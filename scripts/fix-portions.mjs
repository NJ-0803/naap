/**
 * Repair foods imported from per-piece values.
 *
 * The old table stored "400 kcal per piece" — that per-piece figure is what the
 * user actually checked, so it is the thing to preserve. My import divided by a
 * guessed 60 g piece, which inflated per-100 to 667 kcal (near pure fat).
 *
 * Instead: ask for a realistic per-100 for the food, then derive the serving
 * weight that reproduces the verified per-piece calories exactly.
 */
import { neon } from "@neondatabase/serverless";
import Groq from "groq-sdk";
import fs from "node:fs";

for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  if (!l.includes("=")) continue;
  const i = l.indexOf("="); process.env[l.slice(0, i).trim()] ||= l.slice(i + 1).trim();
}
const sql = neon(process.env.DATABASE_URL);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const USER = Number(process.argv[2]);

const src = JSON.parse(fs.readFileSync("/Users/navtejsingh/.hermes/nutrition/foods.json", "utf8"));

for (const [key, rec] of Object.entries(src)) {
  if (!rec?._learned || !rec.per_portion) continue;
  const [unit, vals] = Object.entries(rec.per_portion)[0] ?? [];
  if (!vals?.kcal) continue;

  const res = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
    max_tokens: 200, temperature: 0,
    messages: [
      { role: "system", content: "Give realistic nutrition density per 100 g for a food. Nothing exceeds 900 kcal/100 g." },
      { role: "user", content: `Food: ${key}. What is a typical kcal per 100 g?` },
    ],
    tools: [{ type: "function", function: { name: "density",
      parameters: { type: "object", properties: { kcal_per_100g: { type: "number" } }, required: ["kcal_per_100g"] } } }],
  });
  const call = res.choices[0]?.message?.tool_calls?.[0];
  if (!call) { console.log(`  ? ${key}: no answer, left as-is`); continue; }
  const per100kcal = Number(JSON.parse(call.function.arguments).kcal_per_100g);
  if (!(per100kcal > 0 && per100kcal <= 900)) { console.log(`  ? ${key}: implausible density, left as-is`); continue; }

  // grams that reproduce the verified per-piece calories
  const grams = Math.round((vals.kcal / per100kcal) * 100);
  const k = 100 / grams;
  const per100 = {
    kcal: vals.kcal * k, protein: (vals.protein ?? 0) * k, carbs: (vals.carbs ?? 0) * k,
    fat: (vals.fat ?? 0) * k, fiber: (vals.fiber ?? 0) * k,
  };
  await sql`
    UPDATE foods SET kcal=${per100.kcal}, protein=${per100.protein}, carbs=${per100.carbs},
                     fat=${per100.fat}, fiber=${per100.fiber},
                     portions=${JSON.stringify({ [unit]: grams })}
    WHERE owner_user_id=${USER} AND key=${key}
  `;
  console.log(`  ✓ ${key.padEnd(24)} ${Math.round(per100.kcal)} kcal/100g · 1 ${unit} = ${grams}g → ${Math.round(vals.kcal)} kcal (verified)`);
}
