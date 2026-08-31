-- Height, for BMI. Weight is already tracked per-day in `weights`; height
-- changes rarely enough that one value per user on `targets` is enough.
ALTER TABLE targets ADD COLUMN IF NOT EXISTS height_cm REAL;
