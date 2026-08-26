/**
 * Language -> structure, in exactly one model call.
 *
 * The prompt is deliberately tiny (~400 tokens). The old Hermes-based version
 * shipped 94 KB of tool schemas and skill descriptions on every call and took
 * 40-80s; this does the same job in ~200ms because it asks one small question
 * and nothing else.
 */

import Groq from "groq-sdk";

export const PARSE_MODEL = process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export type Intent =
  | { kind: "log"; meal: string | null; items: RawItem[] }
  | { kind: "status" }
  | { kind: "weight"; kg: number }
  | { kind: "undo"; count: number }
  | { kind: "show"; day: string | null }
  | { kind: "teach"; food: string; stated: string }
  | { kind: "target"; kcal?: number; protein?: number; carbs?: number; fat?: number; fiber?: number; goal?: string }
  | { kind: "other"; reply: string };

export type RawItem = { name: string; qty: number; unit: string };

const SYSTEM = `You turn a person's message about food into structured data for a macro ledger.

Pick exactly one intent:
- log_food: they described food they ate.
- get_status: they asked how much they have eaten or have left.
- log_weight: a bare number, or "w 71.4", or "weighed 71.4" — a bodyweight in kg.
- undo_entry: they want the last entry (or last N) removed.
- show_day: they want to see a day's summary ("show me sunday", "how did I do").
- teach_food: they are telling you a food's nutrition ("add beer 220 calories per
  bottle", "roti is 220 kcal per 100g", "paneer has 18g protein"). Pass their
  words through verbatim in "stated" — do not convert or round anything.
- set_targets: they are setting daily goals ("set my target to 1900 calories and
  130g protein", "goal is cut").

For log_food, list every food mentioned with a quantity and unit:
- Use grams when they gave grams: {"name":"chicken breast","qty":150,"unit":"g"}
- Otherwise a portion word: piece, katori, bowl, cup, tbsp, tsp, scoop, slice, glass
- Indian foods are common: roti/chapati, dal, rajma, chole, paneer, curd, idli, dosa, poha, sabzi
- 1 roti = 1 piece, 1 katori = 1 katori. Do not convert to grams yourself.
- Never invent food that was not mentioned. Never estimate calories — that is done in code.
- Set meal only if stated or obvious; otherwise leave it null.`;

const TOOLS: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "log_food",
      description: "Record food the user says they ate.",
      parameters: {
        type: "object",
        properties: {
          meal: {
            type: ["string", "null"],
            enum: ["breakfast", "lunch", "dinner", "snack", null],
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                qty: { type: "number" },
                unit: { type: "string" },
              },
              required: ["name", "qty", "unit"],
            },
          },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_status",
      description: "Report intake so far and what is left against target.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "log_weight",
      description: "Record a bodyweight in kilograms.",
      parameters: {
        type: "object",
        properties: { kg: { type: "number" } },
        required: ["kg"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_entry",
      description: "Remove the most recent entries.",
      parameters: {
        type: "object",
        properties: { count: { type: "integer", default: 1 } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "teach_food",
      description: "The user is stating a food's nutrition facts.",
      parameters: {
        type: "object",
        properties: {
          food: { type: "string", description: "the food name, e.g. 'beer'" },
          stated: {
            type: "string",
            description: "their numbers verbatim, e.g. '220 calories per bottle'",
          },
        },
        required: ["food", "stated"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_targets",
      description: "Set the user's daily macro targets.",
      parameters: {
        type: "object",
        properties: {
          kcal: { type: "number" },
          protein: { type: "number" },
          carbs: { type: "number" },
          fat: { type: "number" },
          fiber: { type: "number" },
          goal: { type: "string", enum: ["cut", "bulk", "recomp", "maintain"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_day",
      description: "Show a day's summary.",
      parameters: {
        type: "object",
        properties: {
          day: {
            type: ["string", "null"],
            description: "ISO date YYYY-MM-DD, or null for today",
          },
        },
      },
    },
  },
];

export async function parseMessage(text: string, localTime: string): Promise<Intent> {
  const res = await groq.chat.completions.create({
    model: PARSE_MODEL,
    max_tokens: 600,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `[local time ${localTime}] ${text}` },
    ],
    tools: TOOLS,
  });

  const msg = res.choices[0]?.message;
  const call = msg?.tool_calls?.[0];
  if (!call) {
    return { kind: "other", reply: msg?.content?.trim() || "I didn't catch that." };
  }

  let args: Record<string, unknown> = {};
  try {
    args = typeof call.function.arguments === "string"
      ? JSON.parse(call.function.arguments)
      : (call.function.arguments as Record<string, unknown>) ?? {};
  } catch {
    return { kind: "other", reply: "I couldn't read that — try rephrasing." };
  }

  switch (call.function.name) {
    case "log_food": {
      const items = Array.isArray(args.items) ? (args.items as RawItem[]) : [];
      const clean = items
        .filter((i) => i && typeof i.name === "string" && Number.isFinite(Number(i.qty)))
        .map((i) => ({
          name: String(i.name).trim().toLowerCase(),
          qty: Number(i.qty),
          unit: String(i.unit ?? "piece").trim().toLowerCase(),
        }));
      if (!clean.length) return { kind: "other", reply: "No food recognised in that." };
      const meal = typeof args.meal === "string" ? args.meal : null;
      return { kind: "log", meal, items: clean };
    }
    case "get_status":
      return { kind: "status" };
    case "log_weight": {
      const kg = Number(args.kg);
      if (!Number.isFinite(kg) || kg <= 0 || kg > 400) {
        return { kind: "other", reply: "That doesn't look like a weight in kg." };
      }
      return { kind: "weight", kg };
    }
    case "undo_entry":
      return { kind: "undo", count: Math.max(1, Number(args.count ?? 1)) };
    case "show_day":
      return { kind: "show", day: typeof args.day === "string" ? args.day : null };
    case "teach_food": {
      const food = String(args.food ?? "").trim().toLowerCase();
      if (!food) return { kind: "other", reply: "Which food?" };
      return { kind: "teach", food, stated: String(args.stated ?? "").trim() };
    }
    case "set_targets": {
      const pick = (k: string) =>
        Number.isFinite(Number(args[k])) && Number(args[k]) > 0 ? Number(args[k]) : undefined;
      return {
        kind: "target",
        kcal: pick("kcal"), protein: pick("protein"), carbs: pick("carbs"),
        fat: pick("fat"), fiber: pick("fiber"),
        goal: typeof args.goal === "string" ? args.goal : undefined,
      };
    }
    default:
      return { kind: "other", reply: "I'm not sure what you meant." };
  }
}
