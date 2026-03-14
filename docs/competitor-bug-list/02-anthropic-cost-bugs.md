# Technical Deep Dive: Anthropic Cost Calculation Bugs & Remediation

> **Purpose:** Working reference for Cursor. Anthropic's cache token semantics
> are the #1 source of cost calculation bugs across the ecosystem. Six different
> tools get this wrong. This file documents every known bug and the exact parser
> design that avoids them all.
>
> **Scope filter:** Only Anthropic-specific cost calculation issues. For OpenAI
> see `03-openai-cost-bugs.md`. For streaming see `04-streaming-bugs.md`.
> For budget enforcement see `01-budget-enforcement-bugs.md`.
>
> **Strategic alignment:** Cost accuracy is what makes budget enforcement
> trustworthy. If we calculate wrong costs, our budgets enforce wrong limits.
> Every competitor gets Anthropic cache math wrong — getting it right is a
> concrete, testable moat.

---

## The Core Problem

Anthropic's `input_tokens` field means **uncached tokens only**. This is the
opposite of OpenAI, where `prompt_tokens` means **total including cached**.

```
Anthropic: total_input = input_tokens + cache_creation + cache_read
OpenAI:    total_input = prompt_tokens (which already includes cached_tokens)
```

Every tool that assumes "input_tokens = total" overcharges or double-counts.

### Anthropic Usage Object (the source of truth)

```json
{
  "usage": {
    "input_tokens": 2095,
    "output_tokens": 503,
    "cache_creation_input_tokens": 2095,
    "cache_read_input_tokens": 0
  }
}
```

With TTL-specific cache breakdown (newer API versions):

```json
{
  "usage": {
    "input_tokens": 5,
    "output_tokens": 200,
    "cache_creation_input_tokens": 556,
    "cache_read_input_tokens": 128955
  },
  "cache_creation": {
    "ephemeral_5m_input_tokens": 456,
    "ephemeral_1h_input_tokens": 100
  }
}
```

### The Correct Cost Formula

```
cost = input_tokens × base_input_rate
     + cache_creation_5m × (1.25 × base_input_rate)
     + cache_creation_1h × (2.00 × base_input_rate)
     + cache_read × (0.10 × base_input_rate)
     + output_tokens × output_rate
```

If no TTL breakdown is available, assume 5-min for all cache creation tokens.

### Pricing Table (March 2026)

| Model | Input/MTok | Cache Read/MTok | Cache Write 5m/MTok | Cache Write 1h/MTok | Output/MTok |
|---|---|---|---|---|---|
| Claude Sonnet 4.6 | $3.00 | $0.30 | $3.75 | $6.00 | $15.00 |
| Claude Opus 4.6 | $5.00 | $0.50 | $6.25 | $10.00 | $25.00 |
| Claude Haiku 4.5 | $1.00 | $0.10 | $1.25 | $2.00 | $5.00 |

**Long context (>200K input tokens):** All rates double.

---

## Bug AC-1: Double-counting via OTel normalization

**Source:** Langfuse #12306 (Feb 2026, still open)

**What happens:** OTel `gen_ai.usage.input_tokens` = total input (correctly
normalized by pydantic-ai). Langfuse receives this total, then adds cache
counts on top again.

**Exact numbers:** Anthropic returned `input_tokens=5, cache_read=128955,
cache_creation=1253`. OTel correctly reported total=130,213. Langfuse computed
130,213 + 128,955 + 1,253 = **260,421** (2× actual).

**Root cause:** No way to know if upstream already normalized the values.

**Remediation:** NullSpend parses from the RAW provider response — the actual
SSE events or JSON body from Anthropic's API. No OTel layer, no framework
translation. This class of bug is structurally impossible.

```typescript
// NullSpend ALWAYS reads from the raw Anthropic response, never from OTel
function parseAnthropicUsage(responseBody: AnthropicResponse): AnthropicUsage {
  const usage = responseBody.usage;
  return {
    inputTokens: usage.input_tokens,              // uncached only
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
    // Total is derived, never accepted from external source
    totalInputTokens: usage.input_tokens
      + (usage.cache_creation_input_tokens ?? 0)
      + (usage.cache_read_input_tokens ?? 0),
  };
}
```

**Test (pseudocode — CRITICAL):**

