/**
 * Telegram webhook.
 *
 * The whole hot path lives here: verify -> claim -> parse -> price -> store ->
 * reply. One model call, one round of database writes, no agent loop.
 *
 * Telegram expects a 200 quickly and retries anything else, so every failure
 * path still returns 200 — the update id claim is what makes those retries
 * safe rather than duplicating a meal.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseMessage } from "@/lib/parse";
import {
  upsertUser, getTargets, loadFoods, claimUpdate, insertEntries,
  dayTotals, undoEntries, logWeight, sql,
} from "@/lib/db";
import {
  currentStreak, setUsername, createLeague, joinLeague, standings, renderStandings,
} from "@/lib/social";
import {
  findFood, toGrams, macrosFor, implausible, localDay, inferMeal,
  isMassUnit, ZERO, type PricedItem, type Macros,
} from "@/lib/ledger";
import { sendMessage, renderDay, escapeHtml } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 30;

const ok = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  // Telegram signs webhooks with a secret we set at registration time.
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return ok();
  }

  const msg = update?.message ?? update?.edited_message;
  const updateId = update?.update_id;
  if (!msg || typeof updateId !== "number") return ok();

  // Idempotency: a retried update is dropped here, before anything is written.
  if (!(await claimUpdate(updateId))) return ok();

  const chatId = msg.chat?.id;
  const from = msg.from;
  if (!chatId || !from?.id) return ok();

  const text: string = (msg.text ?? msg.caption ?? "").trim();
  if (!text) {
    await sendMessage(chatId, "Send me what you ate — e.g. “2 rotis and a katori of dal”.");
    return ok();
  }

  try {
    await handle(chatId, from, text);
  } catch (err) {
    console.error("handler failed", err);
    await sendMessage(chatId, "Something broke on my side. Try again in a moment.");
  }
  return ok();
}

async function handle(
  chatId: number,
  from: { id: number; first_name?: string },
  text: string
) {
  const user = await upsertUser(from.id, chatId, from.first_name ?? null);
  const now = new Date();
  const day = localDay(user.timezone, now);
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: user.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);

  // Slash commands are handled directly — no model call, so they answer in
  // milliseconds and cost nothing.
  if (text.startsWith("/")) {
    const handled = await slashCommand(chatId, user, text, day);
    if (handled) return;
  }

  const intent = await parseMessage(text, localTime);

  switch (intent.kind) {
    case "log": {
      const foods = await loadFoods(user.id);
      const priced: PricedItem[] = [];
      const problems: string[] = [];

      for (const item of intent.items) {
        const food = findFood(item.name, foods);
        if (!food) {
          problems.push(`${item.name} — not in your food table yet`);
          continue;
        }
        const grams = isMassUnit(item.unit) ? item.qty : toGrams(food, item.qty, item.unit);
        if (grams === null) {
          problems.push(`${item.name} — tell me the amount in grams`);
          continue;
        }
        const macros = macrosFor(food, grams);
        const bad = implausible(macros, grams, food.key);
        if (bad) {
          problems.push(bad);
          continue;
        }
        priced.push({
          food: food.key, qty: item.qty, unit: item.unit,
          grams, macros, source: "table",
        });
      }

      const meal = intent.meal ?? inferMeal(user.timezone, now);
      if (priced.length) await insertEntries(user.id, day, meal, priced);

      const [totals, targets] = await Promise.all([
        dayTotals(user.id, day), getTargets(user.id),
      ]);

      const lines = priced.map(
        (p) =>
          `+ ${p.food} ${trim(p.qty)}${p.unit} → ${Math.round(p.macros.kcal)} kcal` +
          `  P${Math.round(p.macros.protein)}`
      );
      let out = lines.length
        ? `<b>Logged to ${meal}</b>\n<pre>${escapeHtml(lines.join("\n"))}</pre>\n`
        : "";
      out += renderDay(totals as unknown as Record<string, number>,
                       targets as unknown as Record<string, number>);
      if (problems.length) {
        out += `\n${problems.map((p) => "⚠ " + escapeHtml(p)).join("\n")}`;
      }
      await sendMessage(chatId, out);
      break;
    }

    case "status": {
      const [totals, targets] = await Promise.all([
        dayTotals(user.id, day), getTargets(user.id),
      ]);
      const left = Math.max(0, targets.kcal - (totals.kcal ?? 0));
      const pLeft = Math.max(0, targets.protein - (totals.protein ?? 0));
      await sendMessage(
        chatId,
        renderDay(totals as unknown as Record<string, number>,
                  targets as unknown as Record<string, number>) +
          `\n${Math.round(left)} kcal and ${Math.round(pLeft)} g protein left today.`
      );
      break;
    }

    case "weight": {
      await logWeight(user.id, day, intent.kg);
      await sendMessage(chatId, `Weight logged: <b>${intent.kg} kg</b>`);
      break;
    }

    case "undo": {
      const removed = await undoEntries(user.id, intent.count);
      if (!removed.length) {
        await sendMessage(chatId, "Nothing to undo.");
        break;
      }
      const totals = await dayTotals(user.id, day);
      const targets = await getTargets(user.id);
      const lines = removed.map(
        (r) => `− ${r.food} ${trim(r.qty)}${r.unit ?? ""} (${Math.round(r.kcal)} kcal)`
      );
      await sendMessage(
        chatId,
        `<pre>${escapeHtml(lines.join("\n"))}</pre>\n` +
          renderDay(totals as unknown as Record<string, number>,
                    targets as unknown as Record<string, number>)
      );
      break;
    }

    case "show": {
      const target = intent.day ?? day;
      const [totals, targets] = await Promise.all([
        dayTotals(user.id, target), getTargets(user.id),
      ]);
      await sendMessage(
        chatId,
        `<b>${target}</b>\n` +
          renderDay(totals as unknown as Record<string, number>,
                    targets as unknown as Record<string, number>)
      );
      break;
    }

    default:
      await sendMessage(chatId, escapeHtml(intent.reply));
  }
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** Returns true when the command was recognised and answered. */
async function slashCommand(
  chatId: number,
  user: { id: number; username?: string | null },
  text: string,
  day: string
): Promise<boolean> {
  const [rawCmd, ...rest] = text.slice(1).split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "start":
    case "help":
      await sendMessage(
        chatId,
        `<b>NutriLog</b>\nJust tell me what you ate — “2 rotis and a katori of dal”.\n\n` +
          `<b>Also understands</b>\n` +
          `• “how much protein do I have left”\n• a bare number like <code>71.4</code> (weigh-in)\n` +
          `• “undo”\n• “show me sunday”\n\n` +
          `<b>Commands</b>\n` +
          `/streak — your logging streak\n` +
          `/username &lt;handle&gt; — claim a handle\n` +
          `/league &lt;name&gt; — start a friends league\n` +
          `/join &lt;code&gt; — join one\n` +
          `/table — standings`
      );
      return true;

    case "streak": {
      const n = await currentStreak(user.id, day);
      await sendMessage(
        chatId,
        n === 0
          ? "No streak yet — log something today to start one. 🔥"
          : `🔥 <b>${n} day${n === 1 ? "" : "s"}</b> logged in a row.`
      );
      return true;
    }

    case "username": {
      if (!arg) {
        await sendMessage(chatId, "Usage: <code>/username yourhandle</code>");
        return true;
      }
      const res = await setUsername(user.id, arg);
      await sendMessage(
        chatId,
        res === "ok"
          ? `You're <b>@${arg.replace(/^@/, "").toLowerCase()}</b> on the leaderboards.`
          : res === "taken"
          ? "That handle's taken — try another."
          : "Handles are 3–20 characters: letters, numbers, underscores."
      );
      return true;
    }

    case "league": {
      if (!arg) {
        await sendMessage(chatId, "Usage: <code>/league Gym Bros</code>");
        return true;
      }
      const league = await createLeague(user.id, arg);
      await sendMessage(
        chatId,
        `Created <b>${escapeHtml(arg)}</b>.\n\nShare this code:\n<code>${league.join_code}</code>\n\n` +
          `Friends join with <code>/join ${league.join_code}</code>`
      );
      return true;
    }

    case "join": {
      if (!arg) {
        await sendMessage(chatId, "Usage: <code>/join ABC123</code>");
        return true;
      }
      const joined = await joinLeague(user.id, arg);
      await sendMessage(
        chatId,
        joined
          ? `Joined <b>${escapeHtml(joined.name)}</b>. See standings with /table`
          : "No league with that code."
      );
      return true;
    }

    case "table": {
      const leagues = (await sql`
        SELECT l.id, l.name FROM leagues l
        JOIN league_members m ON m.league_id = l.id
        WHERE m.user_id = ${user.id} ORDER BY l.id LIMIT 1
      `) as { id: number; name: string }[];
      if (!leagues.length) {
        await sendMessage(chatId, "You're not in a league yet — /league &lt;name&gt; to start one.");
        return true;
      }
      const since = new Date(`${day}T00:00:00Z`);
      since.setUTCDate(since.getUTCDate() - 6);
      const rows = await standings(leagues[0].id, since.toISOString().slice(0, 10), day);
      await sendMessage(chatId, renderStandings(escapeHtml(leagues[0].name), rows, 7));
      return true;
    }

    default:
      return false;
  }
}
