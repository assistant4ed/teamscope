-- TeamScope Kanban schema (idempotent).
--
-- Single shared board model: one fixed set of columns, cards ordered by
-- integer `position` within their column. Assignees link to the existing
-- ops.report_subscribers (the same "team member" concept surfaced on the
-- Team page). Activity log captures who-did-what-when on every mutation
-- so the boss can audit staff work without polling anyone.
--
-- Safe to re-run — every statement is `IF NOT EXISTS` guarded. The
-- server boot path reads this file via ensureSchema() so a fresh
-- environment comes up self-provisioned.

CREATE SCHEMA IF NOT EXISTS ops;
-- gen_random_uuid() lives in pgcrypto. Supabase ships with it enabled,
-- but a fresh plain-Postgres target would 500 without this.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Columns ------------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS ops.kanban_columns (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text         NOT NULL,
    position      int          NOT NULL,
    is_done       boolean      NOT NULL DEFAULT false,
    wip_limit     int,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_kanban_columns_position
    ON ops.kanban_columns (position)
    WHERE deleted_at IS NULL;

-- Cards --------------------------------------------------------------- --
CREATE TABLE IF NOT EXISTS ops.kanban_cards (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    column_id     uuid         NOT NULL REFERENCES ops.kanban_columns(id),
    title         text         NOT NULL,
    description   text,
    priority      text         NOT NULL DEFAULT 'medium'
                               CHECK (priority IN ('low','medium','high','urgent')),
    position      int          NOT NULL,
    due_date      date,
    created_by    text         NOT NULL,          -- email of the web user
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    done_at       timestamptz,
    deleted_at    timestamptz,
    -- Provenance: where did this card come from? Lets us audit the
    -- auto-creation pipelines without a separate table.
    source_kind   text         NOT NULL DEFAULT 'manual'
                               CHECK (source_kind IN ('manual','telegram','report_goal','agent','api')),
    source_ref    text
);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_column_pos
    ON ops.kanban_cards (column_id, position)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kanban_cards_created_by
    ON ops.kanban_cards (created_by, created_at DESC);

-- Assignees ----------------------------------------------------------- --
-- Many-to-many card ↔ subscriber; composite PK makes re-assigns
-- idempotent (INSERT ... ON CONFLICT DO NOTHING on the route side).
CREATE TABLE IF NOT EXISTS ops.kanban_assignees (
    card_id         uuid         NOT NULL REFERENCES ops.kanban_cards(id) ON DELETE CASCADE,
    subscriber_id   uuid         NOT NULL REFERENCES ops.report_subscribers(id) ON DELETE CASCADE,
    assigned_at     timestamptz  NOT NULL DEFAULT now(),
    assigned_by     text,
    PRIMARY KEY (card_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_kanban_assignees_subscriber
    ON ops.kanban_assignees (subscriber_id);

-- Activity log -------------------------------------------------------- --
-- One row per mutation so the staff-activity view is a simple SELECT.
-- `payload` carries before/after deltas; the shape is action-specific.
CREATE TABLE IF NOT EXISTS ops.kanban_activity (
    id            bigserial    PRIMARY KEY,
    card_id       uuid         REFERENCES ops.kanban_cards(id) ON DELETE SET NULL,
    actor_email   text         NOT NULL,
    action        text         NOT NULL
                               CHECK (action IN (
                                 'card.created','card.updated','card.moved',
                                 'card.assigned','card.unassigned',
                                 'card.done','card.reopened','card.deleted',
                                 'column.created','column.renamed','column.reordered','column.deleted'
                               )),
    payload       jsonb        NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kanban_activity_card
    ON ops.kanban_activity (card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_activity_actor
    ON ops.kanban_activity (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_activity_created
    ON ops.kanban_activity (created_at DESC);

-- Seed default columns (only if the board is empty) ------------------- --
INSERT INTO ops.kanban_columns (name, position, is_done)
SELECT * FROM (VALUES
    ('Backlog',     0, false),
    ('Today',       1, false),
    ('In Progress', 2, false),
    ('Blocked',     3, false),
    ('Done',        4, true )
) AS v(name, position, is_done)
WHERE NOT EXISTS (
    SELECT 1 FROM ops.kanban_columns WHERE deleted_at IS NULL
);
