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
  dayTotals, undoEntries, listEntries, deleteEntryAt, deleteLatestByFood, logWeight,
  learnFood, setTargets, setHeight, sql,
} from "@/lib/db";
import {
  currentStreak, setUsername, createLeague, joinLeague, standings, renderStandings,
} from "@/lib/social";
import { weeklyLines } from "@/lib/rivalry";
import { mintToken } from "@/lib/auth";
import { estimateFood } from "@/lib/learn";
import { verifyKcal } from "@/lib/verify";
import {
  findFood, toGrams, macrosFor, implausible, localDay, inferMeal,
  isMassUnit, ZERO, type PricedItem, type Macros,
} from "@/lib/ledger";
import { sendMessage, sendPhoto, renderDay, escapeHtml } from "@/lib/telegram";

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
    // A hard ceiling under maxDuration. The update_id is already claimed at
    // this point (that's what makes Telegram's retries safe to ignore), so
    // any path that runs long enough to hit the platform's own timeout gets
    // killed mid-flight with no reply ever sent — and no way for the user to
    // get a second attempt, since their retry is now a rejected duplicate.
    // Racing a shorter timeout here means we always reply first, even if
    // `handle` is still running in the background when we do.
    await Promise.race([
      handle(chatId, from, text),
      new Promise((_, reject) => setTimeout(() => reject(new Error("handler timeout")), 20_000)),
    ]);
  } catch (err) {
    console.error("handler failed", err);
    await sendMessage(chatId, "That took too long on my side — try again in a moment.");
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

  // The persistent keyboard sends plain text, so translate a button label into
  // the command it represents before routing.
  const BUTTONS: Record<string, string> = {
    "📊 Dashboard": "/web",
    "🔥 Streak": "/streak",
    "🍽 Today": "/today",
    "🏆 Table": "/table",
    "🧾 Items": "/items",
  };
  text = BUTTONS[text] ?? text;

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

    case "logKnown": {
      const macros: Macros = {
        kcal: intent.macros.kcal,
        protein: intent.macros.protein ?? 0,
        carbs: intent.macros.carbs ?? 0,
        fat: intent.macros.fat ?? 0,
        fiber: intent.macros.fiber ?? 0,
      };
      const bad = implausible(macros, null, intent.description);
      if (bad) {
        await sendMessage(chatId, `⚠ ${escapeHtml(bad)}`);
        break;
      }

      const meal = intent.meal ?? inferMeal(user.timezone, now);
      await insertEntries(user.id, day, meal, [
        { food: intent.description, qty: 1, unit: "meal", grams: null, macros, source: "stated" },
      ]);

      const [totals, targets] = await Promise.all([
        dayTotals(user.id, day), getTargets(user.id),
      ]);
      const knownMacros = intent.macros.protein !== undefined || intent.macros.carbs !== undefined ||
        intent.macros.fat !== undefined || intent.macros.fiber !== undefined;
      let out =
        `<b>Logged to ${meal}</b>\n<pre>${escapeHtml(intent.description)} → ${Math.round(macros.kcal)} kcal` +
        (knownMacros ? `  P${Math.round(macros.protein)}` : "") + `</pre>\n`;
      out += renderDay(totals as unknown as Record<string, number>,
                       targets as unknown as Record<string, number>);
      if (!knownMacros) {
        out += `\n<i>Only calories were given — protein/carbs/fat logged as 0.</i>`;
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

    case "height": {
      await setHeight(user.id, intent.cm);
      const targets = await getTargets(user.id);
      await sendMessage(
        chatId,
        `Height set: <b>${intent.cm} cm</b>` +
          (targets.weight_kg
            ? `\nYour BMI will show at the top of your daily card from now on.`
            : `\nLog a weigh-in (e.g. <code>71.4</code>) and your BMI will show at the top of your daily card.`)
      );
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

    case "items":
      await sendItems(chatId, user.id, day);
      break;

    case "delete": {
      const removed = await deleteEntryAt(user.id, day, intent.index);
      if (!removed) {
        await sendMessage(
          chatId,
          `No item #${intent.index} — send /items to see today's numbered list.`
        );
        break;
      }
      const totals = await dayTotals(user.id, day);
      const targets = await getTargets(user.id);
      await sendMessage(
        chatId,
        `Deleted <b>${escapeHtml(removed.food)}</b> ${trim(removed.qty)}${removed.unit ?? ""} ` +
          `(${Math.round(removed.kcal)} kcal)\n` +
          renderDay(totals as unknown as Record<string, number>,
                    targets as unknown as Record<string, number>)
      );
      break;
    }

    case "remove": {
      const removed = await deleteLatestByFood(user.id, day, intent.food);
      if (!removed) {
        await sendMessage(
          chatId,
          `Couldn't find “${escapeHtml(intent.food)}” logged today. Send /items to see what's there.`
        );
        break;
      }
      const totals = await dayTotals(user.id, day);
      const targets = await getTargets(user.id);
      await sendMessage(
        chatId,
        `Removed <b>${escapeHtml(removed.food)}</b> ${trim(removed.qty)}${removed.unit ?? ""} ` +
          `(${Math.round(removed.kcal)} kcal)\n` +
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

    case "teach": {
      const fact = await estimateFood(intent.food, intent.stated);
      if (!fact) {
        await sendMessage(
          chatId,
          `Couldn't turn that into per-100 g numbers. Try e.g. ` +
            `<code>beer is 43 calories per 100ml</code>.`
        );
        break;
      }
      // Written and cross-checked in parallel — the verification lookup
      // never blocks or changes what gets saved, it only adds a note to the
      // reply (see lib/verify.ts).
      const [, warning] = await Promise.all([
        learnFood(user.id, fact.key, fact.per100, fact.portions),
        verifyKcal(fact.key, fact.per100.kcal),
      ]);
      const p = fact.per100;
      const servings = Object.entries(fact.portions)
        .map(([u, g]) => `1 ${u} = ${g} g → ${Math.round((p.kcal * g) / 100)} kcal`)
        .slice(0, 3);
      await sendMessage(
        chatId,
        `Learned <b>${escapeHtml(fact.key)}</b>\n<pre>` +
          escapeHtml(
            `per 100 g/ml: ${Math.round(p.kcal)} kcal  P${Math.round(p.protein)} ` +
              `C${Math.round(p.carbs)} F${Math.round(p.fat)}` +
              (servings.length ? `\n${servings.join("\n")}` : "")
          ) +
          `</pre>` +
          (fact.note ? `\n<i>${escapeHtml(fact.note)}</i>` : "") +
          (warning ? `\n${escapeHtml(warning)}` : "") +
          `\nIt's yours now — say the amount and I'll log it.`
      );
      break;
    }

    case "target": {
      const t = await getTargets(user.id);
      const next = {
        kcal: intent.kcal ?? t.kcal,
        protein: intent.protein ?? t.protein,
        fat: intent.fat ?? t.fat,
        fiber: intent.fiber ?? t.fiber,
        goal: intent.goal ?? t.goal,
        // carbs fill whatever calories protein and fat leave behind
        carbs: intent.carbs ??
          Math.round(
            Math.max(0, (intent.kcal ?? t.kcal) - (intent.protein ?? t.protein) * 4 -
              (intent.fat ?? t.fat) * 9) / 4
          ),
      };
      await setTargets(user.id, next);
      await sendMessage(
        chatId,
        `<b>Targets updated</b>\n<pre>` +
          escapeHtml(
            `kcal     ${Math.round(next.kcal)}\n` +
              `protein  ${Math.round(next.protein)} g\n` +
              `carbs    ${Math.round(next.carbs)} g\n` +
              `fat      ${Math.round(next.fat)} g\n` +
              `fibre    ${Math.round(next.fiber)} g\n` +
              `goal     ${next.goal}`
          ) +
          `</pre>`
      );
      break;
    }

    default:
      await sendMessage(chatId, escapeHtml((intent as { reply: string }).reply));
  }
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * The numbered breakdown of a day — what /items shows and what "delete 2"
 * refers back to. Shared between the slash command and the natural-language
 * path so both number entries identically.
 */
async function sendItems(chatId: number, userId: number, day: string) {
  const rows = await listEntries(userId, day);
  if (!rows.length) {
    await sendMessage(chatId, "Nothing logged today yet.");
    return;
  }
  const lines = rows.map(
    (r, i) => `${i + 1}. ${r.food} ${trim(r.qty)}${r.unit ?? ""} — ${Math.round(r.kcal)} kcal`
  );
  await sendMessage(
    chatId,
    `<b>Today's items</b>\n<pre>${escapeHtml(lines.join("\n"))}</pre>\n` +
      `Wrong one in there? Send <code>/delete 2</code> (or just say “delete 2”) to remove it.`
  );
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
        `<b>Naap</b> — नाप, to measure.\nJust tell me what you ate — “2 rotis and a katori of dal”.\n\n` +
          `<b>Your dashboard</b>\nTap <b>📊 Dashboard</b> below (or send /web) for charts, ` +
          `history and your league. The buttons stay put, so it's always one tap away.\n\n` +
          `<b>Also understands</b>\n` +
          `• “how much protein do I have left”\n• a bare number like <code>71.4</code> (weigh-in)\n` +
          `• “undo” (removes the last thing logged)\n• “show me sunday”\n` +
          `• your height, e.g. “height 172” or /height 172 — shows your BMI at the top of every card\n` +
          `• already did the maths yourself? “bread + chicken = 560 cals” logs it as-is, no lookup\n\n` +
          `<b>Logged something wrong?</b>\nSend /items to see today's list, numbered. ` +
          `Then say <code>delete 2</code> (or /delete 2) to remove just that one — ` +
          `everything else logged that day stays put.\n\n` +
          `<b>Commands</b>\n` +
          `/height &lt;cm&gt; — set your height, for BMI\n` +
          `/items — today's entries, numbered\n` +
          `/delete &lt;n&gt; — remove one specific entry\n` +
          `/streak — your logging streak\n` +
          `/username &lt;handle&gt; — claim a handle\n` +
          `/league &lt;name&gt; — start a friends league\n` +
          `/join &lt;code&gt; — join one\n` +
          `/table — standings\n/web — open the dashboard`,
        true
      );
      return true;

    case "web":
    case "dash": {
      const base = process.env.PUBLIC_BASE_URL ?? "https://naap-zeta.vercel.app";
      const url = `${base}/link?t=${mintToken(user.id)}`;
      await sendMessage(
        chatId,
        `Your dashboard — this link works for 10 minutes and signs you in:\n\n<a href="${url}">${url}</a>\n\n` +
          `<i>Once opened, you stay signed in for 30 days — just visit ` +
          `naap-zeta.vercel.app.</i>`,
        true
      );
      return true;
    }

    case "today": {
      const [totals, targets] = await Promise.all([
        dayTotals(user.id, day), getTargets(user.id),
      ]);
      await sendMessage(
        chatId,
        renderDay(totals as unknown as Record<string, number>,
                  targets as unknown as Record<string, number>)
      );
      return true;
    }

    case "items":
    case "list":
      await sendItems(chatId, user.id, day);
      return true;

    case "delete": {
      const n = Math.round(Number(arg));
      if (!Number.isFinite(n) || n < 1) {
        await sendMessage(chatId, "Usage: <code>/delete 2</code> — send /items first to see the numbers.");
        return true;
      }
      const removed = await deleteEntryAt(user.id, day, n);
      if (!removed) {
        await sendMessage(chatId, `No item #${n} — send /items to see today's numbered list.`);
        return true;
      }
      const [totals, targets] = await Promise.all([
        dayTotals(user.id, day), getTargets(user.id),
      ]);
      await sendMessage(
        chatId,
        `Deleted <b>${escapeHtml(removed.food)}</b> ${trim(removed.qty)}${removed.unit ?? ""} ` +
          `(${Math.round(removed.kcal)} kcal)\n` +
          renderDay(totals as unknown as Record<string, number>,
                    targets as unknown as Record<string, number>)
      );
      return true;
    }

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

    case "height": {
      const cm = Math.round(Number(arg));
      if (!Number.isFinite(cm) || cm < 50 || cm > 272) {
        await sendMessage(chatId, "Usage: <code>/height 172</code> (in cm)");
        return true;
      }
      await setHeight(user.id, cm);
      const targets = await getTargets(user.id);
      await sendMessage(
        chatId,
        `Height set: <b>${cm} cm</b>` +
          (targets.weight_kg
            ? `\nYour BMI will show at the top of your daily card from now on.`
            : `\nLog a weigh-in (e.g. <code>71.4</code>) and your BMI will show at the top of your daily card.`)
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

      // The card is the thing people screenshot into the group chat, so try the
      // image first and fall back to text if Telegram can't fetch it.
      const payload = rows.map((r) => ({
        username: r.username, name: r.name, days_logged: Number(r.days_logged),
        protein_days: Number(r.protein_days), streak: r.streak, score: r.score,
        me: r.user_id === user.id,
      }));
      const base = process.env.PUBLIC_BASE_URL ?? "https://naap-zeta.vercel.app";
      const cardUrl =
        `${base}/api/card/league?name=${encodeURIComponent(leagues[0].name)}` +
        `&days=7&rows=${encodeURIComponent(Buffer.from(JSON.stringify(payload)).toString("base64"))}`;

      const me = rows.find((r) => r.user_id === user.id);
      const caption = me ? weeklyLines(me, rows, 7).join("\n") : undefined;

      const sent = await sendPhoto(chatId, cardUrl, caption);
      if (!sent) {
        await sendMessage(chatId, renderStandings(escapeHtml(leagues[0].name), rows, 7));
      }
      return true;
    }

    default:
      return false;
  }
}
