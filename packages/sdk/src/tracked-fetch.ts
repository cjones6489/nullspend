import type { CostEventInput, TrackedFetchOptions, TrackedProvider } from "./types.js";
import type { PolicyCache } from "./policy-cache.js";
import { validateCustomerId } from "./customer-id.js";
import {
  BudgetExceededError,
  MandateViolationError,
  SessionLimitExceededError,
  VelocityExceededError,
  TagBudgetExceededError,
} from "./errors.js";
import {
  isTrackedRoute,
  extractModelFromBody,
  isStreamingRequest,
  isStreamingResponse,
  extractOpenAIUsageFromJSON,
  extractAnthropicUsageFromJSON,
} from "./provider-parsers.js";
import {
  createOpenAISSEParser,
  createAnthropicSSEParser,
} from "./sse-parser.js";
import {
  calculateOpenAICostEvent,
  calculateAnthropicCostEvent,
} from "./cost-calculator.js";
import { getModelPricing } from "@nullspend/cost-engine";

/**
 * Build a tracked fetch function that intercepts LLM API calls and
 * automatically reports cost events.
 *
 * @param proxyUrl Optional proxy base URL. When set, requests whose URL starts
 *   with this value are detected as proxied and pass through without client-side
 *   tracking. Header-based detection (`x-nullspend-key`) is the always-on fallback.
 */
