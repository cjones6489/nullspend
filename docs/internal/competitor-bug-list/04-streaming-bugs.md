# Technical Deep Dive: Streaming Parsing Bugs & Remediation

> **Purpose:** Working reference for Cursor. Most cost calculation errors
> manifest during streaming because SSE parsing requires careful state
> management. This file defines the streaming parser state machines for
> OpenAI and Anthropic.
>
> **Scope filter:** Only streaming-specific issues. For the underlying cost
> formulas see `02-anthropic-cost-bugs.md` and `03-openai-cost-bugs.md`.
>
> **Strategic alignment:** Most real-world LLM usage is streaming. If the
> streaming parser is wrong, every cost event is wrong, every budget check
> uses wrong data, and the product is untrustworthy.

---

## The Core Streaming Challenge

The proxy must:
1. Forward SSE chunks to the client in real-time (zero added latency)
2. Extract usage data from the stream without modifying it
3. Calculate cost after the stream completes
4. Never block the response while doing cost work

This is a tee-and-process pattern: the stream is forked, one copy goes to
the client unchanged, the other is parsed for usage data.

---

## Bug SP-1: Anthropic cumulative delta treated as incremental (2× cost)

**Source:** LangChain.js #10249 (March 2026), Cline #4346

**What happens:** Anthropic streaming sends cache token counts in both
`message_start` and the cumulative `message_delta`. LangChain's
`mergeInputTokenDetails` naively adds them:
```javascript
output.cache_read = (a?.cache_read ?? 0) + (b?.cache_read ?? 0)
```
Result: exactly 2× the real cache token counts.

The Anthropic SDK type definitions explicitly document that `message_delta`
values are cumulative: `"The cumulative number of input tokens read from the cache"`.

**Root cause:** Treating cumulative snapshots as incremental deltas.

**Remediation: The Anthropic Streaming State Machine**

```typescript
interface AnthropicStreamState {
  // Input tokens: captured ONCE from message_start, never updated
  inputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;

  // Output tokens: OVERWRITTEN (not summed) from each message_delta
  outputTokens: number | null;

  // Completion flag
  complete: boolean;
}

class AnthropicStreamParser {
  private state: AnthropicStreamState = {
    inputTokens: null,
    cacheCreationTokens: null,
    cacheReadTokens: null,
    outputTokens: null,
    complete: false,
  };

  processEvent(event: SSEEvent): void {
    switch (event.type) {
      case "message_start":
        // Input tokens arrive HERE and only here
        const startUsage = event.data?.message?.usage;
        if (startUsage) {
          this.state.inputTokens = startUsage.input_tokens ?? 0;
          this.state.cacheCreationTokens = startUsage.cache_creation_input_tokens ?? 0;
          this.state.cacheReadTokens = startUsage.cache_read_input_tokens ?? 0;
        }
        break;

      case "message_delta":
        // Output tokens arrive HERE — OVERWRITE, never sum
        const deltaUsage = event.data?.usage;
        if (deltaUsage) {
          this.state.outputTokens = deltaUsage.output_tokens; // overwrite
        }
        break;

      case "message_stop":
        this.state.complete = true;
        break;
    }
  }

  getUsage(): AnthropicUsage | null {
    if (!this.state.complete) return null;
    if (this.state.inputTokens === null) return null;

    return {
      inputTokens: this.state.inputTokens,
      cacheCreationTokens: this.state.cacheCreationTokens ?? 0,
      cacheReadTokens: this.state.cacheReadTokens ?? 0,
      outputTokens: this.state.outputTokens ?? 0,
      totalInputTokens: this.state.inputTokens
        + (this.state.cacheCreationTokens ?? 0)
        + (this.state.cacheReadTokens ?? 0),
    };
  }
}
```

**Critical rule:** `message_start` → capture input ONCE. `message_delta` →
OVERWRITE output. Never sum across events. The final `getUsage()` call after
`message_stop` returns the correct values.

**Test (pseudocode — CRITICAL):**

