# AgentSeam cost engine: competitor bug database and action plan

**Every bug documented below was found in a production tool used by thousands of developers. Each one is a test case for AgentSeam.**

---

## Part 1: The complete bug database

### Category A: Anthropic cache token calculation errors

These are the most common and most costly bugs in the ecosystem. They all stem from one root cause: Anthropic's `input_tokens` field means "uncached tokens only," which is the opposite of OpenAI's `prompt_tokens` which means "total including cached."

**Bug A1 — Langfuse #12306: Double-adding cache tokens via OTel normalization**

- **Source:** github.com/langfuse/langfuse/issues/12306 (filed ~February 2026, still open)
- **What happens:** The OTel semantic convention defines `gen_ai.usage.input_tokens` as total input. Frameworks like pydantic-ai correctly sum Anthropic's three fields (input_tokens + cache_creation + cache_read = total). Langfuse receives this already-normalized total, then adds cache counts on top again.
- **Impact:** 2× the real input token count, inflated costs.
- **Exact numbers from reporter:** Anthropic returned input_tokens=5, cache_read=128,955, cache_creation=1,253. OTel reported total input=130,213 (correct sum). Langfuse computed 130,213 + 128,955 + 1,253 = 260,421 (double).
- **Root cause:** Boundary confusion — Langfuse doesn't know whether its upstream has already normalized the fields. No source-of-truth flag distinguishes "raw Anthropic fields" from "OTel-normalized totals."
- **AgentSeam lesson:** Always parse from the raw provider response. Never accept pre-normalized token counts from any framework or OTel layer. The proxy reads directly from the API response, so this class of bug is structurally impossible.

**Bug A2 — LangChain.js #10249: Streaming double-count from cumulative message_delta**

- **Source:** github.com/langchain-ai/langchainjs/issues/10249 (filed ~March 2026)
- **What happens:** Anthropic streaming sends cache token counts in both `message_start` and the cumulative `message_delta`. LangChain's `mergeInputTokenDetails` function naively adds them: `output.cache_read = (a?.cache_read ?? 0) + (b?.cache_read ?? 0)`.
- **Impact:** Exactly double the real cache token counts.
- **Exact code:** In `libs/providers/langchain-anthropic/src/utils/message_outputs.ts`, the `message_delta` handler passes cumulative values into the chunk's `usage_metadata`. Then in `libs/langchain-core/src/messages/metadata.ts`, `mergeInputTokenDetails` sums them.
- **Root cause:** The Anthropic SDK type definitions explicitly document that `message_delta` values are cumulative (`"The cumulative number of input tokens read from the cache"`), but LangChain treats them as incremental deltas.
- **AgentSeam lesson:** The streaming parser must be a state machine. For Anthropic: capture input from `message_start` once. Overwrite (never sum) output from each `message_delta`. Only read final values after stream completes.

**Bug A3 — LiteLLM #5443: Missing cache costs entirely**

