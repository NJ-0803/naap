"use client";

/**
 * The live demo. Type a meal, watch it resolve.
 *
 * It self-types one example on load so a visitor sees the whole loop without
 * doing anything — then hands them the field. The measured latency is printed
 * because the number is the argument.
 */

import { useEffect, useRef, useState } from "react";

type Item = {
  food: string; qty: number; unit: string; grams: number | null;
  macros: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
};
type Result = {
  items: Item[];
  total?: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
  note?: string | null;
  ms: number;
};

const SEED = "2 rotis, a katori of dal and 150g chicken breast";
const EXAMPLES = [
  "3 eggs and a scoop of whey",
  "one katori rajma with rice",
  "2 idli, sambar and filter coffee",
  "paneer tikka and 2 rotis",
];

export default function Demo() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const typed = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // type the seed example once, then run it
  useEffect(() => {
    if (typed.current) return;
    typed.current = true;
    let i = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setText(SEED); void run(SEED); return; }
    const tick = setInterval(() => {
      i += 1;
      setText(SEED.slice(0, i));
      if (i >= SEED.length) { clearInterval(tick); void run(SEED); }
    }, 32);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(value: string) {
    const q = value.trim();
    if (!q || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: q }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data?.error ?? "Something went wrong."); setRes(null); }
      else setRes(data);
    } catch {
      setErr("Couldn't reach the parser.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="demo">
      <form
        className="demo-bar"
        onSubmit={(e) => { e.preventDefault(); void run(text); }}
      >
        <span className="prompt">▸</span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="2 rotis and a katori of dal"
          maxLength={200}
          aria-label="Describe what you ate"
          spellCheck={false}
        />
        <button type="submit" disabled={busy}>
          {busy ? "…" : "Measure"}
        </button>
      </form>

      <div className="demo-tries">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => { setText(e); void run(e); }}>
            {e}
          </button>
        ))}
      </div>

      <div className={`demo-out ${busy ? "busy" : ""}`} aria-live="polite">
        {err && <div className="demo-err">{err}</div>}

        {!err && res && res.items.length > 0 && (
          <>
            <ul className="demo-items">
              {res.items.map((it, i) => (
                <li key={i} style={{ animationDelay: `${i * 60}ms` }}>
                  <span className="f">{it.food}</span>
                  <span className="q">
                    {it.qty}
                    {it.unit === "g" ? "g" : ` ${it.unit}`}
                    {it.grams && it.unit !== "g" ? ` · ${Math.round(it.grams)}g` : ""}
                  </span>
                  <span className="k">{Math.round(it.macros.kcal)} kcal</span>
                  <span className="p">P{Math.round(it.macros.protein)}</span>
                </li>
              ))}
            </ul>

            {res.total && (
              <div className="demo-total">
                <div className="big">{Math.round(res.total.kcal)}</div>
                <div className="unit">kcal</div>
                <div className="split">
                  <span>P{Math.round(res.total.protein)}</span>
                  <span>C{Math.round(res.total.carbs)}</span>
                  <span>F{Math.round(res.total.fat)}</span>
                </div>
                <div className="ms">{res.ms} ms</div>
              </div>
            )}
          </>
        )}

        {!err && res && res.note && <div className="demo-note">{res.note}</div>}
        {!err && !res && !busy && <div className="demo-idle">…</div>}
      </div>
    </div>
  );
}
