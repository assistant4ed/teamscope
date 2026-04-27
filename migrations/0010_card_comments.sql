-- Per-card comments. Author = whitelisted email; share-edit visitors
-- post as 'share-link'. Soft-delete keeps the timeline coherent so a
-- removed comment still leaves a stub event.
--
-- Idempotent: safe to re-run on every boot.

CREATE TABLE IF NOT EXISTS ops.kanban_card_comments (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id      uuid         NOT NULL REFERENCES ops.kanban_cards(id) ON DELETE CASCADE,
    author_email text         NOT NULL,
    body         text         NOT NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    edited_at    timestamptz,
    deleted_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_card_comments_card
    ON ops.kanban_card_comments (card_id, created_at)
    WHERE deleted_at IS NULL;
