import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) {
  if(!l.includes("="))continue; const i=l.indexOf("="); process.env[l.slice(0,i).trim()] ||= l.slice(i+1).trim();
}
const sql = neon(process.env.DATABASE_URL);
const { findFood, toGrams, macrosFor, implausible } = await import("../lib/ledger.ts");

// a test user
const u = await sql`INSERT INTO users (telegram_id, chat_id, name) VALUES (999001, 999001, 'test')
  ON CONFLICT (telegram_id) DO UPDATE SET name='test' RETURNING id`;
const uid = u[0].id;
await sql`INSERT INTO targets (user_id, kcal, protein) VALUES (${uid}, 1900, 130)
  ON CONFLICT (user_id) DO UPDATE SET kcal=1900, protein=130`;

const foods = await sql`SELECT id,key,aliases,kcal,protein,carbs,fat,fiber,portions FROM foods
  WHERE owner_user_id IS NULL OR owner_user_id = ${uid}`;

// the exact message from the Hermes bug report
const parsed = [
  { name: "chapati", qty: 2, unit: "piece" },
  { name: "dal", qty: 1, unit: "katori" },
  { name: "chicken breast", qty: 150, unit: "g" },
];
console.log("  parsed items -> priced:");
let total = 0;
for (const it of parsed) {
  const f = findFood(it.name, foods);
  const g = toGrams(f, it.qty, it.unit);
  const m = macrosFor(f, g);
  const bad = implausible(m, g, f.key);
  total += m.kcal;
  console.log(`    ${it.name.padEnd(16)} -> ${f.key.padEnd(22)} ${String(g).padStart(4)}g  ${Math.round(m.kcal)} kcal  P${Math.round(m.protein)}${bad ? "  REJECTED" : ""}`);
  await sql`INSERT INTO entries (user_id, day, meal, food, qty, unit, grams, kcal, protein, carbs, fat, fiber, source)
    VALUES (${uid}, CURRENT_DATE, 'lunch', ${f.key}, ${it.qty}, ${it.unit}, ${g},
            ${m.kcal}, ${m.protein}, ${m.carbs}, ${m.fat}, ${m.fiber}, 'table')`;
}
const t = await sql`SELECT COALESCE(SUM(kcal),0)::float kcal, COALESCE(SUM(protein),0)::float protein,
  COUNT(*)::int n FROM entries WHERE user_id=${uid} AND day=CURRENT_DATE`;
console.log(`\n  stored: ${t[0].n} rows, ${Math.round(t[0].kcal)} kcal, ${Math.round(t[0].protein)}g protein`);

// idempotency
const a = await sql`INSERT INTO processed_updates (update_id) VALUES (555001) ON CONFLICT DO NOTHING RETURNING update_id`;
const b = await sql`INSERT INTO processed_updates (update_id) VALUES (555001) ON CONFLICT DO NOTHING RETURNING update_id`;
console.log(`  idempotency: first claim=${a.length===1}  retry blocked=${b.length===0}`);

// clean up
await sql`DELETE FROM entries WHERE user_id=${uid}`;
await sql`DELETE FROM processed_updates WHERE update_id=555001`;
await sql`DELETE FROM targets WHERE user_id=${uid}`;
await sql`DELETE FROM users WHERE id=${uid}`;
console.log("  test data removed");
