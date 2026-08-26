-- Social layer: usernames, leagues, streaks.
--
-- Deliberate design decision: nothing here ranks people on calories eaten,
-- weight, or weight lost. Competing on "who ate least" rewards under-eating,
-- and it is meaningless across people with different goals — a bulker and a
-- cutter cannot share that leaderboard. Everything below scores CONSISTENCY
-- against each member's own targets, so the incentive points at discipline
-- rather than restriction.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
  ON users (lower(username)) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS leagues (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    join_code  TEXT UNIQUE NOT NULL,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS league_members (
    league_id BIGINT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (league_id, user_id)
);
CREATE INDEX IF NOT EXISTS league_members_user_idx ON league_members (user_id);
