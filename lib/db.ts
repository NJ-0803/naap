import { neon } from "@neondatabase/serverless";
import type { Food, Macros, PricedItem } from "./ledger";

export const sql = neon(process.env.DATABASE_URL!);

export type User = {
  id: number;
  telegram_id: number;
  chat_id: number | null;
  name: string | null;
  timezone: string;
};

export type Targets = Macros & { goal: string; weight_kg: number | null };

/** Find or create the user behind a Telegram message. */
export async function upsertUser(
  telegramId: number,
  chatId: number,
  name: string | null
): Promise<User> {
  const rows = (await sql`
    INSERT INTO users (telegram_id, chat_id, name)
    VALUES (${telegramId}, ${chatId}, ${name})
    ON CONFLICT (telegram_id) DO UPDATE
      SET chat_id = EXCLUDED.chat_id,
          name    = COALESCE(users.name, EXCLUDED.name)
    RETURNING id, telegram_id, chat_id, name, timezone
  `) as User[];
  const user = rows[0];

  await sql`
    INSERT INTO targets (user_id) VALUES (${user.id})
    ON CONFLICT (user_id) DO NOTHING
  `;
  return user;
}

export async function getTargets(userId: number): Promise<Targets> {
  const rows = (await sql`
    SELECT kcal, protein, carbs, fat, fiber, goal, weight_kg
    FROM targets WHERE user_id = ${userId}
  `) as Targets[];
  return rows[0];
}

/**
 * The food table this user sees: global foods plus their own, with their own
 * winning on a key clash. That shadowing is what lets one person correct
 * "roti" without changing it for everybody else.
 */
export async function loadFoods(userId: number): Promise<Food[]> {
  const rows = (await sql`
    SELECT DISTINCT ON (key)
           id, key, aliases, kcal, protein, carbs, fat, fiber, portions
    FROM foods
    WHERE owner_user_id IS NULL OR owner_user_id = ${userId}
    ORDER BY key, owner_user_id NULLS LAST
  `) as Food[];
  return rows;
}

/**
 * Claim a Telegram update id. Returns false if we have already handled it.
 *
 * Telegram re-delivers any update it believes failed, which is precisely how
 * a single lunch got logged three times in the previous version. Making this
 * a primary-key insert turns "detect duplicates afterwards" into "duplicates
 * cannot happen".
 */
export async function claimUpdate(updateId: number): Promise<boolean> {
  const rows = (await sql`
    INSERT INTO processed_updates (update_id) VALUES (${updateId})
    ON CONFLICT (update_id) DO NOTHING
    RETURNING update_id
  `) as { update_id: number }[];
  return rows.length > 0;
}

export async function insertEntries(
  userId: number,
  day: string,
  meal: string | null,
  items: PricedItem[]
): Promise<void> {
  for (const it of items) {
    await sql`
      INSERT INTO entries
        (user_id, day, meal, food, qty, unit, grams, kcal, protein, carbs, fat, fiber, source)
      VALUES
        (${userId}, ${day}, ${meal}, ${it.food}, ${it.qty}, ${it.unit}, ${it.grams},
         ${it.macros.kcal}, ${it.macros.protein}, ${it.macros.carbs},
         ${it.macros.fat}, ${it.macros.fiber}, ${it.source})
    `;
  }
}

export async function dayTotals(userId: number, day: string): Promise<Macros & { n: number }> {
  const rows = (await sql`
    SELECT COALESCE(SUM(kcal),0)    AS kcal,
           COALESCE(SUM(protein),0) AS protein,
           COALESCE(SUM(carbs),0)   AS carbs,
           COALESCE(SUM(fat),0)     AS fat,
           COALESCE(SUM(fiber),0)   AS fiber,
           COUNT(*)                 AS n
    FROM entries WHERE user_id = ${userId} AND day = ${day}
  `) as (Macros & { n: number })[];
  return rows[0];
}

export async function undoEntries(userId: number, count: number) {
  return (await sql`
    DELETE FROM entries
    WHERE id IN (
      SELECT id FROM entries WHERE user_id = ${userId}
      ORDER BY id DESC LIMIT ${count}
    )
    RETURNING food, qty, unit, kcal
  `) as { food: string; qty: number; unit: string; kcal: number }[];
}

