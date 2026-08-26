/**
 * Magic-link auth.
 *
 * The bot already knows who you are — Telegram authenticated you when you
 * messaged it. So the web dashboard doesn't need its own login: `/web` in the
 * chat mints a short-lived signed link, opening it sets a session cookie.
 *
 * No passwords, no OAuth, no third-party verification. That last point matters:
 * an OAuth-scoped approach is what made a previous project un-launchable.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const LINK_TTL_MS = 10 * 60 * 1000;        // a magic link is single-use-ish, 10 min
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days once you're in

function secret(): string {
  const s = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!s) throw new Error("TELEGRAM_WEBHOOK_SECRET is required to sign links");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** token = <userId>.<expiryMs>.<signature> */
export function mintToken(userId: number, ttlMs = LINK_TTL_MS): string {
  const body = `${userId}.${Date.now() + ttlMs}`;
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | undefined | null): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = sign(`${id}.${exp}`);

  // constant-time compare so a wrong signature can't be probed byte by byte
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (!Number.isFinite(Number(exp)) || Number(exp) < Date.now()) return null;
  const userId = Number(id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

export function mintSession(userId: number): string {
  return mintToken(userId, SESSION_TTL_MS);
}

export const SESSION_COOKIE = "naap_session";
export const SESSION_MAX_AGE = SESSION_TTL_MS / 1000;
