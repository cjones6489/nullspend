# Competitive Features to Steal
## Concrete features worth adopting, sourced from competitor analysis

Last updated: 2026-04-01

Organized by priority tier, then by source. Each feature includes: what it is, where we saw it, technical spec, and effort estimate.

See also:
- [Technical Feature Roadmap](nullspend-technical-feature-roadmap.md) — where the top features get scheduled
- [Domination Playbook](nullspend-domination-playbook.md) — distribution and competitive warfare
- [Vision Document](nullspend-vision.md) — the $1B thesis

---

## Tier 1: High Impact, Low Effort (days each)

### 1.1 Dry Run / Pre-flight Mode
**Source:** Runcycles (`cycles_decide` operation)
**What:** `X-NullSpend-Dry-Run: true` header on proxy requests. Returns the same 200/429 response the real request would produce, including estimated cost, budget remaining, mandate evaluation — but without making the upstream call or charging budget.
**Why it matters:** Agents can plan before committing. "Will this call succeed? What will it cost?" without spending a cent. Nobody else in the proxy space does this.
**Technical spec:**
- New header: `X-NullSpend-Dry-Run: true`
- Proxy runs full auth → mandate → budget check pipeline
- Skips upstream call and cost event write
- Returns: `{ dry_run: true, would_allow: true, estimated_cost_usd: 0.03, budget_remaining_usd: 47.23, mandate_evaluation: "pass" }`
- On denial: same 429 body as real request, with `dry_run: true` flag
- SDK: `trackedFetch(url, { dryRun: true })` returns result without executing
- MCP: `nullspend_dry_run(model, estimated_tokens)` tool
**Effort:** 1-2 days (proxy pipeline already runs all checks — just skip the upstream call)

### 1.2 ALLOW_WITH_CAPS Graceful Degradation
**Source:** Runcycles (`ALLOW_WITH_CAPS` response)
**What:** Instead of binary 429 block when budget is tight, return constraints the agent should apply: cheaper model, lower max_tokens, no streaming. The agent adapts instead of failing.
**Why it matters:** Hard blocks kill agent workflows. Graceful degradation keeps agents running at reduced capability. Differentiator vs every competitor that does binary allow/deny.
**Technical spec:**
- When budget remaining < estimated cost but > cost of cheaper alternative:
  - Return `200` with `X-NullSpend-Constrained: true` header
  - Body includes: `{ constrained: true, original_model: "gpt-4o", enforced_model: "gpt-4o-mini", reason: "budget_low", budget_remaining_usd: 2.30 }`
  - Proxy rewrites the model in the upstream request automatically
- Requires: mandate must allow the fallback model, fallback model pricing must fit remaining budget
- Dashboard toggle per key/budget: "Enable graceful degradation" with fallback model selection
- SDK: `onConstrained` callback (like `onDenied` but for degraded responses)
- Webhook event: `request.constrained` with original and enforced model
**Effort:** 3-4 days (extends existing budget check logic + model rewrite in proxy)

### 1.3 Required Justification on Expensive Operations
**Source:** Locus (justification fields on payouts)
**What:** `X-NullSpend-Justification: "Summarizing quarterly report for CFO"` header stored with the cost event. Optional by default, mandatory above a configurable cost threshold per key.
**Why it matters:** Creates an audit trail of *why* money was spent, not just *that* it was spent. Enterprise compliance gold — EU AI Act Article 12 (record-keeping) loves this.
**Technical spec:**
- New header: `X-NullSpend-Justification` (max 500 chars, sanitized)
- New column: `cost_events.justification` (text, nullable)
- New key-level config: `require_justification_above_usd` (null = never required)
- If required and missing: 400 `{ error: { code: "justification_required", message: "Requests estimated above $X require a justification header" } }`
- Dashboard: justification shown in cost event detail view, searchable
- SDK: `trackedFetch(url, { justification: "..." })`
**Effort:** 1-2 days (new header + column + validation)

