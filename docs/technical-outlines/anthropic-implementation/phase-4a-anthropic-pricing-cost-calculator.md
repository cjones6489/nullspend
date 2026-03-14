# Phase 4A: Anthropic Pricing Data + Cost Calculator

> **Scope:** Pure functions and data — no proxy, no Redis, no Postgres, no
> infrastructure. Everything in this phase lives in `packages/cost-engine/`
> and `apps/proxy/src/lib/`. All functions are testable in isolation with
> Vitest. This is the foundation that Phases 4B–4E build on.
>
> **Estimated effort:** 1 day build, 1 day testing.
>
> **Reference documents:**
> - `docs/competitor-bug-list/02-anthropic-cost-bugs.md` — 7 bugs to avoid
> - `docs/competitor-bug-list/04-streaming-bugs.md` — Streaming state machine
> - Research artifact: "Anthropic Claude API Proxy: Complete Implementation Reference"

---

## 1. What We're Building

Three deliverables:

1. **Pricing data** — Add all current Anthropic models to `pricing-data.json`
   with correct cache write rates and model aliases.

2. **Cost calculator function** — `calculateAnthropicCost()` in a new file
   `apps/proxy/src/lib/anthropic-cost-calculator.ts` that maps an Anthropic
   usage object to a `CostEventInsert` ready for the database.

3. **Unit tests** — Covering all 7 known competitor bugs (AC-1 through AC-7),
   long context pricing, edge cases, and the exact parity scenarios from the
   existing OpenAI test suite.

---

## 2. Pricing Data Updates

### 2.1 Models to Add

File: `packages/cost-engine/src/pricing-data.json`

Add the following entries. All rates are USD per million tokens. Cache read
rate is stored in `cachedInputPerMTok` (matching the existing field used for
OpenAI cached tokens). Cache write rates use the Anthropic-specific fields
already defined in `ModelPricing`.

```json
"anthropic/claude-opus-4-6": {
  "inputPerMTok": 5.00,
  "cachedInputPerMTok": 0.50,
  "cacheWrite5mPerMTok": 6.25,
  "cacheWrite1hPerMTok": 10.00,
  "outputPerMTok": 25.00
},
"anthropic/claude-sonnet-4-5": {
  "inputPerMTok": 3.00,
  "cachedInputPerMTok": 0.30,
  "cacheWrite5mPerMTok": 3.75,
  "cacheWrite1hPerMTok": 6.00,
  "outputPerMTok": 15.00
},
"anthropic/claude-opus-4-5": {
  "inputPerMTok": 5.00,
  "cachedInputPerMTok": 0.50,
  "cacheWrite5mPerMTok": 6.25,
  "cacheWrite1hPerMTok": 10.00,
  "outputPerMTok": 25.00
},
"anthropic/claude-opus-4-1": {
  "inputPerMTok": 15.00,
  "cachedInputPerMTok": 1.50,
  "cacheWrite5mPerMTok": 18.75,
  "cacheWrite1hPerMTok": 30.00,
  "outputPerMTok": 75.00
},
"anthropic/claude-sonnet-4": {
  "inputPerMTok": 3.00,
  "cachedInputPerMTok": 0.30,
  "cacheWrite5mPerMTok": 3.75,
  "cacheWrite1hPerMTok": 6.00,
  "outputPerMTok": 15.00
},
"anthropic/claude-haiku-3": {
  "inputPerMTok": 0.25,
  "cachedInputPerMTok": 0.025,
  "cacheWrite5mPerMTok": 0.3125,
  "cacheWrite1hPerMTok": 0.50,
  "outputPerMTok": 1.25
}
```

**Models already in the file (verify rates are current):**
- `anthropic/claude-sonnet-4-6` — ✓ correct ($3/$0.30/$3.75/$6.00/$15)
- `anthropic/claude-haiku-3.5` — ✓ correct ($0.80/$0.08/$1.00/$1.60/$4.00)
- `anthropic/claude-opus-4` — ✓ correct ($15/$1.50/$18.75/$30/$75)

