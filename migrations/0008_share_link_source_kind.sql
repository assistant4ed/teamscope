-- Allow 'share-link' as a kanban_cards.source_kind so cards created
-- through a public share-edit link can be audited separately from
-- manual / agent / telegram inserts.
--
-- Idempotent: drop-and-recreate the CHECK constraint each boot.

DO $$
BEGIN
  ALTER TABLE ops.kanban_cards
    DROP CONSTRAINT IF EXISTS kanban_cards_source_kind_check;
  ALTER TABLE ops.kanban_cards
    ADD CONSTRAINT kanban_cards_source_kind_check
    CHECK (source_kind IN ('manual','telegram','report_goal','agent','api','share-link'));
END $$;
