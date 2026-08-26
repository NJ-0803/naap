/** Apply db/schema.sql. Idempotent — every statement is CREATE ... IF NOT EXISTS. */
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

const sql = neon(process.env.DATABASE_URL);
const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
const statements = schema.split(/;\s*$/m).map(s => s.trim()).filter(s => s && !s.startsWith("--"));
for (const stmt of statements) {
  await sql.query(stmt);
}
console.log(`applied ${statements.length} statements`);