export function buildTrackedFetch(
  provider: TrackedProvider,
  options: TrackedFetchOptions | undefined,
  queueCost: (event: CostEventInput) => void,
  policyCache: PolicyCache | null,
  proxyUrl?: string,
): typeof globalThis.fetch {
  // Validate + normalize customer here so direct callers of createTrackedFetch
  // get the same fail-fast behavior as NullSpend.customer(). Throws on invalid
  // input — that is intentional, we want the error at fetch-builder construction
  // time, not at first request.
  const customer = options?.customer !== undefined ? validateCustomerId(options.customer) : undefined;
  const sessionId = options?.sessionId;
  const tags = options?.tags;
  const traceId = options?.traceId;
  const enforcement = options?.enforcement ?? false;
  const manualSessionLimit = options?.sessionLimitMicrodollars ?? null;
  const onCostError = options?.onCostError ?? defaultCostErrorHandler;
  const onDenied = options?.onDenied;

  const trackSessionSpend = !!(enforcement && sessionId);
  let sessionSpendMicrodollars = 0;
  const costSink = trackSessionSpend
    ? (event: CostEventInput) => {
        sessionSpendMicrodollars += event.costMicrodollars;
        queueCost(event);
      }
    : queueCost;

  const metadata = { sessionId, traceId, tags, customer };

  return async function trackedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Resolve URL from input
    const url = resolveUrl(input);

    // Inject X-NullSpend-Customer header if customer is set. This MUST happen
    // before the isProxied bailout — otherwise the header never reaches the
    // proxy and customer attribution is silently lost.
    //
    // WHATWG subtlety: when input is a Request and init.headers is set,
    // init.headers REPLACES the Request's headers entirely (dropping any
    // Authorization the caller baked into the Request). So if the caller
    // passed a Request without init.headers, we must inject the header into
    // a cloned Request instead of synthesizing an init.
    if (customer) {
      if (input instanceof Request && !init?.headers) {
        const newHeaders = new Headers(input.headers);
        newHeaders.set("X-NullSpend-Customer", customer);
        input = new Request(input, { headers: newHeaders });
      } else {
        init = addHeader(init, "X-NullSpend-Customer", customer);
      }
    }

    // Proxy detection guard: skip tracking if going through the proxy
    if (isProxied(url, init, proxyUrl)) {
      return globalThis.fetch(input, init);
    }

    // Non-tracked routes pass through
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (!isTrackedRoute(provider, url, method)) {
      return globalThis.fetch(input, init);
    }

    // Parse body for model + streaming detection
    const bodyStr = extractBody(input, init);
    const model = (bodyStr && extractModelFromBody(bodyStr)) ?? "unknown";
    const streaming = bodyStr ? isStreamingRequest(bodyStr) : false;

    // Phase 2: Cooperative enforcement
    if (enforcement && policyCache) {
      try {
        await policyCache.getPolicy();
        const mandateResult = policyCache.checkMandate(provider, model);
        if (!mandateResult.allowed) {
          safeDenied(onDenied, { type: "mandate", mandate: mandateResult.mandate!, requested: mandateResult.requested!, allowed: mandateResult.allowed_list! }, onCostError);
          throw new MandateViolationError(
            mandateResult.mandate!,
            mandateResult.requested!,
            mandateResult.allowed_list!,
          );
        }

        // Rough estimate for budget check
        const estimate = estimateCostMicrodollars(provider, model, bodyStr);
        const budgetResult = policyCache.checkBudget(estimate);
        if (!budgetResult.allowed) {
          safeDenied(onDenied, {
            type: "budget",
            remaining: budgetResult.remaining ?? 0,
            entityType: budgetResult.entityType,
            entityId: budgetResult.entityId,
            limit: budgetResult.limit,
            spend: budgetResult.spend,
          }, onCostError);
          throw new BudgetExceededError({
            remaining: budgetResult.remaining ?? 0,
            entityType: budgetResult.entityType,
            entityId: budgetResult.entityId,
            limit: budgetResult.limit,
            spend: budgetResult.spend,
          });
        }

        // Session limit check (only when sessionId is set)
        if (sessionId) {
          const sessionLimit = manualSessionLimit ?? policyCache.getSessionLimit() ?? null;
          if (sessionLimit !== null && sessionSpendMicrodollars + estimate > sessionLimit) {
            warnSessionDenied(sessionSpendMicrodollars, estimate, sessionLimit, sessionId);
            safeDenied(onDenied, { type: "session_limit", sessionSpend: sessionSpendMicrodollars, sessionLimit }, onCostError);
            throw new SessionLimitExceededError(sessionSpendMicrodollars, sessionLimit);
          }
        }
      } catch (err) {
        if (
          err instanceof BudgetExceededError ||
          err instanceof MandateViolationError ||
          err instanceof SessionLimitExceededError
        ) {
          throw err;
        }
        // Policy fetch failure — fall open, but still enforce manual session limit
        if (sessionId && manualSessionLimit !== null) {
          const estimate = estimateCostMicrodollars(provider, model, bodyStr);
          if (sessionSpendMicrodollars + estimate > manualSessionLimit) {
            warnSessionDenied(sessionSpendMicrodollars, estimate, manualSessionLimit, sessionId, true);
            safeDenied(onDenied, { type: "session_limit", sessionSpend: sessionSpendMicrodollars, sessionLimit: manualSessionLimit }, onCostError);
            throw new SessionLimitExceededError(sessionSpendMicrodollars, manualSessionLimit);
          }
        }
        onCostError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // For OpenAI streaming: inject stream_options.include_usage
    let modifiedInit = init;
    if (streaming && provider === "openai" && bodyStr) {
      modifiedInit = injectStreamUsage(bodyStr, init);
    } else if (!bodyStr && provider === "openai") {
      // Body couldn't be extracted (e.g., Request object with ReadableStream body).
      // OpenAI streaming won't include usage without stream_options.include_usage.
      // Non-streaming still works (usage in response JSON).
      onCostError(new Error(
        "Could not extract request body — OpenAI streaming usage will not be tracked. " +
        "Pass fetch(url, init) instead of fetch(request) for full tracking support.",
      ));
    }

    const startTime = performance.now();
    const response = await globalThis.fetch(input, modifiedInit ?? init);

    // Proxy 429 interception: detect NullSpend denial codes from proxy
    if (response.status === 429 && enforcement) {
      // Read Retry-After header before parsing body (used by velocity_exceeded)
      const retryAfterHeader = parseInt(response.headers.get("Retry-After") ?? "", 10) || undefined;

      try {
        const cloned = response.clone();
        const json = await cloned.json() as Record<string, unknown>;
        const errObj = json.error as Record<string, unknown> | undefined;
        if (errObj) {
          const code = errObj.code as string | undefined;
          const details = errObj.details as Record<string, unknown> | undefined;

          if (code === "budget_exceeded") {
            const entityType = details?.entity_type as string | undefined;
            const entityId = details?.entity_id as string | undefined;
            const limit = details?.budget_limit_microdollars as number | undefined;
            const spend = details?.budget_spend_microdollars as number | undefined;
            const remaining = Math.max(0, (limit ?? 0) - (spend ?? 0));
            safeDenied(onDenied, { type: "budget", remaining, entityType, entityId, limit, spend }, onCostError);
            throw new BudgetExceededError({ remaining, entityType, entityId, limit, spend });
          }

          if (code === "customer_budget_exceeded") {
            // Proxy emits a distinct code for customer-entity denials.
            // Details shape: { customer_id, budget_limit_microdollars, budget_spend_microdollars }
            // customer_id can be null per shared.ts:212; coerce to undefined.
            // Fall back to the SDK-side customer when the proxy didn't echo it.
            const rawCustomerId = details?.customer_id;
            const entityId = (typeof rawCustomerId === "string" ? rawCustomerId : undefined) ?? customer ?? undefined;
            const limit = toFiniteNumber(details?.budget_limit_microdollars);
            const spend = toFiniteNumber(details?.budget_spend_microdollars);
            const remaining = Math.max(0, (limit ?? 0) - (spend ?? 0));
            safeDenied(onDenied, { type: "budget", remaining, entityType: "customer", entityId, limit, spend }, onCostError);
            throw new BudgetExceededError({ remaining, entityType: "customer", entityId, limit, spend });
          }

          if (code === "velocity_exceeded") {
            // Proxy sends details: { limitMicrodollars, windowSeconds, currentMicrodollars }
            // Retry-after is in the Retry-After HTTP header, not in the JSON body
            const velLimit = details?.limitMicrodollars as number | undefined;
            const velWindow = details?.windowSeconds as number | undefined;
            const velCurrent = details?.currentMicrodollars as number | undefined;
            safeDenied(onDenied, {
              type: "velocity",
              retryAfterSeconds: retryAfterHeader,
              limit: velLimit,
              window: velWindow,
              current: velCurrent,
            }, onCostError);
            throw new VelocityExceededError({
              retryAfterSeconds: retryAfterHeader,
              limit: velLimit,
              window: velWindow,
              current: velCurrent,
            });
          }

          if (code === "session_limit_exceeded") {
            const sessionSpend = details?.session_spend_microdollars as number | undefined;
            const sessionLimit = details?.session_limit_microdollars as number | undefined;
            safeDenied(onDenied, { type: "session_limit", sessionSpend: sessionSpend ?? 0, sessionLimit: sessionLimit ?? 0 }, onCostError);
            throw new SessionLimitExceededError(sessionSpend ?? 0, sessionLimit ?? 0);
          }

          if (code === "tag_budget_exceeded") {
            // Proxy sends budget_spend_microdollars, not remaining — compute remaining
            const tagKey = details?.tag_key as string | undefined;
            const tagValue = details?.tag_value as string | undefined;
            const limit = details?.budget_limit_microdollars as number | undefined;
            const spend = details?.budget_spend_microdollars as number | undefined;
            const remaining = Math.max(0, (limit ?? 0) - (spend ?? 0));
            safeDenied(onDenied, { type: "tag_budget", tagKey, tagValue, remaining, limit, spend }, onCostError);
            throw new TagBudgetExceededError({ tagKey, tagValue, remaining, limit, spend });
          }
        }
      } catch (err) {
        if (
          err instanceof BudgetExceededError ||
          err instanceof VelocityExceededError ||
          err instanceof SessionLimitExceededError ||
          err instanceof TagBudgetExceededError
        ) throw err;
        // Not a NullSpend 429 (upstream provider 429 or parse failure) — fall through
      }
    }

    // Don't track errors
    if (!response.ok) return response;

    // Streaming response
    if (isStreamingResponse(response) && response.body) {
      return handleStreamingResponse(
        provider, model, response, startTime, metadata, costSink, onCostError,
      );
    }

    // Non-streaming response
    return handleNonStreamingResponse(
      provider, model, response, startTime, metadata, costSink, onCostError,
    );
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultCostErrorHandler(error: Error): void {
  console.warn("[nullspend] Cost tracking error:", error.message);
}

function safeDenied(
  onDenied: ((reason: import("./types.js").DenialReason) => void) | undefined,
  reason: import("./types.js").DenialReason,
  onCostError: (error: Error) => void,
): void {
  try {
    onDenied?.(reason);
  } catch (cbErr) {
    onCostError(cbErr instanceof Error ? cbErr : new Error(String(cbErr)));
  }
}

function warnSessionDenied(
  spend: number,
  estimate: number,
  limit: number,
  sessionId: string,
  fallback = false,
): void {
  const tag = fallback ? " (fallback)" : "";
  console.warn(
    `[nullspend] Session limit denied${tag}: spend=${spend} estimate=${estimate} limit=${limit} sessionId=${sessionId}`,
  );
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isProxied(url: string, init?: RequestInit, proxyUrl?: string): boolean {
  // Configurable proxyUrl match via URL origin (not substring — substring
  // matching allows "https://host.evil.com" to spoof "https://host").
  // The client constructor validates proxyUrl with `new URL()`, so we only
  // need to handle parse failures on the request URL side defensively.
  if (proxyUrl) {
    try {
      const requestOrigin = new URL(url).origin;
      const proxyOrigin = new URL(proxyUrl).origin;
      if (requestOrigin === proxyOrigin) return true;
    } catch {
      // Invalid URL on request side — fall through to header check
    }
  }
  // Header-based detection is the always-on fallback so callers can opt in
  // by setting x-nullspend-key on the request explicitly.
  if (init?.headers) {
    const headers = init.headers;
    if (headers instanceof Headers) {
      return headers.has("x-nullspend-key");
    }
    if (Array.isArray(headers)) {
      return headers.some(([k]) => k.toLowerCase() === "x-nullspend-key");
    }
    if (typeof headers === "object") {
      return "x-nullspend-key" in headers;
    }
  }
  return false;
}

/**
 * Coerce an unknown value to a finite number, or undefined if not coercible.
 * Guards against proxy details fields being strings or non-finite values.
 */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Add a header to a RequestInit, returning a new RequestInit. Handles all three
 * header formats (Headers object, array of tuples, plain object) without
 * mutating the caller's input.
 *
 * Case-insensitively dedupes existing entries with the same name so we never
 * emit duplicate headers (which have ambiguous semantics across fetch runtimes).
 */
function addHeader(init: RequestInit | undefined, name: string, value: string): RequestInit {
  const existing = init?.headers;
  if (existing instanceof Headers) {
    const next = new Headers(existing);
    next.set(name, value);  // Headers.set() is case-insensitive per spec
    return { ...init, headers: next };
  }
  const lowerName = name.toLowerCase();
  if (Array.isArray(existing)) {
    // Strip any existing entries with the same header name (case-insensitive),
    // then append the new one.
    const filtered = existing.filter(([k]) => k.toLowerCase() !== lowerName);
    return { ...init, headers: [...filtered, [name, value]] };
  }
  if (existing && typeof existing === "object") {
    // Strip any existing keys with the same name (case-insensitive),
    // then set the new one. Preserves the canonical casing the caller uses.
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(existing as Record<string, string>)) {
      if (k.toLowerCase() !== lowerName) next[k] = v;
    }
    next[name] = value;
    return { ...init, headers: next };
  }
  return { ...init, headers: { [name]: value } };
}

function extractBody(input: RequestInfo | URL, init?: RequestInit): string | null {
  if (init?.body && typeof init.body === "string") return init.body;
  // Note: Request.body is a ReadableStream, not a string — provider SDKs
  // always pass (url, init) where init.body is a JSON string, so this path
  // is not needed. If someone passes a Request object, body extraction fails
  // gracefully (model="unknown", streaming not detected, cost still tracked
  // from the response).
  return null;
}

function injectStreamUsage(bodyStr: string, init?: RequestInit): RequestInit | undefined {
  try {
    const parsed = JSON.parse(bodyStr);
    // Merge with existing stream_options, don't overwrite
    const streamOptions = parsed.stream_options ?? {};
    streamOptions.include_usage = true;
    parsed.stream_options = streamOptions;
    const newBody = JSON.stringify(parsed);

    // Clone init, replace body, strip Content-Length (will be recalculated)
    const newInit = { ...init, body: newBody };
    if (newInit.headers) {
      const headers = new Headers(newInit.headers as HeadersInit);
      headers.delete("content-length");
      newInit.headers = headers;
    }
    return newInit;
  } catch {
    return init;
  }
}

function estimateCostMicrodollars(
  provider: string,
  model: string,
  bodyStr: string | null,
): number {
  const pricing = getModelPricing(provider, model);
  if (!pricing) return 0;

  // Rough estimate: use max_tokens from body for output, 1000 for input
  let maxTokens = 4096;
  if (bodyStr) {
    try {
      const parsed = JSON.parse(bodyStr);
      if (typeof parsed.max_tokens === "number") maxTokens = parsed.max_tokens;
      if (typeof parsed.max_completion_tokens === "number") maxTokens = parsed.max_completion_tokens;
    } catch {
      // ignore
    }
  }

  const inputEstimate = 1000 * pricing.inputPerMTok;
  const outputEstimate = maxTokens * pricing.outputPerMTok;
  return Math.round(inputEstimate + outputEstimate);
}

async function handleStreamingResponse(
  provider: TrackedProvider,
  model: string,
  response: Response,
  startTime: number,
  metadata: { sessionId?: string; traceId?: string; tags?: Record<string, string>; customer?: string },
  queueCost: (event: CostEventInput) => void,
  onCostError?: (error: Error) => void,
): Promise<Response> {
  const body = response.body!;

  if (provider === "openai") {
    const { readable, resultPromise } = createOpenAISSEParser(body);

    // Fire-and-forget cost tracking
    resultPromise
      .then((result) => {
        if (!result.usage) return; // cancelled or no usage
        const durationMs = Math.round(performance.now() - startTime);
        const resolvedModel = result.model ?? model;
        const costEvent = calculateOpenAICostEvent(resolvedModel, result.usage, durationMs, metadata);
        queueCost(costEvent);
      })
      .catch((err) => {
        onCostError?.(err instanceof Error ? err : new Error(String(err)));
      });

    return new Response(readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  // Anthropic
  const { readable, resultPromise } = createAnthropicSSEParser(body);

  resultPromise
    .then((result) => {
      if (!result.usage) return;
      const durationMs = Math.round(performance.now() - startTime);
      const resolvedModel = result.model ?? model;
      const costEvent = calculateAnthropicCostEvent(
        resolvedModel, result.usage, result.cacheCreationDetail, durationMs, metadata,
      );
      queueCost(costEvent);
    })
    .catch((err) => {
      onCostError?.(err instanceof Error ? err : new Error(String(err)));
    });

  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function handleNonStreamingResponse(
  provider: TrackedProvider,
  model: string,
  response: Response,
  startTime: number,
  metadata: { sessionId?: string; traceId?: string; tags?: Record<string, string>; customer?: string },
  queueCost: (event: CostEventInput) => void,
  onCostError?: (error: Error) => void,
): Promise<Response> {
  try {
    const cloned = response.clone();
    const json = await cloned.json();
    const durationMs = Math.round(performance.now() - startTime);

    // Extract model from response if available
    const responseModel =
      json && typeof json === "object" && typeof (json as Record<string, unknown>).model === "string"
        ? (json as Record<string, unknown>).model as string
        : null;
    const resolvedModel = responseModel ?? model;

    if (provider === "openai") {
      const usage = extractOpenAIUsageFromJSON(json);
      if (usage) {
        const costEvent = calculateOpenAICostEvent(resolvedModel, usage, durationMs, metadata);
        queueCost(costEvent);
      }
    } else {
      const result = extractAnthropicUsageFromJSON(json);
      if (result) {
        const costEvent = calculateAnthropicCostEvent(
          resolvedModel, result.usage, result.cacheDetail, durationMs, metadata,
        );
        queueCost(costEvent);
      }
    }
  } catch (err) {
    onCostError?.(err instanceof Error ? err : new Error(String(err)));
  }

  return response;
}
