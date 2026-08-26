/**
 * Streaks and friendly leagues.
 *
 * Scoring rule, applied everywhere in this file: members are compared on
 * consistency against their OWN targets, never on absolute intake or weight.
 * That keeps a leaderboard meaningful between someone cutting and someone
 * bulking, and keeps it from rewarding under-eating.
 */

import { sql } from "./db";

export type Standing = {
  user_id: number;
  username: string | null;
  name: string | null;
  streak: number;
  days_logged: number;
  protein_days: number;
  on_target_days: number;
  score: number;
};

const HANDLE = /^[a-z0-9_]{3,20}$/;

export function validHandle(handle: string): boolean {
  return HANDLE.test(handle.trim().toLowerCase());
}

export async function setUsername(userId: number, handle: string): Promise<"ok" | "taken" | "invalid"> {
  const h = handle.trim().toLowerCase().replace(/^@/, "");
  if (!validHandle(h)) return "invalid";
  const clash = (await sql`
    SELECT 1 FROM users WHERE lower(username) = ${h} AND id <> ${userId}
  `) as unknown[];
  if (clash.length) return "taken";
  await sql`UPDATE users SET username = ${h} WHERE id = ${userId}`;
  return "ok";
}

/**
 * Consecutive days ending today (or yesterday) with at least one entry.
 *
 * Yesterday counts as still-alive so the streak doesn't appear broken every
 * morning before the first meal — it only dies after a full day is missed.
 */
export async function currentStreak(userId: number, today: string): Promise<number> {
  const rows = (await sql`
    SELECT DISTINCT day FROM entries
    WHERE user_id = ${userId} AND day <= ${today}
    ORDER BY day DESC LIMIT 400
  `) as { day: string }[];
  if (!rows.length) return 0;

  const days = new Set(rows.map((r) => String(r.day).slice(0, 10)));
  const cursor = new Date(`${today}T00:00:00Z`);

  // allow the streak to be anchored on today or yesterday
  if (!days.has(iso(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!days.has(iso(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(iso(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function createLeague(userId: number, name: string): Promise<{ id: number; join_code: string }> {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const rows = (await sql`
    INSERT INTO leagues (name, join_code, created_by)
    VALUES (${name.slice(0, 40)}, ${code}, ${userId})
    RETURNING id, join_code
  `) as { id: number; join_code: string }[];
  await sql`
    INSERT INTO league_members (league_id, user_id) VALUES (${rows[0].id}, ${userId})
    ON CONFLICT DO NOTHING
  `;
  return rows[0];
}

export async function joinLeague(userId: number, code: string): Promise<{ name: string } | null> {
  const rows = (await sql`
    SELECT id, name FROM leagues WHERE join_code = ${code.trim().toUpperCase()}
  `) as { id: number; name: string }[];
  if (!rows.length) return null;
  await sql`
    INSERT INTO league_members (league_id, user_id) VALUES (${rows[0].id}, ${userId})
    ON CONFLICT DO NOTHING
  `;
  return { name: rows[0].name };
}

/**
 * Standings over a window, scored on each member's own targets.
 *
 * score = days logged + protein-target days + on-target days, so showing up
 * counts, eating enough protein counts, and hitting your own calorie target
 * counts. Nothing rewards eating less than your goal.
 */
export async function standings(leagueId: number, since: string, today: string): Promise<Standing[]> {
  const rows = (await sql`
    SELECT u.id                                              AS user_id,
           u.username,
           u.name,
           COUNT(DISTINCT e.day)                             AS days_logged,
           COUNT(DISTINCT e.day) FILTER (
             WHERE e.protein_sum >= t.protein * 0.95)        AS protein_days,
           COUNT(DISTINCT e.day) FILTER (
             WHERE abs(e.kcal_sum - t.kcal) <= t.kcal * 0.10) AS on_target_days
    FROM league_members lm
    JOIN users   u ON u.id = lm.user_id
    JOIN targets t ON t.user_id = u.id
    LEFT JOIN (
      SELECT user_id, day,
             SUM(kcal)    AS kcal_sum,
             SUM(protein) AS protein_sum
      FROM entries
      WHERE day >= ${since} AND day <= ${today}
      GROUP BY user_id, day
    ) e ON e.user_id = u.id
    WHERE lm.league_id = ${leagueId}
    GROUP BY u.id, u.username, u.name
  `) as Omit<Standing, "streak" | "score">[];

  const out: Standing[] = [];
  for (const r of rows) {
    const streak = await currentStreak(r.user_id, today);
    out.push({
      ...r,
      streak,
      score: Number(r.days_logged) + Number(r.protein_days) + Number(r.on_target_days),
    });
  }
  return out.sort((a, b) => b.score - a.score || b.streak - a.streak);
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function renderStandings(name: string, rows: Standing[], days: number): string {
  if (!rows.length) return `<b>${name}</b>\nNo members yet.`;
  const lines = rows.map((r, i) => {
    const who = (r.username ? "@" + r.username : r.name ?? "someone").slice(0, 14);
    const medal = MEDALS[i] ?? ` ${i + 1}.`;
    return (
      `${medal} ${who.padEnd(15)}` +
      `${String(r.days_logged).padStart(2)}/${days}d  ` +
      `P${String(r.protein_days).padStart(2)}  ` +
      `🔥${String(r.streak).padStart(2)}`
    );
  });
  return (
    `<b>${name}</b> — last ${days} days\n` +
    `<pre>${lines.join("\n")}</pre>\n` +
    `<i>days logged · protein goals hit · streak</i>`
  );
}
