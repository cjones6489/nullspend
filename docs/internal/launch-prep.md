# NullSpend Launch Prep

**Created:** 2026-03-21
**Status:** Active — this is the priority document until first 50 signups
**Goal:** Get NullSpend in front of real developers and acquire the first 50 users within 2 weeks of launch.

---

## The Core Problem

NullSpend is technically complete. 2,900+ tests, 2 providers, budget enforcement, webhooks, velocity limits, session limits, dashboard, SDK adapter — all shipped and working.

**What's missing: users.** Zero external developers have ever used this product. Every feature was built from architecture reviews and competitive analysis, not customer conversations. The Helicone acquisition (March 3, 2026) created a time-sensitive window with 16,000 orphaned organizations that is closing every day we don't ship.

**The next 2 weeks are about distribution, not features.**

---

## Strategic Context

### Competitive window

- **Helicone** acquired by Mintlify (March 3). 16,000 orgs need an alternative NOW. Window is closing.
- **Portkey** ($18M Series A) is actively marketing to Helicone refugees. Budget enforcement gated behind enterprise.
- **LiteLLM** ($7M ARR) requires Docker + Postgres + Redis + YAML. Good product, terrible DX.
- **No one else** offers budget enforcement at startup pricing with zero infrastructure.

### Our wedge

1. **One env var setup** — change base URL, everything works
2. **Budget enforcement on the free tier** — Portkey gates this behind enterprise pricing
3. **Zero infrastructure** — no Docker, no Redis, no config files
4. **The proxy is transparent** — never modifies requests or responses

### What we lead with

**Visibility first, enforcement second.** Most developers don't know they have a spending problem. Lead with "see what your agents cost" and follow with "set a hard cap so it never happens again."

---

## Launch Checklist

### Day 1-2: Go-Live Prerequisites

These items block launch. Nothing else gets built until these are done.

#### 1. Verify signup → first cost event flow (2-3 hours)

Walk through the entire flow as a new user:
- [ ] Sign up at `/signup` works (Supabase auth)
- [ ] Email confirmation works (or disable email confirmation for launch)
- [ ] Dashboard loads after login
- [ ] "Create API Key" in Settings works, shows key once
- [ ] Point a real OpenAI SDK client at the proxy with the new key
- [ ] Make a real API call (streaming + non-streaming)
- [ ] Cost event appears in Activity page within 5 seconds
- [ ] Analytics page shows the cost
- [ ] Create a budget, hit it, verify 429 response

**If any step fails, fix it before doing anything else.**

#### 2. Domain and URLs (1 hour)

- [ ] Verify `proxy.nullspend.com` resolves to the Cloudflare Worker
- [ ] Verify `nullspend.com` resolves to the Vercel dashboard
- [ ] Verify `/signup`, `/login`, `/app/analytics`, `/app/activity` all load
- [ ] Verify HTTPS on all endpoints
- [ ] Verify CORS headers allow SDK calls from any origin

#### 3. README rewrite (2-3 hours)

The current README needs to be rewritten for external developers. Structure:

```
# NullSpend — Budget enforcement for AI agents

One line change. See every dollar your agents spend. Set hard limits so they can't overspend.

[screenshot of dashboard]

## Setup (2 minutes)

1. Sign up at nullspend.com
2. Create an API key
3. Change your base URL:

   ```bash
   OPENAI_BASE_URL=https://proxy.nullspend.com/v1
   ```

4. Add the auth header to your client
5. Run your agent — costs appear in real time

## What you get (free)

- Real-time cost tracking per request, model, and API key
- Hard budget enforcement — proxy blocks requests over your ceiling
- OpenAI + Anthropic support
- Dashboard with analytics and activity log
- Webhook notifications (14 event types)
- Velocity limits (runaway loop detection)
- Session-level spend caps

## Pricing

Free: $5K/mo proxied spend, 3 budgets, 3 team members, 30-day retention
Pro ($49/mo): $50K/mo, unlimited budgets/keys/members, 90-day retention
Enterprise: custom pricing, unlimited everything, SSO/SAML

## How it works

[architecture diagram — proxy sits between your agent and the LLM provider]

The proxy never modifies your requests or responses.
Your provider API keys stay with you (BYOK).
```

