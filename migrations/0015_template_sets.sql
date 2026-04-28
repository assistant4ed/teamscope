-- Per-role question sets for daily reports.
--
-- One row per set in ops.report_template_sets ('default', 'operations',
-- 'customer_service', 'developer'). Each set has its own morning /
-- midday / eod prompt in both zh and en, stored in the new
-- ops.report_prompt_templates_v2 table keyed by (set_id, slot, language).
--
-- Each subscriber is assigned a set via a new template_set_id column.
-- n8n's Report Prompter joins to fetch the right text per subscriber.
--
-- The legacy ops.report_prompt_templates (slot-only) is left in place
-- — the classify-report endpoint still reads it for context. We can
-- migrate that later; for now, both coexist.
--
-- Idempotent: safe to re-run.

-- 1. Sets ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.report_template_sets (
    id          text         PRIMARY KEY
                              CHECK (id ~ '^[a-z][a-z0-9_]*$'),
    name        text         NOT NULL,
    description text,
    created_at  timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO ops.report_template_sets (id, name, description) VALUES
  ('default',          'Default',          'Generic morning / midday / EOD questions.'),
  ('operations',       'Operations',       'For ops / coordination roles — emphasis on blockers, dependencies, deliveries.'),
  ('customer_service', 'Customer Service', 'For CX roles — emphasis on tickets, escalations, customer sentiment.'),
  ('developer',        'WordPress / Developer', 'For technical roles — emphasis on shipping, deploys, code review.')
ON CONFLICT (id) DO NOTHING;

-- 2. Templates -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.report_prompt_templates_v2 (
    template_set_id text         NOT NULL REFERENCES ops.report_template_sets(id) ON DELETE CASCADE,
    slot            text         NOT NULL CHECK (slot IN ('morning', 'midday', 'eod')),
    language        text         NOT NULL CHECK (language IN ('zh', 'en')),
    template_text   text         NOT NULL,
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    updated_by      text,
    PRIMARY KEY (template_set_id, slot, language)
);

-- Seed text. {name} will be substituted at send time.
INSERT INTO ops.report_prompt_templates_v2 (template_set_id, slot, language, template_text) VALUES

  -- ============== default ==============
  ('default', 'morning', 'en',
$$☀️ Good morning {name}! What are your top 3 goals for today?

(Use Telegram's Reply to answer this message)$$),
  ('default', 'morning', 'zh',
$$☀️ 早安 {name}!今日三大目標是什麼?

(用 Telegram 的 Reply 功能回覆此訊息)$$),
  ('default', 'midday', 'en',
$$⏱️ {name}, midday check-in:
• What's done?
• Any blockers?
• Anything new on the plan?

(Use Telegram's Reply to answer this message)$$),
  ('default', 'midday', 'zh',
$$⏱️ {name},半日 check-in:
• 完成了什麼?
• 有沒有問題/阻塞?
• 今日有新安排?

(用 Telegram 的 Reply 功能回覆此訊息)$$),
  ('default', 'eod', 'en',
$$🌙 EOD {name}:
• What did you complete today?
• Anything unfinished?
• Hours worked?

(Use Telegram's Reply to answer this message)$$),
  ('default', 'eod', 'zh',
$$🌙 日結 {name}:
• 今日完成了什麼?
• 有未完成的?
• 實際工時幾小時?

(用 Telegram 的 Reply 功能回覆此訊息)$$),

  -- ============== operations ==============
  ('operations', 'morning', 'en',
$$☀️ Morning {name} — ops focus for today:
• Top 3 things to coordinate or deliver
• Anything blocked from yesterday that needs unblocking
• Dependencies you're waiting on (and from whom)

(Reply to this message)$$),
  ('operations', 'morning', 'zh',
$$☀️ 早安 {name} — 今日營運重點:
• 今日要協調或交付的三件事
• 昨日有什麼仍卡住需要解決
• 在等誰、等什麼

(用 Telegram 的 Reply 功能回覆)$$),
  ('operations', 'midday', 'en',
$$⏱️ {name}, ops half-day:
• What got resolved or delivered?
• What's still stuck and on whom?
• Any urgent escalation the boss should know about?

(Reply to this message)$$),
  ('operations', 'midday', 'zh',
$$⏱️ {name},營運半日 check-in:
• 已完成或已交付什麼?
• 還在卡住的、卡在誰身上?
• 有需要老闆關注的緊急事項嗎?

(用 Telegram 的 Reply 功能回覆)$$),
  ('operations', 'eod', 'en',
$$🌙 EOD {name}:
• What was delivered or closed today?
• What's rolling over to tomorrow and why?
• Hours worked?

(Reply to this message)$$),
  ('operations', 'eod', 'zh',
$$🌙 日結 {name}:
• 今日交付或結案了什麼?
• 什麼要延到明天、原因是什麼?
• 實際工時幾小時?

(用 Telegram 的 Reply 功能回覆)$$),

  -- ============== customer_service ==============
  ('customer_service', 'morning', 'en',
$$☀️ Good morning {name}! CX focus for today:
• Any escalated tickets or unhappy customers to handle?
• Top 3 customers / issues you'll prioritise
• Anything you need from another team to resolve a ticket?

(Reply to this message)$$),
  ('customer_service', 'morning', 'zh',
$$☀️ 早安 {name}! 今日客戶服務重點:
• 有需要處理的升級工單或不滿意客戶嗎?
• 今日重點客戶或問題的前三項
• 需要其他團隊協助解決哪些工單?

(用 Telegram 的 Reply 功能回覆)$$),
  ('customer_service', 'midday', 'en',
$$⏱️ {name}, CX midday:
• How many tickets resolved so far?
• Any patterns / recurring complaints worth flagging?
• Customers waiting on you that need an update?

(Reply to this message)$$),
  ('customer_service', 'midday', 'zh',
$$⏱️ {name},客服半日 check-in:
• 至今處理了幾張工單?
• 有重複出現的投訴或值得反映的趨勢嗎?
• 有哪些客戶在等你回覆?

(用 Telegram 的 Reply 功能回覆)$$),
  ('customer_service', 'eod', 'en',
$$🌙 EOD {name}:
• Tickets handled today (rough count)
• Any unresolved tickets carried over and why
• Customer wins or losses worth sharing?
• Hours worked?

(Reply to this message)$$),
  ('customer_service', 'eod', 'zh',
$$🌙 日結 {name}:
• 今日處理的工單數量
• 還沒解決、要延續的工單與原因
• 有值得分享的客戶喜訊或失誤嗎?
• 實際工時幾小時?

(用 Telegram 的 Reply 功能回覆)$$),

  -- ============== developer ==============
  ('developer', 'morning', 'en',
$$☀️ Morning {name}! Dev plan for today:
• What are you building or fixing?
• Any PRs waiting on your review or others'?
• Deployment risk to flag?

(Reply to this message)$$),
  ('developer', 'morning', 'zh',
$$☀️ 早安 {name}! 今日開發計畫:
• 在做什麼、修什麼?
• 有等你 review 或等別人 review 的 PR 嗎?
• 有部署風險要先講嗎?

(用 Telegram 的 Reply 功能回覆)$$),
  ('developer', 'midday', 'en',
$$⏱️ {name}, dev midday:
• What got merged / deployed?
• Any production issues or regressions noticed?
• Blocked on review or environment?

(Reply to this message)$$),
  ('developer', 'midday', 'zh',
$$⏱️ {name},開發半日 check-in:
• 有什麼合併了/部署了?
• 有發現生產問題或 regression 嗎?
• 卡在 review 或環境上嗎?

(用 Telegram 的 Reply 功能回覆)$$),
  ('developer', 'eod', 'en',
$$🌙 EOD {name}:
• What shipped today (with PR / deploy link if you have one)?
• Any tech debt or follow-up to flag for tomorrow?
• Hours worked?

(Reply to this message)$$),
  ('developer', 'eod', 'zh',
$$🌙 日結 {name}:
• 今日 ship 了什麼(有 PR 或部署連結最好)?
• 有需要明天跟進的技術債或後續嗎?
• 實際工時幾小時?

(用 Telegram 的 Reply 功能回覆)$$)

ON CONFLICT (template_set_id, slot, language) DO NOTHING;

-- 3. Per-subscriber assignment ---------------------------------------
ALTER TABLE ops.report_subscribers
  ADD COLUMN IF NOT EXISTS template_set_id text
    REFERENCES ops.report_template_sets(id)
    DEFAULT 'default';

UPDATE ops.report_subscribers
   SET template_set_id = 'default'
 WHERE template_set_id IS NULL;