### 2.2 Dated Model Aliases

Anthropic's API always returns the dated version in the `model` field of
responses (e.g., `claude-sonnet-4-5-20250929` instead of `claude-sonnet-4-5`).
Both the short name and dated name must resolve to the same pricing.

Add these dated alias entries to `pricing-data.json`:

```json
"anthropic/claude-opus-4-6-20260205": { /* same as claude-opus-4-6 */ },
"anthropic/claude-sonnet-4-6-20260217": { /* same as claude-sonnet-4-6 */ },
"anthropic/claude-sonnet-4-5-20250929": { /* same as claude-sonnet-4-5 */ },
"anthropic/claude-opus-4-5-20251124": { /* same as claude-opus-4-5 */ },
"anthropic/claude-opus-4-1-20250805": { /* same as claude-opus-4-1 */ },
"anthropic/claude-opus-4-20250514": { /* same as claude-opus-4 */ },
"anthropic/claude-sonnet-4-20250514": { /* same as claude-sonnet-4 */ },
"anthropic/claude-3-5-haiku-20241022": { /* same as claude-haiku-3.5 */ },
"anthropic/claude-3-haiku-20240307": { /* same as claude-haiku-3 */ }
```

**Implementation note:** Rather than duplicating the full pricing object for
each alias, consider a resolver function. But for V1, duplicating in JSON
is simpler and aligns with the existing pattern (no resolver exists for
OpenAI aliases either). The JSON file is small and the duplication is
explicit.

### 2.3 Pricing Rate Validation

Cache multiplier invariants (add to catalog tests):

```
For every Anthropic model:
  cachedInputPerMTok === inputPerMTok * 0.1     (cache read = 10% of input)
  cacheWrite5mPerMTok === inputPerMTok * 1.25   (5-min write = 125% of input)
  cacheWrite1hPerMTok === inputPerMTok * 2.0    (1-hour write = 200% of input)
  cachedInputPerMTok < inputPerMTok             (reads are always cheaper)
  cacheWrite5mPerMTok > inputPerMTok            (writes are always more expensive)
  cacheWrite1hPerMTok > cacheWrite5mPerMTok     (1-hour is more expensive than 5-min)
```

---

## 3. Anthropic Usage Type Definition

### 3.1 Raw Anthropic Usage (from API response)

This is the shape that comes directly from Anthropic's API, either from the
JSON response body (non-streaming) or reconstructed from SSE events
(streaming, Phase 4C). Define in `apps/proxy/src/lib/anthropic-types.ts`:

```typescript
/**
 * Raw usage object from an Anthropic Messages API response.
 * These field names match Anthropic's API exactly.
 */
export interface AnthropicRawUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Optional TTL-specific cache breakdown from the response body.
 * Present as a top-level `cache_creation` field (not inside `usage`).
 * GA as of 2025 — no beta header required.
 */
export interface AnthropicCacheCreationDetail {
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
}
```

### 3.2 Why Two Types (Not One)

The raw usage has snake_case fields matching the API. The cost calculator
internally converts to a normalized representation for calculation. This
keeps the boundary clean: parsing happens once, calculation uses clean types.

---

## 4. Cost Calculator: `calculateAnthropicCost()`

### 4.1 File Location

`apps/proxy/src/lib/anthropic-cost-calculator.ts`

This mirrors the existing `cost-calculator.ts` (which handles OpenAI). Each
provider gets its own calculator file. They share the `CostEventInsert`
return type and use the same `getModelPricing()` and `costComponent()` from
`@nullspend/cost-engine`.

### 4.2 Function Signature

