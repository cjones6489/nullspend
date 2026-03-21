import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { NullSpendAgentOptions } from "./types.js";

const DEFAULT_PROXY_URL = "https://proxy.nullspend.com";
const MAX_TAG_KEYS = 10;
const MAX_TAG_KEY_LENGTH = 64;
const MAX_TAG_VALUE_LENGTH = 256;
const TAG_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const ACTION_ID_PATTERN =
  /^ns_act_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEWLINE_RE = /[\r\n]/;

function sanitizeHeaderValue(value: string, field: string): string {
  if (NEWLINE_RE.test(value)) {
    throw new Error(
      `withNullSpend: ${field} must not contain newline characters`,
    );
  }
  return value;
}

export function withNullSpend(
  options: NullSpendAgentOptions & Options,
): Options {
  const {
    apiKey,
    budgetSessionId,
    tags,
    traceId,
    actionId,
    proxyUrl,
    ...sdkOptions
  } = options;

  if (!apiKey) throw new Error("withNullSpend: apiKey is required");

  // Validate traceId format (must match proxy's ^[0-9a-f]{32}$)
  if (traceId && !TRACE_ID_PATTERN.test(traceId)) {
    throw new Error(
      'withNullSpend: traceId must be a 32-char lowercase hex string (e.g. "abcdef0123456789abcdef0123456789")',
    );
  }

  // Validate actionId format (must match proxy's stripNsPrefix("ns_act_", ...))
  if (actionId && !ACTION_ID_PATTERN.test(actionId)) {
    throw new Error(
      'withNullSpend: actionId must be in ns_act_<UUID> format (e.g. "ns_act_550e8400-e29b-41d4-a716-446655440000")',
    );
  }

  if (tags) {
    const keys = Object.keys(tags);
    if (keys.length > MAX_TAG_KEYS) {
      throw new Error(
        `withNullSpend: tags must have at most ${MAX_TAG_KEYS} keys`,
      );
    }
    for (const k of keys) {
      if (!TAG_KEY_PATTERN.test(k)) {
        throw new Error(
          `withNullSpend: tag key "${k}" must match [a-zA-Z0-9_-]+`,
        );
      }
      if (k.length > MAX_TAG_KEY_LENGTH) {
        throw new Error(
          `withNullSpend: tag key "${k}" exceeds ${MAX_TAG_KEY_LENGTH} chars`,
        );
      }
      if (tags[k].length > MAX_TAG_VALUE_LENGTH) {
        throw new Error(
          `withNullSpend: tag value for "${k}" exceeds ${MAX_TAG_VALUE_LENGTH} chars`,
        );
      }
    }
  }

  // Sanitize all header values against newline injection
  const safeApiKey = sanitizeHeaderValue(apiKey, "apiKey");
  const customHeaders: string[] = [`x-nullspend-key: ${safeApiKey}`];

  if (budgetSessionId) {
    const safe = sanitizeHeaderValue(budgetSessionId, "budgetSessionId");
    customHeaders.push(`x-nullspend-session: ${safe}`);
  }
  if (tags && Object.keys(tags).length > 0)
    customHeaders.push(`x-nullspend-tags: ${JSON.stringify(tags)}`);
  if (traceId) customHeaders.push(`x-nullspend-trace-id: ${traceId}`);
  if (actionId) customHeaders.push(`x-nullspend-action-id: ${actionId}`);

  // Merge with any existing custom headers from the caller
  const existingHeaders = sdkOptions.env?.ANTHROPIC_CUSTOM_HEADERS;
  if (existingHeaders) customHeaders.unshift(existingHeaders);

  // Always include process.env as the base so the child process retains
  // PATH, HOME, ANTHROPIC_API_KEY, etc. User-provided env vars override.
  const existingEnv = {
    ...(typeof process !== "undefined" ? process.env : {}),
    ...(sdkOptions.env ?? {}),
  };

  return {
    ...sdkOptions,
    env: {
      ...existingEnv,
      ANTHROPIC_BASE_URL: proxyUrl ?? DEFAULT_PROXY_URL,
      ANTHROPIC_CUSTOM_HEADERS: customHeaders.join("\n"),
    },
  };
}
