import { type NextRequest, NextResponse } from "next/server";

import { createProxySupabaseClient } from "@/lib/auth/supabase";

export async function proxy(request: NextRequest) {
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

  // Set CSP header — start with Report-Only for safe rollout
  response.headers.set(
    "Content-Security-Policy-Report-Only",
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
