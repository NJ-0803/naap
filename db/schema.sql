-- NutriLog schema.
--
-- Multi-tenant from day one: every row that belongs to a person carries
-- user_id. Retrofitting that later is painful, and it costs nothing now.

CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    telegram_id   BIGINT UNIQUE NOT NULL,
    chat_id       BIGINT,                       -- where to deliver scheduled reports
    name          TEXT,
    timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS targets (
    user_id   BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    kcal      REAL NOT NULL DEFAULT 2000,
    protein   REAL NOT NULL DEFAULT 150,
    carbs     REAL NOT NULL DEFAULT 200,
    fat       REAL NOT NULL DEFAULT 65,
    fiber     REAL NOT NULL DEFAULT 30,
    goal      TEXT NOT NULL DEFAULT 'recomp',   -- cut | bulk | recomp | maintain
    weight_kg REAL
);

-- Foods are global (owner_user_id IS NULL) or private to one user.
-- A user's own entry shadows the global one of the same key, so people can
-- correct "roti" for themselves without changing it for everyone.
CREATE TABLE IF NOT EXISTS foods (
    id             BIGSERIAL PRIMARY KEY,
    owner_user_id  BIGINT REFERENCES users(id) ON DELETE CASCADE,
    key            TEXT NOT NULL,
    aliases        TEXT[] NOT NULL DEFAULT '{}',
    -- per 100 g/ml
    kcal           REAL NOT NULL,
    protein        REAL NOT NULL DEFAULT 0,
    carbs          REAL NOT NULL DEFAULT 0,
    fat            REAL NOT NULL DEFAULT 0,
    fiber          REAL NOT NULL DEFAULT 0,
    -- unit name -> grams, e.g. {"piece": 45, "katori": 150}
    portions       JSONB NOT NULL DEFAULT '{}',
    learned_at     TIMESTAMPTZ,
    UNIQUE (owner_user_id, key)
);
CREATE INDEX IF NOT EXISTS foods_key_idx ON foods (key);
CREATE INDEX IF NOT EXISTS foods_aliases_idx ON foods USING GIN (aliases);

CREATE TABLE IF NOT EXISTS entries (
    id        BIGSERIAL PRIMARY KEY,
    user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
    day       DATE NOT NULL,                    -- local day, resolved in the user's tz
    meal      TEXT,
    food      TEXT NOT NULL,
    qty       REAL NOT NULL,
    unit      TEXT,
    grams     REAL,
    kcal      REAL NOT NULL DEFAULT 0,
    protein   REAL NOT NULL DEFAULT 0,
    carbs     REAL NOT NULL DEFAULT 0,
    fat       REAL NOT NULL DEFAULT 0,
    fiber     REAL NOT NULL DEFAULT 0,
    source    TEXT                              -- table | learned | custom
);
CREATE INDEX IF NOT EXISTS entries_user_day_idx ON entries (user_id, day);

CREATE TABLE IF NOT EXISTS weights (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     DATE NOT NULL,
    kg      REAL NOT NULL,
    ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
);

-- Telegram retries webhooks it thinks failed. Recording every update_id we
-- have already handled is what makes double-logging structurally impossible
-- rather than something we try to detect after the fact.
CREATE TABLE IF NOT EXISTS processed_updates (
    update_id    BIGINT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
