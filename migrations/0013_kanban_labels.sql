-- Per-board labels (a.k.a. tags). Board-scoped so two folders can have
-- their own taxonomy without colliding. Cards get many labels via the
-- join table; deleting a label silently removes it from cards.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ops.kanban_labels (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id    uuid         NOT NULL REFERENCES ops.kanban_boards(id) ON DELETE CASCADE,
    name        text         NOT NULL,
    color       text         NOT NULL DEFAULT 'slate'
                              CHECK (color IN ('slate','red','amber','emerald','sky','indigo','fuchsia','rose')),
    position    int          NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kanban_labels_board
    ON ops.kanban_labels (board_id, position);

CREATE TABLE IF NOT EXISTS ops.kanban_card_labels (
    card_id   uuid NOT NULL REFERENCES ops.kanban_cards(id) ON DELETE CASCADE,
    label_id  uuid NOT NULL REFERENCES ops.kanban_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_kanban_card_labels_label
    ON ops.kanban_card_labels (label_id);