/**
 * Today's entries, oldest first — the numbering a person sees in /items and
 * then refers back to with /delete N. Order must match deleteEntryAt exactly,
 * or "delete 2" would remove the wrong row.
 */
export async function listEntries(userId: number, day: string) {
  return (await sql`
    SELECT id, meal, food, qty, unit, kcal, protein
    FROM entries WHERE user_id = ${userId} AND day = ${day}
    ORDER BY id ASC
  `) as { id: number; meal: string | null; food: string; qty: number; unit: string; kcal: number; protein: number }[];
}

/**
 * Delete one entry by its 1-based position in that same day's list — for
 * fixing a specific bad entry (a typo, a duplicate, a wrong portion) without
 * having to undo everything logged after it and re-type it back in.
 */
export async function deleteEntryAt(userId: number, day: string, index: number) {
  const rows = (await sql`
    WITH target AS (
      SELECT id FROM entries WHERE user_id = ${userId} AND day = ${day}
      ORDER BY id ASC OFFSET ${index - 1} LIMIT 1
    )
    DELETE FROM entries WHERE id IN (SELECT id FROM target)
    RETURNING food, qty, unit, kcal
  `) as { food: string; qty: number; unit: string; kcal: number }[];
  return rows[0] ?? null;
}

/**
 * Delete the most recent entry today matching a spoken food name — for
 * "remove idli" / "remove 2 idli", which name a food rather than a list
 * position (that's deleteEntryAt) or "the last thing" (that's undoEntries).
 */
export async function deleteLatestByFood(userId: number, day: string, food: string) {
  const q = food.trim().toLowerCase();
  const rows = (await sql`
    WITH target AS (
      SELECT id FROM entries
      WHERE user_id = ${userId} AND day = ${day}
        AND (lower(food) = ${q} OR lower(food) LIKE ${"%" + q + "%"} OR ${q} LIKE '%' || lower(food) || '%')
      ORDER BY id DESC LIMIT 1
    )
    DELETE FROM entries WHERE id IN (SELECT id FROM target)
    RETURNING food, qty, unit, kcal
  `) as { food: string; qty: number; unit: string; kcal: number }[];
  return rows[0] ?? null;
}

export async function logWeight(userId: number, day: string, kg: number) {
  await sql`
    INSERT INTO weights (user_id, day, kg) VALUES (${userId}, ${day}, ${kg})
    ON CONFLICT (user_id, day) DO UPDATE SET kg = EXCLUDED.kg, ts = now()
  `;
}

/**
 * Teach this user's table a food, after its numbers passed the guard.
 *
 * A correction must always win over whatever was there before — that's the
 * whole point of "a stated number always beats an estimate" (see lib/learn.ts).
 * DO NOTHING here would silently drop a re-teach of an already-learned food,
 * leaving stale numbers in place while the bot claims it "learned" the new ones.
 */
export async function learnFood(
  userId: number,
  key: string,
  per100: Macros,
  portions: Record<string, number>
): Promise<void> {
  await sql`
    INSERT INTO foods (owner_user_id, key, kcal, protein, carbs, fat, fiber, portions, learned_at)
    VALUES (${userId}, ${key}, ${per100.kcal}, ${per100.protein}, ${per100.carbs},
            ${per100.fat}, ${per100.fiber}, ${JSON.stringify(portions)}, now())
    ON CONFLICT (owner_user_id, key) DO UPDATE
      SET kcal = EXCLUDED.kcal, protein = EXCLUDED.protein, carbs = EXCLUDED.carbs,
          fat = EXCLUDED.fat, fiber = EXCLUDED.fiber, portions = EXCLUDED.portions,
          learned_at = EXCLUDED.learned_at
  `;
}

export async function setTargets(
  userId: number,
  t: { kcal: number; protein: number; carbs: number; fat: number; fiber: number; goal: string }
): Promise<void> {
  await sql`
    UPDATE targets SET kcal = ${t.kcal}, protein = ${t.protein}, carbs = ${t.carbs},
                       fat = ${t.fat}, fiber = ${t.fiber}, goal = ${t.goal}
    WHERE user_id = ${userId}
  `;
}