- **Source:** github.com/BerriAI/litellm (referenced in ecosystem analysis)
- **What happens:** LiteLLM only counted `input_tokens` for Anthropic, completely ignoring `cache_creation_input_tokens` and `cache_read_input_tokens`.
- **Impact:** Any request with caching was undercharged — sometimes dramatically, since cache creation tokens can be 10-100× the uncached input.
- **Root cause:** The developer likely assumed `input_tokens` was total (following OpenAI's convention) and didn't realize Anthropic uses different semantics.
- **AgentSeam lesson:** Mandatory test case — construct a response where cache tokens dominate and verify the cost reflects all three fields.

**Bug A4 — LiteLLM #6575 / #9812: Wrong cache write cost formula**

- **Source:** github.com/BerriAI/litellm/pull/6576, github.com/BerriAI/litellm/issues/9812
- **What happens:** LiteLLM calculated cache write cost as `base_input_cost + surcharge` instead of `cache_write_rate × tokens`. For #9812 specifically: a user reported LiteLLM charged $0.091311 while Anthropic's billing console showed $0.05439 — nearly double.
- **Impact:** Systematic overcharging on every request with cache creation.
- **Root cause:** The cost formula treated cache write as "base cost plus a premium" rather than using the independent cache write rate. The PR #6576 that fixed it was titled "Stopped double counting the tokens" and noted "There don't seem to be any tests of this function."
- **AgentSeam lesson:** Store cache write rates as independent values in the pricing database. Never derive them from the base rate at calculation time. And always test cost functions.

**Bug A5 — Cline #4346: Cumulative message_delta treated as incremental**

- **Source:** Referenced in ecosystem analysis
- **What happens:** Same root cause as Bug A2. Cline accumulated cache token values across multiple `message_delta` events instead of treating each as a cumulative snapshot.
- **Impact:** Cache tokens multiplied by the number of delta events received.
- **AgentSeam lesson:** Same fix as A2 — overwrite, never sum.

**Bug A6 — LiteLLM #19680 / #19681 / #11364: Ongoing cache cost calculation errors (January 2026)**

- **Source:** github.com/BerriAI/litellm/issues/19680, #19681, #11364
- **What happens:** As of January 2026, LiteLLM still has open bugs about incorrect cached token cost calculation. Issue #11364 ("Wrong cost for Anthropic models, cached tokens not being correctly considered") was filed January 21, 2026 and remains open. Issue #19680 documents that `total_prompt_tokens` calculation incorrectly charges for cached tokens.
- **Related issues:** #18728 (rate limiter incorrectly counts cached tokens toward TPM limits), #16341 (Gemini implicit cached tokens not counted in spend log).
- **Impact:** This is not a single bug but a persistent class of errors. The Anthropic cache token semantics continue to cause problems across multiple LiteLLM subsystems.
- **AgentSeam lesson:** This validates that the problem is genuinely hard and that competitors have not solved it even after multiple fix attempts. Getting this right is a real differentiator.

**Bug A7 — Langfuse #5568: OpenAI cached tokens accumulating across consecutive requests**

- **Source:** github.com/langfuse/langfuse/issues/5568 (February 2025)
- **What happens:** When using cached tokens in consecutive OpenAI generations, input tokens accumulated instead of subtracting cached tokens as expected.
- **Impact:** Overstated input token counts and inflated costs for OpenAI requests with caching.
- **AgentSeam lesson:** Even OpenAI's simpler cache model (subset semantics) can be mishandled. Test with consecutive cached requests, not just single requests.

### Category B: Budget enforcement bypass vulnerabilities

These are all from LiteLLM, the dominant open-source proxy. Each one represents a path where a request incurs cost without being checked against a budget.

**Bug B1 — LiteLLM #12977: AzureOpenAI client library bypasses all budgets**

- **Source:** github.com/BerriAI/litellm/issues/12977 (July 2025)
- **What happens:** The `openai.AzureOpenAI` client sends requests to Azure-formatted paths (`/openai/deployments/{model}/chat/completions?api-version=2023-05-15`). LiteLLM's budget enforcement uses route matching against a hardcoded list that doesn't include these paths.
- **Impact:** One user reported $764.78 spend against a $50 budget — a 15× overspend.
- **Root cause:** Budget enforcement tied to URL pattern matching rather than authentication identity.
- **AgentSeam lesson:** Budget enforcement must be identity-based, not route-based. Check the authenticated key/user before any routing. This is the #1 architectural principle.

**Bug B2 — LiteLLM #12905: Team membership nullifies user budgets**

- **Source:** github.com/BerriAI/litellm/issues/12905 (July 2025)
- **What happens:** In `auth_checks.py`, the budget check explicitly skips user budget enforcement when the key belongs to a team. A user with `max_budget: 10.0` and `spend: 15.0` passes the check if their key is team-associated.
- **Exact code:** `if (user_object is not None and user_object.max_budget is not None and (team_object is None or team_object.team_id is None)):` — that last condition is the bug.
- **Impact:** Any user in a team has no individual budget enforcement.
- **Root cause:** Mutually exclusive entity hierarchy — checking only one entity level at a time.
- **AgentSeam lesson:** Check ALL applicable entities independently. Enforce the most restrictive budget. Never short-circuit.

**Bug B3 — LiteLLM #11083: End-user budgets never enforced**

- **Source:** github.com/BerriAI/litellm/issues/11083 (May 2025)
- **What happens:** When a budget is set for an end-user identified by the `user` field, LiteLLM's auth middleware never populates `max_budget` for that end-user. The fix PR (#9658) was closed without merge.
- **Impact:** End-users can spend without limit regardless of budget configuration. The reporter noted: "This can result in incurring massive, unexpected costs."
- **Root cause:** End-user identity is decoupled from key identity, and budget enforcement only runs for the primary auth entity.
- **AgentSeam lesson:** Every entity type that can have a budget must be checked on every request. No exceptions, no "we'll add that later."

**Bug B4 — LiteLLM #10750 / #13882: Pass-through routes skip budget middleware**

- **Source:** github.com/BerriAI/litellm/issues/10750 (May 2025), #13882
- **What happens:** Pass-through routes (`/bedrock`, `/anthropic`, `/vertex-ai`) use a different code path that bypasses the middleware stack entirely. PR #15805 partially fixed this with wildcard route matching, but coverage remains uncertain.
- **Impact:** Any request using pass-through routes incurs cost with zero budget enforcement.
- **Root cause:** Route-based enforcement with hardcoded lists that don't cover all paths.
- **AgentSeam lesson:** There should be no code path to a paid provider that doesn't go through budget enforcement. The proxy architecture should make this impossible by design — budget check happens before the upstream fetch, always.

**Bug B5 — LiteLLM PR #9329: Budget reset cron job silently fails**

- **Source:** Referenced in ecosystem analysis
- **What happens:** The cron job that resets budgets failed due to `isinstance(result, LiteLLM_TeamTable)` not matching Prisma's `prisma.LiteLLM_TeamTable`. Budgets were never actually reset.
- **Impact:** Users who thought their budgets reset monthly were actually accumulating spend forever. Once they hit the limit, they were permanently blocked.
- **AgentSeam lesson:** Budget resets must be atomic and verifiable. AgentSeam's Redis Lua approach (where reset is a single atomic operation) eliminates this class of bug.

**Bug B6 — LiteLLM #14266: Race condition in budget reset**

- **Source:** github.com/BerriAI/litellm/issues/14266 (September 2025)
- **What happens:** `budget_reset_at` timestamp updates but `spend` doesn't zero for random keys. The operation is non-atomic.
- **Impact:** Random keys accumulate spend across reset periods. Users resort to manual SQL scripts as workarounds.
- **Root cause:** Non-atomic budget reset — timestamp and spend are updated in separate operations.
- **AgentSeam lesson:** All budget state mutations (check, reserve, update, reset) must be atomic. Redis Lua scripts give you this for free.

**Bug B7 — LiteLLM #14004: Budget blocks all models including free ones**

- **Source:** Referenced in ecosystem analysis
- **What happens:** When a budget is exceeded, LiteLLM blocks ALL models including zero-cost on-premises models. The budget check runs before model cost evaluation.
- **Impact:** Exceeding your cloud LLM budget also blocks access to your own self-hosted models.
- **Root cause:** Budget check is order-dependent — it runs before the system knows whether the request will cost anything.
- **AgentSeam lesson:** For V1 with only paid providers (OpenAI, Anthropic), this isn't an issue. But when adding support for custom/local models, the cost evaluation must happen before or alongside the budget check, not after.

**Bug B8 — LiteLLM #20324: Soft budget alerts never fire for virtual keys**

- **Source:** Referenced in ecosystem analysis
- **What happens:** `LiteLLM_BudgetTable` is loaded for end-users and teams but not for `LiteLLM_VerificationToken` (virtual keys). Soft budget alerts are effectively broken for the most common entity type.
- **Impact:** Users who configured soft alerts (warn at 80%) never receive them.
- **AgentSeam lesson:** Every budget feature must work for every entity type from day one. Don't ship a feature for one entity and assume it'll work for others.

### Category C: Spend tracking and logging failures

**Bug C1 — LiteLLM #10598: Spend tracking always reports zero**

- **Source:** github.com/BerriAI/litellm/issues/10598 (May 2025)
- **What happens:** A user with a properly configured Docker + Postgres + Redis setup running both OpenAI and Ollama models gets zero spend on every request. Models show correct pricing in the model hub, but spend calculation produces nothing.
- **Impact:** Complete failure of the core value proposition.
- **Root cause:** Unclear from the issue — likely a configuration or initialization bug specific to certain Docker setups.
- **AgentSeam lesson:** The "zero spend" failure mode should be specifically tested for. If the cost engine can't calculate cost for a request, it should log a warning, not silently report zero.

**Bug C2 — LiteLLM PR #10167: Shared mutable state corrupts spend tracking**

- **Source:** github.com/BerriAI/litellm/pull/10167
- **What happens:** When a user calls the `/responses` endpoint and then `/chat/completions`, cost/spend for the second call is not recorded. The `/responses` handler mutates a shared `default_litellm_params` dict, renaming the metadata key. All subsequent calls see the wrong key name.
- **Impact:** Intermittent spend tracking failures that depend on request ordering — extremely hard to debug.
- **Root cause:** Mutable shared state modified in place instead of copied.
- **AgentSeam lesson:** Cloudflare Workers V8 isolates give you natural isolation per request. Each request gets its own memory space, destroyed on completion. This class of shared-state bug is structurally impossible.

**Bug C3 — LiteLLM #20179: WebSearch callback breaks spend tracking**

- **Source:** github.com/BerriAI/litellm/issues/20179 (January 2026)
- **What happens:** When the `websearch_interception` callback is enabled, spend tracking fails silently for any request that includes a tool named "WebSearch." Request completes successfully (200 response), but `x-litellm-response-cost-original: 0.0` and no entry in `LiteLLM_SpendLogs`.
- **Impact:** Tool-using agent requests silently drop cost tracking. The user gets a working response but no cost record.
- **Root cause:** The callback modifies the request pipeline in a way that breaks the cost tracking callback.
- **AgentSeam lesson:** Cost tracking must be the last thing in the pipeline, operating on the final response. It should never be skippable by other middleware or callbacks.

**Bug C4 — LiteLLM #12892: Every request creates a new spend table entry**

- **Source:** github.com/BerriAI/litellm/issues/12892 (July 2025)
- **What happens:** Every incoming request creates a new entry in the daily spend table, bypassing the unique constraint on `[user_id, date, api_key, model, custom_llm_provider, mcp_namespaced_tool_name]`.
- **Impact:** Spend table grows without bound, breaking the usage dashboard.
- **Root cause:** Likely a race condition or constraint violation handling issue.
- **AgentSeam lesson:** Use append-only `cost_events` table (one row per request) rather than trying to aggregate into daily spend rows. Aggregation happens at query time, not write time. Simpler, no race conditions.

**Bug C5 — Langfuse #7767: Failed/refused requests still charged**

- **Source:** github.com/orgs/langfuse/discussions/7767
- **What happens:** A request to Anthropic that's rejected (too many tokens) costs $0 according to Anthropic's billing, but Langfuse assigns a cost of $1.24+ because it infers cost from input parameters rather than checking the response status.
- **Impact:** Phantom costs from failed requests inflate the user's cost view.
- **Root cause:** Cost inference runs regardless of response status.
- **AgentSeam lesson:** Always check the response status before calculating cost. If the provider returned an error (4xx, 5xx), the cost is zero. Only calculate cost from successful responses that include a `usage` object.

**Bug C6 — Langfuse: Reasoning model costs can't be inferred without token counts**

- **Source:** Langfuse documentation on cost tracking
- **What happens:** Langfuse cannot infer costs for reasoning models (o1, o3, o4-mini) unless explicit token usage is provided. Reasoning tokens are hidden and invisible in the response content, so tokenization-based inference doesn't work.
- **Impact:** Missing cost data for the most expensive model family.
- **AgentSeam lesson:** For reasoning models, always extract `reasoning_tokens` from the `completion_tokens_details` object. Never try to infer output costs from visible response text — the hidden reasoning tokens can be 10× the visible output.

### Category D: Performance and scalability issues

**Bug D1 — LiteLLM: Python GIL bottleneck at high concurrency**

- **Source:** dev.to comparison article (January 2026)
- **What happens:** At 500 RPS, P99 latency hits 28 seconds. At 1,000 RPS, LiteLLM crashes — out of memory, cascading request failures. Memory usage climbs to 8GB+.
- **Impact:** LiteLLM is unusable for high-traffic production workloads.
- **Root cause:** Python's Global Interpreter Lock (GIL) and async overhead become bottlenecks at scale.
- **AgentSeam lesson:** Cloudflare Workers on V8 isolates don't have this problem. Each request is handled in its own lightweight isolate. The <1ms cold start and sub-5ms overhead per request means AgentSeam can handle thousands of RPS without degradation.

**Bug D2 — Portkey: 20-40ms latency overhead**

- **Source:** Multiple comparison articles, TrueFoundry analysis
- **What happens:** Portkey adds 20-40ms to every request.
- **Impact:** For latency-sensitive applications, this is meaningful. For comparison, Bifrost (Go-based) claims 11μs and Helicone (Rust-based) claims 8ms P50.
- **AgentSeam lesson:** CF Workers should add <5ms. Benchmark this early and make it a marketing number. "Sub-5ms overhead" is a concrete claim competitors can't match (Portkey) or can (but they don't enforce budgets).

