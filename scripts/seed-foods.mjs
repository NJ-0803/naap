/**
 * Seed the global food table.
 *
 * Source of truth is db/foods.seed.json — the curated table carried over from
 * the original build, weighted toward Indian home cooking where generic
 * nutrition databases are weakest. Global rows have owner_user_id NULL, so
 * every user sees them and can shadow any of them with their own value.
 *
 *   node scripts/seed-foods.mjs
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
    if (!process.env[k]) {
      process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const sql = neon(process.env.DATABASE_URL);
const seed = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "db", "foods.seed.json"), "utf8")
);

let inserted = 0;
for (const [key, rec] of Object.entries(seed)) {
  if (key.startsWith("_")) continue;
  const p = rec.per100;
  if (!p) continue;
  await sql`
    INSERT INTO foods (owner_user_id, key, aliases, kcal, protein, carbs, fat, fiber, portions)
    VALUES (NULL, ${key}, ${rec.aliases ?? []}, ${p.kcal}, ${p.protein ?? 0},
            ${p.carbs ?? 0}, ${p.fat ?? 0}, ${p.fiber ?? 0},
            ${JSON.stringify(rec.portions ?? {})})
    ON CONFLICT (owner_user_id, key) DO UPDATE
      SET aliases = EXCLUDED.aliases, kcal = EXCLUDED.kcal,
          protein = EXCLUDED.protein, carbs = EXCLUDED.carbs,
          fat = EXCLUDED.fat, fiber = EXCLUDED.fiber,
          portions = EXCLUDED.portions
  `;
  inserted++;
}
console.log(`seeded ${inserted} global foods`);
