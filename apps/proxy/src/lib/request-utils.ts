/**
 * Force-merge stream_options.include_usage = true when stream is enabled.
 * Cost tracking depends on the usage chunk; this overrides user settings.
 */
export function ensureStreamOptions(body: Record<string, unknown>): void {
  if (body.stream !== true) return;

  if (!body.stream_options || typeof body.stream_options !== "object") {
    body.stream_options = { include_usage: true };
    return;
  }

  (body.stream_options as Record<string, unknown>).include_usage = true;
}

export function extractModelFromBody(body: Record<string, unknown>): string {
  return typeof body.model === "string" ? body.model : "unknown";
}

const ATTRIBUTION_MAX_LENGTH = 128;
const ATTRIBUTION_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateAttributionHeader(value: string | null): string | null {
  if (value === null) return null;
  if (value.length > ATTRIBUTION_MAX_LENGTH || !ATTRIBUTION_PATTERN.test(value)) {
    return null;
  }
  return value;
}

export function extractAttribution(request: Request): {
  userId: string | null;
  apiKeyId: string | null;
  actionId: string | null;
} {
  return {
    userId: validateAttributionHeader(request.headers.get("x-agentseam-user-id")),
    apiKeyId: validateAttributionHeader(request.headers.get("x-agentseam-key-id")),
    actionId: validateAttributionHeader(request.headers.get("x-agentseam-action-id")),
  };
}