**Bug D3 — LiteLLM #19781: Can't reset budget to unlimited**

- **Source:** github.com/BerriAI/litellm/issues/19781 (January 2026)
- **What happens:** Users who've been assigned a budget cannot be set back to unlimited. The API returns a float parsing error when receiving an empty string for `max_budget`.
- **Impact:** Admin workflow broken — can't remove budgets once set.
- **Root cause:** Frontend sends empty string, backend expects float or null, Pydantic validation rejects it.
- **AgentSeam lesson:** Budget CRUD must handle the full lifecycle: create, update, reset, and remove. Zod validation should accept `null` to mean "no budget."

---

## Part 2: Five architectural anti-patterns to avoid

Distilled from every bug above:

**Anti-pattern 1: Route-based budget enforcement.**
LiteLLM's budget check is tied to URL pattern matching against a hardcoded list. New route formats (Azure paths, pass-through endpoints) bypass it entirely. **AgentSeam's rule:** Budget enforcement is identity-based. It's tied to the authenticated API key, checked before any routing or proxying happens. There is exactly one code path from request to upstream provider, and the budget check is on it.

**Anti-pattern 2: Mutually exclusive entity hierarchy.**
LiteLLM checks only one entity (key OR user OR team) and uses conditional logic that can skip levels. **AgentSeam's rule (V1):** Check key budget. That's it — V1 only has key-level budgets. When team/org budgets are added later, check ALL levels and enforce the most restrictive.

