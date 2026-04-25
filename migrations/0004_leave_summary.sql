-- Leave / public holidays / cached monthly summaries.
--
-- subscriber_leave_days holds dates a single subscriber is off (no
-- prompts, no missed-slot penalty, no salary deduction). public_holidays
-- is global — useful for SG-wide off-days without manually marking each
-- person. monthly_summaries caches Claude-generated review text per
-- subscriber × month so the boss isn't paying for a fresh inference
-- every page load.

CREATE TABLE IF NOT EXISTS ops.subscriber_leave_days (
    subscriber_id   uuid          NOT NULL REFERENCES ops.report_subscribers(id) ON DELETE CASCADE,
    leave_date      date          NOT NULL,
    kind            text          NOT NULL DEFAULT 'leave'
                                  CHECK (kind IN ('leave', 'sick', 'unpaid', 'public_holiday', 'other')),
    note            text,
    created_by      text,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (subscriber_id, leave_date)
);
CREATE INDEX IF NOT EXISTS idx_subscriber_leave_days_date
    ON ops.subscriber_leave_days (leave_date);

CREATE TABLE IF NOT EXISTS ops.public_holidays (
    holiday_date    date          PRIMARY KEY,
    name            text          NOT NULL,
    country         text          NOT NULL DEFAULT 'SG',
    created_by      text,
    created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.monthly_summaries (
    subscriber_id   uuid          NOT NULL REFERENCES ops.report_subscribers(id) ON DELETE CASCADE,
    period_start    date          NOT NULL,
    period_end      date          NOT NULL,
    summary         text          NOT NULL,
    generated_at    timestamptz   NOT NULL DEFAULT now(),
    generated_by    text,
    PRIMARY KEY (subscriber_id, period_start)
);
