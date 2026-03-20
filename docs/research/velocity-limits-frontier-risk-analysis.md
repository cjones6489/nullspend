# Velocity Limits for AI Agent Cost Enforcement: Frontier Patterns & Risk Analysis

**Date:** 2026-03-19
**Scope:** Frontier/emerging patterns, risk/failure mode analysis for loop/runaway detection in NullSpend's Durable Object budget enforcement layer.

---

## Part 1: Frontier & Emerging Patterns

### 1.1 Competitive Landscape: AI Cost Control Companies

#### AgentBudget (YC-backed, open-source)
- **What it is:** Python SDK that wraps LLM provider clients. `agentbudget.init('$5.00')` drops in cost tracking.
- **Loop detection approach:** Three-layer protection:
  1. Hard dollar limit: raises `BudgetExhausted` when budget depleted
  2. Soft limit callback: triggers at 90% consumption for graceful shutdown
  3. **Circuit breaker: detects repeated API calls in loops, raises `LoopDetected` before budget exhaustion**
- **Architecture:** Pure Python, in-process. No infrastructure. Supports 60+ models, LangChain/CrewAI integrations.
- **Relevance to NullSpend:** Their loop detection is client-side (same-process). NullSpend's proxy position means we can detect patterns across all agents without requiring SDK adoption. Their circuit breaker is the most directly comparable feature to what we'd build, but it operates at a fundamentally different layer (client vs. proxy).

#### Helicone (YC W23)
- **What it is:** LLM observability platform. Logging, cost tracking, custom rate limits.
- **Loop detection:** No explicit loop detection or velocity controls found in their public documentation or blog. Their focus is observability (seeing what happened) not enforcement (preventing it).
- **Gap NullSpend can exploit:** Helicone is observe-only. They have no budget enforcement, no velocity limits, no circuit breakers.

#### Respan.ai
- **What it is:** "Self-driving observability and evals for agents." Trace capture, evaluation, prompt optimization.
- **Loop detection:** No explicit loop or runaway detection. Focused on quality evaluation, not cost enforcement.
- **Gateway feature:** Single gateway to 500+ models. Monitoring dashboards with cost metrics. But no enforcement layer.

#### Vercel AI Gateway
- **What it is:** Unified API for 100s of AI models. Budget monitoring, usage tracking.
- **Budget enforcement:** Credit balance tracking via `/credits` endpoint. Generation cost lookups. But no real-time budget enforcement, no velocity controls, no circuit breakers.
- **Architecture:** Gateway proxy model (similar to NullSpend), but enforcement is limited to credit balance checks at the account level.

#### Portkey.ai
- **What it is:** AI gateway with rate limiting. Documentation was unavailable during research.
- **Known features:** Rate limiting, guardrails, caching. No public documentation on velocity-specific controls.

#### Langfuse
- **What it is:** Open-source LLM observability. Tracing, scoring, cost tracking.
- **Loop detection:** No velocity or loop detection. Focused on post-hoc analysis.

**Summary:** No competitor currently offers real-time velocity-based loop detection at the proxy layer. AgentBudget is closest but operates client-side. This is a genuine whitespace opportunity for NullSpend.

---

### 1.2 Agent Framework Built-in Safety Mechanisms

#### Claude Agent SDK (Anthropic)
- **Controls:** `allowedTools` restricts which tools the agent can use. Hooks (`PreToolUse`, `PostToolUse`, `Stop`) provide lifecycle interception points.
- **Budget/loop controls:** No `max_budget_usd` or `max_turns` parameter found in the SDK overview. The SDK relies on external cost enforcement (this is where NullSpend fits).
- **Subagent model:** Main agent delegates to specialized subagents. Each subagent could independently loop.
- **NullSpend implication:** Claude Agent SDK agents have NO built-in cost limits. They depend entirely on external enforcement (API billing limits or proxy-layer controls like NullSpend). This makes proxy-layer velocity detection critical.

#### OpenAI Agents SDK
- **Controls:** `max_turns` parameter on `Runner.run()`. Raises `MaxTurnsExceeded` when exceeded.
- **Error handling:** Custom error handlers can return graceful fallback responses instead of exceptions:
  ```python
  result = Runner.run_sync(agent, prompt, max_turns=3,
    error_handlers={"max_turns": on_max_turns})
  ```
