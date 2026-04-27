-- Goal items: one row per parsed line in a morning report's `goals`
-- field. Created and kept in sync by the server whenever the goals
-- text changes. Once the boss imports goals to the Board, each item's
-- card_id is set; promise-completion is then derived from that card's
-- done_at timestamp. `manually_done` covers items that were verbally
-- completed without ever becoming a card.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ops.report_goal_items (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id     uuid         NOT NULL REFERENCES ops.daily_reports(id) ON DELETE CASCADE,
    position      int          NOT NULL,
    text          text         NOT NULL,
    card_id       uuid         REFERENCES ops.kanban_cards(id) ON DELETE SET NULL,
    manually_done boolean      NOT NULL DEFAULT false,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (report_id, position)
);
CREATE INDEX IF NOT EXISTS idx_report_goal_items_card
    ON ops.report_goal_items (card_id) WHERE card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_report_goal_items_report
    ON ops.report_goal_items (report_id);
