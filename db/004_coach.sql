-- One cached LLM reasoning note per user/period/day. The coach is the one
-- place naap lets a model reason instead of compute — everything numeric is
-- decided before the model ever runs (see lib/coach.ts) — and its output is
-- explicitly non-deterministic, so it's generated at most once per day
-- rather than re-rolled on every page load.
CREATE TABLE IF NOT EXISTS coach_notes (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period     TEXT NOT NULL,   -- 'week' | 'month'
    day        DATE NOT NULL,   -- local day the note was generated for
    text       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, period, day)
);
