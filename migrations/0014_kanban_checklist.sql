-- Card checklists / subtasks. Each item is a small text + done flag;
-- multiple items per card, ordered by position. Surfaced as a progress
-- bar on the card preview and a checkbox list in the edit modal.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ops.kanban_card_checklist_items (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id     uuid         NOT NULL REFERENCES ops.kanban_cards(id) ON DELETE CASCADE,
    text        text         NOT NULL,
    done        boolean      NOT NULL DEFAULT false,
    position    int          NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kanban_checklist_card
    ON ops.kanban_card_checklist_items (card_id, position);
