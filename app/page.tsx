import { cookies } from "next/headers";
import Demo from "./Demo";
import { verifyToken, SESSION_COOKIE } from "@/lib/auth";
import "./globals.css";
import "./landing.css";

// Reading the session makes this dynamic, which is the point: a signed-in
// visitor should be offered their dashboard, not asked to open Telegram again.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Naap — the hall of being fit",
  description:
    "Say what you ate. Get macros back in under a second. Indian food, Telegram, free forever.",
};

const BOT = "https://t.me/naap_the_bot";
const REPO = "https://github.com/NJ-0803/naap";

export default async function Home() {
  const jar = await cookies();
  const signedIn = Boolean(verifyToken(jar.get(SESSION_COOKIE)?.value));

  return (
    <>
      <div className="frame" />
      <div className="ticks left" />
      <div className="ticks right" />

      <div className="shell">
        {/* ---------------- hero ---------------- */}
        <header className="lp-mast">
          <div className="wordmark">
            NAAP<span>.</span>
            <small>the hall of being fit</small>
          </div>
          <nav className="lp-nav">
            <a href={REPO}>Source</a>
            {signedIn ? (
              <a className="cta" href="/dash">Your dashboard →</a>
            ) : (
              <a className="cta" href={BOT}>Open in Telegram</a>
            )}
          </nav>
        </header>

        <section className="lp-hero">
          <div className="eyebrow">नाप // to measure</div>
          <h1>
            Say what you ate.<br />
            <em>Get the numbers back</em><br />
            before you finish reading this.
          </h1>
          <p className="lede">
            No app to install. No database to search. No forms. You type a meal
            the way you&apos;d say it out loud — and a Python-grade ledger does every
            calculation, so the model never invents a calorie.
          </p>

          <Demo />

          <div className="lp-actions">
            {signedIn ? (
              <a className="btn" href="/dash">Open your dashboard</a>
            ) : (
              <a className="btn" href={BOT}>Open in Telegram</a>
            )}
            <a className="btn ghost" href={REPO}>Read the source</a>
          </div>
        </section>

        {/* ---------------- 01 getting started ---------------- */}
        <section>
          <div className="eyebrow">Start here // two minutes</div>
          <div className="head">
            <h2><span className="mark">// 01.</span> Getting Started</h2>
            <div className="count">no install, no password</div>
          </div>

          <div className="grid c4">
            <div className="panel">
              <div className="badge">01 / telegram</div>
              <div className="k">open the bot</div>
              <div className="sub">
                Tap <b>Open in Telegram</b> above, or search{" "}
                <code>@naap_the_bot</code> in the Telegram app. Hit{" "}
                <b>Start</b>.
              </div>
            </div>
            <div className="panel">
              <div className="badge">02 / log</div>
              <div className="k">say what you ate</div>
              <div className="sub">
                Type it the way you&apos;d say it out loud —
                &ldquo;2 rotis and a katori of dal.&rdquo; The bot replies
                with calories and protein in under a second.
              </div>
            </div>
            <div className="panel">
              <div className="badge">03 / web</div>
              <div className="k">open your dashboard</div>
              <div className="sub">
                Send <code>/web</code> in the chat, or tap the{" "}
                <b>📊 Dashboard</b> button. It sends a link — tap it once
                and you&apos;re signed in. No password to set or remember.
              </div>
            </div>
            <div className="panel">
              <div className="badge">04 / friends</div>
              <div className="k">bring people in</div>
              <div className="sub">
                Send <code>/league Gym Bros</code> to start a group, or{" "}
                <code>/join CODE</code> to join a friend&apos;s. Everyone
                runs their own free account.
              </div>
            </div>
          </div>

          <p className="lp-body">
            That&apos;s the whole setup. Set a calorie or protein goal any
            time by just telling the bot — e.g. &ldquo;target 1800 kcal 130
            protein&rdquo; — no settings menu to dig through.
          </p>
        </section>

        {/* ---------------- 02 speed ---------------- */}
        <section>
          <div className="eyebrow">Measured // not claimed</div>
          <div className="head">
            <h2><span className="mark">// 02.</span> The Rebuild</h2>
            <div className="count">same task, both versions</div>
          </div>

          <div className="lp-compare">
            <div className="panel">
              <div className="badge">before</div>
              <div className="k">agent framework</div>
              <div className="v big">98,000</div>
              <div className="sub">tokens to log one banana</div>
              <div className="chips">
                <span className="chip">40–80s</span>
                <span className="chip">up to 17 calls</span>
              </div>
            </div>
            <div className="panel me">
              <div className="badge">after</div>
              <div className="k">naap</div>
              <div className="v big">540</div>
              <div className="sub">tokens for the same meal</div>
              <div className="chips">
                <span className="chip">~0.8s</span>
                <span className="chip">one call</span>
              </div>
            </div>
          </div>

          <p className="lp-body">
            The first version ran on an autonomous agent framework. It re-sent 94 KB
            of tool schemas before deciding where to put a roti. Nothing was wrong
            with the model — it was doing the same work, six times over, through a
            wrapper. Measuring it was the whole fix.
          </p>
        </section>

        {/* ---------------- 02 the rule ---------------- */}
        <section>
          <div className="eyebrow">Design // one rule</div>
          <div className="head">
            <h2><span className="mark">// 03.</span> The Rule</h2>
            <div className="count">why the numbers hold</div>
          </div>

          <div className="lp-rule">
            <div className="lp-rule-line">
              The model parses language.<br />
              <em>It never does arithmetic.</em>
            </div>
          </div>

          <div className="grid c3">
            <div className="panel">
              <div className="badge">01 / model</div>
              <div className="k">parses</div>
              <div className="sub">
                &ldquo;2 rotis and a katori of dal&rdquo; becomes
                <code>roti · 2 · piece</code>. That is all it does.
              </div>
            </div>
            <div className="panel">
              <div className="badge">02 / table</div>
              <div className="k">knows</div>
              <div className="sub">
                Per-100 g values and portion sizes. One roti is 45 g. One katori is
                150 g. Written down, not guessed.
              </div>
            </div>
            <div className="panel">
              <div className="badge">03 / code</div>
              <div className="k">calculates</div>
              <div className="sub">
                Every multiplication and total, in TypeScript. Nothing above
                9 kcal per gram ever reaches the database.
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- 03 indian food ---------------- */}
        <section>
          <div className="eyebrow">Vocabulary // what it speaks</div>
          <div className="head">
            <h2><span className="mark">// 04.</span> Katori, Not Cups</h2>
            <div className="count">46 foods, seeded</div>
          </div>

          <p className="lp-body">
            Generic trackers were built on sandwiches and salads. Point one at a
            thali and it guesses. Naap knows a <b>katori</b>, a <b>roti</b>, a
            <b> thali</b> — and anything it doesn&apos;t know, you teach it once and it
            remembers forever, for you alone.
          </p>

          <div className="chips wide">
            {["roti", "dal", "rajma", "chole", "paneer", "curd", "idli", "dosa",
              "poha", "ghee", "sabzi", "chaas", "whey", "katori", "thali"].map((c) => (
              <span className="chip" key={c}>{c}</span>
            ))}
          </div>
        </section>

        {/* ---------------- 04 league ---------------- */}
        <section>
          <div className="eyebrow">League // consistency, not calories</div>
          <div className="head">
            <h2><span className="mark">// 05.</span> Bring Friends</h2>
            <div className="count">nobody wins by eating less</div>
          </div>

          <p className="lp-body">
            Leagues rank on <b>showing up</b> — days logged, days you hit your own
            protein goal, your streak. Never on calories eaten or weight lost. A
            leaderboard for who ate least rewards under-eating, and means nothing
            between someone cutting and someone bulking.
          </p>

          <div className="lp-table">
            <div className="row top"><div className="rank">01</div><div className="who">@rahul</div><div className="stat">7/7</div><div className="stat hit">P7</div><div className="stat streak">12d</div></div>
            <div className="row me"><div className="rank">02</div><div className="who">@you</div><div className="stat">6/7</div><div className="stat">P4</div><div className="stat streak">6d</div></div>
            <div className="row"><div className="rank">03</div><div className="who">@arjun</div><div className="stat">5/7</div><div className="stat">P2</div><div className="stat streak">2d</div></div>
          </div>
          <div className="note">@rahul is on a 12-day streak. You&apos;re on 6.</div>
        </section>

        {/* ---------------- 05 free ---------------- */}
        <section>
          <div className="eyebrow">Cost // all of it</div>
          <div className="head">
            <h2><span className="mark">// 06.</span> Free, Actually</h2>
            <div className="count">$0 / month</div>
          </div>

          <p className="lp-body">
            Every competitor here is a subscription. Naap is open source and runs
            entirely on free tiers — so it stays free however many people use it,
            because each person runs their own.
          </p>

          <div className="grid c4">
            {[["Vercel", "hosting"], ["Neon", "postgres"], ["Groq", "inference"], ["Telegram", "interface"]].map(([n, w]) => (
              <div className="panel" key={n}>
                <div className="k">{w}</div>
                <div className="v">{n}</div>
                <div className="sub">free tier</div>
              </div>
            ))}
          </div>

          <div className="lp-actions">
            {signedIn ? (
              <a className="btn" href="/dash">Open your dashboard</a>
            ) : (
              <a className="btn" href={BOT}>Start logging</a>
            )}
            <a className="btn ghost" href={REPO}>Deploy your own</a>
          </div>
        </section>

        <footer>
          <span>naap — नाप — to measure</span>
          <span>measured, not guessed</span>
        </footer>
      </div>
    </>
  );
}