**Anti-pattern 3: Post-hoc cost tracking without pre-request reservation.**
LiteLLM tracks costs after the response but checks stale spend values before requests. Concurrent requests can all pass budget checks simultaneously, each seeing the pre-concurrent spend value. **AgentSeam's rule:** Atomic check-and-reserve with Redis Lua scripts. Before the request, reserve the estimated max cost. After the response, reconcile with the actual cost and release the surplus. Concurrent requests see the reserved amount and enforce correctly.

**Anti-pattern 4: Accepting pre-normalized token counts.**
Langfuse's double-counting bug exists because it received already-normalized values from OTel but didn't know whether normalization had occurred. **AgentSeam's rule:** Parse from raw provider responses only. The proxy reads the API response directly — no intermediate framework, no OTel translation layer, no ambiguity about field semantics.

**Anti-pattern 5: Non-atomic budget operations.**
LiteLLM's budget resets, spend updates, and cron jobs are separate non-atomic operations that race with each other. **AgentSeam's rule:** All budget state lives in Redis. All mutations happen via Lua scripts that execute atomically. Postgres stores the durable ledger (cost_events), but real-time enforcement state is exclusively in Redis.

---

## Part 3: The test suite — build this before writing any cost engine code

### OpenAI cost calculation tests

```
Test O1: Standard request, no caching
  Input: prompt_tokens=100, completion_tokens=50, GPT-4o pricing
  Expected: (100 × $2.50/MTok) + (50 × $10.00/MTok) = $0.00075
  Validates: Basic formula works

Test O2: Cached tokens (subset semantics)
  Input: prompt_tokens=1000, cached_tokens=800, completion_tokens=50, GPT-5 pricing
  Expected: (200 × $1.25/MTok) + (800 × $0.125/MTok) + (50 × $10.00/MTok) = $0.00085
  Validates: cached_tokens subtracted from prompt_tokens, not added

Test O3: Reasoning tokens (subset semantics)
  Input: prompt_tokens=100, completion_tokens=500, reasoning_tokens=450, o3 pricing
  Expected: (100 × $2.00/MTok) + (500 × $8.00/MTok) = $0.0042
  Validates: reasoning_tokens NOT added on top — already included in completion_tokens

Test O4: GPT-4o cache discount (50%, not 90%)
  Input: prompt_tokens=1000, cached_tokens=800, GPT-4o pricing
  Expected: cached rate is $1.25/MTok (50% of $2.50), not $0.25 (90% of $2.50)
  Validates: Per-model cache discount rates are used, not a universal discount

Test O5: Azure null fields
  Input: prompt_tokens=100, prompt_tokens_details=null, completion_tokens=50
  Expected: Treat null detail fields as zero, calculate normally
  Validates: Defensive parsing of Azure-specific null vs 0 behavior

Test O6: Streaming — usage from final chunk only
  Input: Stream of 10 SSE chunks, only the last has a usage object
  Expected: Usage extracted once from final chunk, cost calculated once
  Validates: No accumulation across chunks

Test O7: Missing stream_options injection
  Input: Request body with stream=true but no stream_options
  Expected: Proxy injects stream_options.include_usage=true before forwarding
  Validates: Usage data will be present in streaming responses
```

