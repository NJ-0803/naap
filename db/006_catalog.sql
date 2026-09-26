-- Large read-only reference catalog (USDA FoodData Central: Foundation, SR
-- Legacy, FNDDS Survey). Kept apart from `foods` so the per-message table load
-- stays small; it is only searched when the curated/personal table misses.
CREATE TABLE IF NOT EXISTS catalog_foods (
    id        BIGSERIAL PRIMARY KEY,
    fdc_id    BIGINT UNIQUE NOT NULL,
    source    TEXT NOT NULL,
    key       TEXT NOT NULL,
    kcal      REAL NOT NULL,
    protein   REAL NOT NULL DEFAULT 0,
    carbs     REAL NOT NULL DEFAULT 0,
    fat       REAL NOT NULL DEFAULT 0,
    fiber     REAL NOT NULL DEFAULT 0,
    portions  JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS catalog_foods_key_idx ON catalog_foods (key)
