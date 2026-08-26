/**
 * The dashboard — Naap as an instrument panel.
 *
 * Sections are numbered like a spec sheet because the subject is measurement.
 * Server-rendered: the data is already in Postgres, so there is no reason to
 * ship a client bundle to draw it.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken, SESSION_COOKIE } from "@/lib/auth";
import { sql } from "@/lib/db";
import { currentStreak, standings } from "@/lib/social";
import { weeklyLines } from "@/lib/rivalry";
import "../globals.css";

export const dynamic = "force-dynamic";

const MACROS = ["protein", "carbs", "fat", "fiber"] as const;
const LABEL: Record<string, string> = {
  protein: "protein", carbs: "carbs", fat: "fat", fiber: "fibre",
};
// Over target is a warning only for what you budget down. Exceeding protein
// or fibre is a good day, so those never turn red.
const MORE_IS_BETTER = new Set(["protein", "fiber"]);

function tone(pct: number, moreIsBetter = false): string {
  if (pct > 108) return moreIsBetter ? "good" : "over";
  if (pct >= 95) return "good";
  if (pct < 55) return "low";
  return "on";
}

function localDay(tz: string, offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export default async function Dash() {
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

  const [totals] = (await sql`
    SELECT COALESCE(SUM(kcal),0)::float kcal, COALESCE(SUM(protein),0)::float protein,
           COALESCE(SUM(carbs),0)::float carbs, COALESCE(SUM(fat),0)::float fat,
           COALESCE(SUM(fiber),0)::float fiber, COUNT(*)::int n
    FROM entries WHERE user_id = ${userId} AND day = ${today}
  `) as Record<string, number>[];

  const meals = (await sql`
    SELECT COALESCE(meal,'other') meal, SUM(kcal)::float kcal, SUM(protein)::float protein
    FROM entries WHERE user_id = ${userId} AND day = ${today}
    GROUP BY meal ORDER BY MIN(ts)
  `) as { meal: string; kcal: number; protein: number }[];

  const since = localDay(user.timezone, -6);
  const weekRows = (await sql`
    SELECT day::text AS day, SUM(kcal)::float kcal, SUM(protein)::float protein
    FROM entries WHERE user_id = ${userId} AND day >= ${since} AND day <= ${today}
    GROUP BY day ORDER BY day
  `) as { day: string; kcal: number; protein: number }[];

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = localDay(user.timezone, -(6 - i));
    const hit = weekRows.find((r) => r.day.slice(0, 10) === d);
    return {
      day: d,
      label: new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short" }),
      kcal: hit?.kcal ?? 0,
      logged: Boolean(hit),
    };
  });

  const streak = await currentStreak(userId, today);
  const loggedDays = week.filter((w) => w.logged).length;

  const leagues = (await sql`
    SELECT l.id, l.name FROM leagues l
    JOIN league_members m ON m.league_id = l.id
    WHERE m.user_id = ${userId} ORDER BY l.id LIMIT 1
  `) as { id: number; name: string }[];

  let table: Awaited<ReturnType<typeof standings>> = [];
  let lines: string[] = [];
  if (leagues.length) {
    table = await standings(leagues[0].id, since, today);
    const me = table.find((r) => r.user_id === userId);
    if (me) lines = weeklyLines(me, table, 7);
  }

  const kcalPct = targets.kcal ? (totals.kcal / targets.kcal) * 100 : 0;
  const peak = Math.max(...week.map((w) => w.kcal), targets.kcal) * 1.14 || 1;

  return (
    <>
      <div className="frame" />
      <div className="ticks left" />
      <div className="ticks right" />

      <div className="shell">
        <header className="mast">
          <div className="wordmark">
            NAAP<span>.</span>
            <small>नाप — to measure</small>
          </div>
          <div className="readout">
            <div>
              Streak<b className={streak > 0 ? "hot" : ""}>{streak}d</b>
            </div>
            <div>
              Logged<b>{loggedDays}/7</b>
            </div>
            <div>
              Goal<b>{String(targetsRow.goal ?? "—")}</b>
            </div>
          </div>
        </header>

        {/* ---- 01 ---- */}
        <section>
          <div className="eyebrow">Naap // today&apos;s measure</div>
          <div className="head">
            <h2>
              <span className="mark">// 01.</span> Today
            </h2>
            <div className="count">
              {totals.n > 0 ? `${totals.n} items logged` : "nothing logged yet"}
            </div>
          </div>

          <div className="hero-figure">
            <div className={`n ${tone(kcalPct)}`}>{Math.round(totals.kcal)}</div>
            <div className="of">/ {Math.round(targets.kcal)} kcal · {Math.round(kcalPct)}%</div>
          </div>

          <div className="meters">
            {MACROS.map((k) => {
              const got = totals[k] ?? 0;
              const target = targets[k] ?? 0;
              const pct = target ? (got / target) * 100 : 0;
              const t = tone(pct, MORE_IS_BETTER.has(k));
              return (
                <div className="meter" key={k}>
                  <div className="top">
                    <div className="name">{LABEL[k]}</div>
                    <div className={`val ${t}`}>
                      {Math.round(got)} / {Math.round(target)} g
                    </div>
                  </div>
                  <div className="track">
                    <div
                      className={`fill ${t}`}
                      style={{ width: `${Math.max(1, Math.min(pct, 100))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {meals.length > 0 && (
            <div className="grid c4">
              {meals.map((m, i) => (
                <div className="panel" key={m.meal}>
                  <div className="badge">{String(i + 1).padStart(2, "0")} / {m.meal}</div>
                  <div className="k">calories</div>
                  <div className="v">{Math.round(m.kcal)}</div>
                  <div className="sub">{Math.round(m.protein)} g protein</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- 02 ---- */}
        <section>
          <div className="eyebrow">Consistency // rolling seven days</div>
          <div className="head">
            <h2>
              <span className="mark">// 02.</span> The Week
            </h2>
            <div className="count">target {Math.round(targets.kcal)} kcal</div>
          </div>

          <div className="week">
            <div
              className="target"
              style={{ bottom: `calc(${(targets.kcal / peak) * 100}% + 26px)` }}
            >
              <span>target</span>
            </div>
            {week.map((w) => (
              <div className="day" key={w.day}>
                <div className="n">{w.logged ? Math.round(w.kcal) : "—"}</div>
                <div className="col">
                  <div
                    className={`bar ${!w.logged ? "none" : w.kcal > targets.kcal * 1.05 ? "over" : ""}`}
                    style={{ height: `${Math.max(2, (w.kcal / peak) * 100)}%` }}
                  />
                </div>
                <div className="lab">{w.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- 03 ---- */}
        <section>
          <div className="eyebrow">League // consistency, not calories</div>
          <div className="head">
            <h2>
              <span className="mark">// 03.</span> The Table
            </h2>
            <div className="count">{leagues.length ? leagues[0].name : "no league"}</div>
          </div>

          {table.length ? (
            <>
              <div className="rows">
                {table.map((r, i) => (
                  <div
                    className={`row ${r.user_id === userId ? "me" : ""} ${i < 3 ? "top" : ""}`}
                    key={r.user_id}
                  >
                    <div className="rank">{String(i + 1).padStart(2, "0")}</div>
                    <div className="who">
                      {r.username ? `@${r.username}` : r.name ?? "member"}
                    </div>
                    <div className="stat hide-sm">{r.days_logged}/7</div>
                    <div className={`stat ${Number(r.protein_days) >= 7 ? "hit" : ""}`}>
                      P{r.protein_days}
                    </div>
                    <div className="stat streak">{r.streak > 0 ? `${r.streak}d` : "—"}</div>
                  </div>
                ))}
              </div>
              {lines.map((l, i) => (
                <div className="note" key={i}>{l}</div>
              ))}
            </>
          ) : (
            <div className="empty">
              No league yet — send <b>/league &lt;name&gt;</b> to the bot to start one.
            </div>
          )}
        </section>

        <footer>
          <span>{user.username ? `@${user.username}` : user.name ?? "you"}</span>
          <span>naap — measured, not guessed</span>
        </footer>
      </div>
    </>
  );
}