### Anthropic cost calculation tests

```
Test A1: Three disjoint fields summed correctly
  Input: input_tokens=5, cache_creation=12304, cache_read=0, output_tokens=550
  Expected: Sonnet 4.6: (5 × $3.00/MTok) + (12304 × $3.75/MTok) + (550 × $15.00/MTok) = $0.054390
  Validates: All three input fields contribute to cost independently
  Cross-reference: Matches Anthropic billing console (LiteLLM #9812 reported $0.091311 — nearly double)

Test A2: Langfuse #12306 regression — no double-add
  Input: input_tokens=5, cache_creation=1253, cache_read=128955
  Expected total input tokens: 5 + 1253 + 128955 = 130213
  NOT: 130213 + 128955 + 1253 = 260421
  Validates: Fields are summed once, not double-counted

Test A3: LangChain #10249 regression — streaming no double-count
  Input: Streaming response where message_start has cache_read=128955
         and message_delta also has cache_read=128955 (cumulative)
  Expected: Final cache_read = 128955 (not 257910)
  Validates: message_delta overwrites, doesn't accumulate

Test A4: LiteLLM #5443 regression — cache costs included
  Input: input_tokens=100, cache_creation=2000, cache_read=500, output_tokens=200
  Expected cost includes all four components, not just input_tokens × base_rate
  Validates: Cache read and write costs are never omitted

Test A5: LiteLLM #6575 regression — correct cache write formula
  Input: cache_creation=10000, Sonnet 4.6 pricing
  Expected: 10000 × $3.75/MTok = $0.0375
  NOT: 10000 × ($3.00 + $0.75)/MTok or any additive formula
  Validates: Cache write rate is an independent value, not base + surcharge

Test A6: Cline #4346 regression — cumulative delta not incremental
  Input: Stream with 5 message_delta events, each showing cache_read=1000 (cumulative)
  Expected: Final cache_read = 1000 (the last cumulative value)
  NOT: 5000 (5 × 1000)
  Validates: Overwrite semantics on message_delta

Test A7: 5-minute vs 1-hour cache TTL rates
  Input: ephemeral_5m_input_tokens=456, ephemeral_1h_input_tokens=100, Sonnet 4.6
  Expected: (456 × $3.75/MTok) + (100 × $6.00/MTok)
  Validates: Different TTLs use different rates

Test A8: Extended thinking tokens
  Input: output_tokens=2000 (includes thinking blocks), Opus 4.6
  Expected: 2000 × $25.00/MTok = $0.05
  Validates: Thinking tokens are already in output_tokens — no special handling needed

Test A9: Long context rate doubling (>200K input)
  Input: input_tokens=250000, Sonnet 4.6
  Expected: 250000 × ($3.00 × 2)/MTok = $1.50
  Validates: Long context triggers rate doubling

Test A10: Failed/error responses cost zero
  Input: Anthropic returns 400 error, no usage object
  Expected: cost = 0, no cost_event logged
  Validates: Don't infer cost from failed requests (Langfuse #7767 regression)
```

