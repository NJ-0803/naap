/**
 * A day's macros as an image — the evening card.
 *
 * GET /api/card/day?date=Tue%2026%20Aug&d=<base64 json>
 * where d = { totals, targets, meals: [{meal, kcal, protein}], streak }
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const INK = "#e8eef7";
const DIM = "#7b90a8";
const LINE = "#1b2534";
const RED = "#ff2e4c";
const MINT = "#4ade80";
const AMBER = "#ffa23a";

type Payload = {
  totals: Record<string, number>;
  targets: Record<string, number>;
  meals?: { meal: string; kcal: number; protein: number }[];
  streak?: number;
};

const KEYS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
const LABEL: Record<string, string> = {
  kcal: "calories", protein: "protein", carbs: "carbs", fat: "fat", fiber: "fibre",
};

/**
 * Colour by how the number reads, which depends on the macro.
 *
 * Going over is only a problem for things you are budgeting down (calories,
 * carbs, fat). Exceeding protein or fibre is a good day, so those stay mint —
 * showing 108% protein in warning red tells the user the opposite of the truth.
 */
function tone(pct: number, moreIsBetter = false): string {
  if (pct > 108) return moreIsBetter ? MINT : RED;
  if (pct >= 95) return MINT;
  if (pct < 55) return AMBER;
  return INK;
}

const MORE_IS_BETTER = new Set(["protein", "fiber"]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? "";
  let d: Payload = { totals: {}, targets: {} };
  try {
    d = JSON.parse(Buffer.from(searchParams.get("d") ?? "", "base64").toString("utf8"));
  } catch {}

  const kcalPct = d.targets.kcal ? ((d.totals.kcal ?? 0) / d.targets.kcal) * 100 : 0;
  const proteinPct = d.targets.protein ? ((d.totals.protein ?? 0) / d.targets.protein) * 100 : 0;
  const meals = d.meals ?? [];

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex", flexDirection: "column", width: "100%", height: "100%",
          background: "linear-gradient(155deg, #0a0d14 0%, #12111c 50%, #1c1220 100%)",
          padding: "44px 48px", fontFamily: "sans-serif", color: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 15, letterSpacing: 4, color: DIM, textTransform: "uppercase" }}>
              {date}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
              <div style={{ fontSize: 82, fontWeight: 700, letterSpacing: -3, color: tone(kcalPct) }}>
                {String(Math.round(d.totals.kcal ?? 0))}
              </div>
              <div style={{ fontSize: 28, color: DIM, paddingLeft: 14 }}>
                {`/ ${Math.round(d.targets.kcal ?? 0)} kcal`}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ fontSize: 15, letterSpacing: 3, color: RED, textTransform: "uppercase", fontWeight: 700 }}>
              NAAP
            </div>
            {d.streak ? (
              <div style={{ fontSize: 30, color: AMBER, marginTop: 10 }}>
                {`${d.streak}d streak`}
              </div>
            ) : (
              <div style={{ display: "flex" }} />
            )}
          </div>
        </div>

        <div style={{ display: "flex", height: 2, background: LINE, margin: "26px 0 22px" }} />

        {/* macro bars */}
        {KEYS.filter((k) => k !== "kcal").map((k) => {
          const got = d.totals[k] ?? 0;
          const target = d.targets[k] ?? 0;
          const pct = target ? (got / target) * 100 : 0;
          const c = tone(pct, MORE_IS_BETTER.has(k));
          return (
            <div key={k} style={{ display: "flex", flexDirection: "column", marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 17, letterSpacing: 2, color: DIM, textTransform: "uppercase" }}>
                  {LABEL[k]}
                </div>
                <div style={{ fontSize: 22, color: c }}>
                  {`${Math.round(got)} / ${Math.round(target)} g`}
                </div>
              </div>
              <div style={{ display: "flex", height: 12, background: LINE, borderRadius: 6 }}>
                <div
                  style={{
                    display: "flex",
                    width: `${Math.max(1, Math.min(pct, 100))}%`,
                    background: c,
                    borderRadius: 6,
                  }}
                />
              </div>
            </div>
          );
        })}

        {/* protein gets a callout — it's the number that matters most on a cut */}
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 6, padding: "16px 20px", borderRadius: 14,
            background: "rgba(255,255,255,0.03)", border: `2px solid ${LINE}`,
          }}
        >
          <div style={{ fontSize: 18, color: DIM }}>
            {proteinPct >= 100 ? "Protein target hit" : "Protein still short"}
          </div>
          <div style={{ fontSize: 26, color: tone(proteinPct, true) }}>
            {`${Math.round(proteinPct)}%`}
          </div>
        </div>

        {meals.length ? (
          <div style={{ display: "flex", marginTop: 22, gap: 12 }}>
            {meals.slice(0, 4).map((m) => (
              <div
                key={m.meal}
                style={{
                  display: "flex", flexDirection: "column", flex: 1,
                  padding: "14px 16px", borderRadius: 12,
                  background: "rgba(255,255,255,0.028)", border: `2px solid ${LINE}`,
                }}
              >
                <div style={{ fontSize: 13, letterSpacing: 2, color: DIM, textTransform: "uppercase" }}>
                  {m.meal}
                </div>
                <div style={{ fontSize: 26, marginTop: 6 }}>{String(Math.round(m.kcal))}</div>
                <div style={{ fontSize: 15, color: MINT, marginTop: 2 }}>
                  {`P${Math.round(m.protein)}`}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
      </div>
    ),
    { width: 1000, height: meals.length ? 780 : 660 }
  );
}