- **Budget tracking:** None. No token budget or cost tracking in the SDK.
- **NullSpend implication:** `max_turns` prevents infinite loops but doesn't prevent cost runaway within allowed turns (e.g., 10 turns of expensive reasoning model calls). Velocity detection catches the "burns $50 in 10 legitimate turns" scenario that `max_turns` misses.

#### AutoGen/AG2 (Microsoft)
- **Most comprehensive built-in controls:**
  - `MaxMessageTermination(max_messages=10)` -- message count limit
  - `TokenUsageTermination(max_tokens=5000)` -- token budget
  - `TimeoutTermination(timeout_seconds=300)` -- wall-clock timeout
  - `TextMentionTermination("APPROVE")` -- keyword-based stop
- **Composable:** Conditions combine with `&` (AND) and `|` (OR) operators.
- **NullSpend implication:** AutoGen's `TokenUsageTermination` is the closest framework-level equivalent to velocity detection, but it's per-session and requires the agent to report token usage. NullSpend's proxy position gives us ground-truth token counts regardless of whether the agent reports them.

#### LangChain/LangGraph
- **Controls:** `recursion_limit` parameter on graph execution (documentation was behind a redirect and not directly accessible during research).
- **Known default:** Historically 25 steps. Prevents infinite graph traversals.
- **NullSpend implication:** Recursion limits prevent structural loops but not cost-intensive loops within the limit.

**Synthesis:** All frameworks implement some form of iteration/turn limits, but NONE implement cost-rate (velocity) detection. The gap is universal: frameworks count turns, not dollars-per-second. NullSpend's proxy position uniquely enables cost-velocity detection because we see actual spend, not just turn counts.

---

### 1.3 Academic Research on Agent Loop Detection (2024-2026)

#### AIR: Improving Agent Safety through Incident Response (arXiv 2602.11749, Feb 2026)
- First incident response framework for LLM agents
- Detects incidents via semantic checks, synthesizes guardrail rules
- Relevant technique: post-hoc incident detection can inform what velocity patterns to watch for

#### AGENTSAFE: Unified Framework for Ethical Assurance (arXiv 2512.03180, Dec 2025)
- Profiles agentic loops (plan -> act -> observe -> reflect)
- Implements "semantic telemetry, dynamic authorization, anomaly detection, and interruptibility mechanisms"
- Runtime governance with "cryptographic tracing and organizational controls"
- **Most relevant to NullSpend:** The anomaly detection and interruptibility mechanisms map directly to velocity limits (anomaly = spend rate spike, interruptibility = blocking the request)

#### Reflection-Driven Control for Trustworthy Code Agents (arXiv 2512.21354, Dec 2025)
- "Internal reflection loop that monitors and evaluates its own decision path" to detect risks during generation
- Client-side approach (agent self-monitors). Complementary to proxy-side velocity detection.

#### STRATUS: Multi-agent System for Autonomous Reliability Engineering (arXiv 2506.02009, Jun 2025)
- Formalizes "Transactional No-Regression" safety specification for agentic systems
- Relevant concept: defining safety invariants that must hold across agent transactions (analogous to "spend velocity must not exceed threshold")

**Synthesis:** Academic research is focused on semantic/behavioral loop detection (detecting that the agent is doing the wrong thing) rather than cost-velocity detection (detecting that the agent is spending too fast). These approaches are complementary: NullSpend detects the symptom (abnormal spend rate), academic approaches detect the cause (agent stuck in a loop). Both are valuable.

---

### 1.4 Card Payments Industry Velocity Controls

The card payments industry has decades of experience with velocity-based fraud detection. Key learnings:

#### Stripe Issuing
- **Spending limits:** Array of `{amount, interval, categories}` specs
- **Intervals:** `per_authorization`, `daily`, `weekly`, `monthly`
- **Defaults:** 500 USD daily limit per new card, 10,000 USD per individual authorization (unconfigurable)
- **Aggregation:** "Best-effort" with potential 30-second delays
- **Cascade:** "The most restrictive spending control applies" when overlapping limits exist
- **Key insight:** All date-based intervals start at midnight UTC. Simple fixed windows, not sliding.

