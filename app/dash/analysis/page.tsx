/**
 * The full weekly/monthly review — one tap away from the Analysis teaser on
 * /dash, so /dash itself stays a fast daily-use surface and this stays the
 * place you go to actually dig into a week or a month.
 *
 * Also the one page with a "coach" note: the only place naap lets a model
 * reason instead of compute. Every number on this page comes straight from
 * lib/analysis.ts; the coach in lib/coach.ts only explains gaps in words and
 * points at foods already sitting in this user's own table. Its wording is
 * genuinely non-deterministic and regenerates once a day — see the badge.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifyToken, SESSION_COOKIE } from "@/lib/auth";
import { sql, loadFoods } from "@/lib/db";
import { periodStats, weightTrend, type PeriodStats, type WeightTrend } from "@/lib/analysis";
import { getOrCreateCoachNote, type CoachNote } from "@/lib/coach";
import { Reveal, TiltCard } from "../Motion";
import "../../globals.css";

export const dynamic = "force-dynamic";

function tone(pct: number, moreIsBetter = false): string {
  if (pct > 108) return moreIsBetter ? "good" : "over";
  if (pct >= 95) return "good";
  if (pct < 55) return "low";
  return "on";
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function dayLabel(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function localDay(tz: string, offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function StatPanel({
  label, stats, weight, targets,
}: {
  label: string;
  stats: PeriodStats;
  weight: WeightTrend | null;
  targets: Record<string, number>;
}) {
  const kcalPct = targets.kcal ? (stats.avg.kcal / targets.kcal) * 100 : 0;
  const proteinPct = targets.protein ? (stats.avg.protein / targets.protein) * 100 : 0;

  return (
    <TiltCard className="panel">
      <div className="badge">{label}</div>

      <div className="k">days logged</div>
      <div className="v">{stats.daysLogged}/{stats.totalDays}</div>
      <div className="sub">
        {stats.daysLogged
          ? `${Math.round(stats.kcalAdherencePct)}% on-target kcal · ${Math.round(stats.proteinAdherencePct)}% hit protein`
          : "nothing logged yet"}
      </div>

      {stats.daysLogged > 0 && (
        <>
          <div className="k">avg kcal / protein</div>
          <div className="v sm">
            <span className={tone(kcalPct)}>{Math.round(stats.avg.kcal)}</span>
            {" / "}
            <span className={tone(proteinPct, true)}>{Math.round(stats.avg.protein)}g</span>
          </div>
          <div className="sub">of {Math.round(targets.kcal)} kcal · {Math.round(targets.protein)}g target</div>
        </>
      )}

      {stats.best && stats.hardest && (
        <>
          <div className="k">best day</div>
          <div className="v sm">{dayLabel(stats.best.day)}</div>
          <div className="sub">{Math.round(stats.best.kcal)} kcal · {Math.round(stats.best.protein)}g protein</div>

          <div className="k">hardest day</div>
          <div className="v sm">{dayLabel(stats.hardest.day)}</div>
          <div className="sub">{Math.round(stats.hardest.kcal)} kcal · {Math.round(stats.hardest.protein)}g protein</div>
        </>
      )}

      <div className="k">weight</div>
      {weight ? (
        <>
          <div className="v sm">{trim(weight.first)} → {trim(weight.last)} kg</div>
          <div className="sub">
            {weight.deltaKg > 0 ? "+" : ""}{trim(weight.deltaKg)} kg over {weight.count} weigh-ins
          </div>
        </>
      ) : (
        <div className="sub low">no weigh-ins logged this period</div>
      )}
    </TiltCard>
  );
}

function CoachCard({ note }: { note: CoachNote | null }) {
  return (
    <TiltCard className="panel coach">
      <div className="badge"><span className="shimmer-text">✦ coach</span></div>
      <div className="k">where to focus</div>
      <div className="sub coach-text">
        {note
          ? note.text
          : "Nothing flagged — either you're within range on everything, or there isn't enough logged yet to tell."}
      </div>
      <div className="tag">
        {note ? `${note.model} — ` : ""}non-deterministic, reasoning not math · regenerates once a day
      </div>
    </TiltCard>
  );
}

export default async function Analysis() {
  const jar = await cookies();
  const userId = verifyToken(jar.get(SESSION_COOKIE)?.value);
  if (!userId) redirect("/");

  const users = (await sql`
    SELECT id, username, name, timezone FROM users WHERE id = ${userId}
  `) as { id: number; username: string | null; name: string | null; timezone: string }[];
  if (!users.length) redirect("/");
  const user = users[0];

  const today = localDay(user.timezone);
  const [targetsRow] = (await sql`
    SELECT kcal, protein, carbs, fat, fiber, goal FROM targets WHERE user_id = ${userId}
  `) as Record<string, number | string>[];
  const targets = targetsRow as unknown as Record<string, number>;

  const since = localDay(user.timezone, -6);
  const monthSince = localDay(user.timezone, -29);

  const monthRows = (await sql`
    SELECT day::text AS day, SUM(kcal)::float kcal, SUM(protein)::float protein,
           SUM(carbs)::float carbs, SUM(fat)::float fat, SUM(fiber)::float fiber
    FROM entries WHERE user_id = ${userId} AND day >= ${monthSince} AND day <= ${today}
    GROUP BY day ORDER BY day
  `) as { day: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number }[];
  const weekRows = monthRows.filter((r) => r.day >= since);

  const weightRows = (await sql`
    SELECT day::text AS day, kg::float kg FROM weights
    WHERE user_id = ${userId} AND day >= ${monthSince} AND day <= ${today}
    ORDER BY day
  `) as { day: string; kg: number }[];

  const weekStats = periodStats(weekRows, 7, targets);
  const monthStats = periodStats(monthRows, 30, targets);
  const weekWeight = weightTrend(weightRows.filter((w) => w.day >= since));
  const monthWeight = weightTrend(weightRows);

  const foods = await loadFoods(userId);
  const [coachWeek, coachMonth] = await Promise.all([
    getOrCreateCoachNote(userId, "week", today, weekStats, targets, foods),
    getOrCreateCoachNote(userId, "month", today, monthStats, targets, foods),
  ]);

  return (
    <>
      <div className="frame" />
      <div className="ticks left" />
      <div className="ticks right" />

      <div className="shell">
        <header className="mast">
          <a className="wordmark home" href="/">
            NAAP<span>.</span>
            <small>the hall of being fit</small>
          </a>
          <div className="readout">
            <Link className="signout" href="/dash">← Dashboard</Link>
          </div>
        </header>

        <Reveal>
        <section>
          <div className="eyebrow">Analysis // review, not vibes</div>
          <div className="head">
            <h2>Analysis</h2>
            <div className="count">week &amp; 30-day</div>
          </div>

          <div className="grid c2">
            <div className="col-stack">
              <StatPanel label="this week" stats={weekStats} weight={weekWeight} targets={targets} />
              <CoachCard note={coachWeek} />
            </div>
            <div className="col-stack">
              <StatPanel label="last 30 days" stats={monthStats} weight={monthWeight} targets={targets} />
              <CoachCard note={coachMonth} />
            </div>
          </div>
        </section>
        </Reveal>

        <footer>
          <span>{user.username ? `@${user.username}` : user.name ?? "you"}</span>
          <span>naap — measured, not guessed</span>
        </footer>
      </div>
    </>
  );
}
