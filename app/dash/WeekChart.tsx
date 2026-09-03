"use client";

/**
 * Section 02's bar chart, plus the click-through: each logged day is a real
 * button now, and clicking it pops the full day (macros + itemized food)
 * into a square glass modal. Page.tsx fetches all seven days up front (this
 * is one week — cheap), so opening a day is instant, no client fetch.
 */

import { useState } from "react";
import { GrowBar, Modal, TiltButton3D } from "./Motion";

export type WeekDay = {
  day: string;
  label: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  pct: number;
  logged: boolean;
};

export type DayItem = {
  id: number;
  meal: string | null;
  food: string;
  qty: number;
  unit: string | null;
  kcal: number;
  protein: number;
};

const MACROS = ["protein", "carbs", "fat", "fiber"] as const;
const MORE_IS_BETTER = new Set(["protein", "fiber"]);

function tone(pct: number, moreIsBetter = false): string {
  if (pct > 108) return moreIsBetter ? "good" : "over";
  if (pct >= 95) return "good";
  if (pct < 55) return "low";
  return "on";
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function fullLabel(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });
}

export function WeekChart({
  days, entriesByDay, targets, peak,
}: {
  days: WeekDay[];
  entriesByDay: Record<string, DayItem[]>;
  targets: Record<string, number>;
  peak: number;
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const active = days.find((d) => d.day === openDay) ?? null;

  const itemsByMeal = new Map<string, DayItem[]>();
  if (active) {
    for (const it of entriesByDay[active.day] ?? []) {
      const key = it.meal ?? "other";
      if (!itemsByMeal.has(key)) itemsByMeal.set(key, []);
      itemsByMeal.get(key)!.push(it);
    }
  }

  return (
    <>
      <div className="week">
        <div className="target" style={{ bottom: `calc(${(targets.kcal / peak) * 100}% + 26px)` }}>
          <span>target</span>
        </div>
        {days.map((w) => (
          <TiltButton3D
            className="day"
            key={w.day}
            onClick={w.logged ? () => setOpenDay(w.day) : undefined}
          >
            <div className={`n ${w.logged ? tone(w.pct) : ""}`}>{w.logged ? Math.round(w.kcal) : "—"}</div>
            <div className="col">
              <GrowBar
                className={`bar ${!w.logged ? "none" : tone(w.pct)}`}
                heightPct={Math.max(2, (w.kcal / peak) * 100)}
              />
            </div>
            <div className="lab">{w.label}</div>
          </TiltButton3D>
        ))}
      </div>

      <Modal open={Boolean(active)} onClose={() => setOpenDay(null)}>
        {active && (
          <>
            <div className="modal-close" onClick={() => setOpenDay(null)}>✕</div>
            <div className="badge">{fullLabel(active.day)}</div>

            <div className="hero-figure">
              <div className={`n ${tone(active.pct)}`}>{Math.round(active.kcal)}</div>
              <div className="of">/ {Math.round(targets.kcal)} kcal · {Math.round(active.pct)}%</div>
            </div>

            <div className="meters">
              {MACROS.map((k) => {
                const got = active[k] ?? 0;
                const target = targets[k] ?? 0;
                const pct = target ? (got / target) * 100 : 0;
                const t = tone(pct, MORE_IS_BETTER.has(k));
                return (
                  <div className="meter" key={k}>
                    <div className="top">
                      <div className="name">{k === "fiber" ? "fibre" : k}</div>
                      <div className={`val ${t}`}>{Math.round(got)} / {Math.round(target)} g</div>
                    </div>
                    <div className="track">
                      <div className={`fill ${t}`} style={{ width: `${Math.max(1, Math.min(pct, 100))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="breakdown">
              {itemsByMeal.size ? (
                [...itemsByMeal.entries()].map(([meal, list]) => (
                  <div className="meal-group" key={meal}>
                    <div className="meal-label">{meal}</div>
                    <div className="items">
                      {list.map((it) => (
                        <div className="item" key={it.id}>
                          <div className="food">{it.food}</div>
                          <div className="qty">{trim(it.qty)}{it.unit ?? ""}</div>
                          <div className="kcal">{Math.round(it.kcal)} kcal</div>
                          <div className="protein">P{Math.round(it.protein)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">Nothing logged this day.</div>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
