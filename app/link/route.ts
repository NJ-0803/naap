/**
 * Magic-link landing. The bot mints a short-lived signed token; opening the
 * link exchanges it for a 30-day session cookie and drops you on the dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyToken, mintSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  const userId = verifyToken(token);
  if (!userId) {
    return new NextResponse(
      "This link has expired. Send /web to the bot for a fresh one.",
      { status: 401, headers: { "Content-Type": "text/plain" } }
    );
  }
  const res = NextResponse.redirect(new URL("/dash", req.url));
  res.cookies.set(SESSION_COOKIE, mintSession(userId), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