```typescript
import { getModelPricing, costComponent } from "@nullspend/cost-engine";
import type { NewCostEventRow } from "@nullspend/db";
import type { AnthropicRawUsage, AnthropicCacheCreationDetail } from "./anthropic-types.js";

type CostEventInsert = Omit<NewCostEventRow, "id" | "createdAt">;

export function calculateAnthropicCost(
  requestModel: string,
  responseModel: string | null,
  usage: AnthropicRawUsage,
  cacheCreationDetail: AnthropicCacheCreationDetail | null,
  requestId: string,
  durationMs: number,
  attribution?: {
    userId: string | null;
    apiKeyId: string | null;
    actionId: string | null;
  },
): CostEventInsert;
```

### 4.3 Implementation — Step by Step

**Step 1: Extract and normalize token counts**

```typescript
const inputTokens = Number(usage.input_tokens) || 0;
const outputTokens = Number(usage.output_tokens) || 0;
const cacheCreationTokens = Number(usage.cache_creation_input_tokens) || 0;
const cacheReadTokens = Number(usage.cache_read_input_tokens) || 0;
```

**Key rule:** `input_tokens` from Anthropic is ALREADY the uncached portion.
Do NOT subtract cache tokens from it. This is the opposite of OpenAI where
`prompt_tokens` includes cached tokens.

**Step 2: Compute total input tokens (for long context check)**

```typescript
const totalInputTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
```

**Step 3: Resolve model pricing with long context adjustment**

```typescript
let pricing = getModelPricing("anthropic", requestModel);
let resolvedModel = requestModel;

if (!pricing && responseModel) {
  pricing = getModelPricing("anthropic", responseModel);
  if (pricing) resolvedModel = responseModel;
}

// Long context: >200K total input tokens doubles input rates,
// 1.5x output rates. Applied at the rate level, not the token level.
const isLongContext = totalInputTokens > 200_000;
const inputRate = pricing
  ? (isLongContext ? pricing.inputPerMTok * 2 : pricing.inputPerMTok)
  : 0;
const cacheReadRate = pricing
  ? (isLongContext ? pricing.cachedInputPerMTok * 2 : pricing.cachedInputPerMTok)
  : 0;
const cacheWrite5mRate = pricing?.cacheWrite5mPerMTok
  ? (isLongContext ? pricing.cacheWrite5mPerMTok * 2 : pricing.cacheWrite5mPerMTok)
  : 0;
const cacheWrite1hRate = pricing?.cacheWrite1hPerMTok
  ? (isLongContext ? pricing.cacheWrite1hPerMTok * 2 : pricing.cacheWrite1hPerMTok)
  : 0;
const outputRate = pricing
  ? (isLongContext ? pricing.outputPerMTok * 1.5 : pricing.outputPerMTok)
  : 0;
```

**Critical:** Long context multiplier for output is **1.5×**, not 2×. Input
and cache rates double. Output goes to 1.5×. This is a known gotcha —
LiteLLM issue #15055 documents incorrect calculation for long context +
cache combinations.

**Step 4: Calculate cache write cost (TTL-aware)**

```typescript
let cacheWriteCost: number;

if (cacheCreationDetail?.ephemeral_5m_input_tokens !== undefined) {
  // TTL breakdown available — use specific rates
  const tokens5m = Number(cacheCreationDetail.ephemeral_5m_input_tokens) || 0;
  const tokens1h = Number(cacheCreationDetail.ephemeral_1h_input_tokens) || 0;
  cacheWriteCost =
    costComponent(tokens5m, cacheWrite5mRate) +
    costComponent(tokens1h, cacheWrite1hRate);
} else {
  // No TTL breakdown — assume all cache writes are 5-min (conservative)
  cacheWriteCost = costComponent(cacheCreationTokens, cacheWrite5mRate);
}
```

**Why 5-min default:** If no TTL breakdown is available, assuming 5-min for
all cache writes may slightly undercharge for 1-hour writes. But the
alternative (assuming 1-hour) would overcharge. 5-min is the original
default TTL, so it's the more common case.

**Step 5: Calculate total cost**

