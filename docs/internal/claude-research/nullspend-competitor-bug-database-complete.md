# NullSpend competitor bug database: every documented weakness, with test cases

**Purpose:** Catalog every known bug, complaint, and failure mode across competitor platforms. For each, derive a test case that proves NullSpend handles it correctly. This document is both competitive intelligence and a QA specification.

**Last updated:** March 9, 2026

---

## 1. LiteLLM — Budget enforcement failures

LiteLLM is the primary competitive target. As of March 2026, it has 800+ open GitHub issues, with budget enforcement bugs forming a pattern rooted in architectural decisions, not implementation typos.

### Bug 1.1: AzureOpenAI client bypasses all budgets ($764 on $50 budget)

**Source:** GitHub #12977 (July 2025, still architecturally unfixed)

**What happens:** The AzureOpenAI client library sends requests to `/openai/deployments/{model}/chat/completions?api-version=...` instead of `/v1/chat/completions`. LiteLLM's budget middleware uses route matching against a hardcoded list (`LiteLLMRoutes.llm_api_routes.value`). Azure-formatted routes aren't in the list, so budget checking is completely skipped. A user documented $764.78 in spend against a $50 budget — a 15× overspend.

**Root cause:** Budget enforcement tied to URL pattern matching rather than authentication identity.

**NullSpend test case:**
```
TEST: Budget enforcement is identity-based, not route-based
GIVEN: A budget of $50 set for API key "sk-test"
WHEN: Request arrives at any valid endpoint (/v1/chat/completions, /v1/messages, any future path)
THEN: Budget is checked against the authenticated identity, regardless of URL path
VERIFY: Budget check runs before any routing decision
```

### Bug 1.2: End-user budgets never enforced

**Source:** GitHub #11083 (May 2025, community PRs closed without merge)

**What happens:** When a budget is set for an end-user identified by the `user` field, LiteLLM's `UserAPIKeyAuth` never populates `max_budget` from `LiteLLM_BudgetTable` for that user. The auth middleware authenticates the key but treats end-user budget checking as a secondary step that was never wired. A community fix (PR #9658) was closed without being merged.

**Root cause:** End-user identity decoupled from key identity; budget enforcement only runs for the primary auth entity.

**NullSpend test case:**
```
TEST: All budget entities are checked independently
GIVEN: API key "sk-test" has a $100 budget, user "user-123" has a $10 budget
WHEN: Request arrives with both key and user identifiers
THEN: Both budgets are checked; the most restrictive limit applies
VERIFY: User "user-123" is blocked at $10 even though the key has $90 remaining
```

### Bug 1.3: Team membership nullifies user budgets

**Source:** GitHub #12905 (July 2025)

**What happens:** In `auth_checks.py`, the budget check explicitly skips user enforcement when the key belongs to a team: `if (team_object is None or team_object.team_id is None)`. A user with `max_budget: 10.0` and `spend: 15.0` passes the check if their key is team-associated.

**Root cause:** Mutually exclusive entity hierarchy — checks only one entity instead of all applicable entities.

**NullSpend test case:**
```
TEST: Budget hierarchy enforces most restrictive across all entities
GIVEN: User budget = $10, team budget = $100, key budget = $50
WHEN: User spend reaches $10
THEN: Request is blocked (user limit hit, even though team and key have headroom)
VERIFY: No entity association bypasses any other entity's budget
```

### Bug 1.4: Bedrock/Anthropic passthrough routes skip budget middleware

**Source:** GitHub #13882 (partially fixed by PR #15805, Oct 2025)

**What happens:** Passthrough routes (`/bedrock`, `/anthropic`, `/vertex-ai`) use a different code path that bypasses the middleware stack. PR #15805 switched to wildcard route matching, but coverage of all passthrough paths remains uncertain.

**Root cause:** Budget enforcement tied to route matching; new routes can bypass it.

**NullSpend test case:**
```
TEST: Budget enforcement applies to all provider routes
GIVEN: Budget of $20 for API key "sk-test"
WHEN: Requests arrive via /v1/chat/completions, /v1/messages, and any future provider path
THEN: All paths enforce the same budget
VERIFY: No path exists that reaches a paid provider without budget checking
```

### Bug 1.5: Budget reset race condition

**Source:** GitHub #14266

**What happens:** During budget reset, `budget_reset_at` timestamp updates but `spend` doesn't zero for random keys. The reset operation is non-atomic.

**Root cause:** Non-atomic budget state transitions.

**NullSpend test case:**
```
TEST: Budget reset is atomic
GIVEN: Budget with spend = $45 and reset_at approaching
WHEN: Reset triggers while concurrent requests are in-flight
THEN: Spend resets to $0 atomically; no request sees a partially-reset state
VERIFY: Lua script performs reset as single atomic operation
```

### Bug 1.6: Budget precedence confusion with JWT tokens

**Source:** GitHub #14097 (Aug 2025)

**What happens:** When using JWT tokens, the precedence hierarchy becomes: key limits → team limits → (user and customer limits ignored). Customer budgets are completely ignored when JWT tokens are used. Multiple organizations reported this creates "shadow bypasses" where individual protection is lost.

**Root cause:** Budget check ordering creates implicit priority that drops checks silently.

**NullSpend test case:**
```
TEST: All applicable budget entities are checked regardless of auth method
GIVEN: User, team, and org all have budgets
WHEN: Auth via any method (API key, JWT, etc.)
THEN: All entity budgets are evaluated; most restrictive wins
```

### Bug 1.7: Cannot reset budget to unlimited

**Source:** GitHub #19781 (Jan 2026)

