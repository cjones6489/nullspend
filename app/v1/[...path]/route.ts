import { NextResponse } from "next/server";

const GATEWAY_TIMEOUT_MS = 130_000; // Slightly above upstream 120s timeout

// Headers to forward from client to Worker (allowlist — strip cookies/session)
const FORWARD_HEADERS = [
  "x-nullspend-key",
  "x-nullspend-action-id",
  "content-type",
] as const;

function buildForwardHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

async function proxyToGateway(request: Request): Promise<Response> {
  const gatewayUrl = process.env.NULLSPEND_GATEWAY_URL;
  if (!gatewayUrl) {
    return NextResponse.json(
      { error: "gateway_not_configured", message: "NULLSPEND_GATEWAY_URL is not set" },
      { status: 502 },
    );
  }

  const url = new URL(request.url);
  const destination = new URL(url.pathname + url.search, gatewayUrl);

  const workerResponse = await fetch(destination.toString(), {
    method: request.method,
    headers: buildForwardHeaders(request),
    body: request.body,
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    // @ts-expect-error -- Next.js extends RequestInit with duplex for streaming
    duplex: "half",
  });

  // Return Worker response with streaming support (SSE for LLM responses)
  return new Response(workerResponse.body, {
    status: workerResponse.status,
    headers: workerResponse.headers,
  });
}

export async function POST(request: Request) {
  return proxyToGateway(request);
}

export async function GET(request: Request) {
  return proxyToGateway(request);
}