#### Marqeta (documentation inaccessible during research, known from prior knowledge)
- **Velocity controls:** Separate resource type with dimensions:
  - `amount_limit`: max dollar amount per window
  - `usage_limit`: max transaction count per window
  - `velocity_window`: `DAY`, `WEEK`, `MONTH`, `LIFETIME`, `TRANSACTION`
- **Association:** Controls attach to card products, card groups, or individual cards
- **Active/inactive toggle:** Controls can be toggled without deletion
- **Key insight:** Tracking both amount AND count is critical. A loop might make many cheap calls (caught by count limit) or few expensive calls (caught by amount limit).

#### Lithic (documentation inaccessible during research)
- Known to offer similar velocity rule configuration to Marqeta

**Lessons for NullSpend:**

1. **Track both dimensions:** Amount per window AND request count per window. An agent looping on cheap calls (many requests, low cost each) looks different from one making expensive calls (few requests, high cost each).
2. **Multiple window sizes:** Stripe uses per-authorization + daily + weekly + monthly. For AI agents, consider per-request + per-minute + per-hour + per-day.
3. **Fixed windows are simpler than sliding:** Stripe resets at midnight UTC. Simpler to implement, reason about, and debug. The 30-second aggregation delay is acceptable for fraud detection but may not be for real-time budget enforcement.
4. **Most restrictive wins:** When multiple controls apply, the strictest one blocks. This aligns with NullSpend's existing behavior where both user-level and api_key-level budgets are checked.
5. **Defaults matter:** Stripe's 500 USD/day default for new cards is a key safety net. NullSpend should consider default velocity limits that protect users who haven't configured them.

---

### 1.5 Novel Approaches to Velocity/Anomaly Detection

#### Exponential Moving Average (EMA) for Spend Velocity

```
EMA_new = alpha * current_rate + (1 - alpha) * EMA_previous
```

- **Pros:** Smooth, resistant to single-request spikes, captures trend
- **Cons:** Requires persistent state across requests, cold start problem (what's the initial EMA?), alpha tuning is domain-specific
- **Suitability for DO:** Good fit. The DO maintains state across requests. EMA can be stored as a single number. The cold start problem is solved by initializing from the first N requests.
- **Recommended alpha:** 0.3 (weights recent requests heavily but retains history). For a 1-minute window with ~10 requests, this means the last 3-4 requests dominate the average.

#### Z-Score Based Anomaly Detection

```
z_score = (current_rate - mean) / stddev
```

- **Pros:** Statistically principled, adapts to each user's baseline
- **Cons:** Requires sufficient history to establish mean/stddev, cold start problem, assumes normal distribution
- **Suitability for DO:** Feasible but complex. Needs to maintain running mean and variance (two numbers). Could use Welford's online algorithm for numerical stability.
- **Recommendation:** Too complex for v1. The baseline establishment period creates a window where no protection exists. Better for a v2 "adaptive velocity" feature.

#### Token-Level Pattern Detection (Same Prompt Repeated = Loop)

- **Signal:** Hash the request body (or key fields: model + messages[-1].content). Track recent hashes in a ring buffer.
- **Detection:** If the same hash appears N times within a window, flag as potential loop.
- **Pros:** Catches exact-repeat loops with high confidence
- **Cons:** Misses "almost the same" loops (agent varies the prompt slightly each time), storage overhead for request hashes
- **Suitability for DO:** Good fit. Store a ring buffer of last N request hashes (e.g., last 20). SHA-256 hash is 32 bytes, so 20 hashes = 640 bytes.
- **Recommendation:** Implement as a secondary signal alongside velocity. The combination (high velocity AND repeated requests) is a very strong loop indicator.

#### Multi-Signal Detection (Velocity + Repetition + Error Rate)

- **Concept:** Combine multiple weak signals into a strong signal:
  1. Spend velocity exceeds threshold (primary)
  2. Request hashes are repetitive (secondary)
  3. Error rate is elevated (secondary) -- loops often produce errors
  4. Output token count is consistently low (secondary) -- loops often get short responses
- **Scoring:** Weight signals and trip when combined score exceeds threshold
- **Recommendation:** v1 should focus on velocity (signal 1) alone. Multi-signal is a v2 optimization to reduce false positives.

---

### 1.6 Anthropic's Agent Safety Guidance

From Anthropic's "Building Effective Agents" research blog:
- **Stopping conditions:** "Maximum number of iterations" recommended
- **Environmental feedback:** Agents should "gain ground truth from the environment at each step"
- **Sandbox testing:** "Extensive testing in sandboxed environments" before deployment
- **Human checkpoints:** Agents should "pause for human feedback at checkpoints"
- **No velocity/cost controls discussed.** Anthropic's guidance focuses on architectural patterns, not runtime cost enforcement.

This validates the gap: even Anthropic's own guidance doesn't address cost-velocity detection. It's assumed to be handled by the infrastructure layer (which is exactly NullSpend's value proposition).

