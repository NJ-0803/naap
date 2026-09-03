/**
 * The one place naap asks a model to reason instead of compute.
 *
 * Every number here — averages, deltas, adherence — is already decided by
 * lib/analysis.ts before this file ever runs. The model is handed those
 * numbers and a short list of *candidate foods pulled from the user's own
 * table*, each already priced out to a real, safe serving size (never the
 * whole table, never a food it thinks up, never a quantity it invents);
 * its only job is to explain the gap in words and point at 1-3 of those
 * candidates. That keeps the design rule intact — models parse/explain
 * language, code does the arithmetic — while still getting a genuinely
 * non-deterministic "coach" read, which the deterministic panels above it
 * can't give you.
 *
 * Which model reasons is itself decided by code, not left to the model or
 * hardcoded to one option — see selectTier(). Output is cached once per
 * user/period/day (coach_notes) so a page reload doesn't re-roll the
 * wording, re-pick the model, or re-spend a call.
 */

import Groq from "groq-sdk";
import { sql } from "./db";
import { macrosFor, type Food, type Macros } from "./ledger";
import type { PeriodStats } from "./analysis";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 15_000 });

/**
 * Groq models actually enabled on this account (checked live against
 * /v1/models — Groq's catalog changes, don't assume a model id from memory).
 * Both are reasoning models: they spend part of max_tokens on a hidden
 * `reasoning` pass before writing the real answer, controlled by
 * `reasoning_effort` — get that budget wrong and `content` comes back empty
 * with no error (verified: effort "medium" at max_tokens 300 silently
 * produced zero output; that's what broke this the first time).
 *
 * Routing is deterministic: code picks the tier, never the model itself,
 * based on how much a note has to reconcile. A single clean gap on a week
 * of data is well within a small model thinking briefly; several gaps at
 * once, or a noisier 30-day window, get the larger model and a bit more
 * room to actually cross-reference them — more care, not just more tokens.
 */
type Tier = { model: string; effort: "low" | "medium"; maxTokens: number };

const TIER_FAST: Tier = { model: "openai/gpt-oss-20b", effort: "low", maxTokens: 400 };
const TIER_DEEP: Tier = { model: "openai/gpt-oss-120b", effort: "medium", maxTokens: 700 };

function selectTier(gaps: Gap[], period: "week" | "month"): Tier {
  return gaps.length >= 2 || period === "month" ? TIER_DEEP : TIER_FAST;
}

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

/**
 * The food's own first defined portion — the same "canonical serving"
 * fallback lib/ledger.ts's toGrams() already uses elsewhere in the app, so
 * a suggestion is something a person could actually measure out (a scoop,
 * a cup) rather than an arbitrary 100g slab. This is the actual fix for
 * a model suggesting "100g of whey protein" (over 3 scoops at once): it
 * was only ever handed per-100g density, so 100g was the only quantity it
 * had ever seen. Now it only ever sees one real serving.
 */
function realServing(food: Food): { label: string; grams: number } {
  const entry = Object.entries(food.portions ?? {})[0];
  if (entry) {
    const [unit, grams] = entry;
    return { label: `1 ${unit} (${Math.round(grams)}g)`, grams };
  }
  return { label: "100g", grams: 100 };
}

const SYSTEM = `You write naap's "coach note" — a short read of one person's logged food data.
Rules, no exceptions:
- Never invent a number. Only use figures given to you in the prompt.
- Only name foods from the CANDIDATES list, and only at the exact serving size given for
  each one (e.g. "1 scoop (30g): 23g protein"). Those are real, safe single servings —
  never scale one up, never suggest stacking two or more servings of the same item in
  one sitting, and never talk about them as if the number were per-100g.
- Stay realistic and safe. A concentrated food (protein powder, oil, seeds) has a small
  sane serving for a reason — respect it even if the math would "close the gap" faster
  with more.
- 2-4 sentences, plain prose. No greeting, no markdown, no bullet points, no "as an AI".
- Name the specific gap (e.g. "protein is running 61% under target") and 1-3 candidate
  foods, at their given serving, that would help close it.
- Tone: direct and a little dry. Never preachy, never moralizing about food choices.`;

function buildPrompt(
  period: "week" | "month",
  gaps: Gap[],
  candidates: { macro: GapKey; food: Food }[],
  targets: Record<string, number>
): string {
  const gapLines = gaps
    .map((g) => `${g.key} averaging ${Math.round(100 + g.deltaPct)}% of the ${Math.round(targets[g.key])}g/day target`)
    .join("; ");
  const candLines = candidates
    .map((c) => {
      const serving = realServing(c.food);
      const m = macrosFor(c.food, serving.grams);
      return `${c.food.key} — ${serving.label}: ${Math.round(m[c.macro])}g ${c.macro}, ${Math.round(m.kcal)}kcal`;
    })
    .join("; ");
  const window = period === "week" ? "the last 7 days" : "the last 30 days";
  return `Window: ${window}.\nGaps: ${gapLines}.\nCandidates (real single servings, already in this user's food table): ${candLines}.\nWrite the coach note.`;
}

export type CoachNote = { text: string; model: string };

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
    SELECT text, model FROM coach_notes WHERE user_id = ${userId} AND period = ${period} AND day = ${day}
  `) as { text: string; model: string | null }[];
  if (existing) return { text: existing.text, model: existing.model ?? TIER_FAST.model };

  const gaps = findGaps(stats.avg, targets);
  if (!gaps.length) return null;

  const seen = new Set<string>();
  const candidates = gaps
    .flatMap((g) => topFoodsFor(g.key, foods).map((food) => ({ macro: g.key, food })))
    .filter((c) => (seen.has(c.food.key) ? false : (seen.add(c.food.key), true)))
    .slice(0, 12);
  if (!candidates.length) return null;

  const tier = selectTier(gaps, period);

  let text: string;
  try {
    const res = await groq.chat.completions.create({
      model: tier.model,
      temperature: 0.6,
      max_tokens: tier.maxTokens,
      reasoning_effort: tier.effort,
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
    INSERT INTO coach_notes (user_id, period, day, text, model)
    VALUES (${userId}, ${period}, ${day}, ${text}, ${tier.model})
    ON CONFLICT (user_id, period, day) DO UPDATE SET text = EXCLUDED.text, model = EXCLUDED.model, created_at = now()
  `;
  return { text, model: tier.model };
}
