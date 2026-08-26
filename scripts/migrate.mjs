/**
 * Apply db/*.sql in order. Idempotent — every statement is CREATE/ALTER ... IF NOT EXISTS.
 *
 *   node scripts/migrate.mjs
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

/**
 * Strip comments FIRST, then split.
 *
 * Splitting first and discarding chunks that start with "--" silently drops the
 * first real statement in any file that opens with a header comment — which is
 * how `users` went missing and everything referencing it failed with 42P01.
 */
function statements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const sql = neon(process.env.DATABASE_URL);
const dir = path.join(process.cwd(), "db");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const stmts = statements(fs.readFileSync(path.join(dir, file), "utf8"));
  for (const stmt of stmts) {
    try {
      await sql.query(stmt);
    } catch (err) {
      console.error(`\n✗ ${file}: ${err.message}`);
      console.error(`  statement: ${stmt.slice(0, 120)}...`);
      process.exit(1);
    }
  }
  console.log(`  ✓ ${file} — ${stmts.length} statements`);
}
console.log("migration complete");
