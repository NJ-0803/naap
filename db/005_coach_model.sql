-- Which model actually reasoned about a coach note. The model is now
-- auto-selected per note (see lib/coach.ts's selectModel) rather than fixed
-- to one option, so this is worth surfacing rather than hiding.
ALTER TABLE coach_notes ADD COLUMN IF NOT EXISTS model TEXT;