**What happens:** Once a user has been assigned a numeric budget, attempting to set it back to unlimited fails with a `float_parsing` error. The API rejects empty string values for `max_budget`.

**NullSpend test case:**
```
TEST: Budget can be created, modified, and removed cleanly
GIVEN: User with budget = $50
WHEN: Admin deletes the budget
THEN: User has no budget constraint (unlimited)
VERIFY: Budget removal doesn't leave orphaned state in Redis
```

---

## 2. LiteLLM — Cost calculation failures

These bugs directly affect the accuracy of spend tracking, which in turn affects budget enforcement (you can't enforce a budget if you don't know the actual cost).

### Bug 2.1: Cached tokens charged at full price (10.9× overcharge)

**Source:** GitHub #19680 (Jan 2026), #11364 (Jan 2026, still open)

**What happens:** LiteLLM charges all prompt tokens at the base input rate, ignoring that cached tokens should be charged at the discounted cache-read rate. With 91% cache hit rates (common with prompt caching), the overcharge is 10.9× — $5.09 charged vs $0.46 actual. Affects z.ai, Anthropic, and OpenAI cached requests.

**Root cause:** `generic_cost_per_token` doesn't subtract cached tokens before applying the base input rate.

**NullSpend test case:**
```
TEST: OpenAI cached tokens billed at cached rate, not base rate
GIVEN: 8,477,162 prompt tokens, 7,715,693 cached, 10,699 output
MODEL: gpt-4o ($2.50/MTok input, $1.25/MTok cached, $10/MTok output)
THEN: cost = (761,469 × 2.50) + (7,715,693 × 1.25) + (10,699 × 10.00)
     = 1,903,673 + 9,644,616 + 106,990 = 11,655,279 microdollars
VERIFY: NOT 8,477,162 × 2.50 + 10,699 × 10.00 (the LiteLLM bug)
```

### Bug 2.2: Anthropic cache write tokens double-counted

**Source:** GitHub #6575 (Oct 2024), #9812 (April 2025)

**What happens:** When cache_creation_input_tokens are reported, LiteLLM counts them once as "prompt tokens" (at base rate) and again as "cache creation tokens" (at 1.25× rate). Actual cost was $0.054 but LiteLLM reported $0.091 — nearly double.

**Root cause:** Cache write tokens charged at base rate PLUS cache write premium instead of only cache write rate.

**NullSpend test case:**
```
TEST: Anthropic cache write tokens charged at write rate only, not double-counted
GIVEN: input_tokens=3, cache_creation_input_tokens=12304, output_tokens=550
MODEL: claude-sonnet-4-6 ($3/MTok input, $3.75/MTok cache write, $15/MTok output)
THEN: cost = (3 × 3.00) + (12304 × 3.75) + (550 × 15.00)
     = 9 + 46,140 + 8,250 = 54,399 microdollars (~$0.054)
VERIFY: NOT (12304 × 3.00) + (12304 × 3.75) + (550 × 15.00) (~$0.091, the LiteLLM bug)
```

### Bug 2.3: Anthropic streaming + caching costs wrong (7× overcharge)

**Source:** GitHub #11789 (June 2025)

**What happens:** When streaming is enabled with Anthropic passthrough, cache read tokens are counted as regular input tokens. LiteLLM reported $0.002059 for a response that actually cost $0.000292 — roughly 7× overcharge.

**NullSpend test case:**
```
TEST: Streaming and non-streaming produce identical cost calculations
GIVEN: Identical Anthropic request with cache_read_input_tokens=2438
WHEN: Proxied in streaming mode vs non-streaming mode
THEN: Both produce the same cost within 1 microdollar
```

### Bug 2.4: Anthropic prompt caching costs omitted entirely

**Source:** GitHub #5443 (Aug 2024)

**What happens:** LiteLLM only counted non-cached tokens and applied the standard input rate. Cache read and cache write costs were entirely missing from the calculation.

**NullSpend test case:**
```
TEST: All token categories produce non-zero costs when tokens > 0
GIVEN: Any request with cache_read_input_tokens > 0 or cache_creation_input_tokens > 0
THEN: Cost includes components for cache read and/or cache write
VERIFY: Cache read cost > 0 when cache_read_input_tokens > 0
VERIFY: Cache write cost > 0 when cache_creation_input_tokens > 0
```

### Bug 2.5: OpenAI Flex tier priced wrong (2× actual cost)

**Source:** GitHub #13810 (Aug 2025)

**What happens:** When using OpenAI's Flex service tier (service_tier="flex"), pricing is approximately half the standard rate. LiteLLM doesn't account for this and charges standard rates, resulting in 2× overcharge. User confirmed LiteLLM cost was double OpenAI's actual billing.

**NullSpend test case (future, when we add Flex support):**
```
TEST: Service tier pricing applied correctly
GIVEN: Request with service_tier="flex" to gpt-5-nano
THEN: Cost calculated at flex rates (approx 50% of standard)
VERIFY: Reported cost matches OpenAI billing within 5%
```

### Bug 2.6: Gemini tiered pricing wrong

**Source:** GitHub #11495 (June 2025)

**What happens:** Gemini models have tiered pricing (different rates for ≤200K vs >200K tokens). LiteLLM applies input token pricing tiers to output tokens, calculating the wrong rate.

**NullSpend test case (future, when we add Gemini):**
```
TEST: Gemini tiered pricing applies correct tier to each token type
GIVEN: 250K input tokens, 10K output tokens on gemini-2.5-pro
THEN: Input cost uses >200K tier for tokens above 200K
AND: Output cost uses correct output tier (independent of input tier)
```

### Bug 2.7: Image tokens treated as text tokens (12× undercharge)

