const UPSTREAM_FORWARD_HEADERS = [
  "authorization",
  "openai-organization",
  "openai-project",
] as const;

/**
 * Build headers for the upstream OpenAI request.
 * Forwards auth and content headers, strips proxy-specific and unsafe headers.
 */
export function buildUpstreamHeaders(request: Request): Headers {
  const headers = new Headers();

  for (const name of UPSTREAM_FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  headers.set("content-type", "application/json");

  return headers;
}

const CLIENT_FORWARD_HEADERS = [
  "content-type",
  "x-request-id",
] as const;

/**
 * Build headers for the client response.
 * Forwards content-type, request ID, and rate-limit headers from OpenAI.
 */
export function buildClientHeaders(upstreamResponse: Response, apiVersion?: string): Headers {
  const headers = new Headers();

  for (const name of CLIENT_FORWARD_HEADERS) {
    const value = upstreamResponse.headers.get(name);
    if (value) headers.set(name, value);
  }

  for (const [name, value] of upstreamResponse.headers) {
    if (name.startsWith("x-ratelimit-")) {
      headers.set(name, value);
    }
  }

  const retryAfter = upstreamResponse.headers.get("retry-after");
  if (retryAfter) {
    headers.set("retry-after", retryAfter);
  }

  if (apiVersion) {
    headers.set("NullSpend-Version", apiVersion);
  }

  return headers;
}