---

## Part 2: Risk & Failure Mode Analysis

### 2.1 False Positives: Legitimate Burst Activity Triggers Velocity Limit

#### Scenario A: Multi-Agent Orchestration
- **Pattern:** Manager agent spawns 10 worker agents simultaneously. Each makes 1 LLM call. 10 requests arrive at the DO within 1 second.
- **Risk level:** HIGH. This is the most common false positive scenario.
- **Mitigation options:**
  1. **Session-aware velocity:** Requests with different `x-nullspend-session` values are counted separately. A manager spawning workers with distinct sessions won't trigger per-session velocity limits.
  2. **Burst allowance:** Allow N requests above the velocity threshold before tripping (e.g., "50/min sustained, but allow burst of 20 in any 10-second window").
  3. **Token bucket algorithm:** Instead of fixed rate, use a token bucket that allows bursts but limits sustained rate. Refill rate = steady-state limit, bucket depth = burst tolerance.
- **Recommendation:** Token bucket with configurable burst size is the most flexible approach. It naturally handles orchestration bursts while catching sustained loops.

#### Scenario B: RAG Pipeline with Sequential Document Processing
- **Pattern:** Agent processes 50 documents, making a cheap classification call for each. 50 requests in 2 minutes, but total cost is < $0.10.
- **Risk level:** MEDIUM. High request count but low cost per request.
- **Mitigation:** Track velocity on BOTH dimensions (cost rate and request count). If cost velocity is low even though request count is high, the agent is making cheap calls -- not a runaway.
- **Why this matters:** A velocity limit based purely on request count would block this legitimate workload. A velocity limit based on cost rate would correctly allow it.

#### Scenario C: Batch API Key Usage
- **Pattern:** User's CI/CD pipeline runs 20 agents with the same API key. Each makes 5 requests. 100 requests arrive in 30 seconds.
- **Risk level:** MEDIUM-HIGH. Multiple agents sharing a key look indistinguishable from a single agent looping.
- **Mitigation:** Per-session velocity limits. Each agent should use a distinct session ID. Without session IDs, the system can't distinguish multi-agent from single-agent-looping.
- **Key design decision:** Should velocity limits be per-key, per-session, or per-user? Answer: per-key by default, with per-session as an opt-in refinement.

---

### 2.2 False Negatives: Slow-Burn Loops That Evade Detection

#### Scenario A: One Expensive Call Per Minute
- **Pattern:** Agent is stuck but spaces requests 60 seconds apart. Each call costs $0.50 (reasoning model). $30/hour, $720/day.
- **Risk level:** HIGH. This is the hardest scenario to detect.
- **Why velocity misses it:** If the velocity limit is "$10/minute," this agent spends $0.50/minute -- well under the threshold.
- **Mitigation:**
  1. **Multi-window velocity:** Check velocity across multiple windows (1-min, 5-min, 1-hour, 1-day). The 1-day window catches the slow burn even if shorter windows don't.
  2. **Budget limit still catches it:** Even if velocity doesn't trigger, the absolute budget limit ($100/day) eventually stops the agent. Velocity is a fast-response mechanism; budget limits are the backstop.
  3. **Pattern detection:** Same-prompt detection catches exact-repeat slow loops regardless of rate.
- **Key insight:** Velocity limits are NOT a replacement for budget limits. They're a complement. Budget limits catch everything eventually; velocity limits catch fast runaways before the budget is exhausted.

#### Scenario B: Multiple Sessions, Same User
- **Pattern:** Agent creates a new session for each request to avoid per-session velocity limits. Each session makes 1 request.
- **Risk level:** MEDIUM. Session rotation as an evasion technique.
- **Mitigation:** Per-user aggregate velocity in addition to per-session velocity. Even if individual sessions look fine, the aggregate user spend rate reveals the loop.
- **Design implication:** Velocity must be checked at multiple levels: per-session (if available), per-key, AND per-user. The user-level check catches session rotation.

