-- Switch the system default language to English. Existing rows keep
-- whatever the boss set per-member; only new subscribers default to en.
-- Idempotent: re-runs cleanly because ALTER COLUMN SET DEFAULT is
-- replace-style.

ALTER TABLE ops.report_subscribers
  ALTER COLUMN language SET DEFAULT 'en';