```typescript
let costMicrodollars = 0;
if (pricing) {
  costMicrodollars = Math.round(
    costComponent(inputTokens, inputRate) +
    cacheWriteCost +
    costComponent(cacheReadTokens, cacheReadRate) +
    costComponent(outputTokens, outputRate),
  );
}
```

**Single `Math.round()` at the end.** This matches the OpenAI calculator
pattern and avoids per-component rounding errors.

**Step 6: Map to DB row**

```typescript
return {
  requestId,
  provider: "anthropic",
  model: resolvedModel,
  inputTokens: totalInputTokens,
  outputTokens,
  cachedInputTokens: cacheReadTokens,
  reasoningTokens: 0, // thinking tokens are already in output_tokens
  costMicrodollars,
  durationMs,
  userId: attribution?.userId ?? null,
  apiKeyId: attribution?.apiKeyId ?? null,
  actionId: attribution?.actionId ?? null,
};
```

### 4.4 DB Column Mapping Decisions

| DB Column | OpenAI Value | Anthropic Value | Rationale |
|-----------|-------------|-----------------|-----------|
| `input_tokens` | `prompt_tokens` (total incl. cached) | `input_tokens + cache_creation + cache_read` (total) | Consistent: always stores total input |
| `cached_input_tokens` | `cached_tokens` (subset at discount) | `cache_read_input_tokens` (subset at discount) | Consistent: stores the discounted-rate tokens |
| `reasoning_tokens` | `reasoning_tokens` (subset of output) | `0` | Thinking tokens are in `output_tokens` with no separate count in usage |
| `cost_microdollars` | Full cost including all components | Full cost including all 4 components | Correct total regardless of component breakdown |

**What we lose:** `cache_creation_input_tokens` is not stored as a separate
column. The cost is captured correctly in `cost_microdollars`, but we can't
retroactively break down how much was cache writes vs fresh input from the
stored data. This is acceptable for V1. If needed later, add a
`cache_write_input_tokens` column to `cost_events`.

### 4.5 Extended Thinking Token Handling

Anthropic's extended thinking produces `{"type": "thinking"}` content blocks.
These tokens are billed at the standard output rate and are **already included
in `output_tokens`**. The usage object does NOT provide a separate
`thinking_tokens` count.

**The correct approach:** Do nothing special. Use `output_tokens` as-is.
Do NOT attempt to count thinking tokens from content blocks and add them.

**Why `reasoningTokens: 0`:** Unlike OpenAI's `reasoning_tokens` (which is
reported as a subset of `completion_tokens`), Anthropic doesn't break out
thinking tokens in the usage object. We store 0 rather than guessing. If
Anthropic adds a `thinking_tokens` field to usage in the future, we'll
capture it then.

---

## 5. Test Plan

### 5.1 File: `apps/proxy/src/__tests__/anthropic-cost-calculator.test.ts`

Follows the exact structure of `cost-calculator.test.ts` (OpenAI) with
Anthropic-specific scenarios.

### 5.2 Test Cases — Bug Avoidance (AC-1 through AC-7)

Each test is named after the specific competitor bug it prevents. These are
the non-negotiable regression tests.