#### Scenario C: Cost Spread Across Models
- **Pattern:** Agent alternates between cheap and expensive models. Average rate looks normal but the expensive calls are a loop.
- **Risk level:** LOW. The total cost velocity is still elevated; the model variation is irrelevant to cost-rate detection.
- **No special mitigation needed:** Cost-based velocity already handles this.

---

### 2.3 DO Eviction / Cold Start: Velocity State Loss

#### Current DO Behavior (from Cloudflare documentation research)
- **Eviction:** "When a Durable Object receives no events (such as alarms or messages) for a short period, it is evicted from memory." The exact duration is undocumented but empirically observed to be ~10-30 seconds of inactivity.
- **State persistence:** SQLite storage survives eviction. In-memory state (JavaScript class fields) does NOT survive eviction.
- **Cold start:** On the next request after eviction, the DO constructor runs, which calls `blockConcurrencyWhile()` to reload state from SQLite.
- **Memory limit:** "A couple megabytes" per Worker isolate. DOs can cache "up to several megabytes" of data.
- **Storage limit:** 10 GB per DO (SQLite).

#### Impact on Velocity State

**If velocity state is stored only in memory (JS class fields):**
- State is lost on every eviction
- After cold start, the velocity counter resets to zero
- An attacker could intentionally pause for 30 seconds to reset velocity tracking
- **This is unacceptable for security-critical velocity enforcement**

**If velocity state is stored in SQLite:**
- State survives eviction
- Cold start loads state during `blockConcurrencyWhile()`
- No velocity reset on eviction
- Small latency penalty on cold start (SQLite read), but this is already the pattern for budget state
- **This is the correct approach**

**Recommendation:** Store velocity state in the DO's SQLite database, not in memory. Specifically:
```sql
CREATE TABLE IF NOT EXISTS velocity_state (
  entity_key TEXT PRIMARY KEY,       -- "user:u1" or "api_key:k1"
  window_start INTEGER NOT NULL,     -- ms timestamp of current window start
  request_count INTEGER NOT NULL DEFAULT 0,
  spend_microdollars INTEGER NOT NULL DEFAULT 0,
  -- For EMA approach (v2):
  ema_spend_rate REAL,
  last_request_at INTEGER
);
```

The velocity state table adds minimal overhead: one row per entity (typically 2 rows: one for user, one for api_key), queried in the same transaction as `checkAndReserve`.

---

### 2.4 Clock Skew and Time Precision: `Date.now()` in Workers

#### Critical Finding: Workers `Date.now()` Is NOT Real-Time

From Cloudflare's security documentation:
> "The time value returned is not the current time. `Date.now()` returns the time of the last I/O."

During synchronous execution, `Date.now()` is **frozen**. It only advances when an I/O operation completes (network request, storage read/write, etc.).

#### Impact on Velocity Detection

**In the current `checkAndReserve` implementation:**
```typescript
const now = Date.now(); // Frozen to time of last I/O
```
This `now` is set after the RPC call arrives (which is an I/O event), so it's reasonably accurate for the start of request processing. But within `transactionSync()`, `Date.now()` does NOT advance -- all SQL operations within the transaction see the same timestamp.

**For velocity detection, this is actually FINE because:**
1. Each request to the DO is an I/O event that unfreezes `Date.now()`
2. We only need to compare timestamps BETWEEN requests, not within a single request
3. The DO processes requests sequentially (single-threaded), so each request gets a fresh `Date.now()` value

**Potential issue:** If multiple requests queue up while the DO is processing one, they all get timestamps from when their I/O arrives at the DO, not when they were originally sent. For velocity detection, this is actually ideal -- we want to measure the rate at which requests arrive at the enforcement point, not when they were sent.

**Clock monotonicity:** Workers clocks are NOT guaranteed monotonic across cold starts. After eviction and restart, the clock could theoretically jump (forward or backward, if the DO migrates to a different server). Mitigate by using relative windows (measuring elapsed time within a window) rather than absolute timestamps, and treating any negative elapsed time as a window reset.

