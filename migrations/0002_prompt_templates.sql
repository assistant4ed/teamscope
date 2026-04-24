-- Report-prompt templates: the text @edpapabot DMs at each slot.
--
-- Kept as three rows (one per slot) keyed by the slot name so the API
-- surface is just GET / PATCH — no row creates/deletes needed. n8n's
-- 03 · Report Prompter flow should GET /api/config/prompt-templates
-- and use the returned text instead of hardcoding its own prompts.
--
-- Safe to re-run: seeds only when rows are missing.

CREATE TABLE IF NOT EXISTS ops.report_prompt_templates (
    slot           text         PRIMARY KEY
                                CHECK (slot IN ('morning', 'midday', 'eod')),
    template_text  text         NOT NULL,
    updated_at     timestamptz  NOT NULL DEFAULT now(),
    updated_by     text
);

INSERT INTO ops.report_prompt_templates (slot, template_text) VALUES
  ('morning',
$$🌅 Good morning! Quick plan for the day:

• Planned work hours:
• Top 3 goals for today:

Reply in a few lines — no formatting needed.$$),
  ('midday',
$$☀️ Midday check-in:

• What you've completed since morning:
• Blockers or changes to the plan:

Keep it brief.$$),
  ('eod',
$$🌙 End of day:

• Hours worked today:
• Completed:
• Unfinished / rolling to tomorrow:

Just a few lines.$$)
ON CONFLICT (slot) DO NOTHING;