### 1.4 Budget Exhaustion Forecasting
**Source:** Cordum, general FinOps tools
**What:** "At current rate, `marketing-budget` runs out in 4.2 hours." Simple math on existing velocity data.
**Why it matters:** Proactive, not reactive. Teams can act before hitting walls instead of after.
**Technical spec:**
- New field on `/api/policy` response: `forecast_exhaustion_hours` per budget entity
- Calculation: `remaining_usd / current_velocity_usd_per_hour` (velocity data already exists from EWMA)
- Dashboard: "Exhaustion forecast" column on budgets page, color-coded (green >48h, yellow 12-48h, red <12h)
- Webhook event: `budget.forecast.critical` when forecast drops below configurable threshold (default 4 hours)
- Weekly digest inclusion: "3 budgets projected to exhaust within 7 days"
**Effort:** 1-2 days (math on existing velocity data + UI column + webhook event)

### 1.5 Session Cost Rollup Views
**Source:** Helicone (session-level cost aggregation)
**What:** Dashboard view showing total cost, request count, and duration per session. Answers "how much did this conversation cost?"
**Why it matters:** NullSpend already has sessions and session limits. But sessions are only an enforcement mechanism — they should also be an analytics dimension.
**Technical spec:**
- New dashboard page or tab: "Sessions" with table: session_id, total_cost, request_count, duration, key, tags, status (active/completed/limit_hit)
- Query: `GROUP BY session_id` on cost_events with SUM(cost), COUNT(*), MAX-MIN(created_at)
- Click-through to session detail: timeline of all requests with costs
- Filter by key, tag, date range
- Already have: `sessions` materialized table, session_id on cost events
**Effort:** 2-3 days (dashboard page + query + drill-down)

### 1.6 Key-Value Tag Properties
**Source:** Helicone (`Helicone-Property-[Name]` headers)
**What:** Upgrade `X-NullSpend-Tags` from flat strings to `key=value` pairs. Dashboard filtering and aggregation by any key.
**Why it matters:** "Show me cost by `environment`" or "cost by `feature`" or "cost by `customer_tier`" without pre-defining dimensions. Much more flexible analytics.
**Technical spec:**
- Tags already support `key=value` format in parsing
- Extend dashboard analytics to GROUP BY tag key, then by tag value
- New analytics dimension selector: choose any tag key as a pivot
- API: `GET /api/cost-events/summary?group_by=tag:environment`
- Backward compatible — tags without `=` treated as `tag=true`
**Effort:** 2-3 days (analytics query changes + dashboard dimension picker)

---

## Tier 2: High Impact, Medium Effort (1-2 weeks each)

### 2.1 Fleet-Level Priority Throttling
**Source:** Cordum (three-layer cost governance with graceful degradation)
**What:** Org-wide "fleet budget" where at configurable thresholds (e.g., 80%), lower-priority keys get throttled first while high-priority keys continue.
**Why it matters:** Smarter than flat org budgets that cliff-edge everything at once. Critical agents keep running while best-effort agents pause.
**Technical spec:**
- New key-level field: `priority` enum (`critical`, `high`, `normal`, `low`, `best_effort`)
- New org-level budget type: "fleet budget" with threshold tiers
  - 0-80%: all keys allowed
  - 80-90%: `best_effort` keys blocked
  - 90-95%: `low` and `best_effort` blocked
  - 95-100%: only `critical` and `high` allowed
  - 100%: only `critical` allowed
- Thresholds configurable per org
- Webhook events: `fleet.throttle.tier_changed` with affected priority level
- Dashboard: fleet budget widget showing current tier and which priority levels are active
**Effort:** 1 week (new budget type + priority field + tiered enforcement logic in proxy)

