/**
 * Comparative nudges — the part that makes a league feel alive.
 *
 * Every line here compares people on consistency against their OWN targets:
 * days logged, protein goals hit, streaks. None of it compares calories eaten
 * or weight, so a bulker and a cutter can share a table and nobody is rewarded
 * for eating less than their goal.
 *
 * Tone rule: name what happened, never scold. "You were ahead of him until
 * Thursday" motivates; "you failed twice this week" makes people delete the app.
 */

import type { Standing } from "./social";

export type Nudge = { text: string; weight: number };

/** Lines for one member, given the full table. Highest weight wins. */
export function nudgesFor(me: Standing, table: Standing[], days: number): Nudge[] {
  const out: Nudge[] = [];
  const others = table.filter((r) => r.user_id !== me.user_id);
  if (!others.length) return out;

  const name = (r: Standing) => (r.username ? "@" + r.username : r.name ?? "your friend");
  const myRank = table.findIndex((r) => r.user_id === me.user_id) + 1;

  // Someone had a perfect week — the strongest signal in the table.
  for (const o of others) {
    if (o.days_logged >= days && o.protein_days >= days) {
      out.push({
        text: `${name(o)} hit every goal this week — ${days}/${days} days, protein every day.`,
        weight: 9,
      });
    } else if (o.days_logged >= days) {
      out.push({ text: `${name(o)} logged all ${days} days this week.`, weight: 6 });
    }
  }

  // The person directly above you — the one worth chasing.
  if (myRank > 1) {
    const above = table[myRank - 2];
    const gap = above.score - me.score;
    if (gap <= 2) {
      out.push({
        text: `${name(above)} is only ${gap} point${gap === 1 ? "" : "s"} ahead. One good day flips it.`,
        weight: 8,
      });
    }
  }

  // You slipped behind someone you were beating.
  const justBelow = table[myRank];
  if (justBelow && justBelow.score === me.score) {
    out.push({
      text: `You and ${name(justBelow)} are dead level. Tiebreak is the streak — yours is ${me.streak}, theirs ${justBelow.streak}.`,
      weight: 7,
    });
  }

  // Shared weakness reads as solidarity, not judgement.
  const proteinStrugglers = table.filter((r) => r.protein_days < Math.ceil(days / 2));
  if (proteinStrugglers.some((r) => r.user_id === me.user_id) && proteinStrugglers.length > 1) {
    const mate = proteinStrugglers.find((r) => r.user_id !== me.user_id)!;
    out.push({
      text: `Neither you nor ${name(mate)} has hit protein half the week. Whoever fixes it first takes the table.`,
      weight: 7,
    });
  }

  // Streak milestones and jeopardy.
  if (me.streak >= 7 && me.streak % 7 === 0) {
    out.push({ text: `🔥 ${me.streak}-day streak — longest in the league.`, weight: 8 });
  }
  const bestStreak = Math.max(...others.map((o) => o.streak), 0);
  if (me.streak > bestStreak && me.streak >= 3) {
    out.push({ text: `🔥 You hold the longest streak at ${me.streak} days.`, weight: 6 });
  } else if (bestStreak > me.streak) {
    const holder = others.find((o) => o.streak === bestStreak)!;
    out.push({
      text: `${name(holder)} is on a ${bestStreak}-day streak. You're on ${me.streak}.`,
      weight: 5,
    });
  }

  // Leading is worth saying out loud.
  if (myRank === 1 && table.length > 1) {
    out.push({ text: `You're top of the table on ${me.score} points.`, weight: 8 });
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** The two most interesting lines, for the weekly push. */
export function weeklyLines(me: Standing, table: Standing[], days: number): string[] {
  return nudgesFor(me, table, days).slice(0, 2).map((n) => n.text);
}
