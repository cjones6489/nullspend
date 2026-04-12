# Python SDK Parity Plan

## Goal
Bring the Python SDK (`packages/sdk-python`) to feature parity with the TypeScript SDK (`packages/sdk/`), making it a first-class integration path for Python agent frameworks (LangChain, CrewAI, AutoGen, custom agents).

## Current State

### Python SDK has (42 tests, 4 source files):
- **Core read/write API**: `report_cost`, `report_cost_batch`, `check_budget`, `list_budgets`, `list_cost_events`, `get_cost_summary`
- **HITL lifecycle**: `create_action`, `get_action`, `mark_result`, `wait_for_decision`, `propose_and_wait`
- **Error classes**: `NullSpendError`, `PollTimeoutError`, `RejectedError`
- **HTTP**: httpx sync client, retry with jitter, idempotency keys, path validation
- **Sync-only**: no async support

### TypeScript SDK has (409 tests, 13 source files):
Everything above PLUS:
- **Tracked fetch** (`createTrackedFetch`): intercepts OpenAI/Anthropic calls, auto-tracks cost, enforces budgets client-side
- **Policy cache**: TTL-cached org budgets, mandates, session limits with fail-open semantics
- **Customer sessions** (`customer()`): scoped attribution with pre-bound provider fetches
- **Cost calculation**: auto-computes cost from response usage (OpenAI + Anthropic)
- **SSE parsing**: streaming response cost extraction via TransformStream
- **Cost reporter**: background batching queue with flush/shutdown lifecycle
- **Budget negotiation**: `requestBudgetIncrease()` with policy cache invalidation
- **5 enforcement error classes**: `BudgetExceededError`, `MandateViolationError`, `SessionLimitExceededError`, `VelocityExceededError`, `TagBudgetExceededError`
- **Provider parsers**: route detection, model extraction, streaming detection

---

## Gap Analysis

### Applicable gaps (Python SHOULD have):

| Feature | TS SDK | Python SDK | Priority |
|---------|--------|------------|----------|
| `request_budget_increase()` | ✅ | ❌ | P0 |
| Cost reporter (batching queue) | ✅ | ❌ | P0 |
| Async client (`AsyncNullSpend`) | N/A (JS is async-native) | ❌ | P0 |
| Tracked httpx client | `createTrackedFetch` | ❌ | P0 |
| Policy cache | ✅ | ❌ | P0 |
| Customer sessions | `customer()` | ❌ | P1 |
| Cost calculation (OpenAI) | ✅ | ❌ | P1 |
| Cost calculation (Anthropic) | ✅ | ❌ | P1 |
| SSE parsing | ✅ | ❌ | P1 |
| Enforcement error classes (5) | ✅ | ❌ | P1 |
| Provider route detection | ✅ | ❌ | P1 |
| CI integration | ✅ | ❌ | P1 |

### Not applicable (Python doesn't need):
- `globalThis.fetch` interception (Python has httpx/requests, not fetch)
- TransformStream-based SSE (Python uses httpx streaming iterators)
- `interruptibleSleep` / `waitWithAbort` with AbortSignal (Python uses asyncio.wait_for / threading.Event)

---

## Architecture

### Design Principle: Pythonic, Not a Port
The Python SDK should feel native to Python developers. No 1:1 port of JS patterns. Instead:
- **httpx transport hooks** instead of fetch wrapping
- **asyncio-native** async client (not bolted-on)
- **Context managers** for lifecycle (already started)
- **Dataclasses** for types (already using)
- **Iterator protocol** for streaming

### Module Structure (proposed)

```
packages/sdk-python/src/nullspend/
├── __init__.py              # Public exports (exists)
├── client.py                # Sync NullSpend client (exists, extend)
├── async_client.py          # NEW: AsyncNullSpend client
├── types.py                 # Data classes + validate_customer_id() (exists, extend)
├── errors.py                # Error classes (exists, extend with 5 enforcement errors)
├── _cost_calculator.py      # NEW: OpenAI + Anthropic cost math + pricing loader
├── _cost_reporter.py        # NEW: Background batching queue (sync: queue.Queue + daemon thread)
├── _policy_cache.py         # NEW: TTL-cached enforcement
├── _tracked_client.py       # NEW: httpx custom BaseTransport + provider parsers (merged)
├── _sse_parser.py           # NEW: Streaming usage extraction (OpenAI + Anthropic)
├── _pricing_data.json       # NEW: Bundled copy from cost-engine (CI-synced)
└── _retry.py                # NEW: Extract retry logic from client.py
```

