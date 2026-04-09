import { type NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { createProxySupabaseClient } from "@/lib/auth/supabase";
import { logger } from "@/lib/observability";

const MAX_BODY_BYTES = 1_048_576; // 1MB

// Singleton rate limiter — initialized once, reused across requests.
// Returns null if Upstash env vars are not configured.
let _limiter: Ratelimit | null | undefined;

/** @internal Reset singleton for testing only */
export function _resetRatelimitForTesting() { _limiter = undefined; }
function getRatelimit(): Ratelimit | null {
  if (_limiter !== undefined) return _limiter;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    _limiter = null;
    return null;
  }
  _limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(100, "1 m"),
    prefix: "nullspend:api:rl",
    ephemeralCache: new Map(),
  });
  return _limiter;
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  // Attach request ID to any response returned from proxy
  function withRequestId(response: NextResponse): NextResponse {
    response.headers.set("x-request-id", requestId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  // --- Rate limiting for API routes ---
  // Stripe webhooks are exempt — authenticated via signature verification, and
  // rate limiting could cause 429s that trigger cascading Stripe retries.
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/api/stripe/webhook")
  ) {
    const limiter = getRatelimit();
    if (limiter) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        ?? request.headers.get("x-real-ip")
        ?? "127.0.0.1";
      try {
        // `pending` intentionally not captured — no analytics or MultiRegion configured.
        const { success, limit, remaining, reset } = await limiter.limit(ip);
        if (!success) {
          return withRequestId(NextResponse.json(
            { error: { code: "rate_limit_exceeded", message: "Too many requests.", details: null } },
            {
              status: 429,
              headers: {
                "X-RateLimit-Limit": String(limit),
                "X-RateLimit-Remaining": String(remaining),
                "X-RateLimit-Reset": String(reset),
                "Retry-After": String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
              },
            },
          ));
        }
      } catch (err) {
        logger.error({ requestId, err }, "Rate limiter error");
        // M1: Fail closed — block request when rate limiter is unavailable
        return withRequestId(NextResponse.json(
          { error: { code: "service_unavailable", message: "Service temporarily unavailable.", details: null } },
          { status: 503 },
        ));
      }
    }
  }

  // --- CSRF: Origin validation for state-changing API requests ---
  // Stripe webhooks are exempt — authenticated via signature verification, not origin.
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/api/stripe/webhook") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
  ) {
    const origin = request.headers.get("origin") ?? request.headers.get("referer");
    if (origin) {
      const host =
        request.headers.get("x-forwarded-host") || request.headers.get("host");
      try {
        if (new URL(origin).host !== host) {
          return withRequestId(NextResponse.json(
            { error: { code: "csrf_rejected", message: "Cross-origin request blocked.", details: null } },
            { status: 403 },
          ));
        }
      } catch {
        return withRequestId(NextResponse.json(
          { error: { code: "invalid_origin", message: "Invalid origin.", details: null } },
          { status: 400 },
        ));
      }
    }

    // Body size check
    const contentLength = request.headers.get("content-length");
    const contentLengthNum = contentLength ? parseInt(contentLength, 10) : NaN;
    if (!isNaN(contentLengthNum) && contentLengthNum > MAX_BODY_BYTES) {
      return withRequestId(NextResponse.json(
        { error: { code: "payload_too_large", message: "Payload too large.", details: null } },
        { status: 413 },
      ));
    }
  }

  // Base64-encode the nonce to match the CSP3 spec (nonce-source = "'nonce-" base64-value "'")
  // and to match the official Next.js CSP example exactly.
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let supabaseOrigin = "";
  let supabaseWs = "";
  try {
    supabaseOrigin = new URL(supabaseUrl).origin;
    supabaseWs = supabaseOrigin.replace("https://", "wss://");
  } catch {
    // Supabase URL not configured — CSP will use 'self' only
  }

  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ""}`,
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin} ${supabaseWs}` : ""}`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];
  const cspHeaderName = isDev
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
  const cspHeaderValue = cspDirectives.join("; ");

  // Inject nonce, request ID, AND the CSP header into the request headers
  // for downstream handlers. Setting the CSP header on the REQUEST (not just
  // the response) is required by Next.js 16's nonce auto-propagation — it
  // reads the CSP from the request headers to identify the nonce and stamp
  // it onto framework scripts, page bundles, inline styles, and <Script>
  // components during rendering.
  // Source: https://nextjs.org/docs/app/guides/content-security-policy
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set(cspHeaderName, cspHeaderValue);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);

  // Prevent CDN/browser caching of ALL responses from this middleware.
  // Every response carries a per-request CSP nonce both in the header
  // (set below) and injected into <script nonce="..."> tags in the HTML
  // by Next.js's auto-propagation (which requires the root layout to be
  // dynamically rendered — see app/layout.tsx).
  // If Vercel/the CDN caches the HTML body, subsequent requests get a
  // fresh CSP nonce in the header but a STALE nonce baked into the HTML,
  // and the browser blocks every script (React fails to hydrate).
  // See: .gstack/qa-reports/qa-report-nullspend-dev-2026-04-08.md ISSUE-001
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.append("Vary", "Cookie");

  // Enforce CSP in production, report-only in development
  response.headers.set(cspHeaderName, cspHeaderValue);

  try {
    const supabase = createProxySupabaseClient(request, response);
    await supabase.auth.getClaims();
  } catch {
    // If Supabase env vars are missing, let the request through.
    // Route-level auth checks will handle the error.
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
