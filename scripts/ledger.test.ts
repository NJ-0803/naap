import { findFood, toGrams, macrosFor, implausible, inferMeal, localDay, bmi, bmiCategory, type Food } from "../lib/ledger.ts";

const foods: Food[] = [
  { id: 1, key: "roti", aliases: ["chapati", "phulka", "rotis"], kcal: 297, protein: 11, carbs: 58, fat: 3.7, fiber: 8.4, portions: { piece: 45 } },
  { id: 2, key: "dal cooked", aliases: ["dal", "daal"], kcal: 116, protein: 7, carbs: 16, fat: 2.5, fiber: 4, portions: { katori: 150 } },
  { id: 3, key: "chicken breast cooked", aliases: ["chicken breast"], kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, portions: { piece: 120 } },
];

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
};

// the bug that created a second "chapati" food with different calories
const viaAlias = findFood("chapati", foods);
check("chapati resolves to roti (alias)", viaAlias?.key === "roti", `got ${viaAlias?.key}`);
check("rotis (plural) resolves", findFood("rotis", foods)?.key === "roti");

// portion conversion
const roti = findFood("roti", foods)!;
check("2 roti = 90 g", toGrams(roti, 2, "piece") === 90, `got ${toGrams(roti, 2, "piece")}`);
const dal = findFood("dal", foods)!;
check("1 katori dal = 150 g", toGrams(dal, 1, "katori") === 150);
check("grams pass through", toGrams(roti, 150, "g") === 150);

// the arithmetic
const m = macrosFor(roti, 90);
check("2 roti = 267 kcal", Math.round(m.kcal) === 267, `got ${Math.round(m.kcal)}`);
const chicken = findFood("chicken breast", foods)!;
check("150 g chicken = 248 kcal", Math.round(macrosFor(chicken, 150).kcal) === 248);

// the 44,000 kcal bug: per-gram treated as per-100g
const insane = { kcal: 44000, protein: 5400, carbs: 400, fat: 2200, fiber: 0 };
check("guard rejects 44,000 kcal", implausible(insane, 200, "tandoori chicken") !== null);
check("guard allows a real meal", implausible(macrosFor(chicken, 200), 200, "chicken") === null);
check("guard rejects impossible protein", implausible({ kcal: 100, protein: 300, carbs: 0, fat: 0, fiber: 0 }, 100, "x") !== null);

// log_known: a user-stated total has no grams, so only the absolute-kcal
// ceiling applies (there's no per-gram figure to sanity-check against)
check("guard allows a stated total with no grams", implausible({ kcal: 560, protein: 40, carbs: 0, fat: 0, fiber: 0 }, null, "bread + chicken") === null);
check("guard still rejects an insane stated total", implausible({ kcal: 9000, protein: 0, carbs: 0, fat: 0, fiber: 0 }, null, "lunch") !== null);

// the wrong-date bug: day must come from the clock, in the user's zone
const day = localDay("Asia/Kolkata");
check("localDay is ISO", /^\d{4}-\d{2}-\d{2}$/.test(day), day);
check("meal inferred from hour", ["breakfast","lunch","dinner","snack"].includes(inferMeal("Asia/Kolkata")));

// BMI: kg / m^2, missing inputs return null rather than a garbage number
check("bmi(71.5, 172) ≈ 24.2", Math.abs(bmi(71.5, 172)! - 24.17) < 0.05, `got ${bmi(71.5, 172)}`);
check("bmi missing weight returns null", bmi(null, 172) === null);
check("bmi missing height returns null", bmi(71.5, undefined) === null);
check("bmiCategory bands", bmiCategory(17) === "Underweight" && bmiCategory(22) === "Normal" &&
  bmiCategory(27) === "Overweight" && bmiCategory(32) === "Obese");

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
