import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) {
  if(!l.includes("="))continue; const i=l.indexOf("="); process.env[l.slice(0,i).trim()] ||= l.slice(i+1).trim();
}
const { parseMessage } = await import("../lib/parse.ts");
const { estimateFood } = await import("../lib/learn.ts");

const cases = [
  "add beer(geist) calories=220",
  "beer is 220 calories per bottle",
  "set my target to 1900 calories and 130g protein",
];
for (const text of cases) {
  const t0 = Date.now();
  const intent = await parseMessage(text, "23:30");
  console.log(`\n  "${text}"`);
  console.log(`    -> ${intent.kind}  ${Date.now()-t0}ms  ${JSON.stringify(intent).slice(0,120)}`);
  if (intent.kind === "teach") {
    const f = await estimateFood(intent.food, intent.stated);
    if (!f) { console.log("    -> estimate REJECTED"); continue; }
    console.log(`    -> learned "${f.key}": ${Math.round(f.per100.kcal)} kcal/100  P${f.per100.protein} C${f.per100.carbs} F${f.per100.fat}`);
    console.log(`       portions: ${JSON.stringify(f.portions)}`);
    for (const [u,g] of Object.entries(f.portions)) console.log(`       1 ${u} (${g}g) = ${Math.round(f.per100.kcal*g/100)} kcal`);
  }
}
