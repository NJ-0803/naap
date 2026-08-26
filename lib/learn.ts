/**
 * Teaching the food table.
 *
 * The first version of this system estimated an unknown food once and wrote it
 * down forever; porting to Groq I dropped that, so an unknown food just failed
 * with "not in your food table yet" and there was no way to answer back. This
 * restores it, in both directions:
 *
 *   - automatic: an unrecognised food gets one estimate call, is checked for
 *     plausibility, learned, and then logged.
 *   - explicit: "add beer 220 calories per bottle" states the numbers outright,
 *     and a stated number always beats an estimate.
 *
 * Learned foods are private to the user (owner_user_id), so correcting your
 * roti never changes anyone else's.
 */

import Groq from "groq-sdk";
import { PARSE_MODEL } from "./parse";
import type { Macros } from "./ledger";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export type FoodFact = {
  key: string;
  per100: Macros;
  portions: Record<string, number>;
  note?: string;
};

const SYSTEM = `You give nutrition facts for foods, PER 100 g (or per 100 ml for drinks).

Rules:
- Always answer per 100 g/ml, never per serving. If the user states a total for a
  serving, convert it: 220 kcal per 330 ml bottle is 67 kcal per 100 ml.
- Also give the typical serving sizes in grams, e.g. {"bottle": 330, "glass": 250}
  for a drink, {"piece": 45} for a roti, {"katori": 150} for a curry.
- Indian foods are common. Use realistic home-cooked values including cooking oil.
- If the user states a number, use exactly that number. Do not second-guess it.
- Nothing exceeds 9 kcal per gram — that is pure fat.`;

const TOOL: Groq.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "food_facts",
    description: "Nutrition facts for one food, per 100 g or 100 ml.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "short lowercase name, e.g. 'beer'" },
        kcal: { type: "number", description: "per 100 g/ml" },
        protein: { type: "number" },
        carbs: { type: "number" },
        fat: { type: "number" },
        fiber: { type: "number" },
        portions: {
          type: "object",
          description: 'serving name to grams, e.g. {"bottle":330,"glass":250}',
          additionalProperties: { type: "number" },
        },
        note: { type: "string", description: "one short line on what was assumed" },
      },
      required: ["key", "kcal", "protein", "carbs", "fat"],
    },
  },
};

/**
 * `stated` carries anything the user asserted ("220 calories per bottle") so the
 * model converts rather than invents.
 */
export async function estimateFood(name: string, stated?: string): Promise<FoodFact | null> {
  const ask = stated
    ? `Food: ${name}. The user states: ${stated}. Convert to per-100 values.`
    : `Food: ${name}. Give typical values.`;

  const res = await groq.chat.completions.create({
    model: PARSE_MODEL,
    max_tokens: 400,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: ask },
    ],
    tools: [TOOL],
  });

  const call = res.choices[0]?.message?.tool_calls?.[0];
  if (!call) return null;

  let a: Record<string, unknown>;
  try {
    a = typeof call.function.arguments === "string"
      ? JSON.parse(call.function.arguments)
      : (call.function.arguments as Record<string, unknown>) ?? {};
  } catch {
    return null;
  }

  const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const per100: Macros = {
    kcal: num(a.kcal), protein: num(a.protein), carbs: num(a.carbs),
    fat: num(a.fat), fiber: num(a.fiber),
  };

  // Same ceiling the ledger enforces: nothing edible exceeds ~9 kcal/g, so a
  // per-100 figure above 900 means the model answered per serving.
  if (!(per100.kcal > 0) || per100.kcal > 900) return null;
  for (const k of ["protein", "carbs", "fat", "fiber"] as const) {
    if (per100[k] < 0 || per100[k] > 100) return null;
  }

  const portions: Record<string, number> = {};
  const raw = (a.portions ?? {}) as Record<string, unknown>;
  for (const [unit, grams] of Object.entries(raw)) {
    const g = Number(grams);
    if (Number.isFinite(g) && g > 0 && g < 3000) portions[unit.toLowerCase()] = g;
  }

  const key = String(a.key ?? name).trim().toLowerCase().slice(0, 60);
  return {
    key: key || name.trim().toLowerCase(),
    per100,
    portions,
    note: typeof a.note === "string" ? a.note : undefined,
  };
}
