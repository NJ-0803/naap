/**
 * League standings as an image.
 *
 * Telegram can only show text or pictures, and a picture is what people
 * screenshot into the group chat. Rendered with next/og (Satori) at the edge —
 * no headless browser, which is what made the previous version's card renderer
 * fragile.
 *
 * GET /api/card/league?name=Gym%20Bros&days=7&rows=<base64 json>
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

type Row = {
  username: string | null;
  name: string | null;
  days_logged: number;
  protein_days: number;
  streak: number;
  score: number;
  me?: boolean;
};

const INK = "#e8eef7";
const DIM = "#7b90a8";
const LINE = "#1b2534";
const RED = "#ff2e4c";      // radiant red — the one accent
const FLAME = "#ffa23a";    // amber, kept clear of the red
const MINT = "#4ade80";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name") ?? "League";
  const days = Number(searchParams.get("days") ?? 7);

  let rows: Row[] = [];
  try {
    rows = JSON.parse(
      Buffer.from(searchParams.get("rows") ?? "", "base64").toString("utf8")
    );
  } catch {
    rows = [];
  }

  const medal = ["1", "2", "3"];

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: "linear-gradient(155deg, #0a0d14 0%, #12111c 50%, #1c1220 100%)",
          padding: "44px 48px",
          fontFamily: "sans-serif",
          color: INK,
        }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 15, letterSpacing: 4, color: DIM, textTransform: "uppercase" }}>
              {`Standings · last ${days} days`}
            </div>
            <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: -1, marginTop: 6 }}>
              {name}
            </div>
          </div>
          <div style={{ fontSize: 15, letterSpacing: 3, color: DIM, textTransform: "uppercase" }}>
            NutriLog
          </div>
        </div>

        <div style={{ display: "flex", height: 2, background: LINE, margin: "24px 0 8px" }} />

        {/* column labels */}
        <div style={{ display: "flex", fontSize: 13, letterSpacing: 2, color: DIM, textTransform: "uppercase", paddingBottom: 10 }}>
          <div style={{ display: "flex", width: 74 }} />
          <div style={{ display: "flex", flex: 1 }}>Member</div>
          <div style={{ display: "flex", width: 110, justifyContent: "flex-end" }}>Logged</div>
          <div style={{ display: "flex", width: 120, justifyContent: "flex-end" }}>Protein</div>
          <div style={{ display: "flex", width: 110, justifyContent: "flex-end" }}>Streak</div>
        </div>

        {/* rows */}
        {rows.slice(0, 8).map((r, i) => {
          const top = i < 3;
          const who = r.username ? `@${r.username}` : r.name ?? "member";
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "14px 16px",
                marginBottom: 8,
                borderRadius: 14,
                background: r.me ? "rgba(255,46,76,0.12)" : "rgba(255,255,255,0.028)",
                border: r.me ? `2px solid ${RED}` : `2px solid ${LINE}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 58,
                  height: 58,
                  borderRadius: 29,
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 25,
                  fontWeight: 700,
                  color: top ? "#ffffff" : DIM,
                  background: top ? RED : "transparent",
                  border: top ? "none" : `2px solid ${LINE}`,
                }}
              >
                {medal[i] ?? i + 1}
              </div>
              <div style={{ display: "flex", flex: 1, flexDirection: "column", paddingLeft: 18 }}>
                <div style={{ fontSize: 29, fontWeight: 600 }}>{who}</div>
                <div style={{ fontSize: 15, color: DIM, marginTop: 2 }}>{`${r.score} pts`}</div>
              </div>
              <div style={{ display: "flex", width: 110, justifyContent: "flex-end", fontSize: 27 }}>
                {`${r.days_logged}/${days}`}
              </div>
              <div
                style={{
                  display: "flex",
                  width: 120,
                  justifyContent: "flex-end",
                  fontSize: 27,
                  color: r.protein_days >= days ? MINT : INK,
                }}
              >
                {`${r.protein_days}/${days}`}
              </div>
              <div
                style={{
                  display: "flex",
                  width: 110,
                  justifyContent: "flex-end",
                  fontSize: 27,
                  color: r.streak > 0 ? FLAME : DIM,
                }}
              >
                {r.streak > 0 ? `${r.streak}d` : "—"}
              </div>
            </div>
          );
        })}

        <div style={{ display: "flex", flex: 1 }} />
        <div style={{ display: "flex", fontSize: 15, color: DIM }}>
          Ranked on consistency against each member's own targets — never on calories or weight.
        </div>
      </div>
    ),
    // 250 = page padding + header + divider + column labels + footer.
    // 95 = row height (58 medal + 28 padding) plus its 8px gap.
    { width: 1000, height: 250 + Math.min(rows.length, 8) * 95 }
  );
}
