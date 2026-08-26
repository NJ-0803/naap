/**
 * The macro engine.
 *
 * The model parses language into (name, qty, unit). Everything numeric happens
 * here, in code. That split is the whole reason this system can be trusted:
 * models are good at language and unreliable at arithmetic, so no calorie in
 * the database is ever produced by one.
 */

export const UNITS_MASS = new Set(["g", "gm", "gms", "gram", "grams"]);
export const UNITS_VOLUME = new Set(["ml", "millilitre", "milliliter"]);

export type Food = {
  id: number;
  key: string;
  aliases: string[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  portions: Record<string, number>;
};

export type Macros = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

export type ParsedItem = { name: string; qty: number; unit: string };

export type PricedItem = {
  food: string;
  qty: number;
  unit: string;
  grams: number | null;
  macros: Macros;
  source: "table" | "learned";
};

export const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

/** Normalise a unit for lookup: lowercase, singular. */
export function normUnit(unit: string | null | undefined): string {
  const u = (unit ?? "").trim().toLowerCase();
  return u.endsWith("s") && u.length > 1 ? u.slice(0, -1) : u;
}

export function isMassUnit(unit: string | null | undefined): boolean {
  const raw = (unit ?? "").trim().toLowerCase();
  const n = normUnit(unit);
  return (
    UNITS_MASS.has(raw) || UNITS_VOLUME.has(raw) ||
    UNITS_MASS.has(n) || UNITS_VOLUME.has(n)
  );
}

/**
 * Resolve a spoken food name against the table: exact key, then alias, then
 * shortest substring match. Aliases are why "chapati" must never become a
 * second food alongside "roti".
 */
export function findFood(name: string, foods: Food[]): Food | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;

  const exact = foods.find((f) => f.key === q);
  if (exact) return exact;

  const byAlias = foods.find((f) => f.aliases.some((a) => a.toLowerCase() === q));
  if (byAlias) return byAlias;

  const hits = foods.filter(
    (f) =>
      q.includes(f.key) ||
      f.key.includes(q) ||
      f.aliases.some((a) => {
        const al = a.toLowerCase();
        return q.includes(al) || al.includes(q);
      })
  );
  if (!hits.length) return null;
  // shortest key wins — the most specific match
  return hits.sort((a, b) => a.key.length - b.key.length)[0];
}

/** qty + unit -> grams, using the food's own portion table. */
export function toGrams(food: Food, qty: number, unit: string): number | null {
  if (isMassUnit(unit)) return qty;

  const u = normUnit(unit);
  const portions = Object.fromEntries(
    Object.entries(food.portions ?? {}).map(([k, v]) => [normUnit(k), v])
  );
  if (u in portions) return qty * portions[u];

  // generic serving words fall back to the food's first defined portion
  if (!u || ["", "piece", "serving", "unit", "portion"].includes(u)) {
    const first = Object.values(portions)[0];
    if (typeof first === "number") return qty * first;
  }
  return null;
}

export function macrosFor(food: Food, grams: number): Macros {
  const k = grams / 100;
  return {
    kcal: food.kcal * k,
    protein: food.protein * k,
    carbs: food.carbs * k,
    fat: food.fat * k,
    fiber: food.fiber * k,
  };
}

/**
 * Physical plausibility. Pure fat is 9 kcal/g — the ceiling for any food.
 * Anything above it is a unit mix-up, not a meal. A health ledger that
 * silently absorbs a 44,000 kcal row is worse than one that refuses.
 */
export function implausible(
  m: Macros,
  grams: number | null,
  name: string
): string | null {
  if (grams && m.kcal > 9.5 * grams) {
    return `${name}: ${m.kcal.toFixed(0)} kcal for ${grams.toFixed(0)} g ` +
      `(${(m.kcal / grams).toFixed(1)} kcal/g). Nothing exceeds ~9 kcal/g.`;
  }
  if (m.kcal > 5000) {
    return `${name}: ${m.kcal.toFixed(0)} kcal in one item is not plausible.`;
  }
  for (const key of ["protein", "carbs", "fat", "fiber"] as const) {
    if (grams && m[key] > grams * 1.02) {
      return `${name}: ${m[key].toFixed(0)} g ${key} in ${grams.toFixed(0)} g of food.`;
    }
  }
  return null;
}

export function sum(list: Macros[]): Macros {
  return list.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat,
      fiber: acc.fiber + m.fiber,
    }),
    { ...ZERO }
  );
}

/** The local calendar day for a user, so a late dinner lands on the right date. */
export function localDay(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Infer the meal from local time when the user didn't name one. */
export function inferMeal(timezone: string, at: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(at)
  );
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 22) return "dinner";
  return "snack";
}
