import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import { createHmac } from "node:crypto";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) {
  if(!l.includes("="))continue; const i=l.indexOf("="); process.env[l.slice(0,i).trim()] ||= l.slice(i+1).trim();
}
const sql = neon(process.env.DATABASE_URL);

// demo user + league mates
const mk = async (tg, uname, name) => {
  const r = await sql`INSERT INTO users (telegram_id, chat_id, name, username) VALUES (${tg},${tg},${name},${uname})
    ON CONFLICT (telegram_id) DO UPDATE SET username=${uname}, name=${name} RETURNING id`;
  await sql`INSERT INTO targets (user_id, kcal, protein, carbs, fat, fiber, goal)
    VALUES (${r[0].id}, 1900, 130, 210, 60, 30, 'cut')
    ON CONFLICT (user_id) DO UPDATE SET kcal=1900, protein=130, carbs=210, fat=60, fiber=30, goal='cut'`;
  return r[0].id;
};
const me = await mk(900001, "nj", "NJ");
const rahul = await mk(900002, "rahul", "Rahul");
const arjun = await mk(900003, "arjun", "Arjun");

const lg = await sql`INSERT INTO leagues (name, join_code, created_by) VALUES ('Gym Bros','DEMO01',${me})
  ON CONFLICT (join_code) DO UPDATE SET name='Gym Bros' RETURNING id`;
for (const u of [me, rahul, arjun])
  await sql`INSERT INTO league_members (league_id, user_id) VALUES (${lg[0].id},${u}) ON CONFLICT DO NOTHING`;

// a realistic week
for (const u of [me, rahul, arjun]) await sql`DELETE FROM entries WHERE user_id=${u}`;
const plan = {
  [me]:    [[1740,128],[1880,134],[0,0],[1620,118],[2050,141],[1790,126],[1160,86]],
  [rahul]: [[1900,135],[1870,132],[1920,138],[1880,131],[1910,136],[1890,133],[1450,101]],
  [arjun]: [[2200,90],[0,0],[1980,84],[2310,96],[0,0],[2050,88],[900,40]],
};
for (const [uid, days] of Object.entries(plan)) {
  for (let i = 0; i < 7; i++) {
    const [kcal, protein] = days[i];
    if (!kcal) continue;
    const meals = [["breakfast",0.28],["lunch",0.4],["dinner",0.32]];
    for (const [meal, share] of meals) {
      await sql`INSERT INTO entries (user_id, day, meal, food, qty, unit, grams, kcal, protein, carbs, fat, fiber, source)
        VALUES (${Number(uid)}, (CURRENT_DATE - (${6-i} || ' days')::interval)::date, ${meal}, 'mixed meal', 1, 'plate', 350,
          ${kcal*share}, ${protein*share}, ${kcal*share*0.11}, ${kcal*share*0.03}, ${kcal*share*0.004}, 'table')`;
    }
  }
}
const body = `${me}.${Date.now()+600000}`;
const sig = createHmac("sha256", process.env.TELEGRAM_WEBHOOK_SECRET).update(body).digest("base64url");
console.log(`https://naap-zeta.vercel.app/link?t=${body}.${sig}`);
