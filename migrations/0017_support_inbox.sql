-- Support inbox (Pass 2).
--
-- ops.support_tickets:   one row per request (subject + body + status)
-- ops.support_messages:  threaded replies; author_kind distinguishes
--                        staff / requester / AI draft / system events
-- ops.support_kb:        admin-curated short facts the AI draft reply
--                        grounds against
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS ops.support_tickets (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    subject         text         NOT NULL,
    requester_name  text         NOT NULL,
    requester_email text         NOT NULL,
    status          text         NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open','pending','resolved','closed')),
    assignee_email  text,
    source          text         NOT NULL DEFAULT 'web'
                                  CHECK (source IN ('web','telegram','email','api')),
    language        text         NOT NULL DEFAULT 'en'
                                  CHECK (language IN ('en','zh')),
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    closed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status
    ON ops.support_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assignee
    ON ops.support_tickets (assignee_email, created_at DESC)
    WHERE status IN ('open','pending');

CREATE TABLE IF NOT EXISTS ops.support_messages (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id       uuid         NOT NULL REFERENCES ops.support_tickets(id) ON DELETE CASCADE,
    author_email    text         NOT NULL,
    author_kind     text         NOT NULL
                                  CHECK (author_kind IN ('staff','requester','ai_draft','system')),
    body            text         NOT NULL,
    created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket
    ON ops.support_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS ops.support_kb (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    title       text         NOT NULL,
    body        text         NOT NULL,
    is_active   boolean      NOT NULL DEFAULT true,
    position    int          NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_kb_active
    ON ops.support_kb (is_active, position) WHERE is_active = true;

-- Seed a starter KB entry so the AI assistant has something to ground on
-- before the boss writes their own.
INSERT INTO ops.support_kb (title, body, position) VALUES
  ('How TeamScope reports work',
$$TeamScope sends three Telegram prompts a day per active subscriber: morning (default 09:00), midday (default 13:30), and end of day (default 18:30) in the subscriber's local timezone. Members reply via Telegram Reply; replies are auto-classified and stored as the daily report. The boss can also log reports manually via the web UI on the Reports page.$$,
   0)
ON CONFLICT DO NOTHING;
