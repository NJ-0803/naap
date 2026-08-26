/**
 * Bring across the foods the previous system learned.
 *
 * Learned entries came in two shapes: per100 (the normal case) and per_portion
 * (macros for one serving). The schema here is per-100 only, so per_portion
 * rows are converted using their own serving size — and any that can't be
 * converted safely are reported rather than guessed at.
 */
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  if (!l.includes("=")) continue;
  const i = l.indexOf("="); process.env[l.slice(0, i).trim()] ||= l.slice(i + 1).trim();
}
const sql = neon(process.env.DATABASE_URL);

const USER = Number(process.argv[2]);
const SRC = "/Users/navtejsingh/.hermes/nutrition/foods.json";
const src = JSON.parse(fs.readFileSync(SRC, "utf8"));

// a serving word -> grams, used to convert per_portion entries to per 100 g
const GRAMS = {
  piece: 60, katori: 150, bowl: 200, cup: 240, glass: 250, plate: 250,
  scoop: 30, serving: 100, slice: 30, tbsp: 15, tsp: 5, cube: 15, bottle: 330,
};

let done = 0, skipped = [];
for (const [key, rec] of Object.entries(src)) {
  if (key.startsWith("_") || !rec?._learned) continue;

  let per100 = rec.per100 ? { ...rec.per100 } : null;
  let portions = { ...(rec.portions ?? {}) };

  if (!per100 && rec.per_portion) {
    const [unit, vals] = Object.entries(rec.per_portion)[0] ?? [];
    const grams = GRAMS[String(unit).toLowerCase()];
    if (!grams || !vals?.kcal) { skipped.push(`${key} (no serving size for "${unit}")`); continue; }
    const k = 100 / grams;
    per100 = {
      kcal: vals.kcal * k, protein: (vals.protein ?? 0) * k, carbs: (vals.carbs ?? 0) * k,
      fat: (vals.fat ?? 0) * k, fiber: (vals.fiber ?? 0) * k,
    };
    portions[unit] = grams;
  }
  if (!per100?.kcal) { skipped.push(`${key} (no calories)`); continue; }

  // same ceiling the ledger enforces
  if (per100.kcal > 900) { skipped.push(`${key} (${Math.round(per100.kcal)} kcal/100g — implausible)`); continue; }

  await sql`
    INSERT INTO foods (owner_user_id, key, aliases, kcal, protein, carbs, fat, fiber, portions, learned_at)
    VALUES (${USER}, ${key}, ${rec.aliases ?? []}, ${per100.kcal}, ${per100.protein ?? 0},
            ${per100.carbs ?? 0}, ${per100.fat ?? 0}, ${per100.fiber ?? 0},
            ${JSON.stringify(portions)}, now())
    ON CONFLICT (owner_user_id, key) DO UPDATE
      SET kcal = EXCLUDED.kcal, protein = EXCLUDED.protein, carbs = EXCLUDED.carbs,
          fat = EXCLUDED.fat, fiber = EXCLUDED.fiber, portions = EXCLUDED.portions
  `;
  console.log(`  ✓ ${key.padEnd(26)} ${Math.round(per100.kcal)} kcal/100  ${JSON.stringify(portions)}`);
  done++;
}
console.log(`\n  imported ${done}`);
if (skipped.length) { console.log("  skipped:"); skipped.forEach(s => console.log("   -", s)); }
