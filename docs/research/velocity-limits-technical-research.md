# Velocity Limits: Technical Research for NullSpend DO Implementation

**Date:** 2026-03-19
**Scope:** Infrastructure documentation, competitive platform patterns, and open-source implementations relevant to building velocity/loop detection inside NullSpend's Cloudflare Durable Object with SQLite storage.

---

## Section 1: Cloudflare Platform Constraints & Capabilities

### 1.1 Durable Object Limits (Authoritative)

| Resource | Free Plan | Paid Plan |
|----------|-----------|-----------|
| SQLite storage per DO | 5 GB (account total) | 10 GB per object |
| Key+value combined | 2 MB max | 2 MB max |
| Max columns per table | 100 | 100 |
| String/BLOB/row size | 2 MB | 2 MB |
| SQL statement length | 100 KB | 100 KB |
| Bound parameters per query | 100 | 100 |
| Table rows | Unlimited (within storage) | Unlimited (within storage) |
| CPU per invocation (default) | 30s | 30s (configurable up to 5 min) |
| Memory per isolate | 128 MB | 128 MB |
| Request throughput (soft limit) | 1,000 req/s per object | 1,000 req/s per object |
| DO classes per account | 100 | 500 |
| DOs per namespace | Unlimited | Unlimited |
| Alarm handler wall time | 15 min max | 15 min max |
| Subrequests per invocation | 50 external / 1,000 CF services | 10,000 default (up to 10M configurable) |

**Sources:** [DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/), [Subrequests Changelog Feb 2026](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)

**Key implications for velocity limits:**
- 10 GB storage is vastly more than needed. A velocity_state table with millions of rows would still be well under 1 GB.
- 128 MB memory limit means the in-memory `Map<string, BudgetRow>` cache in UserBudgetDO must stay small. Velocity state should be read from SQLite on demand, not cached in a growing Map.
- 1,000 req/s soft limit is relevant because a user under a coordinated burst might approach this. But for NullSpend's use case (proxy traffic), traffic is distributed across per-user DOs, so no single DO should approach this.
- 100 bound parameters per query could constrain bulk velocity lookups, but velocity checks are per-entity (2-3 entities max), so this is not an issue.

### 1.2 SQLite-Backed DO Storage API Details

**`transactionSync()` behavior:**
- Wraps synchronous operations in a single atomic transaction
- Callback must be fully synchronous -- no async, no Promises
- Automatic rollback if callback throws
- Only available with SQLite-backed DOs
- Intended for use with `ctx.storage.sql.exec()`
- All SQL within the callback sees the same `Date.now()` value (clock frozen during sync execution)

**`sql.exec()` behavior:**
- Returns `SqlStorageCursor` (iterable)
- Supports FTS5 (full-text search), JSON extension, math functions
- Multiple semicolon-separated statements allowed; bindings apply only to the last statement
- Cannot execute `BEGIN TRANSACTION` or `SAVEPOINT` (managed by `transactionSync`)
- Numeric values subject to JavaScript 52-bit precision (use INTEGER for microdollars, not REAL)

**Cursor properties for billing:**
- `rowsRead`: tracked for billing (reads cost money after Jan 2026)
- `rowsWritten`: tracked for billing (writes cost money, index updates count as additional writes)

**Write coalescing:** Multiple `put()`/`delete()` calls without intervening `await` are batched atomically. Within `transactionSync()`, all SQL operations are a single atomic batch by definition.

**Write durability:** Changes forwarded to 5 follower machines, confirmed when 3+ respond. Batched up to 10 seconds or 16 MB.

**Performance characteristics:** SQLite runs in the same thread as DO compute -- "zero-latency" for reads. Writes are synchronous and durable before response returns. No network round-trip for storage operations.

