/**
 * Sanity-check the food table's generic (non-Indian-dish) entries against
 * USDA FoodData Central — the same open, public-domain source the seed
 * comment already cites ("IFCT 2017 / USDA FDC / label averages").
 *
 * Read-only: queries the live `foods` table and the public FDC API, prints
 * a delta table, writes nothing.
 *
 *   node scripts/verify-usda.mjs
 *
 * FDC's DEMO_KEY is rate-limited (~30 req/hr/IP) — get a free key at
 * api.data.gov/signup and set FDC_API_KEY to run this more than occasionally.
 */
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const FDC_KEY = process.env.FDC_API_KEY ?? "DEMO_KEY";
const sql = neon(process.env.DATABASE_URL);

// naap key -> best FDC search query. Only generic single-ingredient foods
// have a clean USDA match — composite Indian dishes (roti, dal, biryani...)
// don't, so those stay out of this list on purpose.
const PAIRS = [
  ["chicken breast cooked", "chicken breast meat only cooked roasted"],
  ["egg white", "egg white raw"],
  ["banana", "bananas raw"],
  ["apple", "apples raw with skin"],
  ["almonds", "nuts almonds"],
  ["walnuts", "nuts walnuts english"],
  ["cashews", "nuts cashew nuts raw"],
  ["white rice cooked", "rice white long-grain regular cooked"],
  ["brown rice cooked", "rice brown long-grain cooked"],
  ["potato boiled", "potatoes boiled cooked without skin"],
  ["honey", "honey"],
  ["butter", "butter salted"],
  ["watermelon", "watermelon raw"],
  ["papaya", "papayas raw"],
  ["cucumber", "cucumber with peel raw"],
  ["oats dry", "cereals oats regular and quick not fortified dry"],
  ["tofu", "tofu raw firm"],
];

async function fdcLookup(query) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search` +
    `?query=${encodeURIComponent(query)}&dataType=Foundation,SR%20Legacy&pageSize=1&api_key=${FDC_KEY}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (body.error?.code === "OVER_RATE_LIMIT") return "RATE_LIMITED";
  if (!res.ok) return null;
  const food = body.foods?.[0];
  if (!food) return null;
  const val = (name) => food.foodNutrients.find((n) => n.nutrientName === name)?.value ?? 0;
  // "Energy" appears twice per food — once in kJ, once in KCAL. Matching by
  // name alone silently grabs whichever one the API happened to list first.
  const kcal = food.foodNutrients.find((n) => n.nutrientName === "Energy" && n.unitName === "KCAL")?.value ?? 0;
  return {
    description: food.description,
    kcal,
    protein: val("Protein"),
    carbs: val("Carbohydrate, by difference"),
    fat: val("Total lipid (fat)"),
  };
}

function pct(mine, theirs) {
  if (!theirs) return "—";
  const d = ((mine - theirs) / theirs) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
}

console.log(`Comparing ${PAIRS.length} entries against USDA FoodData Central (Foundation/SR Legacy)\n`);
console.log(
  "key".padEnd(24) + "naap kcal/P".padEnd(14) + "fdc kcal/P".padEnd(14) +
  "Δkcal".padEnd(8) + "ΔP".padEnd(8) + "fdc match"
);

let flagged = 0;
for (const [key, query] of PAIRS) {
  const rows = await sql`
    SELECT kcal, protein FROM foods WHERE owner_user_id IS NULL AND key = ${key}
  `;
  const mine = rows[0];
  if (!mine) {
    console.log(`${key.padEnd(24)} — not in food table (skipped)`);
    continue;
  }
  const fdc = await fdcLookup(query);
  if (fdc === "RATE_LIMITED") {
    console.log(`${key.padEnd(24)} — FDC rate limit hit; get a free key at api.data.gov/signup and set FDC_API_KEY`);
    break;
  }
  if (!fdc) {
    console.log(`${key.padEnd(24)} — no FDC match for "${query}"`);
    continue;
  }
  const dk = pct(mine.kcal, fdc.kcal);
  const dp = pct(mine.protein, fdc.protein);
  const bigDrift = Math.abs(mine.kcal - fdc.kcal) / (fdc.kcal || 1) > 0.15;
  if (bigDrift) flagged++;
  console.log(
    key.padEnd(24) +
    `${mine.kcal.toFixed(0)}/${mine.protein.toFixed(0)}`.padEnd(14) +
    `${fdc.kcal.toFixed(0)}/${fdc.protein.toFixed(0)}`.padEnd(14) +
    dk.padEnd(8) + dp.padEnd(8) +
    (bigDrift ? "⚠ " : "  ") + fdc.description
  );
  // FDC's own rate limit is generous but polite pacing avoids 429s on DEMO_KEY
  await new Promise((r) => setTimeout(r, 150));
}

console.log(`\n${flagged} entr${flagged === 1 ? "y" : "ies"} drift >15% from FDC on calories — worth a manual look, not necessarily wrong.`);
