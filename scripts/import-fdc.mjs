/**
 * Import USDA FoodData Central generic foods into catalog_foods.
 *
 * Real published values only — nothing is estimated or model-generated.
 * Sources: Foundation + SR Legacy (ingredients, raw/cooked basics) and FNDDS
 * Survey (prepared dishes: salads, sandwiches, pizza, burgers, curries...).
 * FDC has no true restaurant-menu data; Survey's restaurant-style generics
 * are the closest open source.
 *
 *   node scripts/import-fdc.mjs            # resumable; caches to scripts/.fdc-cache.json
 */
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const KEY = process.env.FDC_API_KEY;
const sql = neon(process.env.DATABASE_URL);
const BASE = "https://api.nal.usda.gov/fdc/v1";
const CACHE = path.join(process.cwd(), "scripts/.fdc-cache.json");
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : { ids: null, foods: {} };
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

async function get(url, body) {
  for (let a = 0; a < 5; a++) {
    const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    if (r.ok) return r.json();
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 60_000)); continue; }
    await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
  }
  throw new Error("FDC request failed: " + url);
}

// 1) collect ids
if (!cache.ids) {
  cache.ids = [];
  for (const dt of ["Foundation", "SR Legacy", "Survey (FNDDS)"]) {
    for (let page = 1; ; page++) {
      const rows = await get(`${BASE}/foods/list?api_key=${KEY}&dataType=${encodeURIComponent(dt)}&pageSize=200&pageNumber=${page}`);
      if (!rows.length) break;
      for (const r of rows) cache.ids.push([r.fdcId, dt]);
      if (rows.length < 200) break;
    }
    console.log(dt, "ids so far", cache.ids.length);
  }
  save();
}

// 2) fetch details in batches of 20
const todo = cache.ids.filter(([id]) => !cache.foods[id]);
for (let i = 0; i < todo.length; i += 20) {
  const batch = todo.slice(i, i + 20);
  const rows = await get(`${BASE}/foods?api_key=${KEY}&format=full&fdcIds=${batch.map((b) => b[0]).join(",")}`);
  for (const r of rows) cache.foods[r.fdcId] = r;
  if ((i / 20) % 25 === 0) { save(); console.log("fetched", Object.keys(cache.foods).length, "/", cache.ids.length); }
}
save();

// 3) normalise
const num = (f, ...nums) => {
  for (const n of nums) {
    const x = f.foodNutrients?.find((v) => String(v.nutrient?.number) === n && v.amount != null);
    if (x) return Number(x.amount);
  }
  return null;
};
const UNITS = { cup: "cup", tablespoon: "tbsp", tbsp: "tbsp", teaspoon: "tsp", tsp: "tsp", slice: "slice", piece: "piece",
  serving: "serving", patty: "patty", sandwich: "sandwich", burger: "burger", cookie: "cookie", egg: "piece", fruit: "piece",
  medium: "piece", large: "piece", small: "piece", bowl: "bowl", roll: "piece", link: "piece", fillet: "piece" };

function cleanKey(d) {
  return d.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/,?\s*\b(nfs|ns as to [a-z ]+)\b/g, " ")
    .replace(/[^a-z0-9%&' ,.-]/g, " ").replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
}
function portionsOf(f) {
  const out = {};
  for (const p of f.foodPortions ?? []) {
    const g = Number(p.gramWeight);
    if (!(g > 0)) continue;
    const words = `${p.measureUnit?.name ?? ""} ${p.modifier ?? ""} ${p.portionDescription ?? ""}`.toLowerCase().split(/[^a-z]+/);
    const w = words.find((x) => UNITS[x]);
    if (!w) continue;
    const amt = Number(p.amount) > 0 ? Number(p.amount) : 1;
    if (!(UNITS[w] in out)) out[UNITS[w]] = Math.round((g / amt) * 10) / 10;
  }
  // Survey (FNDDS) dishes list their natural serving first ("1 cheeseburger",
  // "1 burrito") under names the whitelist can't know — use it as the piece.
  if (f.dataType?.startsWith("Survey") && !out.piece && !out.serving) {
    const p = (f.foodPortions ?? []).find((x) => Number(x.gramWeight) > 0 &&
      !/cup|tablespoon|teaspoon|fl oz|ounce|quantity not specified/i.test(`${x.measureUnit?.name} ${x.modifier} ${x.portionDescription}`));
    if (p) out.piece = Math.round((Number(p.gramWeight) / (Number(p.amount) > 0 ? Number(p.amount) : 1)) * 10) / 10;
  }
  return out;
}

const rows = [];
for (const [id, dt] of cache.ids) {
  const f = cache.foods[id];
  if (!f) continue;
  const kcal = num(f, "208", "957", "958");
  if (kcal == null || kcal < 0) continue;
  const key = cleanKey(f.description ?? "");
  if (!key || key.length > 90) continue;
  rows.push({
    fdc_id: Number(id), source: dt, key, kcal,
    protein: num(f, "203") ?? 0, carbs: num(f, "205") ?? 0, fat: num(f, "204") ?? 0, fiber: num(f, "291") ?? 0,
    portions: portionsOf(f),
  });
}
console.log("rows to write", rows.length);
for (let i = 0; i < rows.length; i += 200) {
  const c = rows.slice(i, i + 200);
  await sql`
    INSERT INTO catalog_foods (fdc_id, source, key, kcal, protein, carbs, fat, fiber, portions)
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(c)}::jsonb)
      AS t(fdc_id bigint, source text, key text, kcal real, protein real, carbs real, fat real, fiber real, portions jsonb)
    ON CONFLICT (fdc_id) DO UPDATE SET source = EXCLUDED.source, key = EXCLUDED.key, kcal = EXCLUDED.kcal,
      protein = EXCLUDED.protein, carbs = EXCLUDED.carbs, fat = EXCLUDED.fat, fiber = EXCLUDED.fiber, portions = EXCLUDED.portions`;
}
const [{ n }] = await sql`SELECT count(*)::int n FROM catalog_foods`;
console.log("catalog_foods rows:", n);