```typescript
describe("AC-1: No double-counting of Anthropic cache tokens", () => {
  it("calculates total input correctly from three disjoint fields", () => {
    const usage = parseAnthropicUsage({
      usage: {
        input_tokens: 5,
        cache_creation_input_tokens: 1253,
        cache_read_input_tokens: 128955,
        output_tokens: 503,
      }
    });

    expect(usage.totalInputTokens).toBe(130213);   // 5 + 1253 + 128955
    // NOT 260421 (the Langfuse bug)
  });

  it("calculates cost correctly for Sonnet 4.6", () => {
    const cost = calculateAnthropicCost({
      inputTokens: 5,
      cacheCreationTokens: 1253,
      cacheReadTokens: 128955,
      outputTokens: 503,
    }, "claude-sonnet-4-6");

    // (5 × $3.00/MTok) + (1253 × $3.75/MTok) + (128955 × $0.30/MTok) + (503 × $15.00/MTok)
    const expected = (5 * 3.0 + 1253 * 3.75 + 128955 * 0.30 + 503 * 15.0); // per MTok
    const expectedMicrodollars = Math.round(expected); // already in microdollars if using /MTok

    // Actual calculation in microdollars:
    // input:  5 * 3_000 / 1_000 = 15 microdollars
    // write:  1253 * 3_750 / 1_000 = 4_699 microdollars
    // read:   128955 * 300 / 1_000 = 38_687 microdollars
    // output: 503 * 15_000 / 1_000 = 7_545 microdollars
    // total:  50_946 microdollars = ~$0.0509
    expect(cost.totalMicrodollars).toBe(50_946);
  });
});
```

---

## Bug AC-2: Cache write tokens double-counted (base + write premium)

**Source:** LiteLLM #6575 (Oct 2024), #9812 (April 2025)

**What happens:** LiteLLM calculated cache write cost as `base_input_cost +
surcharge` — charging the base rate PLUS the write premium. Actual cost was
$0.054, LiteLLM reported $0.091 (nearly double).

**Root cause:** Cache write rate treated as `base + premium` instead of
being an independent rate.

**Remediation:**

Cache write rate is stored as a single, independent value in the pricing DB:

```typescript
// WRONG (LiteLLM's approach):
const cacheWriteCost = tokens * baseInputRate + tokens * cacheWriteSurcharge;

// CORRECT:
const cacheWriteCost = tokens * cacheWriteRate; // $3.75/MTok for Sonnet, period.
```

**Test (pseudocode — CRITICAL):**

```typescript
describe("AC-2: Cache write cost uses independent rate, not base+premium", () => {
  it("matches Anthropic billing for Sonnet 4.6", () => {
    const cost = calculateAnthropicCost({
      inputTokens: 3,
      cacheCreationTokens: 12304,
      cacheReadTokens: 0,
      outputTokens: 550,
    }, "claude-sonnet-4-6");

    // (3 × $3.00) + (12304 × $3.75) + (0 × $0.30) + (550 × $15.00) per MTok
    // = 9 + 46_140 + 0 + 8_250 = 54_399 microdollars = ~$0.054
    expect(cost.totalMicrodollars).toBe(54_399);

    // NOT: (12304 × $3.00) + (12304 × $3.75) + (550 × $15.00) = ~$0.091
    // That's the LiteLLM #9812 bug
    expect(cost.totalMicrodollars).not.toBe(91_311);
  });
});
```

---

## Bug AC-3: Cache costs omitted entirely

**Source:** LiteLLM #5443 (Aug 2024)

**What happens:** Only `input_tokens` counted at base rate. Both
`cache_creation_input_tokens` and `cache_read_input_tokens` were ignored.

**Root cause:** Developer assumed `input_tokens` = total (OpenAI convention).

**Remediation:**

The parser validates that all cache fields contribute to cost:

```typescript
function calculateAnthropicCost(usage: AnthropicUsage, model: string): CostBreakdown {
  const pricing = getAnthropicPricing(model);

  const components = {
    input: microCost(usage.inputTokens, pricing.inputPerMTok),
    cacheWrite: microCost(usage.cacheCreationTokens, pricing.cacheWritePerMTok),
    cacheRead: microCost(usage.cacheReadTokens, pricing.cacheReadPerMTok),
    output: microCost(usage.outputTokens, pricing.outputPerMTok),
  };

  return {
    ...components,
    totalMicrodollars: components.input + components.cacheWrite
                     + components.cacheRead + components.output,
  };
}

// Integer-only cost calculation — no floating point
function microCost(tokens: number, ratePerMTok: number): number {
  // tokens * ratePerMTok / 1_000_000 would lose precision
  // Instead: (tokens * ratePerMTok + 500_000) / 1_000_000 for rounding
  return Math.round((tokens * ratePerMTok) / 1_000);
}
```

**Test (pseudocode):**

