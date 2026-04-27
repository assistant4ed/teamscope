-- Image attachments on Kanban cards. Stored as a Postgres text[] of
-- Cloudflare Images public URLs (https://imagedelivery.net/...). Order
-- matters — the first image is the card's hero thumbnail.
--
-- Idempotent: safe to re-run.

ALTER TABLE ops.kanban_cards
  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';