### Budget enforcement tests

```
Test B1: Concurrent requests can't exceed budget
  Setup: Budget = $1.00, 10 concurrent requests each estimating $0.15
  Expected: At most 7 requests proceed (7 × $0.15 = $1.05 with one overshoot), remaining blocked
  Validates: Atomic check-and-reserve prevents the thundering herd problem

Test B2: Budget exhausted returns 429
  Setup: Budget = $0.50, spend = $0.49, incoming request estimates $0.10
  Expected: HTTP 429 with body: { remaining: 0.01, estimated: 0.10, reason: "budget_exceeded" }
  Validates: Clear error response with actionable information

Test B3: Reservation TTL expiry
  Setup: Reserve $0.10 for a request, then simulate the request failing (no response)
  Expected: After reservation TTL (e.g., 120s), the $0.10 is released back to available budget
  Validates: Failed requests don't permanently consume budget

Test B4: Budget reset
  Setup: Budget = $10/day, spend = $8.50, trigger reset
  Expected: Spend goes to $0.00 atomically, next request proceeds
  Validates: Atomic reset (LiteLLM #14266 regression — no race condition)

Test B5: No budget = no enforcement
  Setup: API key with no budget configured
  Expected: All requests pass through, cost still tracked in cost_events
  Validates: Budget enforcement is opt-in, observability is always-on

Test B6: Identity-based, not route-based
  Setup: Same API key, requests to /v1/chat/completions AND /v1/messages
  Expected: Both routes check the same budget for the same key
  Validates: LiteLLM #12977 regression — no route bypass

Test B7: Post-response reconciliation
  Setup: Reserve $0.50 (estimated max), actual cost is $0.12
  Expected: Budget releases $0.38 surplus, spend updated to actual cost
  Validates: Reservations don't permanently over-allocate
```