**Test AC-1: No double-counting via OTel normalization (Langfuse #12306)**

```
Input:  input_tokens=5, cache_creation=1253, cache_read=128955, output=503
Model:  claude-sonnet-4-6
Assert: totalInputTokens = 5 + 1253 + 128955 = 130213 (NOT 260421)
Assert: costMicrodollars = round(
  5 × 3.00 +         // uncached input: 15
  1253 × 3.75 +      // cache write: 4699 (approximately)
  128955 × 0.30 +    // cache read: 38687 (approximately)
  503 × 15.00         // output: 7545
) = 50946 microdollars (≈$0.051)
```

**Test AC-2: Cache write uses independent rate, not base+premium (LiteLLM #6575)**

```
Input:  input_tokens=3, cache_creation=12304, cache_read=0, output=550
Model:  claude-sonnet-4-6
Assert: costMicrodollars = round(
  3 × 3.00 +         // input: 9
  12304 × 3.75 +     // write: 46140
  0 × 0.30 +         // read: 0
  550 × 15.00         // output: 8250
) = 54399
NOT: round(12304 × 3.00 + 12304 × 3.75 + ...) = 91311 (the double-charge bug)
```

**Test AC-3: Cache costs NOT omitted (LiteLLM #5443)**

```
Input:  input_tokens=100, cache_creation=5000, cache_read=50000, output=200
Model:  claude-sonnet-4-6
Assert: costMicrodollars > round(100 × 3.00 + 200 × 15.00)
  (Must include cache write and read costs, not just input + output)
Assert: costMicrodollars = round(
  100 × 3.00 +       // 300
  5000 × 3.75 +      // 18750
  50000 × 0.30 +     // 15000
  200 × 15.00         // 3000
) = 37050
```

**Test AC-4: Streaming and non-streaming produce identical costs**

```
Given identical usage objects:
  input_tokens=500, cache_creation=0, cache_read=10000, output=300
  Model: claude-sonnet-4-6

// Non-streaming (usage from response body)
result1 = calculateAnthropicCost("claude-sonnet-4-6", null, usage, null, ...)
// Streaming (same usage reconstructed from SSE events)
result2 = calculateAnthropicCost("claude-sonnet-4-6", null, usage, null, ...)

Assert: result1.costMicrodollars === result2.costMicrodollars
```

This test ensures the cost function is deterministic and path-independent.
The actual streaming parser (Phase 4C) will construct the same
`AnthropicRawUsage` object that the non-streaming path extracts directly.

**Test AC-5a: 5-min and 1-hour cache writes use different rates**

```
Input:  input_tokens=10, cache_creation=556, cache_read=0, output=200
Cache detail: ephemeral_5m=456, ephemeral_1h=100
Model:  claude-sonnet-4-6
Assert: costMicrodollars = round(
  10 × 3.00 +        // 30
  456 × 3.75 +       // 1710
  100 × 6.00 +       // 600
  0 × 0.30 +         // 0
  200 × 15.00         // 3000
) = 5340
```

**Test AC-5b: Fallback when TTL breakdown is absent**

```
Input:  input_tokens=10, cache_creation=556, cache_read=0, output=200
Cache detail: null (no TTL breakdown)
Model:  claude-sonnet-4-6
Assert: costMicrodollars = round(
  10 × 3.00 +        // 30
  556 × 3.75 +       // 2085
  0 × 0.30 +         // 0
  200 × 15.00         // 3000
) = 5115
```

**Test AC-6a: Long context (>200K) doubles input rates, 1.5x output**

```
Input:  input_tokens=5000, cache_creation=0, cache_read=196000, output=1000
Total input: 201000 (>200K → long context)
Model:  claude-sonnet-4-6
Assert: costMicrodollars = round(
  5000 × 6.00 +      // input at 2× rate: 30000
  0 +                 // no cache writes
  196000 × 0.60 +    // cache read at 2× rate: 117600
  1000 × 22.50        // output at 1.5× rate: 22500
) = 170100
NOT: round(5000 × 3.00 + 196000 × 0.30 + 1000 × 15.00) = 88800 (base rates)
```

**Test AC-6b: Just under 200K uses base rates**

```
Input:  input_tokens=5000, cache_creation=0, cache_read=194999, output=1000
Total input: 199999 (<= 200K → base rates)
Model:  claude-sonnet-4-6
Assert: costMicrodollars = round(
  5000 × 3.00 +      // 15000
  194999 × 0.30 +    // 58500 (approximately)
  1000 × 15.00        // 15000
) ≈ 88500
```

**Test AC-6c: Total input includes cache tokens for threshold check**

```
Input:  input_tokens=1000, cache_creation=100000, cache_read=100000, output=500
Total input: 201000 (>200K)
Assert: long context rates applied (input doubled, output 1.5×)
```

**Test AC-7: Extended thinking doesn't inflate output cost**

```
Input:  input_tokens=100, cache_creation=0, cache_read=0, output=5000
  (where 4000 are thinking tokens, 1000 visible — but usage only shows 5000)
Model:  claude-sonnet-4-6
Assert: costMicrodollars = round(100 × 3.00 + 5000 × 15.00) = 75300
Assert: result.reasoningTokens === 0 (not tracked separately)
NOT: round(100 × 3.00 + 5000 × 15.00 + 4000 × 15.00) = 135300
```

### 5.3 Test Cases — Edge Cases

**Zero tokens:**
```
input_tokens=0, cache_creation=0, cache_read=0, output=0
Assert: costMicrodollars === 0
Assert: inputTokens === 0, outputTokens === 0
```

**No cache fields (undefined, not zero):**
```
usage = { input_tokens: 100, output_tokens: 50 }
  (cache_creation_input_tokens and cache_read_input_tokens not present)
Assert: costMicrodollars = round(100 × 3.00 + 50 × 15.00) = 1050
Assert: cachedInputTokens === 0
```

**Very large token counts (128K context):**
```
input_tokens=128000, cache_creation=0, cache_read=0, output=64000
Model: claude-opus-4-6
Assert: costMicrodollars = round(128000 × 5.00 + 64000 × 25.00)
      = round(640000 + 1600000) = 2240000
Assert: Number.isFinite(result.costMicrodollars)
```

**Unknown model returns 0 cost:**
```
Model: "nonexistent-model"
Assert: costMicrodollars === 0
Assert: other fields still populated correctly
```

**Model alias resolution (requestModel fails, responseModel succeeds):**
```
requestModel: "claude-sonnet-4-5" (not in pricing DB)
responseModel: "claude-sonnet-4-5-20250929" (in pricing DB via alias)
Assert: pricing resolves via responseModel
Assert: result.model === "claude-sonnet-4-5-20250929"
Assert: costMicrodollars > 0
```

**All-cached input (input_tokens=0, only cache reads):**
```
input_tokens=0, cache_creation=0, cache_read=50000, output=100
Model: claude-sonnet-4-6
Assert: costMicrodollars = round(0 + 50000 × 0.30 + 100 × 15.00)
      = round(15000 + 1500) = 16500
Assert: inputTokens === 50000 (total = 0 + 0 + 50000)
```

**Pure cache write (no reads, no output):**
```
input_tokens=100, cache_creation=50000, cache_read=0, output=0
Model: claude-haiku-3.5
Assert: costMicrodollars = round(100 × 0.80 + 50000 × 1.00 + 0 + 0)
      = round(80 + 50000) = 50080
```

**Attribution fields passed through:**
```
attribution = { userId: "user-123", apiKeyId: "key-456", actionId: "act-789" }
Assert: result.userId === "user-123"
Assert: result.apiKeyId === "key-456"
Assert: result.actionId === "act-789"
```

**Attribution fields default to null:**
```
attribution = undefined
Assert: result.userId === null
Assert: result.apiKeyId === null
Assert: result.actionId === null
```

### 5.4 Test Cases — Multi-Model Pricing Verification

For each model in the pricing database, verify the basic cost formula works:

```
For each model in [
  "claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-4-5",
  "claude-opus-4-5", "claude-opus-4-1", "claude-opus-4",
  "claude-sonnet-4", "claude-haiku-3.5", "claude-haiku-3"
]:
  Input: input_tokens=1000, cache_creation=0, cache_read=0, output=500
  Assert: costMicrodollars = round(1000 × inputRate + 500 × outputRate)
  Assert: costMicrodollars > 0
```

### 5.5 Test File: `packages/cost-engine/src/anthropic-catalog.test.ts`

Pricing data structural validation (separate from cost calculation tests):

```
For every key in pricing-data.json matching "anthropic/*":
  Assert: inputPerMTok > 0
  Assert: outputPerMTok > 0
  Assert: cachedInputPerMTok > 0
  Assert: cachedInputPerMTok < inputPerMTok
  Assert: cacheWrite5mPerMTok exists and > inputPerMTok
  Assert: cacheWrite1hPerMTok exists and > cacheWrite5mPerMTok
  Assert: cachedInputPerMTok ≈ inputPerMTok × 0.1 (within 0.01)
  Assert: cacheWrite5mPerMTok ≈ inputPerMTok × 1.25 (within 0.01)
  Assert: cacheWrite1hPerMTok ≈ inputPerMTok × 2.0 (within 0.01)
```

Alias consistency:

```
For each alias pair (e.g., "claude-sonnet-4-6" and "claude-sonnet-4-6-20260217"):
  Assert: getModelPricing("anthropic", shortName) !== null
  Assert: getModelPricing("anthropic", datedName) !== null
  Assert: shortName pricing === datedName pricing (deep equal)
```

---

## 6. Files Created or Modified

| File | Action | What Changes |
|------|--------|-------------|
| `packages/cost-engine/src/pricing-data.json` | Modify | Add ~15 new Anthropic model entries (short names + dated aliases) |
| `apps/proxy/src/lib/anthropic-types.ts` | Create | `AnthropicRawUsage` and `AnthropicCacheCreationDetail` interfaces |
| `apps/proxy/src/lib/anthropic-cost-calculator.ts` | Create | `calculateAnthropicCost()` function |
| `apps/proxy/src/__tests__/anthropic-cost-calculator.test.ts` | Create | ~25 tests covering AC-1 through AC-7, edge cases, multi-model |
| `packages/cost-engine/src/anthropic-catalog.test.ts` | Create | Pricing data validation for Anthropic entries |

**Files NOT modified in Phase 4A:**
- `index.ts` (proxy entry point) — no routing changes yet
- `sse-parser.ts` — streaming parser is Phase 4C
- `cost-estimator.ts` — Anthropic output caps are Phase 4D
- `budget.ts` / `budget-lookup.ts` — budget wiring is Phase 4D
- Database schema — no new columns needed

---

## 7. Acceptance Criteria

- [ ] `getModelPricing("anthropic", "claude-sonnet-4-6")` returns correct rates
- [ ] `getModelPricing("anthropic", "claude-sonnet-4-5-20250929")` returns same rates as `"claude-sonnet-4-5"`
- [ ] `isKnownModel("anthropic", "claude-opus-4-6")` returns `true`
- [ ] `calculateAnthropicCost()` produces correct costs for all 7 AC bug scenarios
- [ ] Long context (>200K) applies 2× input, 1.5× output multipliers
- [ ] TTL-specific cache write rates used when `cache_creation` detail is available
- [ ] Fallback to 5-min rate when no TTL breakdown provided
- [ ] All token counts map correctly to DB columns
- [ ] Extended thinking tokens NOT double-counted
- [ ] Unknown models return 0 cost (not an error)
- [ ] All existing OpenAI tests still pass (no regressions)
- [ ] Pricing catalog tests validate all Anthropic entries have correct multiplier relationships

---

## 8. What Phase 4B Builds On

Phase 4B (Non-Streaming Route Handler) will:
- Import `calculateAnthropicCost` from this phase
- Import `AnthropicRawUsage` types from this phase
- Call the function after parsing the non-streaming JSON response body
- Pass the result to the existing `logCostEvent()` — no changes needed there

The cost calculator is a pure function with no side effects. Phase 4B plugs
it into the request lifecycle. Phase 4C feeds it streaming-extracted usage.
Phase 4D connects it to budget enforcement. Each phase is independently
testable against this foundation.
