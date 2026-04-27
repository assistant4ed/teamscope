-- Add 'card.commented' to the kanban_activity allowed actions so we can
-- log per-comment events for the right-rail timeline.
--
-- Idempotent: drop-and-recreate the CHECK constraint each boot.

DO $$
BEGIN
  ALTER TABLE ops.kanban_activity
    DROP CONSTRAINT IF EXISTS kanban_activity_action_check;
  ALTER TABLE ops.kanban_activity
    ADD CONSTRAINT kanban_activity_action_check
    CHECK (action IN (
      'card.created','card.updated','card.moved',
      'card.assigned','card.unassigned',
      'card.done','card.reopened','card.deleted',
      'card.commented',
      'column.created','column.renamed','column.reordered','column.deleted'
    ));
END $$;