```typescript
describe("AC-3: All cache fields produce non-zero costs when tokens > 0", () => {
  it("cache read tokens produce cost", () => {
    const cost = calculateAnthropicCost({
      inputTokens: 100,
      cacheCreationTokens: 0,
      cacheReadTokens: 50000,
      outputTokens: 200,
    }, "claude-sonnet-4-6");

    expect(cost.cacheRead).toBeGreaterThan(0);
    // 50000 × $0.30/MTok = 15_000 microdollars = $0.015
    expect(cost.cacheRead).toBe(15_000);
  });

  it("cache write tokens produce cost", () => {
    const cost = calculateAnthropicCost({
      inputTokens: 100,
      cacheCreationTokens: 50000,
      cacheReadTokens: 0,
      outputTokens: 200,
    }, "claude-sonnet-4-6");

    expect(cost.cacheWrite).toBeGreaterThan(0);
    // 50000 × $3.75/MTok = 187_500 microdollars = $0.1875
    expect(cost.cacheWrite).toBe(187_500);
  });
});
```

---

## Bug AC-4: Streaming + caching 7× overcharge

**Source:** LiteLLM #11789 (June 2025)

**What happens:** When streaming with Anthropic passthrough, cache read tokens
are counted as regular input tokens. LiteLLM reported $0.002059 for a response
that cost $0.000292 — roughly 7× overcharge.

**Root cause:** Streaming parser doesn't distinguish cache tokens from input.

**Remediation:**

The Anthropic streaming parser treats `message_start` and `message_delta` as
separate data sources with specific extraction rules. See
`04-streaming-bugs.md` for the full state machine design.

**Test (acceptance criteria):**

```
AC-4: Streaming and non-streaming produce identical costs
  GIVEN: Identical Anthropic request (same prompt, same model)
  WHEN: Proxied in streaming mode (stream=true)
  AND: Proxied in non-streaming mode (stream=false)
  THEN: Both produce the same cost within 1 microdollar
  (Slight difference acceptable due to rounding, but order of magnitude must match)
```

---

## Bug AC-5: 5-min vs 1-hour TTL cache write rates

**Source:** Anthropic API documentation, tech spec §1

**What happens (potential):** Anthropic introduced a `cache_creation` sub-object
with `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. If we use
the 5-min rate for 1-hour tokens, we undercharge by 60%.

**Root cause:** Newer API feature that most tools haven't implemented.

**Remediation:**

```typescript
function calculateCacheWriteCost(
  usage: AnthropicUsage,
  pricing: AnthropicPricing
): number {
  // If TTL breakdown is available, use specific rates
  if (usage.cacheCreation?.ephemeral5m !== undefined) {
    return microCost(usage.cacheCreation.ephemeral5m, pricing.cacheWrite5mPerMTok)
         + microCost(usage.cacheCreation.ephemeral1h, pricing.cacheWrite1hPerMTok);
  }

  // Fallback: assume all cache writes are 5-min (conservative — may undercharge
  // for 1h tokens, but better than ignoring them)
  return microCost(usage.cacheCreationTokens, pricing.cacheWrite5mPerMTok);
}
```

**Test (acceptance criteria):**

```
AC-5a: 5-min and 1-hour cache writes use different rates
  GIVEN: ephemeral_5m_input_tokens=456, ephemeral_1h_input_tokens=100
  MODEL: claude-sonnet-4-6
  THEN: 5m cost = 456 × $3.75/MTok = 1_710 microdollars
  AND:  1h cost = 100 × $6.00/MTok = 600 microdollars
  AND:  total write cost = 2_310 microdollars

AC-5b: Fallback when TTL breakdown is absent
  GIVEN: cache_creation_input_tokens=556, no cache_creation sub-object
  THEN: All 556 tokens charged at 5-min rate ($3.75/MTok)
```

---

## Bug AC-6: Long context rate doubling

**Source:** Anthropic pricing docs, Langfuse #8499

**What happens (potential):** Requests with >200K input tokens should be charged
at 2× the base rates for ALL token categories. Langfuse doesn't support tiered
pricing, so long-context requests are undercharged.

**Remediation:**

```typescript
function getAnthropicPricing(model: string, totalInputTokens: number): AnthropicPricing {
  const basePricing = anthropicPricingDb[model];
  if (!basePricing) return fallbackPricing(model);

  // Long context: >200K input tokens → double all rates
  if (totalInputTokens > 200_000) {
    return {
      inputPerMTok: basePricing.inputPerMTok * 2,
      cacheReadPerMTok: basePricing.cacheReadPerMTok * 2,
      cacheWrite5mPerMTok: basePricing.cacheWrite5mPerMTok * 2,
      cacheWrite1hPerMTok: basePricing.cacheWrite1hPerMTok * 2,
      outputPerMTok: basePricing.outputPerMTok * 2,
      isLongContext: true,
    };
  }

  return basePricing;
}
```

Note: Total input for threshold = `input_tokens + cache_creation + cache_read`.

**Test (acceptance criteria):**

```
AC-6a: Request under 200K uses base rates
  GIVEN: 150K total input tokens on Sonnet 4.6
  THEN: Input rate = $3.00/MTok