**Source:** GitHub #14819, #17410 (Sept/Dec 2025)

**What happens:** For multimodal models generating images, LiteLLM treats image output tokens as text output tokens. Image tokens are 12× more expensive than text tokens. This causes massive undercharging for image generation.

**NullSpend test case (future consideration):**
```
TEST: Multimodal token types charged at correct rates
GIVEN: completion_tokens_details.image_tokens = 1290
THEN: Image tokens charged at image output rate, not text output rate
```

### Bug 2.8: xAI cached token double-counting

**Source:** GitHub #14874 (Sept 2025)

**What happens:** xAI returns `prompt_tokens_details.text_tokens` as total prompt tokens (including cached) instead of non-cached only. LiteLLM's generic handler treats this as non-cached tokens, then also adds cached tokens — double-counting.

**NullSpend test case:**
```
TEST: Provider-specific token semantics handled correctly
GIVEN: Provider returns cached tokens as subset of total (OpenAI style)
OR: Provider returns uncached tokens only (Anthropic style)
THEN: Cost engine applies correct formula for each provider
VERIFY: No provider combination produces double-counted tokens
```

### Bug 2.9: Roo Code + Bedrock cost mismatch ($26 reported vs $770 actual)

**Source:** GitHub #8514 (Feb 2025)

**What happens:** LiteLLM reported $26.74 for Claude 3.5 Sonnet V2 on Bedrock for the month, while AWS showed $770 — a 29× undercount. The issue appears when Roo Code sends requests that cause token count discrepancies.

**NullSpend test case:**
```
TEST: Cost calculation uses usage from actual API response, not estimates
GIVEN: Any proxy request
THEN: Cost is calculated from the response's usage object, not input estimation
VERIFY: Over 100 sequential requests, sum of per-request costs matches expected total within 1%
```

---

## 3. LiteLLM — Performance and stability failures

### Bug 3.1: Performance degradation at 300 RPS

**Source:** DEV.to article (Jan 2026), GitHub #13541

**What happens:** LiteLLM broke at 300 RPS in production, with some requests experiencing 6-minute latency. Python's GIL, combined with synchronous database logging, creates a throughput ceiling.

**NullSpend advantage:** CF Workers architecture has no GIL, no process-level concurrency limits, and async log processing via `waitUntil()`. Cost logging never blocks the response stream.

### Bug 3.2: Performance degradation over time (memory leak)

**Source:** GitHub #6345 (Oct 2024), multiple DEV.to articles

**What happens:** LiteLLM gradually slows down over time, requiring periodic service restarts. Teams report needing worker recycling after 10,000 requests to manage memory leaks. A September 2025 release caused OOM errors on Kubernetes.

**NullSpend advantage:** CF Workers are stateless V8 isolates — no memory leaks possible across requests.

### Bug 3.3: Database bottleneck at 1M logs

**Source:** GitHub #12067, TrueFoundry review (Feb 2026)

**What happens:** Performance degrades significantly once PostgreSQL accumulates over 1M request logs. At 100K requests/day, this threshold is hit in 10 days. LiteLLM docs acknowledge this.

**NullSpend advantage:** Cost events use Postgres for the append-only ledger but analytics will move to ClickHouse. The proxy itself (CF Workers) has no database in the hot path for cost logging — it uses `waitUntil()` for async writes.

### Bug 3.4: 3+ second cold start in serverless

**Source:** Reddit discussion referenced in DEV.to (Jan 2026)

**What happens:** LiteLLM's import time exceeds 3 seconds, creating noticeable latency on serverless cold starts.

**NullSpend advantage:** CF Workers cold start is <5ms.

---

## 4. Langfuse — Cost tracking failures

### Bug 4.1: Anthropic cache tokens double-counted via OTel

**Source:** GitHub #12306 (Feb 2026, still open)

**What happens:** When using pydantic-ai with Anthropic, Langfuse shows ~2× the real input token count. The OTel spec defines `gen_ai.usage.input_tokens` as the total (cached + uncached). Langfuse then adds cache_read and cache_write on top: `usage.input = input_tokens + cache_read + cache_write = 260,421` (double the actual 130,213). The pydantic-ai team confirmed this is a Langfuse bug, not theirs.

**NullSpend test case:**
```
TEST: Anthropic input_tokens semantics handled correctly
GIVEN: Anthropic returns input_tokens=5 (uncached only), cache_read=128955, cache_write=1253
THEN: Total input = 5 + 128955 + 1253 = 130,213 tokens
AND: Cost = (5 × base_rate) + (128955 × cache_read_rate) + (1253 × cache_write_rate)
VERIFY: Total is NOT 130213 + 128955 + 1253 = 260,421 (the Langfuse bug)
```

### Bug 4.2: Failed requests charged as if they succeeded

**Source:** GitHub #7767, #8775 (2025)

**What happens:** When Anthropic rejects a request (prompt too long), the provider charges $0. But Langfuse infers and assigns a cost based on the input parameters. Users report seeing "hundreds of dollars" for single failed traces that cost nothing. Manually deleting these traces is the only workaround.

**NullSpend test case:**
```
TEST: Failed/rejected requests produce zero cost
GIVEN: Upstream returns 4xx or 5xx error
THEN: No cost event is logged (or cost is explicitly $0)
VERIFY: Only successful responses with usage data produce cost events
```

### Bug 4.3: TypeScript SDK doesn't auto-count Anthropic tokens

**Source:** GitHub Discussion #8038 (July 2025)

**What happens:** Despite docs claiming automatic token counting, the TypeScript SDK doesn't capture Anthropic token usage when creating spans manually. Users must manually map Anthropic's field names to Langfuse's schema.