6 new files (down from 8). Private modules prefixed with `_` — only `__init__.py` exports are public API.

**Eng review decisions:**
- `validate_customer_id()` lives in `types.py` (not a separate file — 10 lines)
- Provider parsers (`is_tracked_route`, `extract_model`, etc.) merged into `_tracked_client.py`
- `_customer_id.py` eliminated
- `_provider_parsers.py` eliminated

---

## Implementation Phases

### Phase 1: Foundation (refactor + async + batching)
**Goal**: Extract internals, add async client, ship `request_budget_increase` and `CostReporter`.

1. **Extract retry logic** → `_retry.py`
   - `is_retryable_status_code(status)`, `calculate_retry_delay_s(attempt, base, max)`
   - `parse_retry_after_s(value, max_s)` — handles numeric seconds + HTTP date (port from TS)
   - Shared between sync and async clients
   - Port: `src/retry.ts` constants and logic

2. **Add `validate_customer_id()`** → `types.py`
   - Same regex as TS SDK: `^[a-zA-Z0-9._:-]+$`, max 256 chars
   - Fail-fast: raises `NullSpendError` on invalid input
   - Port: `src/customer-id.ts`

3. **Add `AsyncNullSpend` client** → `async_client.py`
   - Mirror every method from sync client using `httpx.AsyncClient`
   - `async with AsyncNullSpend(...) as ns:` context manager
   - `await ns.create_action(...)`, etc.
   - `propose_and_wait` properly awaits async executors
   - Key decision: share types/errors, separate HTTP implementation

4. **Add `request_budget_increase()`** to both clients
   - Port: `client.ts:requestBudgetIncrease()` logic
   - Wraps `propose_and_wait(action_type="budget_increase")`
   - On approval: invalidate policy caches (when policy cache exists)
   - Return: `{"action_id": str, "requested_amount_microdollars": int}`

5. **Add 5 enforcement error classes** → `errors.py`
   - `BudgetExceededError(remaining_microdollars, entity_type?, entity_id?, limit?, spend?, upgrade_url?)`
   - `MandateViolationError(mandate, requested, allowed)`
   - `SessionLimitExceededError(session_spend_microdollars, session_limit_microdollars)`
   - `VelocityExceededError(retry_after_seconds?, limit?, window?, current?)`
   - `TagBudgetExceededError(tag_key?, tag_value?, remaining?, limit?, spend?)`

6. **Type parity audit** → `types.py` (caught by outside voice)
   - Add `budget_increase` to `ACTION_TYPES`
   - Add `customer: str | None` to `CostEventInput`
   - Add `cost_breakdown` to `CostEventInput` and `CostEventRecord`
   - Expand `CostSummaryResponse` to match TS: keys, tools, sources, traces breakdowns
   - Audit every field on every dataclass against TS `src/types.ts`

