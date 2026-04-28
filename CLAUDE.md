# TeamScope — repo & ops cheat sheet for future sessions

A small ops + Kanban app for a 4-person design studio. Telegram-first
(`@edpapabot`) with a web UI. This file is the single document you
should read before changing anything.

## What lives where

| Concern | Path / system | Notes |
|---|---|---|
| Web app (frontend) | `App.tsx`, `src/Shell.tsx`, `src/pages/*.tsx`, `src/*.tsx` | React 19 + Vite + Tailwind. Single SPA. |
| Web app (backend) | `server/index.ts` | One file Express + `pg`. ~3.5k lines. Boots, auto-runs every `migrations/*.sql` (idempotent), serves the SPA, exposes `/api/*`. |
| DB schema | `migrations/*.sql` | Numbered, additive, idempotent. **Never edit a deployed migration** — add a new one. |
| Production DB | Supabase (`SUPABASE_DB_URL`) | All app data lives in the `ops` schema. |
| Auth | `ALLOWED_USERS` env (`email:role,…`), validated against `X-User-Email` header | No password. Magic-link upgrade is on the someday list. |
| Bot scheduler | n8n on `ops-n8n` Docker → SQL on Supabase → Telegram Bot API | The bot is a separate system. See "Bot pipeline" below. |
| Image uploads | Cloudflare Images via `RESEND_API_KEY` (no — `CF_IMAGES_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` + `CF_IMAGES_ACCOUNT_HASH`) | Card cover + description + comments all share `uploadImageFile()`. |
| Outbound email | Resend (`RESEND_API_KEY`, `EMAIL_FROM=noreply@clipyai.app`) | Event-driven via `EMAIL_EVENT_CATALOG` in `server/index.ts`. |
| Support inbox + AI replies | `/api/support/*` + `ops.support_*` tables + Claude (`ANTHROPIC_API_KEY`) | KB facts pinned to system prompt. |

## Bot pipeline (the thing that breaks)

```
n8n cron (in Asia/Singapore) ──fires──┐
                                       ▼
                       PG · Find Subs for Slot          (queries Supabase ops schema,
                       (joins template_set_id +          fetches per-member template
                        language to render text)         text in zh or en)
                                       │
                                       ▼
                          Build Prompt Text              (substitutes {name})
                                       │
                                       ▼
                       Telegram sendMessage              (uses Telegram Bot creds)
                                       │
                                       ▼
                         Upsert report_sessions          (so the watchdog +
                                                          collector know it fired)
```

A separate `00 · Bot Watchdog` n8n workflow runs every 30 min and DMs
the boss when any active member's most recent expected slot today is
>30 min overdue with no `report_sessions` row.

## Three traps I've fallen into — read before touching the bot

1. **Workflow-timezone trap.** Setting `TZ=Asia/Singapore` on the n8n
   container does NOT make cron expressions interpret in SGT. The
   workflow row needs `settings.timezone = 'Asia/Singapore'` in
   `workflow_entity`. Without it cron is in UTC.
   *Symptom: EOD fires at 02:47 AM HKT.*

2. **SQL-JOIN trap.** Mixing comma-style FROM with explicit `LEFT JOIN`
   breaks scoping in Postgres. `FROM s, ctx LEFT JOIN t ON t.x = s.x`
   fails: the `LEFT JOIN` binds to `ctx`, so `s` is out of scope in the
   ON clause. Always use explicit `CROSS JOIN` instead of comma.
   *Symptom: every slot fire silently fails after a SQL change.*

3. **Scheduler re-arm trap.** After restarting n8n, occasionally one of
   the cron triggers doesn't re-arm. Toggle the workflow `active = false`
   then `true` (and restart n8n) to force re-registration.
   *Symptom: e.g. morning slot stops firing while midday and EOD work.*

## Before you change SQL in the n8n workflow

Always run it against the live Supabase first:

```bash
DB_URL=$(railway variables --service teamscope --kv | grep '^SUPABASE_DB_URL=' | cut -d= -f2-)
psql "$DB_URL" -c "<your SQL with $1 replaced by 'morning' / 'midday' / 'eod'>"
```

If it errors, fix it before pushing. Saves you a 12-hour silent failure.

## Key data model conventions

