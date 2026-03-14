import { type NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { createProxySupabaseClient } from "@/lib/auth/supabase";

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
  // --- Rate limiting for API routes ---
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const limiter = getRatelimit();
    if (limiter) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        ?? request.headers.get("x-real-ip")
        ?? "127.0.0.1";
      try {
        const { success, limit, remaining, reset } = await limiter.limit(ip);
        if (!success) {
          return NextResponse.json(
            { error: "Too many requests" },
            {
              status: 429,
              headers: {
                "X-RateLimit-Limit": String(limit),
                "X-RateLimit-Remaining": String(remaining),
                "X-RateLimit-Reset": String(reset),
                "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)),
              },
            },
          );
        }
      } catch (err) {
        console.error("[NullSpend] Rate limiter error:", err);
        // M1: Fail closed — block request when rate limiter is unavailable
        return NextResponse.json(
          { error: "Service temporarily unavailable" },
          { status: 503 },
        );
      }
    }
  }

  // --- CSRF: Origin validation for state-changing API requests ---
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
  ) {
    const origin = request.headers.get("origin") ?? request.headers.get("referer");
    if (origin) {
      const host =
        request.headers.get("x-forwarded-host") || request.headers.get("host");
      try {
        if (new URL(origin).host !== host) {
          return NextResponse.json(
            { error: "Cross-origin request blocked" },
            { status: 403 },
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Invalid origin" },
          { status: 400 },
        );
      }
    }

    // Body size check
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Payload too large" },
        { status: 413 },
      );
    }
  }

  const nonce = crypto.randomUUID();
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

  // Inject nonce into request headers for Server Components to read
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Enforce CSP in production, report-only in development
  response.headers.set(
    isDev ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
    cspDirectives.join("; ")
  );

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