```typescript
describe("SP-1: Anthropic streaming — cumulative delta handling", () => {
  it("does NOT double-count cache tokens from start + delta", () => {
    const parser = new AnthropicStreamParser();

    // message_start has cache_read=5000
    parser.processEvent({
      type: "message_start",
      data: { message: { usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 5000,
      }}}
    });

    // message_delta ALSO has cache_read=5000 (cumulative, same value)
    parser.processEvent({
      type: "message_delta",
      data: { usage: { output_tokens: 200 }}
    });

    parser.processEvent({ type: "message_stop" });

    const usage = parser.getUsage();
    expect(usage.cacheReadTokens).toBe(5000);  // NOT 10000
    expect(usage.outputTokens).toBe(200);
  });

  it("overwrites output tokens on each delta, not sums", () => {
    const parser = new AnthropicStreamParser();

    parser.processEvent({
      type: "message_start",
      data: { message: { usage: { input_tokens: 100 }}}
    });

    // 5 deltas with cumulative output counts
    parser.processEvent({ type: "message_delta", data: { usage: { output_tokens: 50 }}});
    parser.processEvent({ type: "message_delta", data: { usage: { output_tokens: 120 }}});
    parser.processEvent({ type: "message_delta", data: { usage: { output_tokens: 200 }}});
    parser.processEvent({ type: "message_delta", data: { usage: { output_tokens: 350 }}});
    parser.processEvent({ type: "message_delta", data: { usage: { output_tokens: 503 }}});

    parser.processEvent({ type: "message_stop" });

    const usage = parser.getUsage();
    expect(usage.outputTokens).toBe(503);  // Last value only
    // NOT 50+120+200+350+503 = 1223 (the LangChain/Cline bug)
  });
});
```

---

## Bug SP-2: OpenAI streaming usage extraction

**Source:** OpenAI docs, existing proxy SSE parser tests

**What happens (if wrong):** OpenAI requires `stream_options: {"include_usage": true}`
for usage in streaming. Usage arrives in the FINAL SSE chunk before `[DONE]`,
with an empty `choices` array. If the parser doesn't look at the last chunk,
or confuses it with a normal chunk, usage is lost.

**Remediation: The OpenAI Streaming State Machine**

```typescript
class OpenAIStreamParser {
  private usage: OpenAIRawUsage | null = null;
  private model: string | null = null;
  private complete: boolean = false;

  processChunk(data: string): void {
    if (data === "[DONE]") {
      this.complete = true;
      return;
    }

    try {
      const parsed = JSON.parse(data);

      // Capture model from first chunk
      if (!this.model && parsed.model) {
        this.model = parsed.model;
      }

      // Usage arrives in the final chunk with empty choices
      if (parsed.usage) {
        this.usage = parsed.usage;
      }
    } catch {
      // Malformed chunk — skip, don't crash
    }
  }

  getUsage(): OpenAIUsage | null {
    if (!this.complete || !this.usage) return null;
    return parseOpenAIUsage({ usage: this.usage });
  }

  getModel(): string | null {
    return this.model;
  }
}
```

**Test (pseudocode):**

```typescript
describe("SP-2: OpenAI streaming usage extraction", () => {
  it("extracts usage from final chunk", () => {
    const parser = new OpenAIStreamParser();

    // Normal content chunks
    parser.processChunk('{"id":"c1","model":"gpt-4o","choices":[{"delta":{"content":"Hi"}}]}');
    parser.processChunk('{"id":"c1","model":"gpt-4o","choices":[{"delta":{"content":" there"}}]}');

    // Final chunk with usage and empty choices
    parser.processChunk('{"id":"c1","model":"gpt-4o","choices":[],"usage":{"prompt_tokens":23,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":10}}}');

    parser.processChunk("[DONE]");

    const usage = parser.getUsage();
    expect(usage).not.toBeNull();
    expect(usage.promptTokens).toBe(23);
    expect(usage.completionTokens).toBe(5);
    expect(usage.promptTokensDetails.cachedTokens).toBe(10);
  });

  it("returns null if stream has no usage chunk", () => {
    const parser = new OpenAIStreamParser();
    parser.processChunk('{"id":"c1","choices":[{"delta":{"content":"Hi"}}]}');
    parser.processChunk("[DONE]");

    expect(parser.getUsage()).toBeNull();
  });

  it("handles malformed chunks without crashing", () => {
    const parser = new OpenAIStreamParser();
    parser.processChunk("not-json");
    parser.processChunk('{"id":"c1","usage":{"prompt_tokens":10,"completion_tokens":5}}');
    parser.processChunk("[DONE]");

    // Should still extract usage from valid chunk
    expect(parser.getUsage()).not.toBeNull();
    expect(parser.getUsage().promptTokens).toBe(10);
  });
});
```

