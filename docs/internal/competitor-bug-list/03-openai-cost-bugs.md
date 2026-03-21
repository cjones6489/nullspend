# Technical Deep Dive: OpenAI & Other Provider Cost Bugs & Remediation

> **Purpose:** Working reference for Cursor. OpenAI cost bugs are less common
> than Anthropic's but still significant — cached token overcharges up to 10.9×,
> reasoning token miscounts, and provider-specific semantic differences.
>
> **Scope filter:** OpenAI, xAI, and future provider cost issues. Anthropic has
> its own file (`02-anthropic-cost-bugs.md`). Streaming-specific issues are in
> `04-streaming-bugs.md`.
>
> **Strategic alignment:** OpenAI is the V1 launch provider. Getting this right
> on day one means every demo and every tutorial "just works." These bugs are
> lower severity than Anthropic's but affect the launch experience.

---

## OpenAI Usage Object (the source of truth)

```json
{
  "usage": {
    "prompt_tokens": 19,
    "completion_tokens": 10,
    "total_tokens": 29,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  }
}
```

**Key semantic difference from Anthropic:**
- `prompt_tokens` = TOTAL (including cached). `cached_tokens` is a SUBSET.
- `completion_tokens` = TOTAL (including reasoning). `reasoning_tokens` is a SUBSET.

### The Correct Cost Formula

```
cost = (prompt_tokens - cached_tokens) × input_rate
     + cached_tokens × cached_input_rate
     + completion_tokens × output_rate
```

Note: `reasoning_tokens` are already inside `completion_tokens` and billed at
the same output rate. No special handling needed for cost — just for display.

### Pricing Table (March 2026, selected models)

| Model | Input/MTok | Cached Input/MTok | Output/MTok | Cache Discount |
|---|---|---|---|---|
| GPT-5 | $1.25 | $0.125 | $10.00 | 90% off |
| GPT-4.1 | $2.00 | $0.50 | $8.00 | 75% off |
| GPT-4o | $2.50 | $1.25 | $10.00 | 50% off |
| o3 | $2.00 | $0.50 | $8.00 | 75% off |
| o4-mini | $1.10 | $0.275 | $4.40 | 75% off |

OpenAI has NO cache write surcharge (unlike Anthropic).

---

## Bug OC-1: Cached tokens charged at full price (10.9× overcharge)

**Source:** LiteLLM #19680 (Jan 2026), #11364 (Jan 2026, still open)

**What happens:** LiteLLM charges all `prompt_tokens` at the base input rate,
ignoring the discount for `cached_tokens`. With 91% cache hit rates, the
overcharge is 10.9× — user documented $5.09 charged vs $0.46 actual.

**Exact numbers:** 8,477,162 prompt tokens, 7,715,693 cached, 10,699 output
on gpt-4o.

**Root cause:** `generic_cost_per_token` doesn't subtract cached from total
before applying the base rate.

**Remediation:**

```typescript
function calculateOpenAICost(usage: OpenAIUsage, model: string): CostBreakdown {
  const pricing = getOpenAIPricing(model);

  const cachedTokens = usage.promptTokensDetails?.cachedTokens ?? 0;
  const uncachedInput = usage.promptTokens - cachedTokens;

  const input = microCost(uncachedInput, pricing.inputPerMTok);
  const cachedInput = microCost(cachedTokens, pricing.cachedInputPerMTok);
  const output = microCost(usage.completionTokens, pricing.outputPerMTok);

  return {
    input,
    cachedInput,
    output,
    totalMicrodollars: input + cachedInput + output,
  };
}
```

**Test (pseudocode — CRITICAL):**