### 2.2 Policy-as-Code / GitOps
**Source:** Cordum (YAML-based Safety Kernel policies)
**What:** `nullspend.policy.yaml` in the repo, pushed to NullSpend via CI/CD or API. Version-controlled, PR-reviewed budgets and mandates.
**Why it matters:** Enterprise customers expect infrastructure-as-code. PR review for budget changes creates accountability. Rollback is `git revert`.
**Technical spec:**
- Schema: YAML file defining keys, budgets, mandates, session limits
  ```yaml
  version: 1
  keys:
    research-bot:
      budgets:
        monthly: { max_usd: 500, period: monthly }
      mandates:
        allowed_models: [claude-sonnet-4, gpt-4o-mini]
        max_cost_per_request_usd: 5.00
      priority: high
      require_justification_above_usd: 2.00
  ```
- API endpoint: `PUT /api/policy/sync` (accepts full policy, reconciles with current state)
- CLI: `npx @nullspend/cli policy push` reads YAML and syncs
- GitHub Action: `nullspend/policy-sync@v1` runs on merge to main
- Dashboard shows: "Policy managed via GitOps" badge, last sync timestamp, diff viewer
- Conflict resolution: API/dashboard edits blocked when GitOps is enabled (or warn)
**Effort:** 1-2 weeks (YAML schema + sync API + CLI + GitHub Action)

### 2.3 Cost Anomaly Detection
**Source:** Respan (proactive evaluation agent), Helicone (anomaly flagging)
**What:** Automatically flag requests that cost 3x+ the rolling average for their model/tag combination. Proactive alerting — catches problems before budgets are hit.
**Why it matters:** Velocity limits catch spend-rate anomalies. This catches per-request cost anomalies — a single request that's weirdly expensive (unexpected model upgrade, prompt injection inflating tokens, etc.).
**Technical spec:**
- Background job (Cron Trigger or per-request check):
  - Per key+model: maintain rolling 50-request average cost
  - Flag any request > 3x average as anomaly
  - Store anomaly flag on cost event
- Webhook event: `cost_event.anomaly` with: actual cost, expected cost, multiplier, model, key
- Dashboard: anomaly badge on cost events, filterable
- Configurable multiplier threshold per key (default 3x)
- Uses existing EWMA infrastructure for rolling averages
**Effort:** 1 week (rolling average tracking + flagging + webhook + dashboard indicator)

### 2.4 Tag-Based Routing Policies (Conditional Mandates)
**Source:** Portkey (conditional routing by metadata)
**What:** "If tag `tier=free`, enforce max model `gpt-4o-mini`; if tag `tier=premium`, allow `gpt-4o`." Tags become active routing decisions, not just passive metadata.
**Why it matters:** SaaS companies using NullSpend for per-customer quotas need different model access per tier. This makes tags + mandates composable.
**Technical spec:**
- New config: "routing rules" per org — ordered list of conditions + mandate overrides
  ```json
  [
    { "match": { "tag": "tier=free" }, "mandates": { "allowed_models": ["gpt-4o-mini"] } },
    { "match": { "tag": "tier=premium" }, "mandates": { "allowed_models": ["gpt-4o", "claude-sonnet-4"] } }
  ]
  ```
- Evaluated in proxy after tag extraction, before mandate check
- First matching rule wins (most specific first)
- Dashboard: routing rules editor with drag-to-reorder
- Falls back to key-level mandates if no rule matches
**Effort:** 1 week (rule evaluation engine + dashboard editor + proxy integration)