---

## Bug SP-3: SSE parsing across chunk boundaries

**Source:** Architectural concern (common in proxy implementations)

**What happens:** Network layers can split SSE events across TCP packet
boundaries. A single event might arrive as:
- Chunk 1: `data: {"id":"c1","cho`
- Chunk 2: `ices":[{"delta":{"content":"Hi"}}]}\n\n`

If the parser processes chunks as complete events, it crashes on partial JSON.

**Remediation:**

The SSE parser operates on the raw byte stream using a TransformStream that
buffers until a complete event boundary (`\n\n`) is found:

```typescript
function createSSEParser(
  inputStream: ReadableStream<Uint8Array>
): { readable: ReadableStream<Uint8Array>; resultPromise: Promise<ParseResult> } {
  let buffer = "";
  let usageParser: OpenAIStreamParser | AnthropicStreamParser;
  // ... parser selection based on provider

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // 1. Pass through to client immediately (zero latency)
      controller.enqueue(chunk);

      // 2. Buffer for parsing
      buffer += decoder.decode(chunk, { stream: true });

      // 3. Extract complete events from buffer
      while (true) {
        const eventEnd = buffer.indexOf("\n\n");
        if (eventEnd === -1) break; // no complete event yet

        const rawEvent = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);

        // Parse the event
        const dataMatch = rawEvent.match(/^data: (.+)$/m);
        if (dataMatch) {
          usageParser.processChunk(dataMatch[1]);
        }
      }
    },

    flush() {
      // Process any remaining buffer
      if (buffer.trim()) {
        const dataMatch = buffer.match(/^data: (.+)$/m);
        if (dataMatch) {
          usageParser.processChunk(dataMatch[1]);
        }
      }
    }
  });

  const readable = inputStream.pipeThrough(transform);
  const resultPromise = /* resolve when parser.complete */;

  return { readable, resultPromise };
}
```

**Key design:** The `controller.enqueue(chunk)` happens BEFORE any parsing.
The client never waits for our parsing to complete. If parsing fails, the
client still gets the full response — we just don't have cost data for it.

**Test (acceptance criteria):**

```
SP-3a: Events split across chunks are parsed correctly
  GIVEN: SSE event split into 3 TCP chunks
  WHEN: Parser processes all 3 chunks
  THEN: Complete event is extracted and parsed

SP-3b: Client receives bytes immediately regardless of parsing
  GIVEN: Upstream sends a chunk
  THEN: Client receives it in the same tick (no buffering delay)
  AND: Parsing happens asynchronously

SP-3c: Parser failure does not break response
  GIVEN: Malformed SSE event in the stream
  THEN: Client still receives the complete response
  AND: Cost data is null (logged as parse failure, not crash)
```

---

## Bug SP-4: WebSearch callback breaks spend tracking

**Source:** LiteLLM #20179

**What happens:** When OpenAI's WebSearch tool is enabled as a callback, the
callback modifies the request pipeline in a way that breaks the cost tracking
callback. Cost shows as $0.00 for all requests with WebSearch.

**Root cause:** Middleware ordering and mutation in the request pipeline.

**Remediation:**

NullSpend's cost extraction is the LAST step, operating on the final
response. It never depends on request-side middleware or callbacks. The
proxy handler structure:

```
Request → auth → budget → forward → [stream to client] → extract usage → cost event
```

Cost extraction reads the response AFTER it's been fully processed. Nothing
in the request pipeline can break it because it operates on the response.

**Test (acceptance criteria):**

```
SP-4: Tool-augmented responses still produce cost data
  GIVEN: OpenAI response that includes tool_calls (WebSearch, function calls)
  THEN: Usage object is still present in final streaming chunk
  AND: Cost event is logged with correct values
```

---

## Bug SP-5: Streaming cost used for budget reconciliation

**Source:** Architectural requirement (not a specific bug)

**What happens (if wrong):** Budget enforcement reserves an estimated cost
pre-request. After streaming completes, the actual cost must reconcile with
the reservation. If the streaming parser fails to extract usage, the
reservation is never reconciled — budget permanently loses the reserved amount.

**Remediation:**