**Source:** [SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

### 1.3 Alarm API Constraints

- One alarm per DO at a time
- Millisecond granularity; usually fires within a few ms of set time (can be delayed up to 1 minute under maintenance)
- Alarms with time <= `Date.now()` trigger asynchronously immediately
- `deleteAlarm()` does NOT cancel an already-executing alarm handler
- Alarms have guaranteed at-least-once execution with exponential backoff (2s initial, up to 6 retries)
- Alarm handler must be **idempotent** (may fire multiple times)
- Only schedule alarms when work exists; avoid gratuitous wake-ups
- Constructor runs before alarm handler if the alarm wakes a hibernated DO

**Implication for velocity:** Alarms can be used for velocity window cleanup (pruning old entries), webhook cooldown expiry, or circuit breaker recovery. The existing UserBudgetDO already uses alarms for reservation expiry -- velocity cleanup can piggyback on the same alarm scheduling logic.

**Source:** [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

### 1.4 DO Concurrency Model (Rules of Durable Objects)

**Single-threaded execution:** Only one piece of synchronous JavaScript executes at any time. Requests queue and execute sequentially.

**Input gates:** Block incoming events during storage operations, preventing race conditions. Open during non-storage I/O (`fetch()`).

**Output gates:** Hold outgoing responses until pending storage writes complete. Clients never see confirmation of unpersisted data.

**Anti-patterns to avoid:**
- Global singleton bottleneck: "A single Durable Object handling all traffic becomes a bottleneck. Never use one instance as a global rate limiter." NullSpend already avoids this by keying DOs by userId.
- `blockConcurrencyWhile()` across external I/O: Blocks ALL concurrency, reducing throughput to ~200 req/s if each call takes ~5ms. Reserve for initialization only (already the pattern in UserBudgetDO).

**Natural sharding:** ~500-1,000 req/s for simple operations per DO. NullSpend's per-user DO partitioning means each user gets their own throughput budget.

**Source:** [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)

### 1.5 Cloudflare Workers Rate Limiting API (Built-in)

Cloudflare offers a native rate limiting binding:

```jsonc
// wrangler.jsonc
{
  "rate_limits": [{
    "name": "MY_RATE_LIMITER",
    "namespace_id": "1001",
    "simple": { "limit": 100, "period": 60 }
  }]
}
```

**API:** `const { success } = await env.MY_RATE_LIMITER.limit({ key: userId })`

**Characteristics:**
- Period limited to 10 or 60 seconds only
- Counters cached on same machine as Worker, updated asynchronously
- "Permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system"
- Per-location counters (not globally consistent)
- No `checkLimit` (only `limit` which also counts)
- Requires Wrangler 4.36.0+

**Why this is NOT suitable for NullSpend velocity limits:**
1. Only 10s or 60s periods -- too rigid for configurable windows
2. Eventually consistent -- not suitable for budget enforcement which requires strong consistency
3. No cost-based limiting -- only request count
4. No per-entity configuration -- hardcoded in wrangler config
5. Cannot combine with budget check in a single atomic transaction
6. The DO already provides the single-threaded consistency model needed for accurate velocity tracking

**Source:** [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

### 1.6 Workers `waitUntil` Constraints

- Extends Worker lifetime for up to **30 seconds** after response sent
- All `waitUntil()` Promises share the 30s budget
- Cancelled Promises logged as warnings
- For guaranteed completion, use Cloudflare Queues instead

**Implication:** Velocity webhook dispatch should use `waitUntil` (small, fast) but reconciliation already uses Queues for reliability. This is consistent with the existing architecture.

**Source:** [Context (ctx)](https://developers.cloudflare.com/workers/runtime-apis/context/)

---

## Section 2: Competitive & Platform Pattern Analysis

### 2.1 AgentBudget (agentbudget.dev)

| Dimension | Details |
|-----------|---------|
| **Detection algorithm** | Fixed window: count identical calls within `loop_window_seconds` (default 60s) |
| **Detection unit** | Identical function calls (same function name, not content hash) |
| **Enforcement** | Circuit break: raises `LoopDetected` exception, halts session |
| **Configuration** | `max_repeated_calls=10`, `loop_window_seconds=60.0`, `on_loop_detected` callback |
| **Recovery** | Manual (session terminated, new session required) |
| **Architecture** | In-process Python library. No infrastructure. Patches SDK clients. |
| **Scope** | Per-session only. No cross-session or per-user aggregation. |

**Three-tier protection model:**
1. Soft limit (90% budget): `on_soft_limit` callback for graceful shutdown
2. Hard limit (100% budget): `BudgetExhausted` exception
3. Loop detection: `on_loop_detected` callback (independent of spend)

**Nested budgets:** Parent sessions can spawn child sessions with sub-budgets. Costs roll up.

**Limitation:** Client-side only. Cannot detect patterns across multiple agents or sessions. Agent code must use the SDK wrapper.

**Source:** [AgentBudget GitHub](https://github.com/sahiljagtap08/agentbudget)

### 2.2 TrueFoundry Agent Gateway

| Dimension | Details |
|-----------|---------|
| **Detection algorithm** | Spending velocity monitoring: rate-of-change of cost over time |
| **Detection signal** | Normal: $1.00 / 10 min. Anomaly: $1.00 / 10 sec (100x velocity spike) |
| **Enforcement** | Circuit breaker: session frozen, human admin alerted |
| **Configuration** | Per-team, per-user, per-model, per-application, per-environment |
| **Recovery** | Manual (human admin must unfreeze) |
| **Architecture** | Gateway proxy (server-side). Conceptual framework only -- no public implementation. |

**Unique concepts:**
- **Per-request micro-budgets:** Manager Agent "pays" Worker Agent from its own wallet. Creates economic reasoning incentive.
- **East-West chargebacks:** Cross-department cost attribution via ledger (debit Marketing, credit Engineering).
- **Shadow FinOps (predictive):** Pre-flight regression model estimates cost before execution. Rejects requests predicted to exceed user's budget.
- **402 Payment Required:** Agents receive HTTP 402 when budget depletes, forcing graceful degradation.

**Limitation:** Published as a blog series (conceptual), not as working code or API documentation. No verifiable implementation details.

**Source:** [TrueFoundry FinOps Blog](https://www.truefoundry.com/blog/agent-gateway-series-part-4-of-7-finops-for-autonomous-systems)

### 2.3 Portkey AI Gateway

| Dimension | Details |
|-----------|---------|
| **Detection algorithm** | No velocity detection. Simple threshold-based budget limits. |
| **Budget model** | USD cap per virtual key (expires key when reached). Token cap per key. |
| **Time model** | No time period -- budget applies until exhausted (lifetime budget). |
| **Enforcement** | Key expiry (blocks all subsequent requests) |
| **Configuration** | Per virtual key. Enterprise plan only for budget limits. |
| **Recovery** | Create new virtual key with new budget |

**Key characteristic:** Virtual keys abstract provider API keys. Budget enforcement happens at the virtual key level, not the user level. No sliding window or velocity concept.

**Limitation:** Budget counter starts from zero only after budget limit is set (no retroactive tracking). No velocity or rate-based controls.

**Source:** [Portkey Budget Limits](https://portkey.ai/docs/product/ai-gateway/virtual-keys/budget-limits)

### 2.4 LiteLLM Proxy

| Dimension | Details |
|-----------|---------|
| **Detection algorithm** | Fixed window: RPM (requests per minute) and TPM (tokens per minute) counters |
| **Budget model** | `max_budget` with configurable duration ("30s", "30m", "30h", "30d"), resets at end of period |
| **Enforcement** | Request rejection (429) when RPM/TPM exceeded. Key soft-delete when budget exceeded. |
| **Configuration** | Per-key, per-team, per-user, per-model deployment. Priority-based quota reservation. |
| **Recovery** | Automatic (budget resets at period end, RPM/TPM resets each minute) |
| **Architecture** | Redis-backed counters synced every 10ms across instances |

**Implementation details:**
- Uses `async_increment` instead of `async_set_cache` for counter updates
- In-memory cache synced with Redis every 10ms to avoid calling Redis per request
- 2x faster than previous implementation
- Drift at most 10 requests at 100 RPS across 3 instances
- Deployment-level cooldown: `allowed_fails=3`, configurable `cooldown_time` in seconds
- Priority-based quota reservation (v1.77.3+): reserve TPM/RPM capacity for production keys

**Token counting modes:** `token_rate_limit_type` can be set to count total tokens, input only, or output only.

**Source:** [LiteLLM Rate Limits](https://docs.litellm.ai/docs/proxy/users), [LiteLLM Config Settings](https://docs.litellm.ai/docs/proxy/config_settings)

### 2.5 Stripe Issuing Velocity Controls

| Dimension | Details |
|-----------|---------|
| **Detection algorithm** | Fixed window counters per interval type |
| **Intervals** | `per_authorization`, `daily`, `weekly`, `monthly`, `yearly`, `all_time` |
| **Enforcement** | Authorization decline before real-time auth webhook fires |
| **Configuration** | Per-card and per-cardholder. `spending_limits: [{amount, interval, categories}]` |
| **Recovery** | Automatic (window resets at interval boundary, midnight UTC for daily) |
| **Defaults** | 500 USD/day per new card, 10,000 USD/authorization (unconfigurable) |

**Critical implementation details:**
- Spending controls run BEFORE real-time authorizations (declined requests never reach the authorization webhook)
- "Best-effort" aggregation with up to 30-second delay between spend occurrence and aggregation
- Most restrictive control wins when overlapping limits exist
- Card limits persist across replacement card chain
- Supports both amount limits AND merchant category restrictions

**Source:** [Stripe Spending Controls](https://docs.stripe.com/issuing/controls/spending-controls)

### 2.6 Marqeta Velocity Controls

| Dimension | Details |
|-----------|---------|
| **Detection algorithm** | Fixed window counters with two dimensions |
| **Dimensions** | `amount_limit` (max dollars per window) AND `usage_limit` (max transaction count per window) |
| **Windows** | `DAY`, `WEEK`, `MONTH`, `LIFETIME`, `TRANSACTION` |
| **Scope** | Card product, card group, or individual card |
| **Enforcement** | Authorization decline |
| **Recovery** | Automatic at window boundary |
| **Max controls per program** | 90 (velocity + authorization controls combined) |
| **Toggle** | Active/inactive without deletion |

**JIT Funding model:** Cards maintain $0 balance. Funds loaded in real-time during authorization. Velocity rules layered on top of JIT checks. Gateway JIT allows the platform's own system to participate in authorization decisions.

**Source:** [Marqeta Velocity Controls](https://www.marqeta.com/docs/core-api/velocity-controls), [Marqeta Controlling Spending](https://www.marqeta.com/docs/developer-guides/controlling-spending)

### 2.7 Cloudflare Rate Limiting (WAF Product)

| Dimension | Details |
|-----------|---------|
| **Detection algorithm** | Approximate sliding window counter |
| **Formula** | `rate = prev_window_count * (overlap_fraction) + current_window_count` |
| **Windows** | 1, 2, 5 (default), or 10 minutes |
| **Enforcement** | Block or throttle (leaky bucket behavior for throttling) |
| **Update frequency** | Sliding window updated every 30 seconds |
| **Accuracy** | 0.003% error rate across 400M requests, average 6% difference between real and approximate rate |
| **Aggregation** | Composite keys (IP, cookie, header, query string, HTTP method) |

**Throttling behavior:** Selectively drops requests to maintain rate within threshold. Leaky bucket behavior: "throttling to 20 req/min means checking the last 60 seconds to see if (on average) fewer than 20 requests were received."

**Source:** [Cloudflare Counting Things](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/), [Rate Limiting Throttling](https://blog.cloudflare.com/new-rate-limiting-analytics-and-throttling/)

### 2.8 AWS WAF Rate-Based Rules

| Dimension | Details |
|-----------|---------|
| **Detection algorithm** | Sliding window with recency-weighted estimation |
| **Default window** | 5 minutes, updated every 30 seconds |
| **Available windows** | 1, 2, 5 (default), 10 minutes |
| **Enforcement** | Block, count, CAPTCHA, or challenge |
| **Aggregation** | IP-based with optional composite keys (headers, cookies, query, URI path) |
| **Accuracy** | "Gives more importance to more recent requests" -- applies rate limiting near the limit but does not guarantee exact match |

**Source:** [AWS WAF Rate-Based Rules](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html)

### 2.9 Circuit Breaker Pattern Comparison

#### Resilience4j (Java, de facto standard)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `failureRateThreshold` | 50% | Failure rate at which circuit opens |
| `slidingWindowType` | COUNT_BASED | COUNT_BASED or TIME_BASED |
| `slidingWindowSize` | 10 | Number of calls (count) or seconds (time) |
| `minimumNumberOfCalls` | 10 | Minimum calls before calculating failure rate |
| `waitDurationInOpenState` | 60s | Time circuit stays open before half-open |
| `permittedNumberOfCallsInHalfOpenState` | 10 | Test calls allowed in half-open |

**State machine:** CLOSED -> OPEN (threshold breached) -> HALF_OPEN (after wait duration) -> CLOSED (test calls succeed) or OPEN (test calls fail)

**RingBitSet:** Uses bit-level storage for success (0) / failure (1) tracking. Extremely memory-efficient.

**Source:** [Resilience4j CircuitBreaker](https://resilience4j.readme.io/docs/circuitbreaker)

#### Opossum (Node.js)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `timeout` | 3000ms | Time before function considered failed |
| `errorThresholdPercentage` | 50% | Failure percentage to trip circuit |
| `resetTimeout` | 30000ms | Time before attempting half-open |
| `rollingCountTimeout` | 10000ms | Statistics window duration |
| `rollingCountBuckets` | 10 | Number of buckets in rolling window |

**Source:** [Opossum GitHub](https://github.com/nodeshift/opossum)

#### Polly (.NET)

Two variants:
- **Basic:** `exceptionsAllowedBeforeBreaking` (consecutive failures) + `durationOfBreak`
- **Advanced:** `failureThreshold` (percentage) + `samplingDuration` + `minimumThroughput` + `durationOfBreak`

Half-open allows ONE test request per `durationOfBreak`. All others rejected with `BrokenCircuitException`.

**Source:** [Polly Circuit Breaker Wiki](https://github.com/App-vNext/Polly/wiki/Circuit-Breaker)

---

## Section 3: Rate Limiting Algorithms Deep Dive

### 3.1 Algorithm Comparison Matrix

| Algorithm | Memory | Accuracy | Burst Handling | Implementation Complexity |
|-----------|--------|----------|---------------|--------------------------|
| Fixed Window | O(1) per key | Low (boundary problem) | Poor (2x burst at boundary) | Trivial |
| Sliding Window Log | O(N) per key (N=requests) | Exact | Good | Low |
| Sliding Window Counter | O(1) per key | ~99.97% (0.003% error) | Good | Low |
| Token Bucket | O(1) per key | Exact | Excellent (configurable burst) | Medium |
| Leaky Bucket | O(1) per key | Exact | None (smooths all traffic) | Medium |
| EWMA (Exponential) | O(1) per key | Adaptive | Good (trend-aware) | Medium |

### 3.2 Fixed Window (Simplest)

```
window_id = floor(now / window_size)
count = increment(key:window_id)
if count > limit: DENY
```

**Boundary problem:** At the boundary between two windows, up to 2x the limit can pass (all requests at the end of window N + all at the start of window N+1).

**Mitigation for NullSpend:** Acceptable for v1 because budget limits are the hard backstop. Velocity limits are an early warning system, so the occasional 2x burst at window boundaries is tolerable.

### 3.3 Sliding Window Counter (Cloudflare's Approach)

```
prev_count = count from previous window
curr_count = count from current window
elapsed = now - current_window_start
weight = (window_size - elapsed) / window_size
estimated_count = prev_count * weight + curr_count
if estimated_count > limit: DENY
```

**Storage:** Two counters (prev_count, curr_count) + one timestamp (current_window_start) = 3 values per key.

**Implementation in SQLite:**
```sql
CREATE TABLE velocity_windows (
  entity_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  current_count INTEGER NOT NULL DEFAULT 0,
  current_spend INTEGER NOT NULL DEFAULT 0,
  prev_count INTEGER NOT NULL DEFAULT 0,
  prev_spend INTEGER NOT NULL DEFAULT 0
);
```

On each request:
```sql
-- If window has rolled over, shift current -> prev and reset
UPDATE velocity_windows SET
  prev_count = CASE WHEN ? >= window_start + ? THEN current_count ELSE prev_count END,
  prev_spend = CASE WHEN ? >= window_start + ? THEN current_spend ELSE prev_spend END,
  current_count = CASE WHEN ? >= window_start + ? THEN 1 ELSE current_count + 1 END,
  current_spend = CASE WHEN ? >= window_start + ? THEN ? ELSE current_spend + ? END,
  window_start = CASE WHEN ? >= window_start + ? THEN ? ELSE window_start END
WHERE entity_key = ?;
```

Then compute: `estimated = prev_count * weight + current_count`

**Why this is the recommended approach for NullSpend:**
1. O(1) memory per entity -- no growing log of timestamps
2. 99.97% accuracy (proven at Cloudflare scale)
3. Fits naturally in a single SQLite row per entity
4. Computation is trivial inside `transactionSync()`
5. Survives DO eviction (SQLite-backed)
6. No cleanup alarms needed (unlike sliding window log)

### 3.4 Token Bucket

```
tokens = min(max_tokens, tokens + (now - last_refill) * refill_rate)
last_refill = now
if tokens >= 1:
  tokens -= 1
  ALLOW
else:
  DENY
```

**Advantage over fixed/sliding window:** Explicitly configurable burst tolerance (`max_tokens` = bucket depth) independent of sustained rate (`refill_rate`).

**SQLite storage:** Same as sliding window counter -- one row per entity with `tokens REAL`, `last_refill INTEGER`.

**Why deferred to v2:** More parameters to configure (max_tokens + refill_rate vs. just limit + window). The sliding window counter is simpler for users to reason about ("100 requests per minute" vs. "refill 1.67 tokens per second with bucket depth 20").

### 3.5 EWMA for Trend Detection

```
ema = alpha * current_value + (1 - alpha) * previous_ema
```

**Cold start:** Initialize `ema = current_value` on first observation.

**Alpha selection:**
- alpha = 0.3: Recent 3-4 observations dominate. Good for detecting rapid changes.
- alpha = 0.1: Smoother, more history-sensitive. Better for establishing baselines.

**For NullSpend velocity:** EWMA could track average cost-per-request or inter-request interval. When the current observation deviates significantly from the EMA (e.g., cost suddenly 5x the average), flag as anomalous.

**Why deferred to v2:** Requires baseline establishment (first N requests). During cold start, no protection exists. Fixed thresholds are more predictable for v1.

---

## Section 4: Sliding Window Implementation in SQLite (DO-Specific)

### 4.1 Sliding Window Log Approach (Timestamp-Per-Request)

```sql
CREATE TABLE velocity_log (
  entity_key TEXT NOT NULL,
  ts INTEGER NOT NULL,
  cost_microdollars INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_velocity_log_entity_ts ON velocity_log(entity_key, ts);
```

**On each request:**
```sql
-- Prune old entries (outside window)
DELETE FROM velocity_log WHERE entity_key = ? AND ts < ?;

-- Count entries in window
SELECT COUNT(*) as req_count, COALESCE(SUM(cost_microdollars), 0) as total_spend
FROM velocity_log WHERE entity_key = ?;

-- Insert new entry
INSERT INTO velocity_log (entity_key, ts, cost_microdollars) VALUES (?, ?, ?);
```

**Pros:** Exact accuracy. Can compute any window size on the fly.
**Cons:** Storage grows with request rate. An agent making 100 req/min creates 100 rows/min per entity. Pruning is O(N) per request.

**Storage estimate:** At 100 req/min, 2 entities, 1-hour window: 100 * 2 * 60 = 12,000 rows. Each row ~50 bytes -> 600 KB. Acceptable but unnecessary given the counter approach.

### 4.2 Sliding Window Counter Approach (Recommended)

```sql
CREATE TABLE IF NOT EXISTS velocity_state (
  entity_key TEXT PRIMARY KEY,
  window_size_ms INTEGER NOT NULL,
  window_start_ms INTEGER NOT NULL,
  current_count INTEGER NOT NULL DEFAULT 0,
  current_spend_microdollars INTEGER NOT NULL DEFAULT 0,
  prev_count INTEGER NOT NULL DEFAULT 0,
  prev_spend_microdollars INTEGER NOT NULL DEFAULT 0,
  max_requests_per_window INTEGER,
  max_spend_per_window_microdollars INTEGER
);
```

**Complete check-and-increment in transactionSync:**

```typescript
// Inside transactionSync(), before budget check
const now = Date.now();

for (const row of budgetRows) {
  const entityKey = `${row.entity_type}:${row.entity_id}`;

  // Read velocity state
  const vs = this.ctx.storage.sql.exec<VelocityState>(
    "SELECT * FROM velocity_state WHERE entity_key = ?", entityKey
  ).toArray()[0];

  if (!vs) continue; // No velocity limit configured

  // Window rotation
  let windowStart = vs.window_start_ms;
  let prevCount = vs.prev_count;
  let prevSpend = vs.prev_spend_microdollars;
  let currCount = vs.current_count;
  let currSpend = vs.current_spend_microdollars;

  if (now >= windowStart + vs.window_size_ms) {
    // Current window expired, rotate
    prevCount = currCount;
    prevSpend = currSpend;
    currCount = 0;
    currSpend = 0;
    windowStart = now - (now % vs.window_size_ms); // Align to window boundary
  }

  // Sliding window estimation
  const elapsed = now - windowStart;
  const weight = Math.max(0, (vs.window_size_ms - elapsed) / vs.window_size_ms);
  const estimatedCount = prevCount * weight + currCount;
  const estimatedSpend = prevSpend * weight + currSpend;

  // Check thresholds
  if (vs.max_requests_per_window && estimatedCount >= vs.max_requests_per_window) {
    // DENY: velocity_exceeded (request count)
  }
  if (vs.max_spend_per_window_microdollars && estimatedSpend >= vs.max_spend_per_window_microdollars) {
    // DENY: velocity_exceeded (spend rate)
  }

  // Increment (count this request)
  this.ctx.storage.sql.exec(
    `UPDATE velocity_state SET
      window_start_ms = ?, prev_count = ?, prev_spend_microdollars = ?,
      current_count = ? + 1, current_spend_microdollars = ? + ?
    WHERE entity_key = ?`,
    windowStart, prevCount, prevSpend, currCount, currSpend, estimateMicrodollars, entityKey
  );
}
```

**Performance:** 1 read + 1 write per entity per request. With 2 entities (user + api_key), that's 4 SQLite operations. At sub-millisecond per operation (zero-latency in-thread), total overhead < 1ms.

### 4.3 Multi-Window Support (v1.1)

To catch both fast bursts and slow burns, multiple windows can be configured:

```sql
-- Same table, multiple rows per entity
INSERT INTO velocity_state VALUES ('user:u1_1min', 60000, ...);   -- 1-minute window
INSERT INTO velocity_state VALUES ('user:u1_1hour', 3600000, ...); -- 1-hour window
INSERT INTO velocity_state VALUES ('user:u1_1day', 86400000, ...); -- 1-day window
```

The check loop iterates all rows matching the entity prefix. Cost: 1 additional read per extra window (3 reads instead of 1 for 3 windows). Still sub-millisecond.

---

## Section 5: Upstash Redis Rate Limiting Patterns

### 5.1 @upstash/ratelimit Library

Three built-in algorithms:

**Fixed Window:**
```typescript
new Ratelimit({ limiter: Ratelimit.fixedWindow(10, "10 s") })
```
Simple counter per fixed time window. Resets at window boundary.

**Sliding Window:**
```typescript
new Ratelimit({ limiter: Ratelimit.slidingWindow(10, "10 s") })
```
Weighted approximation: `rate = prev_window_count * ((window_size - elapsed) / window_size) + current_count`

**Token Bucket:**
```typescript
new Ratelimit({ limiter: Ratelimit.tokenBucket(10, "1 s", 20) })
// 10 tokens refilled per second, max 20 tokens (burst capacity)
```

**Dynamic rate limits:** Rate limits can be changed at runtime without redeploying, built into the Lua scripts.

**Source:** [Upstash Ratelimit Algorithms](https://upstash.com/docs/redis/sdks/ratelimit-ts/algorithms), [Upstash Dynamic Rate Limits](https://upstash.com/blog/dynamic-rate-limits)

### 5.2 Redis Lua Script Pattern for Sliding Window

The canonical Redis sliding window uses sorted sets:

```lua
-- KEYS[1] = rate limit key
-- ARGV[1] = window start timestamp
-- ARGV[2] = current timestamp (score + member)
-- ARGV[3] = max requests

-- Remove entries outside window
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])

-- Count current entries
local count = redis.call('ZCARD', KEYS[1])

if count < tonumber(ARGV[3]) then
  -- Under limit: add this request
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[2])
  redis.call('EXPIRE', KEYS[1], window_seconds)
  return 1  -- allowed
else
  return 0  -- denied
end
```

**Atomicity:** Redis executes Lua scripts atomically. No interleaving between ZREMRANGEBYSCORE, ZCARD, and ZADD.

**NullSpend relevance:** NullSpend already uses Lua scripts for budget enforcement in Redis (the `checkAndReserve` Lua script). The DO-based velocity check replaces the need for a Redis-based velocity Lua script, but the algorithmic pattern (prune-count-add) is identical.

**Source:** [Redis Rate Limiting Tutorial](https://redis.io/tutorials/howtos/ratelimiting/), [Sliding Window Lua Gist](https://gist.github.com/atomaras/925a13f07c24df7f15dcc4fb7bc89c81)

### 5.3 NullSpend's Existing Redis Budget Lua Scripts

NullSpend already has Lua scripts for `checkAndReserve` and `reconcile` in the Redis path (now migrated to DO SQLite). The velocity implementation in the DO should follow the same atomic pattern but using `transactionSync()` instead of Lua scripts.

---

## Section 6: Open Source Implementations & Libraries

### 6.1 Rate Limiting Libraries for Cloudflare Workers

| Library | Approach | Storage | Link |
|---------|----------|---------|------|
| `worker-rate-limiter` | Fixed window via DOs | Durable Objects | [GitHub](https://github.com/Leon338/worker-rate-limiter) |
| `@hono-rate-limiter/cloudflare` | Middleware for Hono | Workers KV or DOs | [npm](https://www.npmjs.com/@hono-rate-limiter/cloudflare) |
| `worker-ratelimit` | General purpose | Workers KV | [GitHub](https://github.com/kpcyrd/worker-ratelimit) |
| `cloudflare-jwt-rate-limiter` | JWT claim-based | Durable Objects | [GitHub](https://github.com/tcarrio/cloudflare-jwt-rate-limiter) |
| OmniLimiterDO pattern | Singleton token bucket | Durable Objects (in-memory) | [Blog](https://shivekkhurana.com/blog/global-rate-limiter-durable-objects/) |

**OmniLimiterDO pattern** is most relevant: uses `idFromName("singleton")` for global coordination. NullSpend uses `idFromName(userId)` for per-user isolation -- correct for our use case.

### 6.2 SQLite-Only Rate Limiting

The `node-rate-limiter-flexible` library supports SQLite backend:

```sql
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0,
  expire INTEGER
);
```

Uses a trigger-based pattern for counter initialization and expiry. The trigger approach is interesting but unnecessary for NullSpend since the DO manages state programmatically.

**Source:** [node-rate-limiter-flexible SQLite Wiki](https://github.com/animir/node-rate-limiter-flexible/wiki/SQLite), [Summarity SQLite Rate Limit](https://summarity.com/sqlite-rate-limit)

### 6.3 AI Agent Circuit Breaker Libraries

| Library | Language | Focus | Link |
|---------|----------|-------|------|
| AgentCircuit | Python | Loop detection + auto-repair + budget | [GitHub](https://github.com/simranmultani197/AgentCircuit) |
| OmniRoute | TypeScript | Multi-provider AI gateway + circuit breaker | [GitHub](https://github.com/diegosouzapw/OmniRoute) |
| opossum | Node.js | General circuit breaker | [GitHub](https://github.com/nodeshift/opossum) |

**AgentCircuit** is the most directly relevant: "One decorator to make any AI agent reliable. Loop detection, auto-repair, output validation, budget control." But it's Python-only and client-side.

**OmniRoute** has per-model circuit breakers: "Closed/Open/Half-Open with configurable thresholds and cooldown, scoped per-model to avoid cascading blocks." This pattern could inform NullSpend's per-entity velocity limits.

### 6.4 Relevant Patterns from Financial Systems

**AstraOS** (AI Agent Operating System) implements:
- Model fallback with circuit breaker pattern (5 failures -> open, 30s half-open)
- Rolling health window
- Cost-aware routing
- Budget Manager: per-user/tenant/session token limits with usage alerts at 80%/90%/100%

**Tiny Dancer** (Recursive Model Router) implements:
- Circuit breaker tracks failure rates per category
- Opens after configurable threshold (5 failures in 60 seconds)
- Automatic reset after cooldown period

---

## Section 7: PostgreSQL Patterns for Velocity Analytics (Dashboard Side)

### 7.1 Sliding Window Velocity Query

For the dashboard to display velocity metrics (separate from real-time enforcement in the DO):

```sql
-- Spending velocity over rolling 1-hour windows
SELECT
  date_trunc('minute', created_at) AS minute,
  COUNT(*) AS request_count,
  SUM(total_cost) AS total_cost,
  SUM(total_cost) / NULLIF(
    EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))), 0
  ) AS cost_per_second
FROM cost_events
WHERE user_id = $1
  AND created_at >= NOW() - INTERVAL '1 hour'
GROUP BY date_trunc('minute', created_at)
ORDER BY minute DESC;
```

### 7.2 Velocity Anomaly Detection (Dashboard Background Job)

```sql
-- Compare recent velocity to historical baseline
WITH recent AS (
  SELECT COUNT(*) AS req_count,
         SUM(total_cost) AS total_spend
  FROM cost_events
  WHERE user_id = $1
    AND created_at >= NOW() - INTERVAL '5 minutes'
),
baseline AS (
  SELECT COUNT(*) / (24.0 * 12) AS avg_req_per_5min,  -- average over 24h
         SUM(total_cost) / (24.0 * 12) AS avg_spend_per_5min
  FROM cost_events
  WHERE user_id = $1
    AND created_at >= NOW() - INTERVAL '24 hours'
    AND created_at < NOW() - INTERVAL '5 minutes'
)
SELECT
  r.req_count,
  r.total_spend,
  b.avg_req_per_5min,
  b.avg_spend_per_5min,
  CASE
    WHEN b.avg_req_per_5min > 0
    THEN r.req_count / b.avg_req_per_5min
    ELSE NULL
  END AS request_velocity_ratio,
  CASE
    WHEN b.avg_spend_per_5min > 0
    THEN r.total_spend / b.avg_spend_per_5min
    ELSE NULL
  END AS spend_velocity_ratio
FROM recent r, baseline b;
```

A `velocity_ratio > 5.0` (5x normal) could trigger a dashboard alert or webhook.

### 7.3 Window Functions for Trend Detection

```sql
-- Detect acceleration (increasing velocity over consecutive windows)
SELECT
  window_start,
  request_count,
  total_spend,
  LAG(request_count) OVER (ORDER BY window_start) AS prev_count,
  request_count - LAG(request_count) OVER (ORDER BY window_start) AS count_delta,
  total_spend - LAG(total_spend) OVER (ORDER BY window_start) AS spend_delta
FROM (
  SELECT
    date_trunc('minute', created_at) AS window_start,
    COUNT(*) AS request_count,
    SUM(total_cost) AS total_spend
  FROM cost_events
  WHERE user_id = $1
    AND created_at >= NOW() - INTERVAL '10 minutes'
  GROUP BY date_trunc('minute', created_at)
) windowed
ORDER BY window_start;
```

**Source:** [PostgreSQL Window Functions](https://www.postgresql.org/docs/current/functions-window.html)

---

## Section 8: Anomaly Detection Algorithms

### 8.1 EWMA (Exponentially Weighted Moving Average)

**Formula:** `EMA_new = alpha * current_rate + (1 - alpha) * EMA_previous`

**Properties:**
- alpha = 0.3: Last 3-4 observations dominate (fast response)
- alpha = 0.1: Last ~10 observations dominate (smooth)
- Cold start: Initialize EMA = first observation
- Storage: 2 values per entity (ema_value, last_update_time)

**Implementation in DO SQLite:**
```sql
ALTER TABLE velocity_state ADD COLUMN ema_cost_rate REAL DEFAULT NULL;
ALTER TABLE velocity_state ADD COLUMN ema_last_update_ms INTEGER DEFAULT NULL;
```

```typescript
// On each request, after checking thresholds:
const alpha = 0.3;
const currentRate = estimateMicrodollars; // or cost_per_second
const newEma = vs.ema_cost_rate === null
  ? currentRate
  : alpha * currentRate + (1 - alpha) * vs.ema_cost_rate;

// Anomaly: current rate significantly exceeds EMA
if (currentRate > newEma * 5) {
  // Flag as potential anomaly
}
```

**Advantage:** Self-adapting. A user who normally spends $10/min won't trigger alerts at $12/min, but will at $50/min. No manual threshold configuration needed.

**Source:** [EWMA for Anomaly Detection](https://medium.com/@venugopal.adep/anomaly-detection-using-ema-exponential-moving-average-8a3d542f70cc)

### 8.2 CUSUM (Cumulative Sum Control Chart)

**Formula:**
```
S_n = max(0, S_{n-1} + (x_n - target) - allowance)
if S_n > threshold: ALERT
```

**Properties:**
- Detects sustained shifts (not single spikes)
- `target` = expected rate, `allowance` = acceptable deviation, `threshold` = trip point
- Storage: 1 value per entity (cumulative sum)
- Resets to 0 after alert

**Better than EWMA for:** Detecting slow-burn cost increases that are individually small but cumulatively significant.

### 8.3 Request Fingerprinting (Loop Signature)

**Approach:** Hash key fields of the request to detect repetition.

```typescript
// Fields to hash for loop detection
const fingerprint = await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(JSON.stringify({
    model: body.model,
    // Last message only (to detect same-prompt loops)
    lastMessage: body.messages?.[body.messages.length - 1]?.content?.slice(0, 200),
  }))
);
const hash = Array.from(new Uint8Array(fingerprint)).map(b => b.toString(16).padStart(2, '0')).join('');
```

**Storage:** Ring buffer of last N hashes in SQLite:
```sql
CREATE TABLE request_hashes (
  entity_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_hashes ON request_hashes(entity_key, hash);
```

**Detection:** `SELECT COUNT(*) FROM request_hashes WHERE entity_key = ? AND hash = ? AND ts > ?`

If count > threshold (e.g., same hash 5+ times in 60 seconds), flag as loop.

**Why deferred to v2:** Adds storage overhead (20 hashes * 64 chars = 1.3 KB per entity), requires request body access in the DO (currently only the proxy route handler sees the body), and the sliding window counter catches most loops via cost velocity alone.

---

## Section 9: Synthesis for NullSpend Implementation

### 9.1 Recommended Architecture

```
Request -> Worker (auth, body parse, cost estimate)
        -> DO.checkAndReserve(keyId, estimate)
           Phase 0: Velocity check (NEW)
             - Read velocity_state for matching entities
             - Sliding window counter estimation
             - DENY if threshold exceeded
           Phase 1: Query budgets (existing)
           Phase 1.5: Period resets (existing)
           Phase 2: Budget check (existing)
           Phase 3: Reserve (existing)
        -> Upstream API
        -> DO.reconcile(reservationId, actualCost)
           - Update velocity counters with actual cost (NEW)
```

### 9.2 Configuration Model

Velocity limits should be stored alongside budget configuration, either as:

**Option A: Columns on the budgets table (simplest)**
```sql
ALTER TABLE budgets ADD COLUMN velocity_max_requests INTEGER;
ALTER TABLE budgets ADD COLUMN velocity_max_spend_microdollars INTEGER;
ALTER TABLE budgets ADD COLUMN velocity_window_ms INTEGER DEFAULT 60000;
ALTER TABLE budgets ADD COLUMN velocity_policy TEXT DEFAULT 'block'; -- 'block' | 'warn'
```

**Option B: Separate velocity_limits table (more flexible)**
```sql
CREATE TABLE velocity_limits (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  window_ms INTEGER NOT NULL DEFAULT 60000,
  max_requests INTEGER,
  max_spend_microdollars INTEGER,
  policy TEXT NOT NULL DEFAULT 'block',
  PRIMARY KEY (entity_type, entity_id, window_ms)
);
```

**Recommendation:** Option B. It supports multiple windows per entity (1-min + 1-hour) and keeps the budgets table focused on budget enforcement. The velocity_limits table is populated via `populateIfEmpty`-style RPC from the dashboard.

### 9.3 Error Response Format

```json
{
  "error": {
    "code": "velocity_exceeded",
    "message": "Request rate exceeds velocity limit. 42 requests in the last 60 seconds (limit: 30).",
    "details": {
      "entity_type": "api_key",
      "entity_id": "key_abc123",
      "window_seconds": 60,
      "current_count": 42,
      "limit": 30,
      "retry_after_seconds": 18
    }
  }
}
```

HTTP status: 429 (same as budget_exceeded, distinguished by error code).

Headers:
```
Retry-After: 18
X-Velocity-Limit: 30
X-Velocity-Remaining: 0
X-Velocity-Reset: 1710864060
```

### 9.4 Competitive Differentiation Summary

| Capability | NullSpend (Planned) | AgentBudget | TrueFoundry | Portkey | LiteLLM | Stripe Issuing |
|------------|-------------------|-------------|-------------|---------|---------|----------------|
| Real-time enforcement | Yes (DO) | Yes (in-process) | Conceptual | Enterprise only | Yes (Redis) | Yes |
| Cost velocity detection | Yes | No (count only) | Yes (concept) | No | TPM only | Amount only |
| Request count velocity | Yes | Yes | Unknown | No | RPM | Usage limit |
| Multi-window | Yes (v1.1) | Single window | Unknown | No | Per-minute only | daily/weekly/monthly |
| Per-entity scoping | user + api_key | session only | multi-level | per-key | per-key/team/user | per-card/cardholder |
| Survives restart | Yes (SQLite) | No (in-process) | Unknown | N/A (server) | Yes (Redis) | Yes |
| No SDK required | Yes (proxy) | No (SDK wrap) | Yes (gateway) | Yes (gateway) | Yes (proxy) | N/A |
| Circuit breaker | v2 | Yes | Yes (concept) | No | Cooldown | No |
| Loop fingerprinting | v2 | Yes (call hash) | No | No | No | N/A |

**NullSpend's unique position:** The only solution that combines (a) proxy-layer enforcement (no SDK required), (b) cost-velocity detection (not just request count), (c) durable state that survives restarts, and (d) integration with per-entity budget enforcement. The Durable Object architecture provides strong consistency guarantees that Redis-based solutions (LiteLLM) and in-process solutions (AgentBudget) cannot match.

---

## Sources

### Cloudflare Documentation
- [DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [DO Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Zero-latency SQLite in DOs](https://blog.cloudflare.com/sqlite-in-durable-objects/)
- [Counting Things (Rate Limiting Architecture)](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/)
- [Rate Limiting Throttling](https://blog.cloudflare.com/new-rate-limiting-analytics-and-throttling/)
- [Subrequests Limit Changelog](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)
- [Workers Context (waitUntil)](https://developers.cloudflare.com/workers/runtime-apis/context/)
- [DO Alarms Blog](https://blog.cloudflare.com/durable-objects-alarms/)

### Competitive Platforms
- [AgentBudget](https://agentbudget.dev) / [GitHub](https://github.com/sahiljagtap08/agentbudget)
- [TrueFoundry Agent Gateway FinOps](https://www.truefoundry.com/blog/agent-gateway-series-part-4-of-7-finops-for-autonomous-systems)
- [Portkey Budget Limits](https://portkey.ai/docs/product/ai-gateway/virtual-keys/budget-limits)
- [LiteLLM Budgets & Rate Limits](https://docs.litellm.ai/docs/proxy/users)
- [LiteLLM Rate Limit Tiers](https://docs.litellm.ai/docs/proxy/rate_limit_tiers)
- [Stripe Issuing Spending Controls](https://docs.stripe.com/issuing/controls/spending-controls)
- [Stripe Velocity Checks](https://stripe.com/resources/more/what-is-a-velocity-check-in-payments-what-businesses-should-know)
- [Marqeta Velocity Controls](https://www.marqeta.com/docs/core-api/velocity-controls)
- [Marqeta Controlling Spending](https://www.marqeta.com/docs/developer-guides/controlling-spending)

### Rate Limiting & Algorithms
- [Upstash Ratelimit Algorithms](https://upstash.com/docs/redis/sdks/ratelimit-ts/algorithms)
- [Upstash Dynamic Rate Limits](https://upstash.com/blog/dynamic-rate-limits)
- [Upstash ratelimit-js](https://github.com/upstash/ratelimit-js)
- [Redis Rate Limiting Tutorial](https://redis.io/tutorials/howtos/ratelimiting/)
- [Redis Sliding Window Lua Gist](https://gist.github.com/atomaras/925a13f07c24df7f15dcc4fb7bc89c81)
- [Sliding Window Rate Limiter Design](https://arpitbhayani.me/blogs/sliding-window-ratelimiter/)
- [AWS WAF Rate-Based Rules](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html)
- [Visualizing Rate Limiting Algorithms](https://smudge.ai/blog/ratelimit-algorithms)

### Circuit Breaker Patterns
- [Resilience4j CircuitBreaker](https://resilience4j.readme.io/docs/circuitbreaker)
- [Opossum (Node.js)](https://github.com/nodeshift/opossum)
- [Polly Circuit Breaker Wiki](https://github.com/App-vNext/Polly/wiki/Circuit-Breaker)
- [Polly Docs](https://www.pollydocs.org/strategies/circuit-breaker.html)

### Open Source Implementations
- [worker-rate-limiter (DO-based)](https://github.com/Leon338/worker-rate-limiter)
- [hono-rate-limiter/cloudflare](https://www.npmjs.com/@hono-rate-limiter/cloudflare)
- [AgentCircuit](https://github.com/simranmultani197/AgentCircuit)
- [OmniRoute AI Gateway](https://github.com/diegosouzapw/OmniRoute)
- [node-rate-limiter-flexible SQLite](https://github.com/animir/node-rate-limiter-flexible/wiki/SQLite)
- [Summarity SQLite Rate Limit](https://summarity.com/sqlite-rate-limit)
- [Rate Limiting with DOs Blog](https://shivekkhurana.com/blog/global-rate-limiter-durable-objects/)
- [Ditching Redis for DOs](https://dev.to/horushe/why-i-ditched-redis-for-cloudflare-durable-objects-in-my-rate-limiter-jof)

### Anomaly Detection
- [EWMA Anomaly Detection](https://medium.com/@venugopal.adep/anomaly-detection-using-ema-exponential-moving-average-8a3d542f70cc)
- [PostgreSQL Window Functions](https://www.postgresql.org/docs/current/functions-window.html)
