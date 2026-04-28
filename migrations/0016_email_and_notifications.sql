-- Email infrastructure (Pass 1).
--
-- ops.email_logs:        every send attempt — provider, status, request_id
-- ops.email_templates:   per (event_id, language) editable template body
-- ops.notifications:     in-app bell items keyed to recipient email
--
-- Templates fall back to in-code defaults from server's
-- EMAIL_EVENT_CATALOG when no DB row exists for the (event_id, language)
-- pair, so a fresh deploy works before the boss touches any UI.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS ops.email_templates (
    event_id     text         NOT NULL,
    language     text         NOT NULL CHECK (language IN ('en', 'zh')),
    subject      text         NOT NULL,
    body         text         NOT NULL,
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    updated_by   text,
    PRIMARY KEY (event_id, language)
);

CREATE TABLE IF NOT EXISTS ops.email_logs (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        text         NOT NULL,
    recipient_email text         NOT NULL,
    subject         text,
    language        text,
    status          text         NOT NULL DEFAULT 'queued'
                                  CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
    provider        text,         -- 'resend', etc.
    provider_id     text,         -- Resend's message id when status='sent'
    error           text,
    context_preview jsonb        NOT NULL DEFAULT '{}'::jsonb,
    actor_email     text,         -- who triggered this email
    created_at      timestamptz  NOT NULL DEFAULT now(),
    sent_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient
    ON ops.email_logs (recipient_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_event
    ON ops.email_logs (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_status
    ON ops.email_logs (status) WHERE status = 'failed';

CREATE TABLE IF NOT EXISTS ops.notifications (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_email text         NOT NULL,
    kind            text         NOT NULL,
    title           text         NOT NULL,
    body            text,
    link_url        text,
    read_at         timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
    ON ops.notifications (recipient_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON ops.notifications (recipient_email, created_at DESC)
    WHERE read_at IS NULL;