### 2.5 Risk Points Budget (Non-Monetary)
**Source:** Runcycles (risk-weighted action scoring)
**What:** Parallel budget dimension alongside dollars. Each action class gets a point value: `classification=1pt, code_generation=10pts, email_send=20pts, deployment=50pts`. Budget enforces both dimensions simultaneously.
**Why it matters:** A $0.01 request that triggers an email is higher risk than a $1.00 read-only completion. Risk points capture blast radius, not just cost. Especially relevant for HITL — auto-approve cheap low-risk, require approval for cheap high-risk.
**Technical spec:**
- New budget dimension: `risk_points` alongside `max_microdollars`
- New field on cost events: `risk_points` (integer)
- Risk point assignment: by model (configurable), by tag, or by custom header `X-NullSpend-Risk-Points`
- Default risk map: `{ "gpt-4o": 5, "gpt-4o-mini": 1, "claude-opus-4": 10 }` (configurable per key)
- Budget check: must pass BOTH dollar budget AND risk point budget
- Dashboard: risk points column on cost events, risk budget widget
**Effort:** 1-2 weeks (new budget dimension + dual enforcement + configuration UI)

### 2.6 Automated Cost Digest
**Source:** Helicone (automated weekly reports)
**What:** Weekly email/Slack message with spending trends, top models by cost, optimization recommendations. Zero configuration beyond enabling.
**Why it matters:** Keeps NullSpend top-of-mind even when users aren't in the dashboard. Executive-friendly — the CFO sees this and asks "what is NullSpend?"
**Technical spec:**
- Cron Trigger: weekly (Monday 8am UTC) or configurable
- Content: total spend vs last week (% change), per-key breakdown (top 5), per-model breakdown, enforcement events (blocks, HITL triggers), budget exhaustion forecasts, optimization recommendation (cheapest model switch)
- Delivery: email (Resend/SendGrid) + Slack webhook (existing integration)
- Dashboard: "Digest" settings page — enable/disable, frequency, recipients
- HTML email template with NullSpend branding
**Effort:** 1 week (cron job + email template + Slack formatting + settings page)

---

## Tier 3: Strategic Differentiators (2+ weeks each)

### 3.1 HTTP 402 Budget Negotiation Protocol
**Source:** Stripe MPP (HTTP 402 challenge-credential flow)
**What:** When proxy blocks a request, return 402 (not 429) with structured negotiation info: price required, budget remaining, cheaper alternatives, upgrade URL. SDK auto-negotiates.
**Why it matters:** Standard HTTP semantics. SDK can auto-retry with cheaper model. Aligns with MPP's 402 pattern — NullSpend speaks the same language as the payment protocol ecosystem.
**Technical spec:**
- Budget exceeded → HTTP 402 instead of 429
- Response body: `{ required_usd: 0.15, remaining_usd: 0.03, alternatives: [{ model: "gpt-4o-mini", estimated_usd: 0.02 }], upgrade_url: "https://app.nullspend.com/budgets/xyz", negotiate_url: "https://api.nullspend.com/v1/budget-requests" }`
- SDK `trackedFetch`: intercepts 402, auto-retries with cheapest allowed alternative if `autoNegotiate: true`
- Backward compat: opt-in via key setting (default still 429 for existing integrations)
**Effort:** 1-2 weeks (402 response format + SDK auto-negotiation + backward compat)
**Note:** Already partially on roadmap as budget negotiation. MPP validates the HTTP 402 approach.

### 3.2 Supervised vs Autonomous Session Modes
**Source:** Google AP2 (human-present vs human-not-present distinction)
**What:** Sessions marked as "supervised" (human watching in real-time) get higher limits and auto-approve. "Autonomous" sessions get stricter limits and more HITL gates.
**Why it matters:** Different governance posture based on oversight level. Supervised agents should run fast; autonomous agents need guardrails. This is what AP2 mandates distinguish — NullSpend should too.
**Technical spec:**
- New header: `X-NullSpend-Session-Mode: supervised|autonomous` (default: autonomous)
- Per-key config: supervision multipliers — `{ supervised: { budget_multiplier: 2.0, hitl_threshold_multiplier: 5.0 }, autonomous: { budget_multiplier: 1.0, hitl_threshold_multiplier: 1.0 } }`
- Supervised mode: 2x budget limit, 5x HITL threshold (e.g., HITL at $50 instead of $10)
- Autonomous mode: standard limits
- Dashboard: session list shows supervision mode, filterable
- Webhook: `session.mode_changed` if mode changes mid-session
**Effort:** 1-2 weeks (session mode tracking + multiplier logic + dashboard)