| Table | Notes |
|---|---|
| `ops.report_subscribers` | One row per team member. `language` (en/zh), `template_set_id` (default/operations/customer_service/developer/…), per-slot times, working_days, telegram_chat_id, email. |
| `ops.daily_reports` | Boss-editable; goals / mid_progress / mid_issues / mid_changes / eod_completed / eod_unfinished / eod_hours. PATCH triggers `syncGoalItems`. |
| `ops.report_goal_items` | Synced from `daily_reports.goals`. Each line becomes an item; carded items link to `kanban_cards.id`. Drives the "promise tracker." |
| `ops.kanban_boards` | Folders. Single `is_default = true` row at any time. Soft-delete via `deleted_at`. |
| `ops.kanban_columns` | FK to board. Same `deleted_at` soft-delete. |
| `ops.kanban_cards` | Has `image_urls text[]` (CF Images URLs only, sanitized server-side), `source_kind` whitelist (`manual / telegram / report_goal / agent / api / share-link`). Comments live in `ops.kanban_card_comments`; checklist in `ops.kanban_card_checklist_items`; many-to-many labels in `ops.kanban_card_labels`. |
| `ops.report_template_sets` + `ops.report_prompt_templates_v2` | Per-role question sets. Templates use `{name}` substitution. |
| `ops.email_templates` (overrides) | Optional per-(event, lang) override of the in-code defaults from `EMAIL_EVENT_CATALOG`. |
| `ops.notifications` | In-app bell items, recipient = lowercase email. |
| `ops.support_tickets / messages / kb` | Tickets, threaded replies, KB facts pinned to AI draft system prompt. |

## Adding a new email event

Pure four-step recipe (mirrors Clipy AI's pattern):

1. Append an entry to `EMAIL_EVENT_CATALOG` in `server/index.ts` —
   declare `id`, `audience`, `when_fired`, `required_context`,
   `templates.en` + `templates.zh`.
2. From the trigger site, call:
   ```ts
   sendEmail({
     eventId: 'your.event.id',
     recipientEmail: sub.email,
     language: sub.language,
     context: { recipient_name, ... },
     actorEmail: req.user!.email,
     alsoNotify: { kind, title, body, linkUrl },  // optional in-app bell
   }).catch(e => console.error(...));
   ```
3. The `EmailAdminSection` on the Team page auto-discovers the new event
   — no UI work needed.
4. (If user-facing) wire a route or activity-log entry that links them
   from the in-app notification.

## Operating notes

- **Deploy:** `railway up --service teamscope --ci` from the repo root.
  No GitHub auto-deploy on this service.
- **Migrations:** auto-run on boot via `ensureSchema()`; the Dockerfile
  copies `migrations/` into the runtime image. If you add new SQL
  features that need a new migration to land before the server boots
  with the new query, prefer applying the migration directly to
  Supabase first via `psql`, then deploying — this avoids a brief
  "column does not exist" window during Railway redeploys.
- **n8n changes:** workflow JSONs in `~/.../ops-assistant/n8n/workflows/`
  are a SOURCE-OF-TRUTH BACKUP, not the live state. Live state is in
  ops-postgres `workflow_entity.nodes`. Update both.
- **Custom domain:** `teamscope.stratexai.io` CNAMEs to `h72b0do9.up.railway.app`
  with `_railway-verify.teamscope` TXT for cert. Cloudflare proxy is OFF
  for this record (Railway terminates TLS). Don't enable proxy without
  switching SSL mode to Full Strict first.
- **Image hash gotcha:** `CF_IMAGES_ACCOUNT_HASH` is the value that
  appears in `imagedelivery.net/<hash>/<image-id>/public`. Verify by
  fetching `https://api.cloudflare.com/client/v4/accounts/<account-id>/images/v1/<image-id>`
  and reading `result.variants[0]`. The hash inherited from contentforge
  was stale and silently 404'd every uploaded image.

## Visibility surfaces (use these before debugging)

- **Dashboard → Bot pulse — today** — per-member, per-slot status. Misses
  show as red dots immediately.
- **Dashboard → Today's promises** — kept-vs-set rate per member.
- **Sidebar bell** — in-app notifications (mentions, comments, support tickets).
- **Team page → Email & notifications** — recent email log with status.
- **Team page → Question sets** — boss edits per-role prompts inline.
- **Team page → Support knowledge base** — KB facts the AI draft replies ground on.
- **Team page → Public holidays** — non-working days for salary calc.
- **Cmd+K** — global search across cards, reports, members.
- **`?`** — keyboard shortcut cheatsheet.

## Things deliberately NOT done

- No SSO / passwords / 2FA — single-tenant whitelist by design.
- No real-time WebSocket updates — refresh-driven, polled (60s for the
  bell). Adequate for a 4-person team.
- No external-app onboarding (`/admin/external-apps` from Clipy) —
  not needed yet; revisit if you ever expose support tickets to outside
  customers.
- No comments on share-edit public links — the auth boundary is too
  fuzzy. Drafted but unshipped.
- The `ops.report_prompt_templates` (slot-only) legacy table is still
  read by the classify-report endpoint as context. The active bot
  uses the v2 table. Don't delete the legacy one without updating
  the classifier first.

---

*Updated: 2026-04-28. If something here is wrong, fix it in the same PR.*
