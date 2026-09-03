/**
 * The one place naap asks a model to reason instead of compute.
 *
 * Every number here — averages, deltas, adherence — is already decided by
 * lib/analysis.ts before this file ever runs. The model is handed those
 * numbers and a short list of *candidate foods pulled from the user's own
 * table* (never the whole table, never foods it thinks up itself); its only
 * job is to explain the gap in words and point at 1-3 of those candidates.
 * That keeps the design rule intact — models parse/explain language, code
 * does the arithmetic — while still getting a genuinely non-deterministic
 * "coach" read, which the deterministic panels above it can't give you.
 *
 * Output is cached once per user/period/day (coach_notes) so a page reload
 * doesn't re-roll the wording or re-spend a call.
 */

import Groq from "groq-sdk";
import { PARSE_MODEL } from "./parse";
import { sql } from "./db";
import type { Food, Macros } from "./ledger";
import type { PeriodStats } from "./analysis";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 15_000 });

const GAP_KEYS = ["protein", "fiber", "carbs", "fat"] as const;
type GapKey = (typeof GAP_KEYS)[number];

type Gap = { key: GapKey; deltaPct: number };

/** Macros running at least 15% under target — noise below that isn't worth a model call. */
function findGaps(avg: Macros, targets: Record<string, number>): Gap[] {
  return GAP_KEYS
    .map((key) => ({
      key,
      deltaPct: targets[key] ? ((avg[key] - targets[key]) / targets[key]) * 100 : 0,
    }))
    .filter((g) => g.deltaPct < -15)
    .sort((a, b) => a.deltaPct - b.deltaPct);
}

/** The user's own foods richest in one macro — the only foods the model is allowed to name. */
function topFoodsFor(macro: GapKey, foods: Food[], limit = 5): Food[] {
  return [...foods]
    .filter((f) => f[macro] > 0)
    .sort((a, b) => b[macro] - a[macro])
    .slice(0, limit);
}

const SYSTEM = `You write naap's "coach note" — a short read of one person's logged food data.
Rules, no exceptions:
- Never invent a number. Only use kcal/gram figures given to you in the prompt.
- Only name foods from the CANDIDATES list. Never suggest a food that isn't in it.
- 2-4 sentences, plain prose. No greeting, no markdown, no bullet points, no "as an AI".
- Name the specific gap (e.g. "protein is running 61% under target") and 1-3 candidate
  foods that would close it, citing their per-100g numbers from the candidates list.
- Tone: direct and a little dry. Never preachy, never moralizing about food choices.`;

function buildPrompt(period: "week" | "month", gaps: Gap[], candidates: { macro: GapKey; food: Food }[], targets: Record<string, number>): string {
  const gapLines = gaps
    .map((g) => `${g.key} averaging ${Math.round(100 + g.deltaPct)}% of the ${Math.round(targets[g.key])}g/day target`)
    .join("; ");
  const candLines = candidates
    .map((c) => `${c.food.key} — ${c.macro} ${c.food[c.macro]}g/100g, ${c.food.kcal}kcal/100g`)
    .join("; ");
  const window = period === "week" ? "the last 7 days" : "the last 30 days";
  return `Window: ${window}.\nGaps: ${gapLines}.\nCandidates (already in this user's food table): ${candLines}.\nWrite the coach note.`;
}

export type CoachNote = { text: string };

export async function getOrCreateCoachNote(
  userId: number,
  period: "week" | "month",
  day: string,
  stats: PeriodStats,
  targets: Record<string, number>,
  foods: Food[]
): Promise<CoachNote | null> {
  if (stats.daysLogged < 2) return null;

  const [existing] = (await sql`
    SELECT text FROM coach_notes WHERE user_id = ${userId} AND period = ${period} AND day = ${day}
  `) as { text: string }[];
  if (existing) return { text: existing.text };

  const gaps = findGaps(stats.avg, targets);
  if (!gaps.length) return null;

  const seen = new Set<string>();
  const candidates = gaps
    .flatMap((g) => topFoodsFor(g.key, foods).map((food) => ({ macro: g.key, food })))
    .filter((c) => (seen.has(c.food.key) ? false : (seen.add(c.food.key), true)))
    .slice(0, 12);
  if (!candidates.length) return null;

  let text: string;
  try {
    const res = await groq.chat.completions.create({
      model: PARSE_MODEL,
      temperature: 0.6,
      max_tokens: 220,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildPrompt(period, gaps, candidates, targets) },
      ],
    });
    text = res.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    return null; // the coach is a bonus — never block the page on a model hiccup
  }
  if (!text) return null;

  await sql`
    INSERT INTO coach_notes (user_id, period, day, text) VALUES (${userId}, ${period}, ${day}, ${text})
    ON CONFLICT (user_id, period, day) DO UPDATE SET text = EXCLUDED.text, created_at = now()
  `;
  return { text };
}