```typescript
describe("OC-1: Cached tokens use discounted rate", () => {
  it("handles 91% cache hit correctly on gpt-4o", () => {
    const cost = calculateOpenAICost({
      promptTokens: 8_477_162,
      completionTokens: 10_699,
      promptTokensDetails: { cachedTokens: 7_715_693 },
    }, "gpt-4o");

    // Uncached: (8,477,162 - 7,715,693) = 761,469 × $2.50/MTok
    // Cached:   7,715,693 × $1.25/MTok
    // Output:   10,699 × $10.00/MTok
    const expectedInput = microCost(761_469, 2_500_000);     // ~1_903_673
    const expectedCached = microCost(7_715_693, 1_250_000);  // ~9_644_616
    const expectedOutput = microCost(10_699, 10_000_000);    // ~106_990

    expect(cost.input).toBe(expectedInput);
    expect(cost.cachedInput).toBe(expectedCached);
    expect(cost.output).toBe(expectedOutput);

    // Total should be ~$11.66, NOT ~$31.29 (the LiteLLM bug)
    const buggyTotal = microCost(8_477_162, 2_500_000) + expectedOutput;
    expect(cost.totalMicrodollars).toBeLessThan(buggyTotal);
  });

  it("handles zero cached tokens", () => {
    const cost = calculateOpenAICost({
      promptTokens: 1000,
      completionTokens: 500,
      promptTokensDetails: { cachedTokens: 0 },
    }, "gpt-4o");

    // All input at base rate, nothing cached
    expect(cost.input).toBe(microCost(1000, 2_500_000));
    expect(cost.cachedInput).toBe(0);
  });

  it("handles missing promptTokensDetails gracefully", () => {
    const cost = calculateOpenAICost({
      promptTokens: 1000,
      completionTokens: 500,
      // No promptTokensDetails at all
    }, "gpt-4o");

    // Conservative: treat all as uncached
    expect(cost.input).toBe(microCost(1000, 2_500_000));
    expect(cost.cachedInput).toBe(0);
  });
});
```

---

## Bug OC-2: Reasoning tokens mishandled

**Source:** Langfuse docs, tech spec §1

**What happens (potential):** Reasoning models (o3, o4-mini) produce hidden
reasoning tokens that are INSIDE `completion_tokens` but invisible in the
response content. A simple prompt can generate 192 reasoning tokens for 22
visible output tokens. If we try to infer cost from visible output text,
we'll undercharge by ~9×.

Langfuse explicitly documents they "cannot infer costs for reasoning models
unless explicit token usage is provided."

**Root cause:** Reasoning tokens are invisible — you can't count them from
the response content.

**Remediation:**

NullSpend reads `completion_tokens` directly from the usage object — never
infers from response text. Reasoning tokens are a display concern, not a
cost concern.

```typescript
// Reasoning tokens: SUBSET of completion_tokens, same rate
// No special cost handling needed — just extract for display
function parseOpenAIUsage(body: unknown): OpenAIUsage {
  const usage = (body as any)?.usage;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    promptTokensDetails: {
      cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      audioTokens: usage.prompt_tokens_details?.audio_tokens ?? 0,
    },
    completionTokensDetails: {
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      audioTokens: usage.completion_tokens_details?.audio_tokens ?? 0,
    },
  };
}
```

**Test (acceptance criteria):**

```
OC-2a: Reasoning tokens don't inflate cost
  GIVEN: completion_tokens=200, reasoning_tokens=180 (subset)
  THEN: Output cost = 200 × output_rate
  NOT: 200 × output_rate + 180 × output_rate

OC-2b: Reasoning tokens captured for display
  GIVEN: Response from o3 with reasoning_tokens=500
  THEN: Cost event includes reasoningTokens=500 for dashboard display
  AND: Cost calculation uses only completion_tokens total
```

---

## Bug OC-3: Responses API field name differences

**Source:** OpenAI docs, tech spec §1

**What happens (potential):** OpenAI's newer Responses API uses different field
names: `input_tokens` instead of `prompt_tokens`, `output_tokens` instead of
`completion_tokens`, `input_tokens_details` instead of `prompt_tokens_details`.
Same semantics, different keys.

**Remediation:**

Detect which API format is in use and normalize:

