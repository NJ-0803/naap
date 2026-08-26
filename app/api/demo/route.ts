/**
 * Public demo: text in, priced macros out. Nothing is stored, no account.
 *
 * This is the landing page's entire argument — you type a meal the way you'd
 * say it, and the numbers come back before you've finished reading the
 * sentence. Telling people that is worthless; letting them do it is the pitch.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseMessage } from "@/lib/parse";
import { sql } from "@/lib/db";
import {
  findFood, toGrams, macrosFor, implausible, isMassUnit,
  type Food, type Macros,
} from "@/lib/ledger";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_CHARS = 200;

// Per-instance and therefore approximate — serverless spreads requests across
// instances. Enough to blunt casual abuse of a key-less public endpoint without
// pretending to be real rate limiting.
const seen = new Map<string, { n: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

function throttled(ip: string): boolean {
  const now = Date.now();
  const rec = seen.get(ip);
  if (!rec || now > rec.reset) {
    seen.set(ip, { n: 1, reset: now + WINDOW_MS });
    if (seen.size > 5000) seen.clear();
    return false;
  }
  rec.n += 1;
  return rec.n > MAX_PER_WINDOW;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "anon";
  if (throttled(ip)) {
    return NextResponse.json(
      { error: "Give it a moment — too many tries." },
      { status: 429 }
    );
  }

  let text = "";
  try {
    text = String((await req.json())?.text ?? "").trim().slice(0, MAX_CHARS);
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "Type what you ate." }, { status: 400 });

  const started = Date.now();

  const intent = await parseMessage(text, "13:20");
  if (intent.kind !== "log") {
    return NextResponse.json({
      items: [],
      note:
        intent.kind === "status"
          ? "That's a question — in the bot it reads your day back."
          : "No food recognised. Try “2 rotis and a katori of dal”.",
      ms: Date.now() - started,
    });
  }

  // global foods only — the demo has no account, so nothing personal is touched
  const foods = (await sql`
    SELECT id, key, aliases, kcal, protein, carbs, fat, fiber, portions
    FROM foods WHERE owner_user_id IS NULL
  `) as Food[];

  const items: {
    food: string; qty: number; unit: string; grams: number | null; macros: Macros;
  }[] = [];
  const unknown: string[] = [];

  for (const it of intent.items.slice(0, 8)) {
    const food = findFood(it.name, foods);
    if (!food) { unknown.push(it.name); continue; }
    const grams = isMassUnit(it.unit) ? it.qty : toGrams(food, it.qty, it.unit);
    if (grams === null) { unknown.push(it.name); continue; }
    const macros = macrosFor(food, grams);
    if (implausible(macros, grams, food.key)) { unknown.push(it.name); continue; }
    items.push({ food: food.key, qty: it.qty, unit: it.unit, grams, macros });
  }

  const total = items.reduce(
    (a, i) => ({
      kcal: a.kcal + i.macros.kcal, protein: a.protein + i.macros.protein,
      carbs: a.carbs + i.macros.carbs, fat: a.fat + i.macros.fat,
      fiber: a.fiber + i.macros.fiber,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );

  return NextResponse.json({
    items, total, unknown,
    meal: intent.meal,
    ms: Date.now() - started,
    note: unknown.length
      ? `${unknown.join(", ")} isn't in the shared table — in the bot you'd teach it once and it's yours forever.`
      : null,
  });
}