#### 4. Landing page copy (1-2 hours)

If `nullspend.com` has a landing page (vs redirecting straight to the app), it needs:
- [ ] One-sentence pitch: "Stop your AI agents from burning money"
- [ ] The $47K horror story hook (2 sentences)
- [ ] "One line change" setup demo (animated terminal or code block)
- [ ] Feature grid (visibility, enforcement, webhooks, velocity limits)
- [ ] Pricing table
- [ ] "Get started free" CTA → `/signup`
- [ ] "Migrating from Helicone?" link → migration guide

#### 5. Publish guides (30 min)

These docs already exist but need to be accessible from the dashboard or docs site:
- [ ] `docs/guides/quickstart.md` — review for accuracy, publish
- [ ] `docs/guides/migrating-from-helicone.md` — review, update the "Kill receipts (coming soon)" mention, publish
- [ ] `docs/guides/provider-setup-openai.md` — review, publish
- [ ] `docs/guides/provider-setup-anthropic.md` — review, publish
- [ ] `docs/guides/budget-configuration.md` — review, publish

**Decision needed:** Where do docs live? Options:
- Simple: `/docs` route in the Next.js app rendering MDX
- Minimal: GitHub repo wiki or README links
- Full: Mintlify/Nextra docs site (ironic given Helicone's acquirer)

Recommendation: Start with README links to raw markdown files. Add a proper docs site after launch if users ask for it.

#### 6. Update migration guide for current features (30 min)

The Helicone migration guide references "Kill receipts (coming soon)" and uses "platform key" language. Update:
- [ ] Remove "Kill receipts" mention (deprioritized)
- [ ] Replace "platform key" with "API key" (auth was unified)
- [ ] Update the feature mapping table — add tags, velocity limits, session limits, webhooks, W3C traceparent (all features Helicone didn't have)
- [ ] Update the custom properties FAQ to mention tags (`X-NullSpend-Tags` header)

---

### Day 3: Distribution Push

#### 7. Post on Hacker News (1 hour)

Draft exists at `docs/guides/show-hn-draft.md`. Updates needed:
- [ ] Review and tighten the copy
- [ ] Update feature list (add velocity limits, session limits, webhooks, tags, traceparent)
- [ ] Remove "platform key" references — it's just an API key now
- [ ] Add the competitive angle: "Helicone was acquired. Portkey gates enforcement behind enterprise. LiteLLM needs Docker."
- [ ] Prepare answers for likely HN questions:
  - "Why not just use OpenAI's usage API?" → No hard enforcement, no cross-provider view
  - "How does this compare to LiteLLM?" → Zero infrastructure vs Docker+PG+Redis+YAML
  - "What about latency?" → Sub-ms overhead, cost calculation is async
  - "Is this open source?" → Proxy is Apache 2.0, dashboard is hosted SaaS
  - "What happens if your proxy goes down?" → 502, never forwards unauthenticated requests

#### 8. Twitter/X thread (30 min)

- "We built @nullspend after watching an agent burn $47K in a weekend. Here's what we learned:"
- Thread: the problem → why existing solutions fail → one-line setup → screenshot → link
- Tag: @OpenAI, @AnthropicAI, relevant AI agent builders

#### 9. Reddit posts (30 min)

- r/ChatGPTPro — "I built a free tool to track and limit your OpenAI spending"
- r/ClaudeAI — "Free cost tracking for Claude API usage with hard budget limits"
- r/LocalLLaMA — "Open-source proxy for tracking LLM costs across providers"
- r/SideProject — "Show: NullSpend — FinOps for AI agents"

#### 10. Helicone-specific outreach (1 hour)

- [ ] Blog post: "Helicone is dead. Here's how to migrate in 5 minutes."
- [ ] Post in Helicone Discord (if they have one) or GitHub Discussions
- [ ] Search Twitter for "helicone alternative" and reply with migration guide link
- [ ] SEO: title tag, meta description, H1 optimized for "Helicone alternative"

---

### Day 4-14: User Conversations

#### 11. Talk to every developer who signs up

Goal: 10 real conversations in the first 2 weeks.

For each user:
- How did you find NullSpend?
- What's your current LLM spend? How many API calls/day?
- What tools do you use today for cost tracking?
- What's the most painful thing about managing LLM costs?
- What would make you pay for this?

**Where to find developers:**
- HN commenters on the Show HN post
- Twitter DMs to people who engage with the thread
- Discord communities: AI agents, Claude, cursor, windsurf
- GitHub: look at repos that import `openai` or `@anthropic-ai/sdk` and have budget/cost issues

#### 12. Claude Code / Cursor angle (high leverage)

These are where developers are spending real money right now. A targeted piece of content:

- "How to set a spending limit on Claude Code"
- "Track your Cursor API costs in real time"
- Show the NullSpend dashboard with real Claude/GPT-4 costs
- 2-minute setup walkthrough

This could be the highest-ROI content because it targets developers with immediate spending pain, not hypothetical future pain.

---

## What NOT To Build

These are explicitly deferred until after the first 50 signups:

| Feature | Why defer |
|---|---|
| Tag-based budgets | No user has asked for this. Multi-team problem, zero teams exist. |
| Unit economics metrics | Nobody is looking at the dashboard yet. |
| Cryptographic receipts | Solution looking for a problem. |
| API version-gating | Zero external consumers. Can change anything freely. |
| AI SDK middleware adapter | Wait for SDK v6 stability. |
| ClickHouse analytics | Postgres is fine at current scale (zero rows). |
| Team/org hierarchies | Enterprise feature. No enterprise customers. |
| Stripe billing integration | Stay free to maximize adoption. Wire Stripe when someone asks to pay. |

**The rule:** If a feature request didn't come from a real user conversation, it doesn't get built during launch prep.

---

## Success Metrics

| Metric | Target | Timeline |
|---|---|---|
| Signups | 50 | 2 weeks post-launch |
| Active users (routed real traffic) | 5 | 2 weeks post-launch |
| Cost events logged | 10,000 | 2 weeks post-launch |
| User conversations | 10 | 2 weeks post-launch |
| First paid conversion | 1 | 4 weeks post-launch |

## Kill Criteria

If after 4 weeks post-launch:
- < 10 signups → Positioning is wrong. Reframe or pivot.
- 50+ signups but < 2 active users → Onboarding is broken. Fix the first-5-minutes experience.
- Active users but zero paid intent → Free tier is too generous, or enforcement isn't the thing people value. Investigate.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Helicone window closes before we launch | High | High | Launch this week, not next week |
| Proxy goes down during HN traffic | Medium | High | Load test before posting. Verify Cloudflare auto-scaling. |
| Supabase auth issues at signup | Medium | Medium | Test the full flow 3x before posting |
| Nobody cares about budget enforcement | Medium | High | Lead with visibility ("see your costs"), not enforcement. Enforcement is the upgrade path. |
| LiteLLM or Portkey ship similar features during our launch | Low | Medium | Our DX advantage (one env var, zero infra) is hard to replicate quickly |

---

## Post-Launch Priorities (decide based on user feedback)

After the first 50 signups and 10 conversations, revisit the priority roadmap. Likely candidates:

1. **Whatever users ask for most** — this is the whole point
2. **Tag-based budgets** — IF users ask for per-project cost tracking
3. **Slack integration** — IF users want notifications without webhooks
4. **CSV export** — IF users need to import costs into their own systems
5. **More providers** — IF users ask for Google, Mistral, etc.

The priority roadmap (`docs/technical-outlines/priority-implementation-roadmap.md`) has detailed designs for tag-based budgets and other P2/P3 features. These are ready to build when user demand justifies them.
