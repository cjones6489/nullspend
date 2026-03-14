# Proxy Worker (@nullspend/proxy)

Cloudflare Workers proxy that sits between agents and OpenAI. Authenticates requests, tracks costs, and enforces budgets.

## Commands

```bash
pnpm test             # Run proxy tests (from this directory)
pnpm dev              # Start wrangler dev server
pnpm deploy           # Deploy to Cloudflare
```

## Critical Rules

- **NEVER use `passThroughOnException()`** — proxy must fail closed (502), never forward unauthenticated/untracked requests to origin
- **NEVER add failover logic** that bypasses auth or cost tracking — this undermines the entire FinOps purpose
- Auth check must be the absolute first thing before any processing
- Body size limit (1MB) enforced both pre-read (Content-Length) and post-read (byte count)

## Testing

- Tests live in `src/__tests__/` directory
- Mock `cloudflare:workers` with `vi.mock("cloudflare:workers", ...)`
- Mock `@upstash/redis/cloudflare` for Redis
- Polyfill `crypto.subtle.timingSafeEqual` in `beforeAll`
- `makeEnv()` helper returns typed `Env` with test values
- `makeCtx()` helper returns mock `ExecutionContext`

## Architecture

- `src/index.ts` — entry point, routing, body parsing
- `src/routes/openai.ts` — chat completions handler
- `src/lib/auth.ts` — platform key validation (timing-safe)
- `src/lib/cost-calculator.ts` — token-to-cost conversion
- `src/lib/cost-logger.ts` — async DB write via `ctx.waitUntil()`
- `src/lib/sse-parser.ts` — streaming response parser for usage extraction
- `src/lib/headers.ts` — header sanitization (strip proxy headers, forward OpenAI headers)

## Cost Tracking Flow

```
Request → Auth → Forward to OpenAI → Parse response/stream → Extract usage → Calculate cost → Log async via waitUntil()
```

Non-streaming: parse JSON response for `usage` field.
Streaming: SSE parser accumulates chunks, extracts final `usage` from `[DONE]`-adjacent message.