```typescript
function parseOpenAIUsage(body: unknown): OpenAIUsage {
  const usage = (body as any)?.usage;
  if (!usage) throw new Error("No usage in OpenAI response");

  // Chat Completions API: prompt_tokens / completion_tokens
  // Responses API: input_tokens / output_tokens
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;

  const promptDetails = usage.prompt_tokens_details ?? usage.input_tokens_details;
  const completionDetails = usage.completion_tokens_details ?? usage.output_tokens_details;

  return {
    promptTokens,
    completionTokens,
    promptTokensDetails: {
      cachedTokens: promptDetails?.cached_tokens ?? 0,
      audioTokens: promptDetails?.audio_tokens ?? 0,
    },
    completionTokensDetails: {
      reasoningTokens: completionDetails?.reasoning_tokens ?? 0,
      audioTokens: completionDetails?.audio_tokens ?? 0,
    },
  };
}
```

**Test (acceptance criteria):**

```
OC-3a: Chat Completions API format parsed correctly
  GIVEN: { prompt_tokens: 100, completion_tokens: 50 }
  THEN: promptTokens=100, completionTokens=50

OC-3b: Responses API format parsed correctly
  GIVEN: { input_tokens: 100, output_tokens: 50 }
  THEN: promptTokens=100, completionTokens=50

OC-3c: Both formats produce identical cost
  GIVEN: Same token counts in both formats
  THEN: Identical cost output
```

---

## Bug OC-4: xAI cached token semantics differ from OpenAI

**Source:** LiteLLM #14874 (Sept 2025)

**What happens:** xAI returns `prompt_tokens_details.text_tokens` as TOTAL
prompt tokens (including cached) instead of non-cached. LiteLLM's generic
handler treats this as non-cached tokens, then adds cached tokens — double-counting.

**Root cause:** Provider-specific semantic differences in identically-named fields.

**Remediation (future — xAI not in V1 scope):**

Each provider gets its own parser. Never share parsing logic across providers.

```typescript
// Provider detection happens at the proxy level based on upstream host
function parseUsage(provider: Provider, body: unknown): NormalizedUsage {
  switch (provider) {
    case "openai": return parseOpenAIUsage(body);
    case "anthropic": return parseAnthropicUsage(body);
    // Future providers:
    case "xai": return parseXAIUsage(body);
    case "google": return parseGeminiUsage(body);
    default: return parseFallbackUsage(body);
  }
}
```

**Design principle:** No `genericParser`. Each provider is isolated. The
cost of code duplication is far less than the cost of a semantic mismatch bug.

**Test (acceptance criteria — future):**

```
OC-4: Provider-specific parsing is isolated
  GIVEN: Two providers return { prompt_tokens_details: { text_tokens: 100 } }
  WHEN: text_tokens means "total" for Provider A but "non-cached" for Provider B
  THEN: Each parser applies correct semantics independently
```

---

## Bug OC-5: Image output tokens charged as text (12× undercharge)

**Source:** LiteLLM #14819, #17410 (Sept/Dec 2025)

**What happens:** For multimodal models generating images, LiteLLM treats
image output tokens as text. Image tokens are 12× more expensive.

**Remediation (future — not V1):**

```typescript
// When we add image model support:
function calculateMultimodalCost(usage: OpenAIUsage, model: string) {
  const pricing = getOpenAIPricing(model);
  const imageTokens = usage.completionTokensDetails?.imageTokens ?? 0;
  const textTokens = usage.completionTokens - imageTokens;

  return {
    textOutput: microCost(textTokens, pricing.outputPerMTok),
    imageOutput: microCost(imageTokens, pricing.imageOutputPerMTok),
  };
}
```

**Test (acceptance criteria — future):**

```
OC-5: Image tokens use image rate, not text rate
  GIVEN: completion_tokens=1500, image_tokens=1290
  THEN: 1290 tokens at image rate, 210 tokens at text rate
```

---

## Bug OC-6: Failed requests still counted

**Source:** Langfuse #7767 (cross-provider, documented here for OpenAI context)