**NullSpend advantage:** Proxy intercepts the response directly — no SDK-level token mapping needed. The SSE parser captures usage from the actual API response.

### Bug 4.4: No tiered pricing support

**Source:** GitHub #8499 (Aug 2025)

**What happens:** Anthropic and Gemini both have tiered pricing (e.g., different rates above 200K input tokens). Langfuse doesn't support this, meaning cost reports to leadership are inaccurate for long-context usage — the exact scenario where costs are highest and accuracy matters most.

**NullSpend test case (future):**
```
TEST: Long-context rate doubling applied for Anthropic >200K input
GIVEN: Anthropic request with 250K input tokens
THEN: First 200K charged at base rate, remaining 50K at 2× rate
```

### Bug 4.5: Self-hosted ClickHouse storage grows uncontrollably

**Source:** GitHub Discussion #7582, #5687

**What happens:** ClickHouse storage grows from 300MB to 800MB in 5 hours with zero traces. One user hit storage exhaustion in 1 day with no activity. The ZooKeeper + ClickHouse combination causes background storage inflation. A user with only 5 traces saw storage grow from 400MB to 1.2GB in 2 days.

**NullSpend advantage:** No ClickHouse requirement. Postgres for transactional data, with ClickHouse as an optional future analytics layer.

### Bug 4.6: ClickHouse versions above 25.5.2 cause exabyte memory allocation

**Source:** GitHub Discussion #10314 (Nov 2025)

**What happens:** Certain ClickHouse versions above 25.5.2 trigger extreme memory usage during deletions, sometimes attempting to allocate exabytes of memory. Langfuse recommends staying at 25.5.2 or below.

**NullSpend advantage:** No ClickHouse dependency.

---

## 5. LangChain — Streaming cost calculation failures

### Bug 5.1: Cache tokens double-counted in streaming

**Source:** GitHub langchainjs #10249 (March 2026, 1 week old)

**What happens:** In `@langchain/anthropic`, the `message_delta` handler passes cumulative cache token values as if they were incremental deltas. `mergeInputTokenDetails` then adds `message_start` and `message_delta` cache tokens together, producing exactly 2× the actual values. Cache_read + cache_creation exceeds input_tokens, which is mathematically impossible.

**NullSpend test case:**
```
TEST: Streaming Anthropic message_delta values treated as cumulative, not incremental
GIVEN: message_start has cache_read=5000
AND: message_delta has cache_read=5000 (cumulative, same value)
THEN: Final cache_read = 5000 (use only the last value)
VERIFY: NOT 10000 (the LangChain bug of summing start + delta)
```

---

## 6. Cline — Same cumulative delta bug

### Bug 6.1: Streaming cumulative delta treated as incremental

**Source:** GitHub cline #4346

**What happens:** Same root cause as LangChain #10249. Cline treats `message_delta` usage values as incremental, doubling cache token counts.

**NullSpend test case:** Same as Bug 5.1 — tests derive from the same streaming semantics.

---

## 7. Portkey — Structural weaknesses

### Weakness 7.1: Budget enforcement only at Enterprise tier

**Source:** Portkey pricing page, TrueFoundry analysis (Feb 2026)

**What happens:** Budget enforcement with hard limits is gated to the Enterprise tier ($2K-$10K/month). Pro tier ($49/month) gets observability and rate limits, but no budget ceilings. The feature that would prevent a $47K disaster costs more than the disaster.

### Weakness 7.2: Log limits create blind spots

**Source:** TrueFoundry pricing guide, G2 reviews

**What happens:** When you exceed your log quota, the gateway keeps routing but stops recording. You lose cost visibility during high-traffic periods — exactly when you need it most. This means budget tracking stops during spikes, creating an enforcement gap.

**NullSpend test case:**
```
TEST: Cost tracking never stops regardless of volume
GIVEN: 10M requests in a month (well above any tier limit)
THEN: Every request produces a cost event
VERIFY: No request passes through the proxy without cost being calculated
```

### Weakness 7.3: SSRF vulnerability in custom host

**Source:** GitHub Security Advisory GHSA-hhh5-2cvx-vmfp (Dec 2025)

**What happens:** Server-Side Request Forgery vulnerability in custom host configuration. Rated as Moderate severity.

### Weakness 7.4: 30-day log retention on Pro

**Source:** Portkey docs, TrueFoundry analysis

**What happens:** Pro tier retains logs for only 30 days. Insufficient for HIPAA (6 years), SOX (7 years), or any regulated industry. Enterprise tier offers custom retention but at significant cost.

### Weakness 7.5: Models without pricing show $0 and bypass budgets

**Source:** Portkey docs on cost management

**What happens:** "If a specific request log shows 0 cents in the COST column, it means that Portkey does not currently track pricing for that model, and it will not count towards the provider's budget limit." Unknown models bypass budget enforcement entirely.

**NullSpend test case:**
```
TEST: Unknown models still count against budget (at estimated or zero cost)
GIVEN: Request for model "some-new-model-not-in-pricing-db"
THEN: Budget check still runs (using estimated cost or blocking if estimation fails)
VERIFY: No model can bypass budget enforcement by being unknown
```

### Weakness 7.6: G2 review complaints

**Source:** G2 reviews (2026)

Recurring themes: "a lot of bugs," "complexity for newcomers too high," "missing advanced analytics," "GUI documentation must be more flexible," "pricing are high for smaller teams," "documentation gaps in execution."

---

## 8. TrueFoundry — Pricing weakness

### Weakness 8.1: $499/month minimum for enforcement

**Source:** TrueFoundry pricing page

**What happens:** Technically the most complete competitor (enforcement + MCP + tool tracking). But $499/month Pro minimum excludes the long tail of developers and startups who represent 90%+ of the market.