**Recommendation:** `Date.now()` is adequate for velocity detection in DOs. No special handling needed beyond defensive programming for non-monotonic clock edge cases.

---

### 2.5 Concurrent Request Handling: DO Sequential Processing

#### How the DO Processes Requests

From Cloudflare documentation and the existing `UserBudgetDO` code:
1. Each DO processes requests one at a time (single-threaded)
2. `transactionSync()` provides atomicity within a request
3. Input gates serialize requests: while a storage operation is executing, no new events are delivered
4. If 100 requests arrive simultaneously, they queue and execute sequentially

#### Impact on Velocity Detection

**Good news:** Sequential processing means velocity state updates are naturally serialized. No race conditions between concurrent velocity checks.

**Bad news:** If 100 requests queue up, request #100 waits for requests #1-99 to complete. By the time #100 runs its velocity check, it correctly sees 99 prior requests in the window. **This is the correct behavior** -- the velocity limit should fire on request N when N exceeds the threshold, regardless of when the requests were originally sent.

**Latency concern:** If the DO is processing a burst of requests and each request takes ~5ms (SQLite read + write), 100 queued requests means request #100 waits ~500ms. This is a performance concern but not a correctness concern.

**Interaction with reservations:** The current `checkAndReserve` creates a reservation (SQLite write) for each approved request. Velocity checking should happen BEFORE the reservation, as part of the same `transactionSync()` call. This means a denied-by-velocity request never creates a reservation (no cleanup needed).

**Recommendation:** Add velocity check as Phase 0 of `checkAndReserve`, before the budget check. The check reads `velocity_state`, updates it, and denies if threshold exceeded -- all within the existing `transactionSync()`.

---

### 2.6 Interaction with Existing Budget Enforcement

#### Decision Matrix: Velocity Limit vs. Budget Limit

| Velocity | Budget | Outcome | Rationale |
|----------|--------|---------|-----------|
| OK | OK | Approved | Normal operation |
| OK | Exceeded | Denied (budget) | Budget is the hard limit. Velocity is fine but money is gone. |
| Exceeded | OK | Denied (velocity) | Budget has headroom but spending too fast. This is the new capability. |
| Exceeded | Exceeded | Denied (budget) | Both limits hit. Return budget error (more useful to the caller). |

#### Check Order: Velocity First, Then Budget

**Rationale:**
1. Velocity check is cheaper (one row read + update) than budget check (multiple entity rows + reservation)
2. If velocity is exceeded, skip the budget check entirely (no reservation needed)
3. If velocity is OK but budget is exceeded, the existing budget denial flow handles it

**Error response:**
- Budget exceeded: `429` with `budget_exceeded` error code (existing)
- Velocity exceeded: `429` with `velocity_exceeded` error code (new)
- The error code tells the agent framework what happened. Some frameworks (OpenAI Agents SDK) have retry logic -- the error code should signal "don't retry immediately" vs. "retry after delay."

#### HTTP Headers for Velocity State

Following the pattern from existing rate limiting:
```
X-Velocity-Limit: 100          -- requests per window
X-Velocity-Remaining: 42       -- requests remaining in current window
X-Velocity-Reset: 1710864000   -- unix timestamp when window resets
X-Velocity-Window: 60          -- window size in seconds
```

---

### 2.7 Gaming/Evasion: Can Agents Work Around Velocity Limits?

#### Evasion 1: API Key Rotation
- **Attack:** Create a new API key for each burst of requests. Each key starts with a fresh velocity window.
- **Mitigation:** Velocity limits at the USER level in addition to the key level. All keys belonging to a user share the user-level velocity counter.
- **Current architecture support:** The DO is keyed by userId (`env.USER_BUDGET.idFromName(userId)`). All keys for a user already route to the same DO. User-level velocity is trivial to add.

#### Evasion 2: Multiple Sessions
- **Attack:** Each request uses a different session ID to avoid per-session velocity limits.
- **Mitigation:** Don't rely on per-session velocity as the primary control. Per-key and per-user velocity are the primary controls. Per-session is an additional refinement, not a gating mechanism.

