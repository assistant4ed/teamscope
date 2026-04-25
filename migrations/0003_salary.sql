-- Salary configuration + payment log + email mapping for self-edit.
--
-- email column on report_subscribers links a Telegram subscriber to
-- their TeamScope web login (ALLOWED_USERS). Without it we can't
-- authorise a colleague to edit their own report rows.
--
-- subscriber_salary holds the current rate per subscriber. Replaced
-- in place when the boss changes terms; salary_payments preserves the
-- audit trail of what was actually paid for which period.
--
-- Safe to re-run.

ALTER TABLE ops.report_subscribers
    ADD COLUMN IF NOT EXISTS email text;

CREATE INDEX IF NOT EXISTS idx_report_subscribers_email
    ON ops.report_subscribers (lower(email))
    WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS ops.subscriber_salary (
    subscriber_id   uuid         PRIMARY KEY REFERENCES ops.report_subscribers(id) ON DELETE CASCADE,
    payment_type    text         NOT NULL
                                 CHECK (payment_type IN ('monthly_base','hourly','daily_rate')),
    rate            numeric      NOT NULL CHECK (rate >= 0),
    currency        text         NOT NULL DEFAULT 'SGD',
    notes           text,
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    updated_by      text
);

CREATE TABLE IF NOT EXISTS ops.salary_payments (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id   uuid         NOT NULL REFERENCES ops.report_subscribers(id) ON DELETE CASCADE,
    period_start    date         NOT NULL,
    period_end      date         NOT NULL CHECK (period_end >= period_start),
    days_reported   int,
    hours_reported  numeric,
    amount          numeric      NOT NULL CHECK (amount >= 0),
    currency        text         NOT NULL DEFAULT 'SGD',
    paid_at         timestamptz  NOT NULL DEFAULT now(),
    paid_by         text,
    notes           text
);
CREATE INDEX IF NOT EXISTS idx_salary_payments_subscriber
    ON ops.salary_payments (subscriber_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_salary_payments_period
    ON ops.salary_payments (period_start, period_end);

-- Seed known emails. Idempotent: only sets when currently NULL so
-- a manual override (Team page edit) isn't clobbered on next boot.
UPDATE ops.report_subscribers SET email = 'ops6@hobbyland-group.com'
 WHERE name = 'Meghan Ang' AND email IS NULL;
UPDATE ops.report_subscribers SET email = 'admini@hobbyland-group.com'
 WHERE name = 'Andrea' AND email IS NULL;
