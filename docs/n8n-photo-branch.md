# n8n: photo branch for the Master Router

Drop this into `01 · Master Router` so Telegram photo messages are
routed to TeamScope's image analyzer instead of being dropped as
"Empty message came through".

## Where it goes

After `Auth Gate` and before the existing text-routing branch, add an
IF node that splits on whether the incoming Telegram message has a
`photo` array. The `false` branch keeps the existing text flow; the
`true` branch goes through the three new nodes below.

## Nodes to add

```
[ IF: has photo? ] ──true──▶ [ HTTP: getFile ] ──▶ [ HTTP: analyze-image ] ──▶ [ Telegram: reply ]
                  └─false──▶ (existing text branch)
```

### 1. IF — has photo?

- Condition (boolean):
  `{{ $json.message?.photo && $json.message.photo.length > 0 }}`

### 2. HTTP — getFile

Resolves the largest photo's `file_id` to a downloadable path.

- Method: `POST`
- URL: `=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/getFile`
- Body (JSON):
  ```json
  {
    "file_id": "{{ $json.message.photo[$json.message.photo.length - 1].file_id }}"
  }
  ```
- The photo array is sorted smallest → largest; the last entry is the highest-resolution version.

### 3. HTTP — POST /api/agent/analyze-image

- Method: `POST`
- URL: `https://teamscope.stratexai.io/api/agent/analyze-image`
- Headers:
  ```
  X-User-Email: n8n@internal
  content-type: application/json
  ```
- Body (JSON):
  ```json
  {
    "telegram_file_id": "{{ $('IF: has photo?').item.json.message.photo[$('IF: has photo?').item.json.message.photo.length - 1].file_id }}",
    "caption": "{{ $('IF: has photo?').item.json.message.caption || '' }}",
    "sender_name": "{{ $('IF: has photo?').item.json.message.from.first_name }}"
  }
  ```

  TeamScope handles the actual download internally using the same
  `TELEGRAM_BOT_TOKEN`, so you can pass either `telegram_file_id`
  (cleanest), or pre-download in n8n and pass `base64`.

### 4. Telegram — reply with the bot's response

- chatId: `{{ $('IF: has photo?').item.json.message.chat.id }}`
- text: `{{ $json.reply }}`
  (the `reply` field from `analyze-image` is always under 240 chars
  and ready to send.)

## Optional: branch on intent

If you want the bot to actually create the proposed card, follow the
Telegram reply with a Switch node on `{{ $('HTTP analyze-image').item.json.intent }}`:

- `delegate` / `plan_self` → POST to TeamScope
  `/api/agent/create-card` with the `action.title` (TeamScope re-extracts
  assignee from the title, same as the text path).
- `research` → POST `/api/agent/create-card` with title prefixed `RESEARCH: `.
- `report_self` → call `04 · Report Collector` sub-flow with the
  log_report shape.
- `chatter` / `context_attach` / `ambiguous` → reply only.

## Test before wiring

Send the bot a photo with caption "where should this go?" — TeamScope's
endpoint returns a `description`, `intent`, and `action`. Use that JSON
to decide what each downstream branch should do.
