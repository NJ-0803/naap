import { nudgesFor } from "../lib/rivalry.ts";
import type { Standing } from "../lib/social.ts";

const mk = (u: string, d: number, p: number, t: number, s: number): Standing => ({
  user_id: u.length + d * 100 + p, username: u, name: u,
  days_logged: d, protein_days: p, on_target_days: t, streak: s,
  score: d + p + t,
});

// a realistic week: you're 2nd, your friend had a perfect week, both short on protein
const me = mk("nj", 6, 2, 3, 6);
const rahul = mk("rahul", 7, 7, 5, 12);
const arjun = mk("arjun", 6, 2, 2, 4);
const table = [rahul, me, arjun].sort((a, b) => b.score - a.score);

console.log("  table:", table.map(r => `${r.username}=${r.score}`).join("  "));
console.log();
for (const n of nudgesFor(me, table, 7)) {
  console.log(`  [${n.weight}] ${n.text}`);
}