### 3.3 Config-Driven A/B Model Routing
**Source:** Portkey (gateway config objects with strategy modes)
**What:** Stored JSON routing configs with strategies: `loadbalance` (80/20 traffic split), `fallback` (try primary, fall back on error), `canary` (5% to new model). Referenced by ID in requests.
**Why it matters:** Lets teams test new models safely (canary), distribute load across providers, and auto-recover from provider outages. Combined with NullSpend's cost tracking, you see cost impact of each routing decision.
**Technical spec:**
- New entity: `routing_configs` (id, org_id, name, strategy, targets, created_at)
- Strategies: `single` (default), `loadbalance` (weighted), `fallback` (ordered), `canary` (percentage)
- Header: `X-NullSpend-Config: cfg_xyz` or key-level default config
- Proxy resolves config → picks target based on strategy → rewrites model/provider → tracks which target was used on cost event
- Dashboard: routing config editor, per-config cost comparison ("Claude path costs $0.12/req avg, GPT path costs $0.08/req avg")
**Effort:** 2 weeks (config storage + routing engine + proxy integration + analytics)

### 3.4 Child Keys with Attenuating Permissions
**Source:** Crossmint (delegated keys with granular permissions)
**What:** Derived API keys that inherit but can only narrow their parent's permissions. Parent key has $500 budget → child has $50, allowed models subset, 24hr TTL. Auto-expires.
**Why it matters:** Maps to delegation chain vision (org → team → agent → sub-agent). Each level can only attenuate, never expand. Foundation for NSAID multi-hop delegation.
**Technical spec:**
- New field: `api_keys.parent_key_id` (nullable, self-referencing FK)
- New field: `api_keys.expires_at` (timestamp, nullable)
- Creation: `POST /api/keys` with `parent_key_id` — validates child permissions ⊆ parent permissions
- Enforcement: child budget ≤ parent budget, child models ⊆ parent models, child providers ⊆ parent providers
- Auto-expiry: cron job disables expired keys, or check on auth
- Dashboard: key hierarchy tree view
- SDK: `client.createChildKey({ parentKeyId, budget, mandates, ttlHours })`
**Effort:** 2 weeks (key hierarchy + permission inheritance + expiry + dashboard tree view)

### 3.5 Policy Snapshot Pinning
**Source:** Locus (immutable rules during transactions)
**What:** When a session starts, agent gets a policy snapshot hash. Mid-session policy changes don't take effect until next session. Prevents confusing behavior where limits change while agent is mid-task.
**Why it matters:** An admin lowering a budget while an agent is running could cause unexpected mid-conversation failures. Snapshot pinning makes behavior predictable.
**Technical spec:**
- On session start: capture current policy (mandates, budget, session limit) and hash it
- Store: `sessions.policy_snapshot_hash` + `sessions.policy_snapshot` (JSONB)
- Session requests enforce against snapshot, not live policy
- Live policy changes take effect on next session
- Dashboard: "Policy pinned at session start" indicator
- Override: `X-NullSpend-Policy-Refresh: true` header forces re-fetch mid-session
**Effort:** 1-2 weeks (snapshot capture + session-scoped enforcement + override)

### 3.6 Open-Source Pricing Database
**Source:** Portkey (`github.com/Portkey-AI/models` — 2,000+ models, 40+ providers)
**What:** Open-source the pricing data from `packages/cost-engine` as a standalone community-maintained repository. Accept PRs for new models and price changes.
**Why it matters:** Positions NullSpend as the definitive source for LLM pricing. Community catches pricing changes faster. Every contributor becomes aware of NullSpend.
**Technical spec:**
- Extract `pricing-data.json` into a standalone repo: `nullspend/llm-pricing`
- npm package: `@nullspend/llm-pricing` (JSON data only, no code dependency)
- GitHub Actions: CI validates schema on PR, auto-publishes to npm on merge
- `@nullspend/cost-engine` imports from `@nullspend/llm-pricing`
- README with contribution guide: how to add a model, how to update pricing
- Automated checks: flag models whose pricing hasn't been verified in 30 days
**Effort:** 2-3 days for extraction, ongoing maintenance