AC-6b: Request over 200K uses doubled rates
  GIVEN: 250K total input tokens on Sonnet 4.6
  THEN: Input rate = $6.00/MTok, cache read = $0.60/MTok, output = $30.00/MTok

AC-6c: Threshold is on total input (including cache tokens)
  GIVEN: input_tokens=5000, cache_read=196000 → total=201000
  THEN: Long context rates apply (total > 200K)
```

---

## Bug AC-7: Extended thinking double-count risk

**Source:** Anthropic docs, Cline ecosystem

**What happens (potential):** Extended thinking produces `{"type": "thinking"}`
content blocks. These are billed as output tokens and are already included in
`output_tokens`. If we count them separately, we double-charge.

**Remediation:**

```typescript
// Extended thinking tokens are ALREADY in output_tokens.
// Do NOT add them again.
// The correct approach: just use output_tokens as-is.
function parseAnthropicUsage(response: AnthropicResponse): AnthropicUsage {
  return {
    inputTokens: response.usage.input_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    outputTokens: response.usage.output_tokens, // includes thinking tokens
    // No separate "thinkingTokens" field needed for cost
  };
}
```

**Test (acceptance criteria):**

```
AC-7: Extended thinking doesn't inflate output cost
  GIVEN: Response with output_tokens=5000 (includes 4000 thinking + 1000 visible)
  THEN: Output cost = 5000 × output_rate
  NOT: 5000 × output_rate + 4000 × output_rate (double-count)
```

---

## Parser Design: `parseAnthropicUsage()`

The complete non-streaming parser:

```typescript
interface AnthropicUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalInputTokens: number;
  cacheCreation?: {
    ephemeral5m: number;
    ephemeral1h: number;
  };
}

interface AnthropicCostBreakdown {
  input: number;         // microdollars
  cacheWrite: number;    // microdollars
  cacheRead: number;     // microdollars
  output: number;        // microdollars
  totalMicrodollars: number;
  isLongContext: boolean;
  isFallbackPricing: boolean;
}

function parseAnthropicUsage(body: unknown): AnthropicUsage {
  const usage = (body as any)?.usage;
  if (!usage) throw new Error("No usage object in Anthropic response");

  const inputTokens = usage.input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;

  // TTL-specific breakdown (optional)
  const cacheCreationDetail = (body as any)?.cache_creation;
  const ephemeral5m = cacheCreationDetail?.ephemeral_5m_input_tokens;
  const ephemeral1h = cacheCreationDetail?.ephemeral_1h_input_tokens;

  return {
    inputTokens,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    outputTokens,
    totalInputTokens: inputTokens + cacheCreation + cacheRead,
    ...(ephemeral5m !== undefined && {
      cacheCreation: {
        ephemeral5m: ephemeral5m ?? 0,
        ephemeral1h: ephemeral1h ?? 0,
      }
    }),
  };
}

function calculateAnthropicCost(
  usage: AnthropicUsage,
  model: string
): AnthropicCostBreakdown {
  const pricing = getAnthropicPricing(model, usage.totalInputTokens);

  const input = microCost(usage.inputTokens, pricing.inputPerMTok);
  const cacheRead = microCost(usage.cacheReadTokens, pricing.cacheReadPerMTok);
  const output = microCost(usage.outputTokens, pricing.outputPerMTok);

  // Cache write: use TTL-specific rates if available
  let cacheWrite: number;
  if (usage.cacheCreation) {
    cacheWrite = microCost(usage.cacheCreation.ephemeral5m, pricing.cacheWrite5mPerMTok)
               + microCost(usage.cacheCreation.ephemeral1h, pricing.cacheWrite1hPerMTok);
  } else {
    cacheWrite = microCost(usage.cacheCreationTokens, pricing.cacheWrite5mPerMTok);
  }

  return {
    input,
    cacheWrite,
    cacheRead,
    output,
    totalMicrodollars: input + cacheWrite + cacheRead + output,
    isLongContext: pricing.isLongContext ?? false,
    isFallbackPricing: pricing.isFallback ?? false,
  };
}

// Integer-only: no floating point in money calculations
function microCost(tokens: number, rateMicrodollarsPerMTok: number): number {
  return Math.round((tokens * rateMicrodollarsPerMTok) / 1_000);
}
```

---

## Implementation Checklist

- [ ] `parseAnthropicUsage()` — three disjoint fields, never assume total
- [ ] `calculateAnthropicCost()` — independent rates, not base+premium
- [ ] TTL-specific cache write handling (5m vs 1h)
- [ ] Long context detection (>200K total input → double rates)
- [ ] `microCost()` helper — integer arithmetic only
- [ ] Anthropic pricing table in DB (Sonnet 4.6, Opus 4.6, Haiku 4.5)
- [ ] Tests AC-1 through AC-7 (all derived from real competitor bugs)
- [ ] Streaming parser — see `04-streaming-bugs.md`
