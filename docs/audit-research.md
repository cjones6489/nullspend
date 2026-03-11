# Audit Remediation Research

**Date:** March 2026
**Sources:** Next.js 16.1.6 docs, Supabase docs, Cloudflare Workers docs, OWASP guidelines, Upstash docs

This document captures research findings to inform the correct implementation of fixes from `docs/audit-findings.md`.

---

## Table of Contents

1. [Next.js 16 Security Patterns](#1-nextjs-16-security-patterns)
2. [Supabase RLS & Auth](#2-supabase-rls--auth)
3. [Cloudflare Workers Proxy Security](#3-cloudflare-workers-proxy-security)
4. [SSRF Prevention & Slack Security](#4-ssrf-prevention--slack-security)
5. [Rate Limiting with Upstash](#5-rate-limiting-with-upstash)
6. [Implementation Recipes](#6-implementation-recipes)

---

## 1. Next.js 16 Security Patterns

### 1.1 CSRF Protection

**Key fact:** Next.js 16 has built-in CSRF for Server Actions (Origin vs Host validation) but **NOT for Route Handlers** (`route.ts`). All our API routes need manual CSRF protection.

**Recommended pattern — Origin header validation in `proxy.ts`:**

```ts
function validateOrigin(request: NextRequest): NextResponse | null {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    return null;
  }

  const origin = request.headers.get('origin');
  if (!origin) return null; // Non-browser or same-origin — allow through

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  try {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 400 });
  }

  return null;
}
```

**Why this works:** Browser-initiated cross-origin requests always include the `Origin` header. API-key-authenticated requests from non-browser clients (SDKs, agents) typically don't include `Origin`, so they pass through — their auth is validated by the API key, not session cookies.

**Note:** Requests without `Origin` are allowed through because API-key-authenticated non-browser clients won't send it. The session-based routes are protected because browsers always send `Origin` on cross-origin requests.

### 1.2 Body Size Limits

**New in Next.js 16:** `proxyClientMaxBodySize` config option (experimental, default 10MB). However, it only **warns** when exceeded — it does NOT reject.

For strict enforcement, check `Content-Length` in `proxy.ts` and use a streaming reader in route handlers:

```ts
// In proxy.ts — quick Content-Length check
const MAX_BODY_BYTES = 1_048_576; // 1MB
const contentLength = request.headers.get('content-length');
if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
  return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
}
```

```ts
// In route handlers — streaming reader with byte limit
async function readBodySafe(request: Request, maxBytes = 1_048_576) {
  const reader = request.body?.getReader();
  if (!reader) return { body: '' };

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > maxBytes) {
      reader.cancel();
      return { error: `Body exceeds ${maxBytes} bytes` };
    }
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  return { body: chunks.map(c => decoder.decode(c, { stream: true })).join('') + decoder.decode() };
}
```

### 1.3 401 vs 403 Status Codes

Next.js 15.1+ introduced experimental `unauthorized()` (401) and `forbidden()` (403) functions from `next/navigation`. Requires `experimental.authInterrupts: true` in next.config. These render custom error pages.

For API routes returning JSON, use explicit status codes:
- **401 Unauthorized**: Identity unknown (missing/invalid API key, no session)
- **403 Forbidden**: Identity known but not permitted (wrong role, CSRF failure)

### 1.4 proxy.ts Runtime

**Important change:** `proxy.ts` in Next.js 16 runs on the **Node.js runtime** by default (stable since v15.5.0). This means `crypto.randomUUID()`, `new URL()`, and other Node.js APIs are available without polyfills.

### 1.5 What Changed in Next.js 15-16

| Feature | Status |
|---------|--------|
| `middleware.ts` -> `proxy.ts` | Renamed in v16.0.0. `middleware` is deprecated. |
| `proxy.ts` runs Node.js runtime | Stable since v15.5.0. |
| `proxyClientMaxBodySize` | New experimental config (default 10MB, warn-only). |
| `unauthorized()` / `forbidden()` | Experimental since v15.1.0 |
| Server Actions CSRF | Built-in Origin vs Host validation |
| Route Handler CSRF | Manual — no built-in protection |
| Vercel WAF Rate Limiting | Available on all plans (1M included requests) |

---

## 2. Supabase RLS & Auth

### 2.1 Service Role Key Bypasses RLS

**Critical fact:** Both the service role key AND direct Postgres connections (Drizzle ORM via `DATABASE_URL`) bypass ALL RLS policies. Our app uses Drizzle for all server-side DB operations, so RLS serves as **defense-in-depth** for the PostgREST API surface.

| Context | RLS Status | Auth Check |
|---------|-----------|------------|
| Drizzle ORM (server actions, API routes) | Bypassed | Application code (`resolveSessionUserId()`) |
| Supabase JS client (browser, anon key) | Enforced | RLS policies + JWT |
| Supabase JS client (server, cookie-based) | Enforced | RLS policies + JWT from cookie |
| Proxy worker (direct DB) | Bypassed | API key validation in code |

### 2.2 RLS Policy Templates

```sql
-- Enable RLS on all tables
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_events ENABLE ROW LEVEL SECURITY;

-- actions: owner_user_id-based
CREATE POLICY "actions_select_own" ON actions FOR SELECT
  USING (auth.uid()::text = owner_user_id);
CREATE POLICY "actions_insert_own" ON actions FOR INSERT
  WITH CHECK (auth.uid()::text = owner_user_id);
CREATE POLICY "actions_update_own" ON actions FOR UPDATE
  USING (auth.uid()::text = owner_user_id)
  WITH CHECK (auth.uid()::text = owner_user_id);

-- api_keys: user_id-based
CREATE POLICY "api_keys_select_own" ON api_keys FOR SELECT
  USING (auth.uid()::text = user_id);
CREATE POLICY "api_keys_insert_own" ON api_keys FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "api_keys_update_own" ON api_keys FOR UPDATE
  USING (auth.uid()::text = user_id);

-- slack_configs: user_id-based
CREATE POLICY "slack_configs_select_own" ON slack_configs FOR SELECT
  USING (auth.uid()::text = user_id);
CREATE POLICY "slack_configs_insert_own" ON slack_configs FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "slack_configs_update_own" ON slack_configs FOR UPDATE
  USING (auth.uid()::text = user_id);

-- budgets: entity-based (user OR api_key ownership)
CREATE POLICY "budgets_select_own" ON budgets FOR SELECT
  USING (
    (entity_type = 'user' AND entity_id = auth.uid()::text)
    OR (entity_type = 'api_key' AND entity_id IN (
      SELECT id::text FROM api_keys WHERE user_id = auth.uid()::text
    ))
  );

-- cost_events: read-only for user (append-only table)
CREATE POLICY "cost_events_select_own" ON cost_events FOR SELECT
  USING (auth.uid()::text = user_id);

-- Deny anonymous access to all tables
REVOKE ALL ON actions FROM anon;
REVOKE ALL ON api_keys FROM anon;
REVOKE ALL ON slack_configs FROM anon;
REVOKE ALL ON budgets FROM anon;
REVOKE ALL ON cost_events FROM anon;
```

**Note:** `auth.uid()` returns `uuid`. Our schema stores user IDs as `text`, so the `::text` cast is required.

### 2.3 `getClaims()` vs `getUser()` — Security Implications

| Method | Network Call | Trust Level |
|--------|-------------|-------------|
| `getSession()` | No | **Untrusted** — JWT from client cookie |
| `getClaims()` | No | **Untrusted** — same JWT, decoded locally |
| `getUser()` | **Yes** (Supabase Auth API) | **Trusted** — server-validated |

**Finding:** Our `getCurrentUserId()` uses `getClaims()`, which does NOT validate the JWT server-side. A sophisticated attacker could forge JWT claims. For security-critical operations (approve/reject, key management), we should use `getUser()`.

**Recommendation:**
- Keep `getClaims()` in `proxy.ts` (triggers refresh, no network call, acceptable)
- Switch to `getUser()` in `resolveSessionUserId()` and `resolveApprovalActor()` for trusted identity

### 2.4 User Deletion Cascade

Supabase Auth user deletion does NOT cascade to application tables. Recommended approach for a FinOps platform (audit trail matters):

**Soft-delete trigger on `auth.users` deletion:**

```sql
CREATE OR REPLACE FUNCTION public.handle_user_soft_deletion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.api_keys
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE user_id = OLD.id::text;
  UPDATE public.slack_configs
    SET is_active = false
    WHERE user_id = OLD.id::text;
  -- actions, cost_events, budgets preserved for audit trail
  RETURN OLD;
END;
$$;

CREATE TRIGGER on_auth_user_deleted
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_soft_deletion();
```

---

## 3. Cloudflare Workers Proxy Security

### 3.1 `passThroughOnException()` — REMOVE IT

**Critical finding:** Our proxy calls `passThroughOnException()` on line 8 of `index.ts`. When the Worker throws an uncaught exception, Cloudflare forwards the **original, unmodified request** (including the `Authorization` header with the OpenAI API key) to the origin.

Additionally, the explicit catch block in our code (lines 47-58) does `fetch(failoverUrl, { headers: buildFailoverHeaders(request) })` which forwards the Authorization header to OpenAI **without cost tracking**.

**Both paths bypass auth AND cost tracking.** This undermines the entire FinOps purpose.

**Recommendation:** Remove `passThroughOnException()` entirely. AI proxies should **fail closed** (return 500/502), never fail open (forward to origin). A failed proxy request with a clear error is vastly preferable to an untracked, potentially unauthenticated request.

```ts
// BEFORE (dangerous):
ctx.passThroughOnException();
try { ... } catch { return fetch(openai, { headers: original }); }

// AFTER (safe):
// No passThroughOnException
try { ... } catch (err) {
  console.error("[proxy] Error:", err);
  return Response.json({ error: "internal_error" }, { status: 502 });
}
```

### 3.2 Auth-First Architecture

Auth must be the **absolute first thing** that runs before any fallback logic:

```
Request → URL routing → Body parsing → AUTH CHECK → Rate limit → Body size → Process → Cost tracking → Response
                                          ↓ fail
                                        401 (hard stop, never forward to origin)
```

### 3.3 Rate Limiting in Workers

Cloudflare has a **built-in Rate Limiting binding** for Workers:

```jsonc
// wrangler.jsonc
{
  "rate_limiting": [{
    "binding": "RATE_LIMITER",
    "namespace_id": "1001",
    "simple": { "limit": 100, "period": 60 }
  }]
}
```

```ts
const { success } = await env.RATE_LIMITER.limit({ key: apiKeyHash });
if (!success) return Response.json({ error: "rate_limited" }, { status: 429 });
```

Alternatively, use `@upstash/ratelimit` since we already have `@upstash/redis` in the proxy.

### 3.4 Body Size Limits in Workers

Current max: **100MB** on paid plan. But we should enforce much lower limits for chat completions:

```ts
const MAX_BODY_SIZE = 1_048_576; // 1MB

// Check Content-Length first (cheap)
const contentLength = request.headers.get("content-length");
if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
  return Response.json({ error: "payload_too_large" }, { status: 413 });
}

// Also check after reading (Content-Length can be spoofed/missing)
const bodyText = await request.text();
if (bodyText.length > MAX_BODY_SIZE) {
  return Response.json({ error: "payload_too_large" }, { status: 413 });
}
```

### 3.5 `ctx.waitUntil()` Reliability

- Extends Worker lifetime beyond response being sent
- Best-effort: if isolate is terminated, in-flight promises may be dropped
- For **guaranteed** cost event delivery, consider Cloudflare Workers Queues:

```jsonc
// wrangler.jsonc
{ "queues": { "producers": [{ "binding": "COST_QUEUE", "queue": "agentseam-cost-events" }] } }
```

```ts
// Producer (in proxy): send to queue instead of direct DB write
await env.COST_QUEUE.send(costEvent);

// Consumer (batch insert): at-least-once delivery, auto-retry
export default {
  async queue(batch, env) {
    const db = drizzle({ client: new Client({ connectionString: env.HYPERDRIVE.connectionString }) });
    await db.insert(costEvents).values(batch.messages.map(m => m.body));
  }
};
```

### 3.6 Connection Pooling

Our proxy creates a **new `pg.Client` per request** in `cost-logger.ts`. This is expensive. Options:
- **Hyperdrive** (already configured in wrangler.jsonc) — handles connection pooling at the Cloudflare edge
- **Workers Queues** (recommended) — batch inserts, 1 connection per 100 events instead of per event

---

## 4. SSRF Prevention & Slack Security

### 4.1 Webhook URL Validation — The Vulnerability

**Current code** (`lib/validations/slack.ts:7`):
```ts
.refine((url) => url.startsWith("https://hooks.slack.com/"), { ... })
```

This is vulnerable because `"https://hooks.slack.com.evil.com/"` passes the check.

**Correct pattern — `new URL()` + hostname check:**

```ts
function isSlackWebhookUrl(raw: string): boolean {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }

  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "hooks.slack.com") return false;
  if (parsed.port !== "") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;

  return ["/services/", "/workflows/", "/triggers/"].some(
    prefix => parsed.pathname.startsWith(prefix)
  );
}
```

**Node.js URL parsing is safe** in Node.js 18+ (WHATWG spec). Key edge cases are handled:
- Null bytes throw TypeError
- Encoded dots in hostname are NOT decoded (won't match)
- Backslashes are treated as path separators (hostname unaffected)
- `username`/`password` check blocks auth info in URLs

### 4.2 Slack Callback User Authorization

**Current gap:** Any Slack workspace member who sees the channel can approve/reject any action. No user-to-owner mapping exists.

**Recommended fix:** Store the Slack user ID during config setup, verify on callback:

```ts
// On callback:
const slackUserId = payload.user.id;
const [config] = await db.select().from(slackConfigs)
  .where(eq(slackConfigs.userId, action.ownerUserId));

if (config?.slackUserId && config.slackUserId !== slackUserId) {
  return errorMessage("You are not authorized to decide this action.");
}
```

### 4.3 Webhook URL Encryption at Rest

Webhook URLs contain secret tokens. Should be encrypted with AES-256-GCM:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY = Buffer.from(process.env.WEBHOOK_ENCRYPTION_KEY!, "hex"); // 32 bytes

function encryptWebhookUrl(url: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}
```

### 4.4 Masking Webhook URLs in API Responses

```ts
function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const masked = segments.map((seg, i) => i < 2 ? seg : seg.slice(0, 4) + "****");
    return `${parsed.protocol}//${parsed.hostname}/${masked.join("/")}`;
  } catch {
    return url.slice(0, 40) + "****";
  }
}
// "https://hooks.slack.com/services/T00/B00****/xR5h****"
```

### 4.5 Zod Validation Hardening

**Sanitize Zod errors before returning to clients:**
```ts
// Current (leaks schema details):
issues: error.issues

// Fixed:
issues: error.issues.map(issue => ({ path: issue.path, message: issue.message }))
```

**Prototype pollution with `z.record()`:**
```ts
const safeRecord = z.record(z.string(), z.unknown()).transform(obj => {
  const { __proto__, constructor, prototype, ...safe } = obj;
  return safe;
});
```

**`z.coerce.number()` accepts hex/Infinity:**
```ts
// Current: z.coerce.number() — accepts "0x1a", "Infinity", "1e308"
// Safer: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100))
```

---

## 5. Rate Limiting with Upstash

### 5.1 Package: `@upstash/ratelimit`

Latest stable: v2.x. Three algorithms available:

| Algorithm | Redis Commands | Best For |
|-----------|---------------|----------|
| `Ratelimit.fixedWindow(n, window)` | 1 per check | Simple protection |
| `Ratelimit.slidingWindow(n, window)` | 2-3 per check | **Recommended** — no boundary burst |
| `Ratelimit.tokenBucket(refill, interval, max)` | 2-3 per check | Burst-tolerant APIs |

### 5.2 Integration Pattern

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, "1 m"),
  prefix: "agentseam:ratelimit",
  ephemeralCache: new Map(), // reduces Redis calls for repeat offenders
});

const { success, limit, remaining, reset } = await ratelimit.limit(identifier);
```

### 5.3 Local Development Without Redis

```ts
const redis = process.env.UPSTASH_REDIS_REST_URL
  ? Redis.fromEnv()
  : Ratelimit.ephemeralCache(); // In-memory, non-distributed, resets on restart
```

### 5.4 Recommended Architecture — Layered Rate Limiting

| Layer | Scope | Tool | Where |
|-------|-------|------|-------|
| 1. Infrastructure | IP-based DDoS protection | Vercel WAF | Vercel dashboard (zero code) |
| 2. Application (Next.js) | Per-IP for API routes | `@upstash/ratelimit` in `proxy.ts` | `proxy.ts` |
| 3. Application (Proxy) | Per-API-key | `@upstash/ratelimit` or CF Rate Limiting binding | `apps/proxy/src/index.ts` |
| 4. Per-endpoint | Sensitive operations | Per-route limiter instance | Individual route handlers |

### 5.5 Suggested Limits

| Endpoint | Limit | Rationale |
|----------|-------|-----------|
| API routes (general) | 100 req/min per user | General protection |
| Action creation (`POST /api/actions`) | 20 req/min per user | Prevents DB flooding |
| API key creation (`POST /api/keys`) | 5 req/min per user | Prevents key sprawl |
| Slack callbacks | 60 req/min per workspace | Slack's own rate limits |
| Proxy (`/v1/chat/completions`) | 120 req/min per API key | Prevents cost runaway |
| Key revocation | 10 req/min per user | Prevents accidental mass revocation |

### 5.6 Cost at Scale

| Daily API Calls | Redis Commands (sliding window) | Monthly Cost (pay-as-you-go) |
|-----------------|--------------------------------|------------------------------|
| 10,000 | ~25,000/day | ~$1.50 |
| 100,000 | ~250,000/day | ~$15 |
| 1,000,000 | ~2,500,000/day | ~$150 (consider Pro plan) |

---

## 6. Implementation Recipes

### Recipe A: Hardened `proxy.ts` (CSRF + body limits + CSP + rate limiting)

Combines our existing CSP implementation with new CSRF, body limit, and rate limiting. This is the target state for `proxy.ts`:

```ts
import { type NextRequest, NextResponse } from "next/server";
import { createProxySupabaseClient } from "@/lib/auth/supabase";

const MAX_BODY_BYTES = 1_048_576; // 1MB

export async function proxy(request: NextRequest) {
  // --- CSRF: Origin validation for state-changing API requests ---
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
  ) {
    const origin = request.headers.get("origin");
    if (origin) {
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
      try {
        if (new URL(origin).host !== host) {
          return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid origin" }, { status: 400 });
      }
    }

    // Body size check
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
  }

  // --- Rate limiting (add @upstash/ratelimit when ready) ---
  // if (request.nextUrl.pathname.startsWith("/api/")) {
  //   const identifier = request.ip ?? "127.0.0.1";
  //   const { success } = await ratelimit.limit(identifier);
  //   if (!success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  // }

  // --- CSP: Nonce-based Content Security Policy ---
  const nonce = crypto.randomUUID();
  const isDev = process.env.NODE_ENV === "development";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let supabaseOrigin = "", supabaseWs = "";
  try {
    supabaseOrigin = new URL(supabaseUrl).origin;
    supabaseWs = supabaseOrigin.replace("https://", "wss://");
  } catch { /* Supabase not configured */ }

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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy-Report-Only", cspDirectives.join("; "));

  // --- Supabase session refresh ---
  try {
    const supabase = createProxySupabaseClient(request, response);
    await supabase.auth.getClaims();
  } catch { /* Supabase not configured */ }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

### Recipe B: Hardened Proxy Worker `index.ts`

```ts
// Remove passThroughOnException(), add body size check, fail closed
const MAX_BODY_SIZE = 1_048_576;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // NO passThroughOnException() — fail closed

    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        // Body size check
        const contentLength = request.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
          return Response.json({ error: "payload_too_large" }, { status: 413 });
        }

        const bodyText = await request.text();
        if (bodyText.length > MAX_BODY_SIZE) {
          return Response.json({ error: "payload_too_large" }, { status: 413 });
        }

        const body = JSON.parse(bodyText);
        return await handleChatCompletions(request, env, body);
      }

      return Response.json({ error: "not_found" }, { status: 404 });
    } catch (err) {
      // NEVER fall back to origin
      console.error("[proxy] Error:", err);
      return Response.json({ error: "internal_error" }, { status: 502 });
    }
  },
};
```

### Recipe C: SSRF-Safe Slack Webhook Validation

```ts
const ALLOWED_SLACK_PATH_PREFIXES = ["/services/", "/workflows/", "/triggers/"];

