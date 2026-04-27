-- Per-subscriber Telegram-bot language. The bot DMs each member in
-- their preferred language (zh = traditional Chinese, en = English).
-- Reports stored in ops.daily_reports remain English-only — the
-- classifier in /api/agent/classify-report translates non-English
-- replies to English before persisting structured fields.
--
-- Idempotent: safe to re-run on every boot.

ALTER TABLE ops.report_subscribers
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'zh';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'report_subscribers_language_check'
  ) THEN
    ALTER TABLE ops.report_subscribers
      ADD CONSTRAINT report_subscribers_language_check
      CHECK (language IN ('zh', 'en'));
  END IF;
END $$;
