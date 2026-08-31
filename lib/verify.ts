/**
 * Cross-checks a newly-learned food's calories against open, public
 * nutrition databases before the bot trusts it forever.
 *
 * This only runs from the `teach` flow (see lib/learn.ts) — the one place an
 * LLM-produced or user-typed number gets written to the food table and reused
 * for every future log. It never overrides anything; a stated number still
 * always wins (that rule lives in lib/learn.ts's SYSTEM prompt). This just
 * flags a number worth a second look, whether the drift came from the
 * model's guess or a plain typo — same spirit as ledger.ts's implausible()
 * 9 kcal/g guard, just checked against a real reference instead of a
 * physical ceiling.
 *
 * Both lookups are best-effort: on timeout, error, or no match, verification
 * silently no-ops rather than blocking the reply — a miss here isn't itself
 * suspicious, since plenty of home-cooked/Indian dishes genuinely aren't in
 * either database.
 */

const FDC_KEY = process.env.FDC_API_KEY ?? "DEMO_KEY";
const LOOKUP_TIMEOUT_MS = 3_000;

// Generous on purpose — this is a sanity check, not a precision match. Fuzzy
// name search can land on a different variant of the same food (a different
// brand's roti, a sweetened vs. plain kombucha), so a tight threshold would
// flag far more near-misses than real errors.
const DRIFT_THRESHOLD = 0.35;

type Match = { source: string; kcal: number; description: string };

async function checkFDC(name: string): Promise<Match | null> {
  try {
    const url =
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(name)}` +
      `&dataType=Foundation,SR%20Legacy&pageSize=1&api_key=${FDC_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    const body = await res.json().catch(() => null);
    const food = body?.foods?.[0];
    if (!food) return null;
    const kcal = food.foodNutrients?.find(
      (n: { nutrientName: string; unitName: string; value: number }) =>
        n.nutrientName === "Energy" && n.unitName === "KCAL"
    )?.value;
    if (typeof kcal !== "number") return null;
    return { source: "USDA", kcal, description: food.description };
  } catch {
    return null;
  }
}

async function checkOFF(name: string): Promise<Match | null> {
  try {
    const url =
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}` +
      `&search_simple=1&action=process&json=1&page_size=1`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      headers: { "User-Agent": "naap-verify/1.0" },
    });
    const body = await res.json().catch(() => null);
    const product = body?.products?.[0];
    const kcal = product?.nutriments?.["energy-kcal_100g"];
    if (typeof kcal !== "number" || kcal <= 0) return null;
    return { source: "Open Food Facts", kcal, description: product.product_name ?? name };
  } catch {
    return null;
  }
}

/**
 * Returns a one-line warning for the reply when the learned kcal drifts far
 * from a public source, or null when it either roughly matches or nothing
 * was found. Both databases are queried in parallel so this adds at most
 * ~LOOKUP_TIMEOUT_MS to the reply, not the sum of both.
 */
export async function verifyKcal(name: string, kcal: number): Promise<string | null> {
  const [fdc, off] = await Promise.all([checkFDC(name), checkOFF(name)]);
  const match = fdc ?? off; // USDA is public-domain and less noisy than user-submitted OFF entries
  if (!match) return null;

  const drift = Math.abs(kcal - match.kcal) / match.kcal;
  if (drift < DRIFT_THRESHOLD) return null;

  return (
    `⚠ ${match.source} lists "${match.description}" at ~${Math.round(match.kcal)} kcal/100g — ` +
    `worth double-checking your ${Math.round(kcal)}.`
  );
}
