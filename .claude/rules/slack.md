---
paths:
  - "lib/slack/**"
  - "app/api/slack/**"
---

# Slack Integration

- `SLACK_BOT_TOKEN` (xoxb-...) — Slack Web API bot token for budget negotiation threaded replies. Optional; falls back to incoming webhook if absent.
- `SLACK_CHANNEL_ID` — Channel ID for budget negotiation messages. Required alongside `SLACK_BOT_TOKEN`.
- Existing webhook URL (via `slackConfigs` table) is used for all non-budget actions and as fallback.
