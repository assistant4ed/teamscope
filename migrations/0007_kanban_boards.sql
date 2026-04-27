-- Multiple Kanban "folders". Each board owns its own columns + cards.
-- A single board is flagged `is_default = true` so the agent / Telegram
-- pipelines that auto-create cards always have an unambiguous target.
--
-- Each board can be shared via a public link. `share_token` is a 32-char
-- URL-safe random string; `share_mode` = 'view' (read-only) or 'edit'
-- (anyone with the link can also create / move / edit / delete cards).
-- Toggling sharing off sets share_token = NULL so any leaked URL dies.
--
-- Idempotent: safe to re-run on every boot.

-- 1. Boards table -----------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.kanban_boards (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text         NOT NULL,
    is_default   boolean      NOT NULL DEFAULT false,
    share_token  text         UNIQUE,
    share_mode   text         NOT NULL DEFAULT 'view'
                              CHECK (share_mode IN ('view', 'edit')),
    created_by   text         NOT NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_boards_one_default
    ON ops.kanban_boards (is_default) WHERE is_default = true AND deleted_at IS NULL;

-- 2. Add board_id to columns -----------------------------------------
ALTER TABLE ops.kanban_columns
  ADD COLUMN IF NOT EXISTS board_id uuid REFERENCES ops.kanban_boards(id);

-- 3. Backfill: create a "Main" board if none exists, then attach all
--    existing columns to it. Idempotent — only runs when there are
--    columns missing a board_id.
DO $$
DECLARE
  v_board_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM ops.kanban_columns WHERE board_id IS NULL) THEN
    -- Reuse an existing Main if someone re-ran this and the upstream
    -- column reset; otherwise create a fresh one.
    SELECT id INTO v_board_id FROM ops.kanban_boards
      WHERE name = 'Main' AND deleted_at IS NULL LIMIT 1;
    IF v_board_id IS NULL THEN
      INSERT INTO ops.kanban_boards (name, is_default, created_by)
      VALUES ('Main', true, 'system')
      RETURNING id INTO v_board_id;
    ELSE
      UPDATE ops.kanban_boards SET is_default = true WHERE id = v_board_id;
    END IF;
    UPDATE ops.kanban_columns
       SET board_id = v_board_id
     WHERE board_id IS NULL;
  END IF;
END $$;

-- 4. Now lock board_id NOT NULL ----------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ops' AND table_name = 'kanban_columns'
       AND column_name = 'board_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE ops.kanban_columns
      ALTER COLUMN board_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kanban_columns_board
    ON ops.kanban_columns (board_id, position) WHERE deleted_at IS NULL;