### Microdollar precision tests

```
Test M1: No floating point drift
  Setup: 10,000 sequential cost calculations, each $0.000001
  Expected: Total = exactly $0.01 (10,000 microdollars)
  Validates: Integer arithmetic prevents cumulative float errors

Test M2: Large cost values
  Setup: 1,000,000 tokens × $10.00/MTok
  Expected: $10.00 = 10,000,000 microdollars (fits in JS Number)
  Validates: No overflow for realistic workloads

Test M3: Sub-cent costs display correctly
  Setup: cost_microdollars = 3 (= $0.000003)
  Expected: Display as "$0.000003", not "$0.00" or "$0"
  Validates: UI shows meaningful precision for small costs
```

---

## Part 4: Implementation action plan

### Phase 1 priority: Get OpenAI cost calculation bulletproof

1. Create `packages/cost-engine/` with provider-specific parsers
2. Write tests O1-O7 first (TDD)
3. Implement `parseOpenAIUsage()` — returns normalized `CostBreakdown`
4. Implement `OpenAIStreamParser` state machine
5. Implement `microCost()` helper with integer-only arithmetic
6. Import LiteLLM's pricing JSON as seed data
7. Write `getModelPricing(provider, model)` lookup function

### Phase 2 priority: Get budget enforcement airtight

1. Write tests B1-B7 first
2. Implement Redis Lua script for atomic check-and-reserve
3. Implement post-response reconciliation
4. Implement budget CRUD API
5. Verify concurrent request behavior under load

### Phase 3 priority: Get Anthropic cost calculation perfect

1. Write tests A1-A10 first — every one derived from a real bug
2. Implement `parseAnthropicUsage()` — completely separate from OpenAI parser
3. Implement `AnthropicStreamParser` state machine (overwrite, never sum)
4. Handle 5-min vs 1-hour TTL cache rates
5. Handle long context rate doubling
6. Cross-reference results against Anthropic's billing console

### Ongoing: Use competitor bugs as your regression suite

Every new bug filed against LiteLLM, Langfuse, LangChain, or Portkey related to cost calculation should become a test case in AgentSeam. Subscribe to these repos' issues. The ecosystem is doing your QA for free.