---

## 9. Revenium — Adoption weakness

### Weakness 9.1: Enterprise-first, zero developer adoption

**Source:** Product positioning, website analysis

**What happens:** Tool Registry launched March 3, 2026 — less than a week old. No GitHub presence, no open source, no developer community. Language speaks to CFOs ("system of record," "economic boundaries"), not developers.

---

## 10. AgentCost — Architecture weakness

### Weakness 10.1: Budget enforcement gated to BSL enterprise tier

**Source:** GitHub agentcostin/agentcost

**What happens:** MIT community edition is observability-only. Budget enforcement requires the BSL 1.1 enterprise tier.

### Weakness 10.2: Monkey patching for framework interception

**Source:** Architecture analysis

**What happens:** Uses monkey patching to intercept LangChain, CrewAI, AutoGen internals. This breaks across framework version upgrades and misses non-framework LLM calls.

**NullSpend advantage:** Proxy interception works at the HTTP level — framework-agnostic, version-agnostic.

---

## Summary: Test case priority matrix

### P0 — Must pass before launch (OpenAI proxy + budget enforcement)

| # | Test | Derived from |
|---|------|-------------|
| 1 | Budget check is identity-based, not route-based | LiteLLM #12977 |
| 2 | All entity budgets checked independently (most restrictive wins) | LiteLLM #12905, #14097 |
| 3 | Concurrent requests cannot collectively exceed budget | LiteLLM architectural flaw |
| 4 | Budget reset is atomic | LiteLLM #14266 |
| 5 | OpenAI cached tokens billed at cached rate | LiteLLM #19680, #11364 |
| 6 | Reasoning tokens billed at output rate (no double-count) | LiteLLM pattern |
| 7 | Failed/error responses produce zero cost | Langfuse #7767, #8775 |
| 8 | Streaming and non-streaming produce identical costs | LiteLLM #11789 |
| 9 | Unknown models still enforce budget | Portkey docs |
| 10 | Cost tracking never stops regardless of volume | Portkey log limits |

### P1 — Must pass before Anthropic support (Phase 3)

| # | Test | Derived from |
|---|------|-------------|
| 11 | Anthropic input_tokens = uncached only (not total) | Langfuse #12306, LiteLLM #5443 |
| 12 | Cache write tokens charged at write rate, not double-counted | LiteLLM #6575, #9812 |
| 13 | Streaming message_delta values are cumulative, not incremental | LangChain #10249, Cline #4346 |
| 14 | Cache read + cache write + uncached = total (never exceeds) | LangChain #10249 invariant |
| 15 | 5-min vs 1-hour cache TTL multipliers applied correctly | Anthropic pricing docs |
| 16 | Streaming cache cost matches non-streaming | LiteLLM #11789 |

### P2 — Should pass post-launch (extended provider support)

| # | Test | Derived from |
|---|------|-------------|
| 17 | Gemini tiered pricing (≤200K vs >200K) | LiteLLM #11495 |
| 18 | Anthropic long-context rate doubling (>200K) | Langfuse #8499 |
| 19 | OpenAI Flex tier pricing | LiteLLM #13810 |
| 20 | Image output tokens at correct rate | LiteLLM #14819, #17410 |
| 21 | Provider-specific token semantics (xAI, Bedrock) | LiteLLM #14874, #8514 |

---

## Narrative ammunition: Quotable numbers

These are real, documented numbers from competitor bug reports that can be cited in blog posts, landing pages, and HN threads:

- **$764.78 on a $50 budget** — LiteLLM #12977 (AzureOpenAI bypass)
- **10.9× overcharge** — LiteLLM #19680 (cached tokens at full price)
- **$0.091 vs $0.054 actual** — LiteLLM #9812 (Anthropic cache write double-count)
- **7× overcharge on streaming** — LiteLLM #11789 (Anthropic streaming + caching)
- **$770 actual vs $26.74 reported** — LiteLLM #8514 (29× undercount with Roo Code)
- **2× the real input tokens** — Langfuse #12306 (OTel cache double-count)
- **$1.24+ charged for $0 actual** — Langfuse #8775 (failed request charged)
- **1.2GB storage with 5 traces** — Langfuse Discussion #5687 (ClickHouse inflation)
- **6-minute latency at 300 RPS** — LiteLLM #13541 (performance ceiling)
- **800+ open issues** — LiteLLM GitHub (Jan 2026 count)
- **Exabytes of memory** — ClickHouse versions above 25.5.2 with Langfuse (Discussion #10314)
# NullSpend competitor bug database — ADDENDUM: Expanded findings

**This addendum extends the original bug database with findings from a wider search across stability, security, streaming, enterprise, and developer experience issues.**

---

## 11. LiteLLM — Memory, stability, and operational failures

### Bug 11.1: Budget reset OOM crash (500MB → 16GB in seconds)

**Source:** GitHub #13210 (Aug 2025)

**What happens:** At 00:00 UTC on the 1st of each month, the ResetBudgetJob loads the entire `LiteLLM_Key` table into memory to process budget resets. With ~250K keys, process RSS explodes from ~500MB to >16GB within seconds, followed by OOM kill. Database connection storms compound the issue as retries pile up.

**Root cause:** `reset_budget_for_litellm_keys` loads entire table into memory instead of using batched/streaming queries.

**NullSpend advantage:** Redis Lua scripts perform budget resets atomically per-key. No batch loading, no OOM risk. A reset is a single `SET` command per key.

**NullSpend test case:**
```
TEST: Budget reset under concurrent load does not cause memory spikes
GIVEN: 10,000 active budgets all scheduled for reset at the same time
WHEN: Reset triggers
THEN: Memory usage remains stable (no bulk table loads)
AND: All budgets reset correctly within 60 seconds
```

### Bug 11.2: Progressive memory leak requiring periodic restarts

**Source:** GitHub #15128, #12685, #6404, #5695 (multiple reports, 2024-2026)

**What happens:** Memory usage grows continuously over days of operation, eventually consuming all available RAM (12GB+ reported) and crashing. Reports across multiple configurations: FastAPI, virtual keys + Langfuse, async streaming. Multiple users independently report needing worker recycling every 10,000 requests or periodic container restarts.

**Root cause:** Multiple suspected sources — async streaming completion leaks (#6404), virtual key tracking (#5695), callback handler accumulation.

**NullSpend advantage:** CF Workers are stateless V8 isolates. Each request runs in a fresh isolate — no memory can accumulate across requests. Impossible to have memory leaks by architecture.

### Bug 11.3: September 2025 release causes Kubernetes OOM errors

**Source:** LiteLLM Release Notes (Sep 6, 2025), confirmed by Maxim AI analysis

**What happens:** A production release shipped a known issue where startup leads to Out of Memory errors on Kubernetes deployments. Users discovered this in production.

**NullSpend advantage:** CF Workers have no startup cost — cold start is <5ms. No container, no startup memory, no OOM risk.

### Bug 11.4: Database log accumulation degrades performance at 1M rows

**Source:** GitHub #12067, TrueFoundry analysis, Maxim AI analysis

**What happens:** LiteLLM stores request logs in PostgreSQL. Performance degrades significantly once the table exceeds 1M rows. At 100K requests/day, this threshold is hit in 10 days. The LiteLLM docs acknowledge this limitation.

**NullSpend test case:**
```
TEST: Cost event log performance doesn't degrade with volume
GIVEN: cost_events table with 10M rows
WHEN: New cost event is inserted
THEN: Insert completes in <50ms
AND: Dashboard queries remain responsive (<500ms for recent data)
```

### Bug 11.5: Kubernetes deployment postmortem — 9 failure phases, 1 full day

**Source:** GitHub #22807 (March 4, 2026 — 5 days ago!)

**What happens:** A user documented deploying `litellm-pgvector` on ARM64 Kubernetes requiring a full day of debugging across 9 distinct failure phases. Required building a custom Docker image, manually bootstrapping the database schema, patching database records by hand, reverse-engineering the API flow, and applying multiple workarounds.

**NullSpend advantage:** One env var change. No Docker, no Kubernetes, no PostgreSQL setup, no Redis to manage.

---

## 12. LiteLLM — Streaming proxy failures

### Bug 12.1: Responses API streaming omits required SSE events

**Source:** GitHub #20975 (Feb 2026)

**What happens:** When streaming Azure Responses API requests through LiteLLM, it sends `response.output_text.delta` events but omits required setup events (`response.created`, `response.in_progress`, `response.output_item.added`, `response.content_part.added`). Clients reject the deltas because protocol setup events are missing. Discovered when using Codex through LiteLLM.

**NullSpend advantage:** NullSpend passes SSE bytes through unmodified — the TransformStream only observes, never modifies. Client receives exactly what the provider sends.

**NullSpend test case:**
```
TEST: SSE passthrough is byte-identical to upstream
GIVEN: Any streaming response from OpenAI
WHEN: Proxied through NullSpend
THEN: Client receives byte-for-byte identical SSE stream
VERIFY: No events added, removed, reordered, or modified
```

### Bug 12.2: Fake streaming for custom/unknown models silently drops events

**Source:** GitHub #21090 (Feb 2026)

**What happens:** For custom models not in LiteLLM's pricing database, the Responses API falls back to "fake streaming" — sending only `response.completed` + `[DONE]` instead of the 30+ intermediate events the model actually produces. Function call arguments, thinking blocks, and incremental content are all silently lost.

**Root cause:** Exception handler defaults `supports_native_streaming` to `false` for unknown models.

**NullSpend advantage:** Proxy doesn't rewrite or reconstruct streams. Unknown models pass through identically.

### Bug 12.3: Out-of-order thinking_delta blocks crash downstream clients

**Source:** OpenCode GitHub #3596 (Oct 2025)

**What happens:** LiteLLM's stream handler buffers, reconstructs, and re-emits SSE events from Bedrock. This reconstruction changes block ordering — `thinking_delta` arrives BEFORE `message_start`, violating the state machine contract. Downstream clients (OpenCode) crash on the out-of-order events.

**Root cause:** Stream reconstruction doesn't preserve ordering from the upstream provider.

**NullSpend test case:**
```
TEST: Stream event ordering preserved exactly as received from provider
GIVEN: Provider sends events in order [A, B, C, D]
WHEN: Proxied through NullSpend
THEN: Client receives events in order [A, B, C, D]
VERIFY: No buffering or reconstruction changes event ordering
```

### Bug 12.4: Pre-stream errors returned as SSE instead of JSON

**Source:** GitHub #18756 (Jan 2026)

**What happens:** When a streaming request fails during parameter validation (before streaming starts), LiteLLM returns the error in SSE format instead of standard JSON. Clients expecting a normal JSON error response fail to parse the SSE-formatted error.

**NullSpend test case:**
```
TEST: Upstream errors forwarded with correct content-type
GIVEN: Request with invalid parameters
WHEN: Provider returns 400 error
THEN: Error response passes through with original content-type and status code
```

### Bug 12.5: Timeouts not enforced — requests hang for 6000 seconds

**Source:** GitHub #7001 (Dec 2024)

**What happens:** Despite configuring `timeout: 300` and `stream_timeout: 120` in config.yaml, some requests don't timeout until reaching the default 6000 seconds (100 minutes). The configured timeouts are silently overridden or ignored.

**NullSpend advantage:** CF Workers have hard CPU time limits enforced by the runtime itself. Proxy requests to OpenAI can use `AbortSignal.timeout()` for explicit control.

### Bug 12.6: Excessive warning logging — 20× log volume

**Source:** GitHub #20990 (Feb 2026)

**What happens:** After upgrading to v1.81.10, logs fill with "streaming chunk model mismatch" warnings for every request. Logs become 20× the normal size, making troubleshooting impossible and inflating log storage costs.

---

## 13. LiteLLM — Security vulnerabilities (CVE catalog)

LiteLLM has a significant catalog of CVEs — material for enterprise security teams evaluating alternatives.

### CVE 13.1: SSRF exposing API keys (CVE-2024-6587)

**What happens:** SSRF via attacker-controlled `api_base` parameter causes requests to arbitrary domains, potentially exposing the OpenAI API key in the Authorization header.

### CVE 13.2: Langfuse API key leakage (CVE-2025-0330, CVSS 7.5)

**What happens:** Error handling in `proxy_server.py` leaks `langfuse_secret` and `langfuse_public_key` when parsing team settings fails. Grants full access to the Langfuse project storing all requests.

### CVE 13.3: SQL injection via /key/block (CVE-2025-45809)

**What happens:** SQL injection through the `/key/block` endpoint enables a `proxy_admin_viewer` to brute-force database files via `pg_read_file` with timing-based checks.

### CVE 13.4: SQL injection via /team/update (CVE-2024-4890)

**What happens:** Blind SQL injection due to improper handling of `user_id` parameter in raw SQL. Could yield unauthorized access to sensitive data.

### CVE 13.5: Improper API key masking in logs (CVE-2024-9606)

**What happens:** Masking logic only hides the first 5 characters of API keys, leaking most of the secret key in logs.

### CVE 13.6: Arbitrary command execution via config (CVE-2024-6825)

**What happens:** `post_call_rules` config can be set to a system method (e.g., `os.system`), enabling arbitrary command execution.

### CVE 13.7: Arbitrary file deletion (CVE-2024-4888)

**What happens:** `/audio/transcriptions` endpoint uses `os.remove(file.filename)` without validation, allowing deletion of arbitrary server files.

### CVE 13.8: Improper access control (CVE-2024-5710)

**What happens:** Insufficient access control checks across team management endpoints enable unauthorized CRUD operations.

### CVE 13.9: Unauthorized admin access (CVE-2025-0628)

**What happens:** Improper authorization allows unauthorized users to gain administrative access to the proxy.

**NullSpend security posture:**
- CF Workers V8 isolates provide per-request memory isolation
- No arbitrary code execution paths (no Python eval, no YAML config parsing)
- No SQL injection surface (parameterized Drizzle ORM queries)
- API keys never persisted (BYOK pass-through, SHA-256 hash only for matching)
- Timing-safe auth comparison (crypto.subtle.timingSafeEqual)
- No file system access (V8 isolate sandbox)

**NullSpend test case:**
```
TEST: Platform auth key never appears in logs or error messages
GIVEN: Request with X-NullSpend-Auth header
WHEN: Any error occurs during processing
THEN: Error logs contain NO auth credentials
VERIFY: Grep all log output for platform key value — zero matches
```

---

## 14. LiteLLM — Enterprise and developer experience pain

### Pain 14.1: SSO, RBAC, and team budgets behind enterprise paywall

**Source:** TrueFoundry review (2026), LiteLLM Enterprise docs

**What happens:** SSO (beyond 5 users), RBAC, audit logging, and team-level budget enforcement all require the enterprise license. The open-source version lacks built-in authentication, which means teams share master keys. One TrueFoundry reviewer noted: "If you want the stuff your CISO asks for — SSO, RBAC, team-level budget enforcement — you hit a paywall."

**NullSpend positioning:** Budget enforcement included in the $49/month Pro tier. No enterprise gate for core safety features.

### Pain 14.2: 2-4 week production deployment

**Source:** TrueFoundry pricing guide, multiple analyses

**What happens:** Setting up LiteLLM for production requires Docker + PostgreSQL + Redis configuration, load balancing, monitoring, and security hardening. Multiple sources estimate 2-4 weeks of engineering time for a production-ready deployment.

**NullSpend positioning:** One env var change, working in 60 seconds.

### Pain 14.3: Spend log request truncation

**Source:** GitHub #10988 (May 2025)

**What happens:** Request/response pairs saved to the database are silently truncated. A user whose primary use case was saving request/response pairs discovered this was "silently broken" by a code change, with no release note or deprecation warning.

### Pain 14.4: Documentation buried and not containerization-friendly

**Source:** GitHub #22807 postmortem (March 4, 2026)

**What happens:** The postmortem author found that "some of these issues were in fact documented — they were either buried in setup guides that don't translate cleanly to containerised deployment, or covered in LiteLLM's broader docs without being referenced."

---

## 15. Portkey — Expanded weaknesses

### Weakness 15.1: SSRF vulnerability in custom host (GHSA-hhh5-2cvx-vmfp)

**Source:** GitHub Security Advisory (Dec 2025)

**What happens:** Server-Side Request Forgery vulnerability in custom host configuration, rated Moderate severity.

### Weakness 15.2: Bedrock streaming errors return wrong format

**Source:** GitHub #1142 (June 2025)

**What happens:** Bedrock streaming mode fails to throw exceptions correctly. Responses come back as status 200 with an error in the JSON body instead of proper error status codes, masking failures from client error handling.

### Weakness 15.3: Log limits create silent cost tracking gaps

**Source:** TrueFoundry pricing analysis (Feb 2026)

**What happens:** When you exceed your log quota, "your requests continue to be routed normally to LLM providers, and the gateway doesn't stop working. What stops is recording new logs." This means during high-traffic periods, you lose cost tracking, performance metrics, latency data, and error monitoring — exactly when you need it most. Budget enforcement that depends on logs also becomes unreliable.

**NullSpend test case:**
```
TEST: Cost tracking operates independently of any quotas
GIVEN: 10M requests proxied in a month
THEN: Every single request has a cost event recorded
VERIFY: No gap between "requests served" and "cost events logged"
```

### Weakness 15.4: Complex pricing confuses users

**Source:** G2 reviews, TrueFoundry analysis

**What happens:** "Recorded logs" pricing is confusing — the concept of paying per log rather than per request creates uncertainty. At $9/100K logs, costs are reasonable at moderate scale but unpredictable at high scale. Multiple G2 reviews cite "pricing are high for smaller teams."

### Weakness 15.5: Limited MCP support

**Source:** TrueFoundry analysis (Feb 2026)

**What happens:** "As of 2026, Portkey has limited MCP support and hasn't prioritized Portkey MCP gateway features yet." For teams building agentic applications with tool use, this is a significant gap.

**NullSpend advantage:** Existing MCP proxy with 49 tests, ready to wire into the same budget enforcement as the LLM proxy.

---

## 16. LangChain — Security vulnerabilities

### CVE 16.1: Critical serialization injection (CVE-2025-68664, CVSS 9.3)

**Source:** The Hacker News (Dec 2025), Cybersecurity News

**What happens:** LangChain-core's `dumps()` and `dumpd()` functions don't escape user-controlled dictionaries with 'lc' keys. Attackers can exfiltrate environment variables and potentially execute code through prompt injection → serialization/deserialization cycles in streaming operations, logging, and caching. 12 vulnerable patterns identified. ~847M total PyPI downloads affected.

**NullSpend positioning:** Proxy architecture means no serialization/deserialization of LLM responses — bytes pass through unmodified. No framework dependency, no framework vulnerability surface.

### CVE 16.2: Parallel JS vulnerability (CVE-2025-68665, CVSS 8.6)

**What happens:** Same serialization injection flaw exists in LangChain.js. Objects with "lc" keys enable secret extraction and prompt injection.

---

## 17. Cross-cutting themes for NullSpend messaging

### Theme A: "Observation vs. enforcement" — the security camera problem

Every competitor except LiteLLM and TrueFoundry is observation-only. They show you what happened after the money is spent. The list: Langfuse, Helicone, Braintrust, Datadog, Arize/Phoenix, LangWatch, LangSmith, AgentOps, AI Cost Board. None of them can stop a runaway agent.

### Theme B: "The infrastructure tax"

LiteLLM requires Docker + PostgreSQL + Redis + 2-4 weeks of setup. Langfuse requires PostgreSQL + ClickHouse + Redis + blob storage. TrueFoundry requires $499/month minimum. Portkey requires enterprise contract for enforcement. NullSpend requires one environment variable.

### Theme C: "The accuracy gap"

Every cost calculation tool has documented bugs with cached token math. LiteLLM has 7+ cost calculation bugs filed in the last year alone. Langfuse double-counts via OTel. LangChain doubles via cumulative deltas. NullSpend's cost engine has tests derived from each of these exact bugs.

### Theme D: "The security surface"

LiteLLM has 10+ CVEs including SQL injection, SSRF, arbitrary file deletion, and API key leakage. It's a Python process with full filesystem and network access. NullSpend runs in a V8 isolate sandbox with no filesystem access, no arbitrary code execution, and parameterized queries only.

---

## Updated test case priority matrix

### NEW P0 tests (add to original P0 list)

| # | Test | Derived from |
|---|------|-------------|
| 22 | SSE passthrough is byte-identical to upstream | LiteLLM #20975, #21090, OpenCode #3596 |
| 23 | Stream event ordering preserved exactly | OpenCode #3596 (out-of-order blocks) |
| 24 | Upstream errors forwarded with correct status/content-type | LiteLLM #18756 |
| 25 | Platform auth key never appears in any log output | LiteLLM CVE-2024-9606, CVE-2025-0330 |
| 26 | Budget reset under load — no memory spike | LiteLLM #13210 (OOM crash) |
| 27 | Cost event insert performance stable at 10M+ rows | LiteLLM #12067 |

### NEW narrative ammunition

- **16GB OOM on budget reset** — LiteLLM #13210 (500MB → 16GB in seconds on monthly reset)
- **9 failure phases, 1 full day** — LiteLLM #22807 (March 4, 2026 K8s deployment postmortem)
- **10+ CVEs** — LiteLLM CVE catalog (SQL injection, SSRF, API key leakage, arbitrary file deletion)
- **6000-second ghost timeouts** — LiteLLM #7001 (configured 300s timeout ignored, requests hang 100 minutes)
- **20× log bloat** — LiteLLM #20990 (warning spam after upgrade, logs 20× normal size)
- **Silent event dropping** — LiteLLM #21090 (30+ SSE events reduced to 2, function calls lost)
- **CVSS 9.3 serialization injection** — LangChain CVE-2025-68664 (847M downloads affected)
- **$0 cost = budget bypass** — Portkey docs (unknown models show $0, don't count against budget)
- **Maintenance mode** — Helicone acquired March 3, 16,000 orgs orphaned, "we'll work with customers to migrate to another platform"
