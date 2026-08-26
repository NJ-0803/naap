"use server";

/**
 * League actions from the web. The session cookie identifies the user, so these
 * never take a user id from the client.
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { verifyToken, SESSION_COOKIE } from "@/lib/auth";
import { createLeague, joinLeague, setUsername } from "@/lib/social";

async function me(): Promise<number | null> {
  const jar = await cookies();
  return verifyToken(jar.get(SESSION_COOKIE)?.value);
}

export async function createLeagueAction(formData: FormData) {
  const userId = await me();
  if (!userId) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await createLeague(userId, name);
  revalidatePath("/dash");
}

export async function joinLeagueAction(formData: FormData) {
  const userId = await me();
  if (!userId) return;
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return;
  await joinLeague(userId, code);
  revalidatePath("/dash");
}

export async function setUsernameAction(formData: FormData) {
  const userId = await me();
  if (!userId) return;
  const handle = String(formData.get("handle") ?? "").trim();
  if (!handle) return;
  await setUsername(userId, handle);
  revalidatePath("/dash");
}