7. **Add `CostReporter`** → `_cost_reporter.py` (moved from Phase 3)
   - `CostReporter(config, send_batch_fn)`
   - `enqueue(event)` — `queue.Queue` (thread-safe), auto-flush at batch_size
   - `flush()` — drain queue, chunk, send. Concurrent flush dedup (only one runs)
   - `shutdown()` — drain loop (max 16 iterations), pathological-producer guard
   - **Sync lifecycle**: `atexit` handler for normal-exit flush + `NullSpend.__exit__` calls `shutdown()`
   - **Async lifecycle**: lazy loop binding (bind to event loop on first `enqueue()`). NO atexit for async (can't await). Explicit `await ns.shutdown()` or `async with` context manager (`__aexit__` calls shutdown)
   - Sync: `queue.Queue` + daemon `threading.Thread` for background flush
   - Async: `asyncio.Queue` + `asyncio.create_task` (created on first enqueue, not construction)
   - `on_dropped`, `on_flush_error` callbacks
   - Config validation: `batch_size` 1-100, `flush_interval_ms` >= 100, `max_queue_size` >= 1
   - Add `queue_cost()`, `flush()`, `shutdown()` methods to both `NullSpend` and `AsyncNullSpend`

**Tests**: ~80 new tests (async client mirror + budget increase + error classes + cost reporter)
**Estimated**: 1 session

### Phase 2: Cost Engine (auto-tracking foundation)
**Goal**: Port cost calculation + SSE parsing so tracked client can compute costs.

1. **Cost calculator** → `_cost_calculator.py`
   - `calculate_openai_cost_event(model, usage, duration_ms, metadata) -> CostEventInput`
   - `calculate_anthropic_cost_event(model, usage, cache_detail, duration_ms, metadata) -> CostEventInput`
   - Uses `@nullspend/cost-engine` pricing data — **Decision needed**: bundle `pricing-data.json` in Python package or fetch from API?
   - **Recommendation**: Bundle the JSON file. It's ~15KB, changes rarely, and avoids a network dependency. Ship a `_pricing.py` that loads it. Version bumps sync the file.
   - Long-context 2x multiplier for Anthropic (>200K tokens)
   - Cache write TTL variants (ephemeral_5m, ephemeral_1h)

2. **Add `package-data` to `pyproject.toml`** (caught by outside voice)
   - Add `[tool.setuptools.package-data] nullspend = ["_pricing_data.json", "py.typed"]`
   - Without this, JSON doesn't ship in the wheel — cost calculator crashes at runtime

3. **SSE parser** → `_sse_parser.py`
   - `parse_openai_sse(response_stream) -> (passthrough_stream, result_future)`
   - `parse_anthropic_sse(response_stream) -> (passthrough_stream, result_future)`
   - Python approach: async generator that yields bytes AND accumulates usage
   - 64KB line length safety valve (match TS)

**Provider parsers** are merged into `_tracked_client.py` (Phase 3) as private functions:
   - `_is_tracked_route(provider, url, method) -> bool`
   - `_extract_model_from_body(body) -> str | None`
   - `_is_streaming_request(body) -> bool`
   - `_is_streaming_response(response) -> bool`
   - `_extract_openai_usage_from_json(json) -> Usage`
   - `_extract_anthropic_usage_from_json(json) -> Usage`

**Tests**: ~80 new tests (cost math is highly parameterized — all 38 models)
**Estimated**: 1 session

### Phase 3: Enforcement Layer (policy cache + tracked client)
**Goal**: Client-side budget enforcement, the core differentiator.

1. **Policy cache** → `_policy_cache.py`
   - `PolicyCache(fetch_fn, ttl_s=60, on_error=None)`
   - `async get_policy() -> PolicyResponse | None`
   - `check_mandate(provider, model) -> MandateResult`
   - `check_budget(estimate_microdollars) -> BudgetResult`
   - `get_session_limit() -> int | None`
   - `invalidate()`
   - Dedupes in-flight fetches (asyncio.Lock or threading.Lock)
   - Fail-open on fetch failure (return stale or None)

2. **Add `proxy_url` to `NullSpendConfig`** (deferred from Phase 1)
   - Strict HTTP(S) scheme validation at constructor time
   - Strict port matching for proxy detection (no normalization)
   - Used by tracked client for proxy vs direct mode detection

3. **Tracked httpx client** → `_tracked_client.py`
   - Custom `httpx.BaseTransport` subclass wrapping the real transport
   - `create_tracked_client(provider, options) -> httpx.Client`
   - `create_async_tracked_client(provider, options) -> httpx.AsyncClient`
   - **Pre-request**: inject headers, check enforcement (mandate + budget + session)
   - **Post-response**: extract usage, calculate cost, queue cost event
   - Proxy detection: URL origin match (strict port) via `proxy_url` config
   - 429 interception: `X-NullSpend-Denied: 1` header → typed errors
   - Streaming: `TeeByteStream` wraps response for cost extraction
   - Provider parsers merged as private functions (see Phase 2 note)

   **TeeByteStream specification** (the hardest 40 lines):
   ```
   class TeeByteStream(httpx.SyncByteStream):
       """Wraps a byte stream, yielding chunks to caller while
       accumulating SSE data for cost extraction."""

       def __iter__(self):
           for chunk in self._stream:
               self._accumulator.feed(chunk)  # SSE parser
               yield chunk                     # passthrough
           # Stream complete — queue cost event
           usage = self._accumulator.finalize()
           if usage:
               self._queue_cost(usage)

       def close(self):
           # Handle cancellation: queue partial cost if any
           if not self._accumulator.finalized:
               usage = self._accumulator.finalize_partial()
               if usage:
                   self._queue_cost(usage)
           self._stream.close()
   ```
   Async variant: `AsyncTeeByteStream(httpx.AsyncByteStream)` with `async for`.

4. **Customer sessions** (on NullSpend client)
   - `ns.customer("acme-corp") -> CustomerSession`
   - `session.openai -> httpx.Client` (tracked, attributed to customer)
   - `session.anthropic -> httpx.Client` (tracked, attributed to customer)
   - Customer ID validated via `validate_customer_id()` from `types.py`

**Tests**: ~160 new tests (80 sync + 80 async for tracked client, policy cache, sessions)
**Estimated**: 2 sessions

### Phase 4: Integration + CI
**Goal**: E2E verification, CI pipeline, PyPI publish automation.

1. **Functional E2E tests** → `tests/e2e/` or `tests/functional/`
   - Mirror F1–F11 from `smoke-sdk-functional.test.ts`
   - Requires deployed proxy + API keys
   - pytest markers: `@pytest.mark.e2e`, `@pytest.mark.smoke`

2. **CI integration** → `.github/workflows/ci.yml`
   - Add Python test step: `cd packages/sdk-python && python -m pytest`
   - Matrix: Python 3.9, 3.10, 3.11, 3.12, 3.13
   - Non-blocking initially (allow-failure), promote to blocking after stabilization

3. **PyPI publish automation** → `.github/workflows/publish-python.yml`
   - Trigger: tag `python-sdk-v*`
   - Build: `python -m build`
   - Publish: `twine upload`

4. **Pricing data sync** → script or CI step
   - Copy `packages/cost-engine/src/pricing-data.json` → `packages/sdk-python/src/nullspend/_pricing_data.json`
   - Validate in CI: diff check, fail if out of sync

**Tests**: ~30 new tests (E2E)
**Estimated**: 1 session

---

## Data Flow: Tracked Client

```
User code (OpenAI/Anthropic SDK)
  │
  ├─ Configures: client = OpenAI(http_client=ns.customer("acme").openai)
  │
  ▼
httpx.Client (with NullSpend event hooks)
  │
  ├─ [Request Hook]
  │   ├─ Inject X-NullSpend-Customer header
  │   ├─ Inject X-NullSpend-Tags, TraceId, ActionId headers
  │   ├─ Check: is this a tracked route? (POST /chat/completions, etc.)
  │   ├─ Check: is this going to the proxy? (URL origin match)
  │   │   ├─ YES → skip client-side enforcement (proxy does it)
  │   │   └─ NO → run enforcement:
  │   │       ├─ Fetch policy (cached, TTL 60s)
  │   │       ├─ Check mandate (allowed providers/models)
  │   │       ├─ Estimate cost → check budget
  │   │       └─ Check session limit
  │   └─ If denied → raise typed error (BudgetExceededError, etc.)
  │
  ├─ [Upstream Request] → OpenAI/Anthropic API (or NullSpend proxy)
  │
  ├─ [Response Hook]
  │   ├─ Check: proxy 429 with X-NullSpend-Denied? → raise typed error
  │   ├─ Non-streaming: clone response, extract usage JSON, calculate cost
  │   ├─ Streaming: wrap stream with SSE parser, extract usage on completion
  │   └─ Queue cost event to CostReporter (fire-and-forget)
  │
  ▼
Response returned to user code (unmodified)
```

---

## Data Flow: Cost Reporter Lifecycle

```
enqueue() ──→ queue.Queue ──→ [daemon thread]
                                │
                      ┌─────────┴─────────┐
                      │  wait(flush_interval) │
                      │  or batch_size reached │
                      └─────────┬─────────┘
                                │
                           flush()
                                │
                      ┌─────────┴─────────┐
                      │  splice queue      │
                      │  chunk by batch_size│
                      │  send_batch(chunk)  │
                      └─────────┬─────────┘
                                │
               on_flush_error ←─┤─→ success
                                │
shutdown() ──→ drain loop (max 16) ──→ stop thread
atexit ──→ flush() (best-effort, normal exit)
__exit__ ──→ shutdown() (context manager)
```

## Data Flow: TeeByteStream

```
upstream.stream ──→ TeeByteStream
                     │
              ┌──────┴──────┐
              │              │
         yield chunk    accumulate in
         to caller      SSE parser
              │              │
              ▼              ▼
         user reads     parse_sse()
         response       extracts usage
              │              │
         close()        queue_cost()
              │              │
              └──────┬───────┘
                     │
              stream complete

Cancel mid-read ──→ close() ──→ finalize_partial() ──→ partial cost event
```

---

## Key Decisions (resolved during eng review)

### D1: Pricing data bundling — RESOLVED: Bundle
Bundle `pricing-data.json` in package. Simple, no network dependency, ~15KB. CI validates sync with cost-engine source.

### D2: Async architecture — RESOLVED: Two clients
Two separate clients (`NullSpend` sync + `AsyncNullSpend` async). This is the httpx, Anthropic SDK, and OpenAI SDK pattern. [Layer 1]

### D3: httpx transport — RESOLVED: Custom BaseTransport
Custom `httpx.BaseTransport` subclass for tracked client. Event hooks can't intercept streaming response bodies (response hook fires before body is read). Custom transport wraps the real transport, intercepts the response stream via `TeeByteStream`.

### D4: Streaming cost extraction — RESOLVED: TeeByteStream
Tee iterator wrapping `SyncByteStream`/`AsyncByteStream`. Yields bytes to caller while accumulating SSE data. Cost event queued in `close()`. Partial cost event on cancellation. See TeeByteStream spec in Phase 3.

### D5: Thread safety for sync cost reporter — RESOLVED: queue.Queue + daemon + atexit
`queue.Queue` (thread-safe by default) + daemon `threading.Thread` for background flush. `atexit` handler registered in `__init__` for normal-exit flush. Context manager `__exit__` calls `shutdown()`. Daemon thread dying on crash = events lost (acceptable). Normal exit = atexit flushes (expected).

---

## Test Strategy

### Unit tests (per phase, sync + async counted separately)
- Phase 1: ~80 tests — async client mirror (40), budget increase (8), error classes (10), cost reporter (22)
- Phase 2: ~80 tests — cost math parameterized × 38 models (60), SSE parsing (14), usage extraction (6)
- Phase 3: ~160 tests — policy cache (20), tracked client sync (40) + async (40), TeeByteStream (16), customer sessions (12), 429 interception (16), proxy detection (16)
- Phase 4: ~30 tests — E2E functional

**Total new tests**: ~350 (from 42 → ~392)

**Note:** Sync/async multiplier accounts for ~40% of Phase 1 and Phase 3 test counts. Python's two-client pattern requires separate tests because `httpx.Client` and `httpx.AsyncClient` are different code paths (`SyncByteStream` vs `AsyncByteStream`, `threading.Lock` vs `asyncio.Lock`, etc.).

### Testing patterns
- `respx` for HTTP mocking (already used)
- `pytest-asyncio` for async tests (already a dev dependency)
- Parameterized tests for all-models coverage: `@pytest.mark.parametrize`
- SSE test fixtures: real captured streams from OpenAI/Anthropic

### Parity validation
After each phase, run a structural comparison:
1. List all public methods on TS SDK `NullSpend` class
2. List all public methods on Python SDK `NullSpend` + `AsyncNullSpend` classes
3. Diff — any new TS method must have a Python equivalent or documented exclusion reason

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Pricing data drift (Python ≠ TS) | Medium | High (cost miscalculation) | CI sync check, shared JSON source |
| httpx streaming API changes | Low | Medium | Pin httpx >= 0.25, < 1.0 |
| Async/sync code duplication | High | Medium (maintenance) | Shared _retry.py, types.py; accept some duplication (Layer 1 pattern) |
| SSE parsing edge cases | Medium | Medium | Port TS test fixtures verbatim |
| Python 3.9 compatibility | Low | Low | Test matrix in CI |
| Cost engine version skew | Medium | High | Bundle pricing JSON, version in filename |

---

## Success Criteria

1. **API parity**: Every applicable TS SDK method has a Python equivalent (sync + async)
2. **Test parity**: ≥390 tests covering all features (sync + async)
3. **CI green**: Python tests run on every PR, blocking merge
4. **E2E verified**: Functional tests pass against deployed proxy
5. **Published**: `nullspend` on PyPI at version ≥0.2.0
6. **Documented**: README covers tracked client, customer sessions, enforcement

---

## DX Decisions (from /plan-devex-review)

### Developer Persona
Backend/ML engineer at a startup building AI agents in Python. 15-minute tolerance.
Expects `pip install` + 3 lines. Does not want to learn NullSpend architecture.

### Developer Empathy Narrative
Sarah, backend eng at seed-stage. Burning $800/month on GPT-4o. CTO wants visibility.
She `pip install nullspend`, wraps her OpenAI client with `ns.openai`, makes a call,
and sees the cost appear in the dashboard without calculating anything. That's the
magical moment. 5-minute integration including signup.

### DX Fixes (incorporated into plan)

1. **Default URLs**: `NullSpend(api_key="...")` just works. `base_url` defaults to
   `https://nullspend.dev`. `proxy_url` defaults to `https://proxy.nullspend.dev`.
   User can override either. One required field.

2. **Env-var fallback**: `NullSpend()` with no args reads `NULLSPEND_API_KEY` from
   `os.environ`. Also supports `NULLSPEND_BASE_URL`. Matches OpenAI/Anthropic/Stripe pattern.

3. **`ns.openai` / `ns.anthropic` shorthands**: Properties on NullSpend client that
   return tracked httpx clients with no customer attribution. Simplest integration path.
   Customer sessions (`ns.customer("acme").openai`) are the opt-in advanced path.

4. **Default warning log**: When `on_cost_error` is not set, SDK logs a WARNING via
   Python's `logging` module on the first cost tracking failure. Includes error message
   and hint to set `on_cost_error`. Subsequent errors silent (no spam).

5. **Error message templates** (Stripe formula: what + why + fix + url):
   - Auth: `"Invalid API key. Check NULLSPEND_API_KEY env var or api_key arg. Get a key at https://nullspend.dev/app/keys"`
   - Budget: `"Budget exceeded. $X.XX remaining (limit: $Y.YY, spent: $Z.ZZ). Increase at https://nullspend.dev/app/budgets"`
   - Cost tracking: `"Failed to report cost event (STATUS REASON). Check API key. Set on_cost_error to customize."`

6. **README rewrite**: Lead with tracked client example, not `report_cost()`.
   Progressive disclosure: basic tracking → customer attribution → enforcement → HITL.

---

## NOT in scope

- **Stress tests for Python SDK** — Python doesn't do proxy-level enforcement. Defer.
- **Non-httpx HTTP clients** (requests, aiohttp, urllib3) — tracked client is httpx-only.
- **Framework adapters** (LangChain, CrewAI, AutoGen) — separate plan. Tracked httpx works with any SDK accepting `http_client=`.
- **Pricing auto-update** — manual copy + CI check sufficient for now.
- **`waitWithAbort` / `interruptibleSleep`** — Python has `asyncio.wait_for` / `threading.Event.wait`.
- **Non-Stripe billing providers** — out of SDK scope entirely.

## What already exists

| Sub-problem | Existing code | Reused? |
|-------------|--------------|---------|
| Core client (HITL, cost, budgets) | `client.py` (514 lines) | Yes, extended |
| Retry logic | Inlined in `client.py:_request()` | Extracted to `_retry.py` |
| Error hierarchy | `errors.py` (40 lines) | Extended with 5 classes |
| Types/dataclasses | `types.py` (150+ lines) | Extended with missing fields |
| Path validation | `client.py:_validate_path_segment()` | Kept in place |
| 42 unit tests | `tests/test_client.py` | Kept, extended |
| Pricing catalog | `packages/cost-engine/src/pricing-data.json` | Bundled copy |
| Policy endpoint | `app/api/policy/route.ts` | Called by Python cache |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 4 | CLEAR | 5 proposals, 3 accepted, 1 deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 8 | ISSUES | 9 findings, 3 accepted |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 10 | CLEAR | 10 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 5 | CLEAR | score: 6/10 → 8/10 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | CLEAR | score: 5/10 → 7/10, TTHW: ~10min → ~5min |

**CODEX:** Found type parity gap, async lifecycle issue, and packaging blocker. All 3 accepted and incorporated.
**CROSS-MODEL:** Claude and Codex agreed on custom BaseTransport approach. Codex disagreed on CostReporter sequencing (wanted it later), Claude's argument accepted by user.
**DX:** 6 fixes: default URLs, env-var fallback, ns.openai shorthand, warning log on error, error message templates, README rewrite.
**UNRESOLVED:** 0
**VERDICT:** ENG + DX CLEARED — ready to implement.