function isSlackWebhookUrl(raw: string): boolean {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }

  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "hooks.slack.com") return false;
  if (parsed.port !== "") return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;

  return ALLOWED_SLACK_PATH_PREFIXES.some(p => parsed.pathname.startsWith(p));
}
```

### Recipe D: Zod Error Sanitization

```ts
function sanitizeZodIssues(issues: ZodIssue[]) {
  return issues.map(issue => ({
    path: issue.path,
    message: issue.message,
    // Omit: code, expected, received, unionErrors, etc.
  }));
}
```

---

## Open Questions

1. **Rate limiting dependency**: Add `@upstash/ratelimit` to both root `package.json` and `apps/proxy/package.json`? Or just one?
2. **Webhook encryption key management**: Where to store `WEBHOOK_ENCRYPTION_KEY`? Vercel env vars? Supabase Vault?
3. **RLS migration**: Apply via Drizzle migration SQL or Supabase dashboard? Drizzle doesn't natively manage RLS policies.
4. **`getUser()` latency**: Switching from `getClaims()` to `getUser()` adds a network call per request. Acceptable trade-off for security-critical routes?
5. **Proxy failover removal**: Removing `passThroughOnException()` means requests fail hard if the Worker has a bug. Is this acceptable for production? (Answer: yes, for a FinOps proxy, untracked requests are worse than failed requests.)