#### Evasion 3: Spacing Requests Just Under Threshold
- **Attack:** Agent is programmed to space requests at exactly the velocity limit minus epsilon.
- **Mitigation:** This is actually the desired behavior. If the agent is staying under the velocity limit, it's consuming budget at an acceptable rate. The budget limit is the backstop.
- **Design principle:** Velocity limits are about RATE, not total. An agent staying under the rate limit is, by definition, operating within acceptable parameters. If the total spend is concerning, that's what the budget limit is for.

#### Evasion 4: Using Multiple Users/Accounts
- **Attack:** Agent operator creates multiple NullSpend accounts to distribute requests.
- **Mitigation:** Out of scope for velocity limits. This is an account-level abuse detection problem, handled by account verification, billing, and terms of service.

**Assessment:** Evasion 1 (key rotation) is the most realistic attack vector. The mitigation (user-level velocity) is straightforward and aligns with the existing DO architecture.

---

### 2.8 Webhook Storm: Velocity Alert Flooding

#### The Problem
If velocity is exceeded 100 times in a minute (100 requests, all denied), should we send 100 `velocity.exceeded` webhook events?

**No.** This creates a webhook storm that:
- Overwhelms the customer's webhook endpoint
- Costs NullSpend in QStash dispatches
- Provides no additional information after the first alert

#### Proposed Solution: Cooldown Period

```
First velocity denial  -> send webhook "velocity.exceeded"
Next 4 minutes         -> suppress duplicate webhooks
5 minutes after first  -> if still exceeding, send "velocity.still_exceeded" with count
```

**Implementation:** Store `last_velocity_webhook_at` in the DO's SQLite. Before dispatching a webhook:
```typescript
const cooldownMs = 5 * 60 * 1000; // 5 minutes
if (now - lastVelocityWebhookAt < cooldownMs) {
  // Suppress, but increment suppressed_count
  return;
}
```

**Webhook event types to add:**
- `velocity.exceeded` -- first detection in a cooldown window
- `velocity.resolved` -- velocity returned to normal after being exceeded (optional, v2)

**Interaction with existing threshold webhooks:**
The existing `detectThresholdCrossings` already has a TODO for dedup: "Redis dedup for threshold alerts (v1.1)". The velocity webhook cooldown should use the same dedup mechanism (DO SQLite instead of Redis, since the DO is the authority).

---

### 2.9 Configuration Errors: User Sets Velocity Too Low

#### The Problem
User sets velocity limit to 5 requests/minute. Their agent makes 10 legitimate requests/minute. Every other request is blocked.

#### Signals to Communicate "Too Low" vs. "Something Is Wrong"

| Signal | "Too low" | "Something is wrong" |
|--------|-----------|---------------------|
| Denial pattern | Consistent denials at steady rate | Burst of denials after period of no denials |
| Request diversity | Varied request bodies | Same/similar request bodies |
| Error rate before velocity | Low | High (agent retrying errors) |
| User action | Recently changed velocity config | No recent config change |

#### Mitigation Strategies

1. **Dashboard warning:** When creating/updating a velocity limit, show the user's recent request rate. If the limit is below their p95 request rate, warn: "This limit is below your typical request rate of X/minute."
2. **Velocity limit floor:** Consider a minimum velocity limit (e.g., 5 requests/minute, $1/minute). Prevents accidental lockout.
3. **Grace period on config change:** When a velocity limit is first set or lowered, allow a 5-minute grace period where violations are warned (webhook) but not blocked. This lets the user see the impact before enforcement kicks in.
4. **"Observe" mode for velocity:** Like the existing `policy: "warn"` for budgets, allow `velocity_policy: "warn"` that fires webhooks but doesn't block.

---

### 2.10 Multi-Entity Interaction: User + API Key Velocity Limits

#### The Problem
Both the user entity and the api_key entity can have velocity limits. How do they interact?

#### Proposed Model (Consistent with Budget Enforcement)

Current budget enforcement checks ALL matching entities and denies if ANY strict_block entity is exceeded. Velocity should follow the same pattern:

```
For each entity (user, api_key) that has velocity limits:
  Check velocity for that entity
  If ANY entity's velocity is exceeded:
    Deny with the exceeded entity's details
```

**Example:**
- User velocity limit: 100 req/min
- API key velocity limit: 20 req/min
- Request #21 with this key: denied (api_key velocity exceeded, even though user velocity is fine)

This is the same "most restrictive wins" pattern from Stripe Issuing.

#### Per-Entity vs. Aggregate Velocity

