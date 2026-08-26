import Groq from "groq-sdk";
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trimStart().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const groq = new Groq({ apiKey: env.GROQ_API_KEY });
const cases = [
  "log my lunch - 2 chapati, one katori aloo capsicum sabji, 150g tandoori chicken and a glass of chaas",
  "3 whole eggs boiled, 2 egg whites and a scoop of whey with 200ml milk",
  "how much protein do i have left",
  "71.4",
];

for (const text of cases) {
  const t0 = Date.now();
  const res = await groq.chat.completions.create({
    model: "qwen/qwen3.8-27b", max_tokens: 600, temperature: 0,
    messages: [
      { role: "system", content: "You turn a message about food into structured data for a macro ledger. log_food for food eaten (grams when given, else portion words: piece, katori, bowl, cup, scoop, glass; Indian foods common; never estimate calories). get_status when asked what's left. log_weight for a bare number in kg." },
      { role: "user", content: `[local time 13:20] ${text}` },
    ],
    tools: [
      { type: "function", function: { name: "log_food", description: "Record food eaten", parameters: { type: "object", properties: { meal: { type: ["string", "null"] }, items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, qty: { type: "number" }, unit: { type: "string" } }, required: ["name", "qty", "unit"] } } }, required: ["items"] } } },
      { type: "function", function: { name: "get_status", description: "Report what is left against target", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "log_weight", description: "Record bodyweight kg", parameters: { type: "object", properties: { kg: { type: "number" } }, required: ["kg"] } } },
    ],
  });
  const ms = Date.now() - t0;
  const call = res.choices[0].message.tool_calls?.[0];
  const u = res.usage;
  if (!call) { console.log(`  ✗ ${ms}ms  no tool call  "${text.slice(0, 40)}"`); continue; }
  const a = JSON.parse(call.function.arguments || "{}");
  const detail = call.function.name === "log_food"
    ? a.items.map(i => `${i.name}:${i.qty}:${i.unit}`).join(", ")
    : JSON.stringify(a);
  console.log(`  ✓ ${String(ms).padStart(4)}ms  ${String(u.prompt_tokens).padStart(4)}tok  ${call.function.name}`);
  console.log(`         ${detail}`);
}
