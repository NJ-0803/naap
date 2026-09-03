/**
 * Weekly / monthly review — the numbers behind a Telegram report, computed
 * straight from Postgres so the dashboard needs no separate report job.
 *
 * Averages are over LOGGED days only: an unlogged day is missing data, not a
 * zero, and must never drag the average down.
 */
import type { Macros } from "./ledger";

export type DayRow = { day: string } & Macros;

export type PeriodStats = {
  daysLogged: number;
  totalDays: number;
  avg: Macros;
  kcalAdherencePct: number; // % of logged days within +-10% of kcal target
  proteinAdherencePct: number; // % of logged days at >=95% of protein target
  best: DayRow | null;
  hardest: DayRow | null;
};

// Rewards a day close to the kcal target that also hit protein — the same
// "real meal, on target" read a person gives a week of numbers by eye.
function score(row: DayRow, targets: Record<string, number>): number {
  const kcalPct = targets.kcal ? (row.kcal / targets.kcal) * 100 : 0;
  const proteinPct = targets.protein ? (row.protein / targets.protein) * 100 : 0;
  return -Math.abs(kcalPct - 100) + (proteinPct >= 95 ? 15 : proteinPct * 0.1);
}

export function periodStats(
  rows: DayRow[], totalDays: number, targets: Record<string, number>
): PeriodStats {
  const logged = rows.filter((r) => r.kcal > 0 || r.protein > 0);
  const n = logged.length;

  const sum = logged.reduce(
    (a, r) => ({
      kcal: a.kcal + r.kcal,
      protein: a.protein + r.protein,
      carbs: a.carbs + r.carbs,
      fat: a.fat + r.fat,
      fiber: a.fiber + r.fiber,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );
  const avg: Macros = n
    ? {
        kcal: sum.kcal / n,
        protein: sum.protein / n,
        carbs: sum.carbs / n,
        fat: sum.fat / n,
        fiber: sum.fiber / n,
      }
    : { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

  const withinKcal = logged.filter(
    (r) => targets.kcal && Math.abs(r.kcal / targets.kcal - 1) <= 0.1
  ).length;
  const hitProtein = logged.filter(
    (r) => targets.protein && r.protein / targets.protein >= 0.95
  ).length;

  let best: DayRow | null = null;
  let hardest: DayRow | null = null;
  for (const r of logged) {
    if (!best || score(r, targets) > score(best, targets)) best = r;
    if (!hardest || score(r, targets) < score(hardest, targets)) hardest = r;
  }
  // With one logged day "best" and "hardest" are the same row — not a range.
  if (n < 2) { best = null; hardest = null; }

  return {
    daysLogged: n,
    totalDays,
    avg,
    kcalAdherencePct: n ? (withinKcal / n) * 100 : 0,
    proteinAdherencePct: n ? (hitProtein / n) * 100 : 0,
    best,
    hardest,
  };
}

export type WeightTrend = { first: number; last: number; deltaKg: number; count: number };

export function weightTrend(rows: { day: string; kg: number }[]): WeightTrend | null {
  if (rows.length < 2) return null;
  const first = rows[0].kg;
  const last = rows[rows.length - 1].kg;
  return { first, last, deltaKg: last - first, count: rows.length };
}