```typescript
async function handleStreamingResponse(
  response: Response,
  reservationId: string,
  provider: Provider
): Promise<Response> {
  const { readable, resultPromise } = createSSEParser(response.body, provider);

  // Schedule reconciliation after stream completes (non-blocking)
  ctx.waitUntil(
    resultPromise.then(async (result) => {
      if (result.usage) {
        const cost = calculateCost(result.usage, provider, result.model);
        await reconcile(reservationId, cost.totalMicrodollars);
      } else {
        // Failed to extract usage — release reservation, log warning
        await releaseReservation(reservationId);
        logWarning("streaming_parse_failure", { reservationId, provider });
      }
    }).catch(async (error) => {
      // Parse error — release reservation to avoid permanent budget loss
      await releaseReservation(reservationId);
      logError("streaming_reconciliation_error", { error, reservationId });
    })
  );

  return new Response(readable, {
    status: response.status,
    headers: response.headers,
  });
}
```

**Key design:** `ctx.waitUntil()` ensures reconciliation happens even after
the response is sent to the client. If anything fails, the reservation is
released (not permanently consumed).

**Test (pseudocode — CRITICAL):**

```typescript
describe("SP-5: Streaming budget reconciliation", () => {
  it("reconciles actual cost after streaming completes", async () => {
    const key = await createApiKey({ budgetMicrodollars: 10_000_000 });
    mockUpstream.streamResponse([
      contentChunk("Hello"),
      usageChunk({ prompt_tokens: 100, completion_tokens: 50 }),
      doneChunk(),
    ]);

    const res = await proxy("/v1/chat/completions", {
      headers: auth(key),
      body: { ...request, stream: true },
    });

    // Drain the stream
    await drainStream(res.body);

    // Wait for async reconciliation
    await flushWaitUntil();

    const budget = await getRemainingBudget(key.id);
    const costEvents = await getCostEvents(key.id);

    expect(costEvents).toHaveLength(1);
    expect(costEvents[0].costMicrodollars).toBeGreaterThan(0);
    expect(budget).toBeLessThan(10_000_000); // budget was debited
  });

  it("releases reservation if streaming parse fails", async () => {
    const key = await createApiKey({ budgetMicrodollars: 10_000_000 });
    mockUpstream.streamResponse([
      contentChunk("Hello"),
      // No usage chunk — parse will fail
      doneChunk(),
    ]);

    const budgetBefore = await getRemainingBudget(key.id);
    const res = await proxy("/v1/chat/completions", {
      headers: auth(key),
      body: { ...request, stream: true },
    });
    await drainStream(res.body);
    await flushWaitUntil();

    const budgetAfter = await getRemainingBudget(key.id);
    // Reservation was released — budget fully restored
    expect(budgetAfter).toBe(budgetBefore);
  });
});
```

---

## Integration: SSE Parser + Provider Parsers + Budget System

```
                    ┌─────────────────────────────┐
                    │     Upstream Response        │
                    │   (SSE byte stream)          │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │   TransformStream (tee)      │
                    │   Pass bytes → client        │
                    │   Buffer → event parser      │
                    └──────┬──────────┬───────────┘
                           │          │
              ┌────────────▼──┐  ┌────▼────────────┐
              │  Client gets  │  │  Event parser    │
              │  full stream  │  │  (OpenAI or      │
              │  (no latency) │  │   Anthropic)     │
              └───────────────┘  └────┬────────────┘
                                      │
                              ┌───────▼──────────┐
                              │  Usage extracted  │
                              │  (or null)        │
                              └───────┬──────────┘
                                      │
                              ┌───────▼──────────┐
                              │  Cost calculator  │
                              │  (provider-       │
                              │   specific)       │
                              └───────┬──────────┘
                                      │
                              ┌───────▼──────────┐
                              │  Reconcile with   │
                              │  Redis budget     │
                              │  reservation      │
                              └──────────────────┘
```

---

## Implementation Checklist

- [ ] `AnthropicStreamParser` — state machine (capture once, overwrite delta)
- [ ] `OpenAIStreamParser` — final-chunk usage extraction
- [ ] SSE TransformStream — chunk boundary handling
- [ ] Provider detection for parser selection
- [ ] Streaming budget reconciliation via `ctx.waitUntil()`
- [ ] Reservation release on parse failure (never permanent budget loss)
- [ ] Tests SP-1 through SP-5
- [ ] Integration test: stream → parse → cost → reconcile end-to-end