---

## Tier 4: Future Considerations (when path is clearer)

### 4.1 Semantic Search Across Cost Events
**Source:** AgentMail (semantic search across inboxes)
**What:** Search cost events by meaning, not just keyword. "Show me all requests related to customer onboarding" using semantic matching on stored request/response bodies (already in R2).
**When:** After body capture is widely adopted and there's enough data to make search valuable.

### 4.2 Cost Comparison Experiments
**Source:** Langfuse (experiments UI)
**What:** Run the same prompt against multiple models, see cost + quality side-by-side. "Claude Sonnet costs $0.12 for this, GPT-4o costs $0.08, quality scores are 94% vs 91%."
**When:** After smart model routing is built (needs quality signal infrastructure).

### 4.3 Prompt Caching (Exact Match)
**Source:** Portkey (semantic caching)
**What:** Simple exact-match caching with content hashing. `X-NullSpend-Cache: true` header. SHA-256(model + messages) → cached response. Returns with zero cost event.
**When:** After enough request volume to justify cache infrastructure. Start simple (exact match), skip semantic caching (expensive, low accuracy).

### 4.4 Output Guardrails with Three Response Modes
**Source:** Portkey (60+ guardrails with block/retry/monitor modes)
**What:** Beyond cost guardrails — PII detection, JSON validation, hallucination flags. Three modes: block, retry with fallback, monitor-only.
**When:** Only if customer discovery reveals demand. This is Portkey/Respan territory, not NullSpend's core.

### 4.5 Custom Model Pricing via API
**Source:** Langfuse (user-configurable pricing tiers)
**What:** Let users define custom model pricing via API. Handles fine-tuned models, private deployments, and negotiated enterprise rates that differ from list pricing.
**When:** When enterprise customers with custom pricing tiers appear.

### 4.6 Version Labels for Environments
**Source:** Langfuse (mutable labels on immutable versions)
**What:** Mandates/budgets have immutable version numbers plus mutable labels (`production`, `staging`). Deploy different cost policies per environment.
**When:** When multi-environment deployment becomes a common pattern.

---

## Pricing Model Insights

| Platform | Model | Lesson for NullSpend |
|---|---|---|
| Langfuse | Per-trace, no seat fee | Most developer-friendly — don't penalize team growth |
| Helicone | Per-seat + usage | Seat fees limit adoption at large orgs |
| Portkey | Per-log usage | Simple, predictable, aligns with scale |
| Runcycles | Free / open source | Can't compete on price, compete on product |
| Crossmint | Per-transaction | Works for payment rails, not for governance |

**Recommendation:** Usage-based pricing (per cost event or per governed dollar), no per-seat multiplier. Aligns NullSpend's revenue with agent scale, not team size. Generous free tier to drive adoption.

---

## Quick Reference: What to Build Next

If building path-agnostic features while doing customer discovery:

1. **Dry Run** (1-2 days) — half a day in proxy, differentiator vs all competitors
2. **ALLOW_WITH_CAPS** (3-4 days) — graceful degradation, nobody does this
3. **Budget Exhaustion Forecasting** (1-2 days) — math on existing velocity data
4. **Justification Header** (1-2 days) — compliance gold, trivial to implement
5. **Session Cost Rollups** (2-3 days) — makes existing sessions 10x more useful
6. **Key-Value Tags** (2-3 days) — unlocks dimensional analytics

Total: ~2 weeks for all six. All path-agnostic. All differentiate from competitors.
