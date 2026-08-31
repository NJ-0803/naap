/**
 * Load-test the Telegram webhook against a LOCAL dev server only.
 *
 * Every non-command message goes through a real Groq call (see lib/parse.ts)
 * — running this against production would burn real API quota and write
 * fake rows into the live database for no reason. Point it at `next dev`.
 *
 *   npm run dev                                  # separate terminal
 *   node scripts/loadtest.mjs [count] [concurrency]
 *
 * Uses a dedicated fake Telegram id so it can never collide with a real
 * user, and deletes every row it wrote when done.
 */
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const BASE_URL = process.env.LOADTEST_URL ?? "http://localhost:3000";
if (/vercel\.app|naap-zeta/.test(BASE_URL)) {
  console.error("Refusing to load-test a production-looking URL. Set LOADTEST_URL to a local dev server.");
  process.exit(1);
}

const COUNT = Number(process.argv[2]) || 20;
const CONCURRENCY = Number(process.argv[3]) || 5;
const TEST_TG_ID = 900000000 + Math.floor(Math.random() * 99999); // fresh id per run
const UPDATE_BASE = Date.now();

const MESSAGES = [
  "2 roti and a katori of dal",
  "150g chicken breast",
  "1 banana",
  "a glass of buttermilk",
  "3 idli with coconut chutney",
  "1 bowl curd rice",
  "2 boiled eggs and a slice of bread",
  "how much protein do i have left",
  "1 cup black coffee",
  "100g paneer bhurji",
];

function update(i, dupe = false) {
  return {
    update_id: dupe ? UPDATE_BASE : UPDATE_BASE + i,
    message: {
      message_id: i,
      from: { id: TEST_TG_ID, first_name: "LoadTest" },
      chat: { id: TEST_TG_ID },
      date: Math.floor(Date.now() / 1000),
      text: MESSAGES[i % MESSAGES.length],
    },
  };
}

async function send(body) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/api/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.TELEGRAM_WEBHOOK_SECRET
          ? { "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify(body),
    });
    const ms = performance.now() - t0;
    return { ok: res.ok, status: res.status, ms };
  } catch (err) {
    return { ok: false, status: 0, ms: performance.now() - t0, err: String(err) };
  }
}

async function pool(items, limit, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

console.log(`Load-testing ${BASE_URL}/api/telegram — ${COUNT} messages, concurrency ${CONCURRENCY}`);
console.log(`Test user telegram_id ${TEST_TG_ID} (fresh, cleaned up after)\n`);

const updates = Array.from({ length: COUNT }, (_, i) => update(i));
const results = await pool(updates, CONCURRENCY, send);

const times = results.map((r) => r.ms).sort((a, b) => a - b);
const p50 = times[Math.floor(times.length * 0.5)];
const p95 = times[Math.floor(times.length * 0.95)];
const failed = results.filter((r) => !r.ok);

console.log(`p50 ${p50.toFixed(0)}ms   p95 ${p95.toFixed(0)}ms   max ${times.at(-1).toFixed(0)}ms`);
console.log(`${results.length - failed.length}/${results.length} succeeded`);
if (failed.length) console.log("failures:", failed.slice(0, 3));

// idempotency: replay the first update_id and confirm it's a no-op
const dupe = await send(update(0, true));
console.log(`\nidempotency replay of update_id ${UPDATE_BASE}: ${dupe.ok ? "ok" : "FAILED"} (${dupe.ms.toFixed(0)}ms)`);

// cleanup — this test user, and the update_ids it claimed, should leave no trace
const sql = neon(process.env.DATABASE_URL);
const u = await sql`SELECT id FROM users WHERE telegram_id = ${TEST_TG_ID}`;
if (u[0]) {
  const n = await sql`SELECT COUNT(*)::int n FROM entries WHERE user_id = ${u[0].id}`;
  await sql`DELETE FROM users WHERE id = ${u[0].id}`; // cascades to targets/entries/weights
  console.log(`cleaned up: ${n[0].n} entries + test user removed`);
} else {
  console.log("no user row was created (every request may have failed before upsertUser)");
}
// processed_updates isn't scoped to a user, so it isn't caught by the cascade above.
const ids = updates.map((u) => u.update_id);
await sql`DELETE FROM processed_updates WHERE update_id = ANY(${ids})`;
console.log(`cleaned up: ${ids.length} claimed update_ids removed`);
