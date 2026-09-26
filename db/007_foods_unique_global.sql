-- UNIQUE (owner_user_id, key) never fires for global rows (NULL owner is
-- distinct from itself), so every seed run inserted a full duplicate set and
-- loadFoods picked an arbitrary copy. Keep the newest row per global key and
-- enforce uniqueness with a partial index.
DELETE FROM foods a USING foods b
  WHERE a.owner_user_id IS NULL AND b.owner_user_id IS NULL
    AND a.key = b.key AND a.id < b.id;
CREATE UNIQUE INDEX IF NOT EXISTS foods_global_key_uidx ON foods (key) WHERE owner_user_id IS NULL
