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
- Give your best-known typical per-100 g/ml values in kcal/protein/carbs/fat/fiber —
  these are a fallback, used only for whatever the user didn't state a number for.
- Also give the typical serving sizes in grams, e.g. {"bottle": 330, "glass": 250}
  for a drink, {"piece": 45} for a roti, {"katori": 150} for a curry.
- Indian foods are common. Use realistic home-cooked values including cooking oil.
- If the user stated any number(s) themselves (e.g. "220 calories per 330 ml bottle"),
  put those in "stated" EXACTLY as given, plus the serving size in grams/ml they
  apply to (330 in that example, or 100 if they said "per 100g"). Do NOT divide or
  convert those numbers yourself — the app does that arithmetic, not you. This
  matters even when the number looks wrong to you: report what they said, not what
  you think is correct.
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
        kcal: { type: "number", description: "per 100 g/ml, your best-known typical value" },
        protein: { type: "number" },
        carbs: { type: "number" },
        fat: { type: "number" },
        fiber: { type: "number" },
        portions: {
          type: "object",
          description: 'serving name to grams, e.g. {"bottle":330,"glass":250}',
          additionalProperties: { type: "number" },
        },
        stated: {
          type: "object",
          description:
            "Numbers the USER explicitly gave, unconverted, plus the serving size " +
            "(grams/ml) they apply to. Omit entirely if the user gave no numbers.",
          properties: {
            serving_g: { type: "number", description: "e.g. 330 for 'per 330ml bottle', 100 for 'per 100g'" },
            kcal: { type: "number" },
            protein: { type: "number" },
            carbs: { type: "number" },
            fat: { type: "number" },
            fiber: { type: "number" },
          },
        },
        note: { type: "string", description: "one short line on what was assumed" },
      },
      required: ["key", "kcal", "protein", "carbs", "fat"],
    },
  },
};

/**
 * `stated` carries anything the user asserted ("220 calories per bottle") so the
 * model reports it back rather than inventing — the per-100 conversion for
 * whatever the user stated happens below, in code, not in the model's answer.
 * Letting the model do that division was the bug: on an implausible-looking
 * stated number (e.g. "dragon fruit is 900 calories per 100g"), it would
 * sometimes quietly substitute its own more "reasonable" estimate instead of
 * the number it was just told to use verbatim. Splitting "what did they say"
 * (reliable) from "convert it" (deterministic arithmetic) removes the model's
 * opening to second-guess a correction it was explicitly told not to.
 */
export async function estimateFood(name: string, stated?: string): Promise<FoodFact | null> {
  const ask = stated
    ? `Food: ${name}. The user states: ${stated}.`
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

  // Whatever the user explicitly stated overrides the model's own per-100
  // estimate for that field — converted here, deterministically, instead of
  // trusting the model to have done the division correctly (or at all).
  const s = (a.stated ?? {}) as Record<string, unknown>;
  const servingG = num(s.serving_g);
  if (servingG > 0) {
    const factor = 100 / servingG;
    for (const k of ["kcal", "protein", "carbs", "fat", "fiber"] as const) {
      if (s[k] !== undefined && Number.isFinite(Number(s[k]))) {
        per100[k] = Math.round(Number(s[k]) * factor * 100) / 100;
      }
    }
  }

  // Same ceiling the ledger enforces: nothing edible exceeds ~9 kcal/g, so a
  // per-100 figure above 900 means the model (or a stated conversion) landed
  // on a per-serving number instead of per-100.
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

  // The model sometimes returns underscored keys ("iced_latte"), but every
  // lookup (findFood, parsed log items) is space-separated — an underscored
  // key would silently never match when the food is actually logged.
  const clean = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").slice(0, 60);
  const key = clean(String(a.key ?? name));
  return {
    key: key || clean(name),
    per100,
    portions,
    note: typeof a.note === "string" ? a.note : undefined,
  };
}