- **Per-entity:** Each entity has its own velocity counter. User has one, each api_key has one. A key can exceed its limit while the user is fine.
- **Aggregate:** All entities share a single velocity counter. If any entity would push the aggregate over, deny.
- **Recommendation:** Per-entity (consistent with how budget limits work). The user entity provides the aggregate-level check naturally -- all requests for a user pass through the user entity check regardless of which key is used.

#### Storage in DO SQLite

The `velocity_state` table keyed by `entity_key` naturally supports this. In `checkAndReserve`, iterate over matching budget rows and check velocity for each:

```typescript
// Phase 0: Velocity check (before budget check)
for (const row of rows) {
  const velocityLimit = row.velocity_limit; // new column on budgets table
  if (velocityLimit) {
    const vState = this.getVelocityState(row.entity_type, row.entity_id, now);
    if (vState.requestCount >= velocityLimit.maxRequests) {
      result = { status: "denied", reason: "velocity_exceeded", ... };
      return;
    }
    // Increment velocity counter
    this.incrementVelocity(row.entity_type, row.entity_id, now);
  }
}
```

---

## Part 3: Synthesis & Recommendations

### 3.1 What to Build for v1

1. **Fixed-window velocity tracking in the DO** -- Per-entity (user + api_key), tracking both request count and spend amount per window. Window size configurable (default: 1 minute).
2. **Velocity check as Phase 0 of `checkAndReserve`** -- Before budget check. Denied requests never create reservations.
3. **SQLite-backed velocity state** -- Survives DO eviction. Single table with entity_key, window_start, request_count, spend_microdollars.
4. **`429 velocity_exceeded` error response** -- Distinct from `budget_exceeded`. Includes headers with velocity state.
5. **Webhook with cooldown** -- `velocity.exceeded` event with 5-minute dedup.
6. **User-level velocity as evasion backstop** -- Even if per-key velocity is fine, user-level velocity catches key rotation attacks.

### 3.2 What to Defer to v2

1. **EMA / adaptive velocity** -- Requires baseline establishment, more complex.
2. **Request body hashing (loop fingerprinting)** -- Secondary signal, adds storage overhead.
3. **Multi-signal detection** -- Combining velocity + repetition + error rate.
4. **Z-score anomaly detection** -- Requires history, assumes normal distribution.
5. **Per-session velocity** -- Useful but not critical. Per-key and per-user cover the main cases.
6. **Token bucket algorithm** -- Better than fixed window for burst tolerance, but more complex. Fixed window with a configurable burst allowance is sufficient for v1.
7. **Grace period / observe mode** -- Nice UX but not security-critical.

### 3.3 Key Design Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Window type | Fixed window (reset at interval boundary) | Simpler, debuggable, consistent with card industry |
| Velocity dimensions | Both request count AND spend amount | Catches both cheap-loop and expensive-loop patterns |
| Entity scope | Per-entity (user + api_key) | Consistent with budget enforcement, prevents key rotation evasion |
| State storage | DO SQLite | Survives eviction, transactional with budget check |
| Check order | Velocity -> Budget -> Reserve | Cheapest check first, no reservation if velocity denied |
| Default limits | None (opt-in) | Don't surprise existing users. Recommend during onboarding. |
| Clock handling | `Date.now()` with non-monotonic defense | Adequate for DO sequential processing |

### 3.4 Risk Priority Matrix

| Risk | Likelihood | Impact | Mitigation Complexity | Priority |
|------|-----------|--------|----------------------|----------|
| False positives (orchestration bursts) | HIGH | HIGH | MEDIUM (burst allowance) | P0 |
| DO eviction losing velocity state | HIGH | HIGH | LOW (use SQLite) | P0 |
| False negatives (slow-burn loops) | MEDIUM | MEDIUM | MEDIUM (multi-window) | P1 |
| Webhook storm | MEDIUM | LOW | LOW (cooldown) | P1 |
| Key rotation evasion | LOW | HIGH | LOW (user-level velocity) | P1 |
| Clock skew | LOW | LOW | LOW (defensive coding) | P2 |
| Config errors (too-low limits) | MEDIUM | LOW | MEDIUM (dashboard UX) | P2 |
| Date.now() frozen during sync | LOW | NONE | NONE (non-issue, see 2.4) | N/A |
