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
  | { kind: "logKnown"; meal: string | null; description: string; macros: KnownMacros }
  | { kind: "status" }
  | { kind: "weight"; kg: number }
  | { kind: "height"; cm: number }
  | { kind: "undo"; count: number }
  | { kind: "items" }
  | { kind: "delete"; index: number }
  | { kind: "remove"; food: string }
  | { kind: "show"; day: string | null }
  | { kind: "teach"; food: string; stated: string }
  | { kind: "target"; kcal?: number; protein?: number; carbs?: number; fat?: number; fiber?: number; goal?: string }
  | { kind: "other"; reply: string };

export type RawItem = { name: string; qty: number; unit: string };
export type KnownMacros = {
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
};

const SYSTEM = `You turn a person's message about food into structured data for a macro ledger.

Pick exactly one intent:
- log_food: they described food they ate, for you to price from the food
  table.
- log_known: they already worked out the calories (and maybe macros)
  themselves for the whole meal and just want it stored as-is — an explicit
  total attached to the meal, not a per-item amount to look up. Signal words:
  an "=" or "is"/"came to"/"was" immediately before a calorie number for the
  *whole thing just described*, e.g. "bread + chicken = 560 cals", "my lunch
  was about 700 kcal", "dinner came to 450 calories, 30g protein". Put
  whatever they said the meal was in "description" verbatim (e.g. "bread +
  chicken"); do NOT split it into items or look anything up. If
  breakfast/lunch/dinner/snack is named — even just as the subject, e.g. "my
  lunch was..." — set meal to it, same rule as log_food. Only use this
  when a total number is explicitly given — if they just list foods with
  quantities for you to price, that is log_food.
- get_status: they asked for their aggregate totals or how much is left against
  target — one number per macro, nothing itemized ("how am I doing", "calories
  left", "how much protein do I have").
- log_weight: a bare number, or "w 71.4", or "weighed 71.4" — a bodyweight in kg.
- set_height: they state their height, for BMI — "height 172", "I'm 172cm",
  "my height is 5'8" (convert feet/inches to cm: (feet*12+inches)*2.54). A
  bare number alone is always log_weight, never this — height must be named
  explicitly or carry a height unit (cm, ft, ').
- undo_entry: they want the most recently logged entry (or last N) removed,
  with no specific food named ("undo", "remove the last thing", "undo last 2").
- list_items: they want each food they logged today broken out individually,
  not just the totals — anything asking for a per-item view rather than one
  summed number ("what did I log", "show my items", "breakdown of today",
  "bifurcation of my food", "food i logged", "what all did I eat", "split it
  up", "list my meals"). If the word "food" appears with an ask to see it
  broken down, split up, or itemized, this is list_items, not get_status.
- delete_item: they want one specific numbered entry removed, referencing a
  position in a list they were already shown ("delete item 2", "remove #3",
  "delete 2"). Only use this for a bare list position with no food named.
- remove_food: they name a specific food to remove from today's log ("remove
  idli", "remove 2 idli", "delete the roti", "undo the dal"). A quantity next
  to the food name (e.g. "2" in "remove 2 idli") is not a list position —
  that's still remove_food, not delete_item.
- show_day: they want to see a day's summary ("show me sunday", "how did I do").
- teach_food: they are telling you a food's nutrition ("add beer 220 calories per
  bottle", "roti is 220 kcal per 100g", "paneer has 18g protein"). Pass their
  words through verbatim in "stated" — do not convert or round anything.
- set_targets: they are setting daily goals ("set my target to 1900 calories and
  130g protein", "goal is cut").

For log_food, list every food mentioned with a quantity and unit:
- Use grams when they gave grams: {"name":"chicken breast","qty":150,"unit":"g"}
- Otherwise a portion word: piece, katori, bowl, cup, tbsp, tsp, scoop, slice,
  glass, packet, bar, sub, serving, regular, tall, grande, venti
- Indian foods are common: roti/chapati, dal, rajma, chole, paneer, curd, idli, dosa, poha, sabzi
- Franchise/packaged foods are common too: mcdonalds/mcd, dominos, kfc, subway,
  starbucks, maggi, lays, kurkure, parle-g, bournvita, oreo, dairy milk — use
  their own size word verbatim as the unit (e.g. "grande cappuccino" ->
  {"name":"cappuccino","qty":1,"unit":"grande"}, "1 packet maggi" ->
  {"name":"maggi","qty":1,"unit":"packet"}).
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
      name: "log_known",
      description:
        "Record a meal whose calories (and optionally macros) the user has " +
        "already calculated themselves. Store their numbers exactly as given " +
        "— never estimate or look anything up.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "what the meal was, verbatim, e.g. 'bread + chicken'" },
          meal: {
            type: ["string", "null"],
            enum: ["breakfast", "lunch", "dinner", "snack", null],
            description:
              "Set this whenever breakfast/lunch/dinner/snack is named anywhere in the " +
              "message, even just as the subject, e.g. 'my lunch was 700 kcal' -> "
              + "meal='lunch'. Only null if truly unstated.",
          },
          kcal: { type: "number" },
          protein: { type: "number" },
          carbs: { type: "number" },
          fat: { type: "number" },
          fiber: { type: "number" },
        },
        required: ["description", "kcal"],
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
      name: "set_height",
      description: "Record the user's height in centimetres, for BMI.",
      parameters: {
        type: "object",
        properties: { cm: { type: "number" } },
        required: ["cm"],
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
      name: "list_items",
      description: "Show today's logged entries individually, numbered.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_item",
      description: "Remove one specific numbered entry from today's item list.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer", description: "1-based position in the list, e.g. 2 for 'delete item 2'" },
        },
        required: ["index"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_food",
      description: "Remove the most recent logged entry for one named food today.",
      parameters: {
        type: "object",
        properties: {
          food: { type: "string", description: "the food name, e.g. 'idli'" },
        },
        required: ["food"],
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
    case "log_known": {
      const description = String(args.description ?? "").trim();
      const kcal = Number(args.kcal);
      if (!description || !Number.isFinite(kcal) || kcal <= 0) {
        return { kind: "other", reply: "Give me the meal and its calories, e.g. \"bread + chicken = 560 cals\"." };
      }
      // Small fast models are unreliable at also filling a second field
      // (meal) once they've already committed to the tool call — cheaper
      // and 100% reliable to just look for the word ourselves.
      const named = /\b(breakfast|lunch|dinner|snack)\b/i.exec(`${description} ${text}`);
      const meal = typeof args.meal === "string" ? args.meal : named ? named[1].toLowerCase() : null;
      const pick = (k: string) =>
        Number.isFinite(Number(args[k])) && Number(args[k]) >= 0 ? Number(args[k]) : undefined;
      return {
        kind: "logKnown",
        meal,
        description,
        macros: { kcal, protein: pick("protein"), carbs: pick("carbs"), fat: pick("fat"), fiber: pick("fiber") },
      };
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
    case "set_height": {
      const cm = Number(args.cm);
      if (!Number.isFinite(cm) || cm < 50 || cm > 272) {
        return { kind: "other", reply: "That doesn't look like a height in cm." };
      }
      return { kind: "height", cm };
    }
    case "undo_entry":
      return { kind: "undo", count: Math.max(1, Number(args.count ?? 1)) };
    case "list_items":
      return { kind: "items" };
    case "delete_item": {
      const index = Math.round(Number(args.index));
      if (!Number.isFinite(index) || index < 1) {
        return { kind: "other", reply: "Which one? Send /items to see the numbered list, then say e.g. \"delete 2\"." };
      }
      return { kind: "delete", index };
    }
    case "remove_food": {
      const food = String(args.food ?? "").trim().toLowerCase();
      if (!food) return { kind: "other", reply: "Which food should I remove?" };
      return { kind: "remove", food };
    }
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
