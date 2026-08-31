/**
 * Find real, commonly-logged Indian packaged/branded products that aren't in
 * the food table yet — using Open Food Facts (open data, ODbL license, no
 * API key needed) as the candidate source, ranked by how often people have
 * actually scanned each product.
 *
 * Read-only: prints candidates for manual review. It does not write to
 * db/foods.seed.json — this project's own history (see git log) shows gaps
 * get added by hand, checked against existing aliases first, so a near-dupe
 * like "yellow dal" doesn't fork off "dal cooked" as a second entry.
 *
 *   node scripts/find-food-gaps.mjs [n]     # n = candidates to show, default 25
 */
import fs from "node:fs";
import path from "node:path";

const N = Number(process.argv[2]) || 25;

const foods = JSON.parse(fs.readFileSync(path.join(process.cwd(), "db/foods.seed.json"), "utf8"));
const known = [];
for (const [key, entry] of Object.entries(foods)) {
  if (key === "_comment") continue;
  known.push(key.toLowerCase());
  for (const a of entry.aliases ?? []) known.push(a.toLowerCase());
}

function knownAlready(name) {
  const q = name.toLowerCase();
  return known.some((k) => q.includes(k) || k.includes(q));
}

// Pull popular India-tagged products, most-scanned first — that ordering is
// exactly "what people actually log", the same bar this project's own past
// gap-finding passes (restaurant menus, franchise lists) used.
// OFF returns a 503 HTML page above ~page_size=50 with the full `nutriments`
// field expanded — paging in smaller batches avoids that without losing
// coverage.
const PAGE_SIZE = 40;
const PAGES = 3;

async function fetchPage(page) {
  const url =
    `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=india` +
    `&sort_by=unique_scans_n&page_size=${PAGE_SIZE}&page=${page}` +
    `&fields=product_name,brands,nutriments,code`;
  const res = await fetch(url, { headers: { "User-Agent": "naap-gap-finder/1.0" } });
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) {
    console.error(`  (page ${page}: OFF returned ${res.status}, skipping)`);
    return [];
  }
  const body = await res.json();
  return body.products ?? [];
}

const products = [];
for (let page = 1; page <= PAGES; page++) {
  products.push(...(await fetchPage(page)));
  await new Promise((r) => setTimeout(r, 300));
}

const seen = new Set();
const candidates = [];
for (const p of products) {
  const name = (p.product_name ?? "").trim();
  if (!name) continue;
  const kcal = p.nutriments?.["energy-kcal_100g"];
  const protein = p.nutriments?.["proteins_100g"];
  if (typeof kcal !== "number" || kcal <= 0) continue; // water/salt/etc — not a macro-tracking gap

  const norm = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (seen.has(norm) || knownAlready(norm)) continue;
  seen.add(norm);
  candidates.push({ name, brand: p.brands ?? "", kcal, protein: protein ?? null });
}

console.log(`Checked ${products.length} popular India-tagged products from Open Food Facts.`);
console.log(`${candidates.length} aren't in the food table (by key or alias substring match).\n`);
console.log("candidate".padEnd(34) + "brand".padEnd(22) + "kcal/100g".padEnd(11) + "protein");
for (const c of candidates.slice(0, N)) {
  console.log(
    c.name.slice(0, 32).padEnd(34) +
    c.brand.slice(0, 20).padEnd(22) +
    String(Math.round(c.kcal)).padEnd(11) +
    (c.protein !== null ? c.protein.toFixed(1) + "g" : "—")
  );
}
console.log(`\nReview before adding — Open Food Facts entries are user-submitted, so cross-check`);
console.log(`against a label/official source, same as every past batch in db/foods.seed.json.`);
