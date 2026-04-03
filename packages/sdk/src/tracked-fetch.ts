import type { CostEventInput, TrackedFetchOptions, TrackedProvider } from "./types.js";
import type { PolicyCache } from "./policy-cache.js";
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
 */
export function buildTrackedFetch(
  provider: TrackedProvider,
  options: TrackedFetchOptions | undefined,
  queueCost: (event: CostEventInput) => void,
  policyCache: PolicyCache | null,
): typeof globalThis.fetch {
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

  const metadata = { sessionId, traceId, tags };

  return async function trackedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Resolve URL from input
    const url = resolveUrl(input);

    // Proxy detection guard: skip tracking if going through the proxy
    if (isProxied(url, init)) {
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

function isProxied(url: string, init?: RequestInit): boolean {
  if (url.includes("proxy.nullspend.com")) return true;
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
  metadata: { sessionId?: string; traceId?: string; tags?: Record<string, string> },
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
  metadata: { sessionId?: string; traceId?: string; tags?: Record<string, string> },
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