**What happens:** Langfuse infers cost from input parameters even when the
provider returned an error. A rejected request costs $0 at the provider but
shows $1.24+ in Langfuse.

**Remediation:**

```typescript
async function handleResponse(
  response: Response,
  reservationId: string,
  provider: Provider
): Promise<void> {
  if (!response.ok) {
    // Provider returned error — cost is $0
    await releaseReservation(reservationId);
    // Log the error but no cost event
    return;
  }

  // Only calculate cost from successful responses with usage data
  const body = await response.json();
  const usage = parseUsage(provider, body);
  const cost = calculateCost(usage, provider);
  await reconcile(reservationId, cost.totalMicrodollars);
}
```

**Test (pseudocode — CRITICAL):**

```typescript
describe("OC-6: Failed requests produce zero cost", () => {
  it("releases reservation on 429 rate limit", async () => {
    const key = await createApiKey({ budgetMicrodollars: 10_000_000 });
    mockUpstream.respondWith(429, { error: "rate_limited" });

    const budgetBefore = await getRemainingBudget(key.id);
    await proxy("/v1/chat/completions", { headers: auth(key), body: validRequest });
    const budgetAfter = await getRemainingBudget(key.id);

    // Budget should be fully restored — no cost incurred
    expect(budgetAfter).toBe(budgetBefore);
  });

  it("releases reservation on 400 bad request", async () => {
    const key = await createApiKey({ budgetMicrodollars: 10_000_000 });
    mockUpstream.respondWith(400, { error: "invalid_request" });

    const budgetBefore = await getRemainingBudget(key.id);
    await proxy("/v1/chat/completions", { headers: auth(key), body: badRequest });
    const budgetAfter = await getRemainingBudget(key.id);

    expect(budgetAfter).toBe(budgetBefore);
  });

  it("does NOT log a cost event for failed requests", async () => {
    const key = await createApiKey();
    mockUpstream.respondWith(500, { error: "server_error" });

    await proxy("/v1/chat/completions", { headers: auth(key), body: validRequest });

    const events = await getCostEvents(key.id);
    expect(events).toHaveLength(0);
  });
});
```

---

## Parser Design: `parseOpenAIUsage()`

```typescript
interface OpenAIUsage {
  promptTokens: number;
  completionTokens: number;
  promptTokensDetails: {
    cachedTokens: number;
    audioTokens: number;
  };
  completionTokensDetails: {
    reasoningTokens: number;
    audioTokens: number;
  };
}

interface OpenAICostBreakdown {
  input: number;          // microdollars — uncached input
  cachedInput: number;    // microdollars — cached input (discounted)
  output: number;         // microdollars — all output tokens
  totalMicrodollars: number;
  isFallbackPricing: boolean;
}

function calculateOpenAICost(
  usage: OpenAIUsage,
  model: string
): OpenAICostBreakdown {
  const pricing = getOpenAIPricing(model);

  const cachedTokens = usage.promptTokensDetails.cachedTokens;
  const uncachedInput = usage.promptTokens - cachedTokens;

  const input = microCost(uncachedInput, pricing.inputPerMTok);
  const cachedInput = microCost(cachedTokens, pricing.cachedInputPerMTok);
  const output = microCost(usage.completionTokens, pricing.outputPerMTok);

  return {
    input,
    cachedInput,
    output,
    totalMicrodollars: input + cachedInput + output,
    isFallbackPricing: pricing.isFallback ?? false,
  };
}
```

---

## Implementation Checklist

- [ ] `parseOpenAIUsage()` — handles both Chat Completions and Responses API
- [ ] `calculateOpenAICost()` — cached tokens at discounted rate
- [ ] `microCost()` shared helper — integer-only arithmetic
- [ ] OpenAI pricing table (GPT-5, GPT-4.1, GPT-4o, o3, o4-mini)
- [ ] Failed response → zero cost + reservation release
- [ ] Tests OC-1 through OC-6
- [ ] Streaming usage extraction — see `04-streaming-bugs.md`
