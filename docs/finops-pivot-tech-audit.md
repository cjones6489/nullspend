# FinOps Pivot: Technology Sanity Check

> Pre-build research to catch big-picture issues before we start coding.
> Each section covers a key technology in the roadmap, what we found, and
> any risks or adjustments needed.

---

## 1. Cloudflare Workers as the proxy runtime

### Verdict: GO — with two gotchas to handle

**What works:**
- No wall clock time limit. Streaming LLM responses that take 30-60+ seconds
  are fine — only CPU time is metered, and waiting on network I/O doesn't
  count against it.
- CPU time limit is 30s by default on paid plans, configurable up to 5 minutes.
  For a proxy that mostly waits on upstream fetch calls, 30s of CPU is plenty.
- Request body limit is 100MB on paid plan (500MB enterprise). More than enough
  for even the largest LLM context windows with image inputs.
- Subrequest limit was raised to 10,000 per invocation in Feb 2026 (up from
  1,000). Each proxy call needs: 1 fetch to Redis, 1 fetch to LLM provider,
  1 fetch to Postgres for logging = 3 subrequests. No issue.
- Drizzle ORM works with Hyperdrive (Cloudflare's Postgres connection pooler).
  Official docs show the exact setup with `nodejs_compat` flag.

**Gotcha 1: `passThroughOnException()` does not preserve the request body.**

When the Worker throws and falls through to origin, the POST body is gone
(already consumed by the Worker). The tech spec assumes this "just works"
but it doesn't for POST requests.

**Mitigation:** Clone the request at the start of the handler before reading
the body. Use a manual try/catch with the cloned request as fallback:

```typescript
async fetch(request, env, ctx) {
  const requestClone = request.clone();
  ctx.passThroughOnException(); // last resort fallback

  try {
    const body = await request.json();
    // ... proxy logic ...
  } catch (err) {
    // Manual fallback with preserved body
    return fetch(requestClone);
  }
}
```

**Impact on roadmap:** Minor — just a pattern change in Phase 1. Not a blocker.

**Gotcha 2: `response.body.tee()` has a 128MB buffer limit.**

If one branch of the tee reads slower than the other, data buffers in memory.
For a typical LLM streaming response (text tokens), the total payload is small
(kilobytes to low megabytes), so this is unlikely to hit 128MB. But if a
response somehow generates an enormous output (huge code generation, etc.),
it could theoretically hit the limit.

**Mitigation:** For the async logging branch (in `waitUntil`), consume
chunks immediately as they arrive — don't accumulate. Just scan for the
`usage` object in the final chunk and discard everything else. This keeps
the buffer pressure near zero.

**Impact on roadmap:** Minor design consideration in Phase 1. Not a blocker.

---

## 2. `waitUntil()` for async post-response work

### Verdict: GO — with wall clock awareness

**What works:**
- `waitUntil()` lets background promises complete after the response is sent.
- Can now be imported directly from `cloudflare:workers` (Aug 2025 update)
  instead of threading through the execution context.

**Concern: Wall clock limit.**

The research shows a ~30 second wall time limit for `waitUntil` tasks.
Our async work (parse usage from log stream, calculate cost, write to Redis
and Postgres) should complete well within this, but we need to be aware of it.

If Postgres writes via Hyperdrive are slow (cold connection, etc.), there's
a risk of the waitUntil task being killed before the cost event is logged.

**Mitigation options:**
1. Log to Redis first (fast, <20ms) and batch-write to Postgres on a schedule.
   This decouples the critical path from Postgres latency.
2. Use Cloudflare Queues for the Postgres write — queue the cost event
   from waitUntil, and a queue consumer writes it to Postgres with unlimited
   time.
3. Accept that a small % of cost events might be lost in edge cases and
   reconcile from Redis periodically.

**Impact on roadmap:** We should plan for option 1 or 2 in Phase 1. Not a
blocker, but we need to pick an approach during implementation planning.

---

## 3. Upstash Redis for budget enforcement

### Verdict: GO — with latency awareness

**What works:**
- EVAL (Lua scripts) is fully supported via the REST API.
- EVALSHA is supported (cache script by SHA1, call by hash — avoids resending
  script code on every request).
- Redis Functions also available (load once, call by name) for even better
  performance on hot scripts.
- `@upstash/redis` SDK works in CF Workers out of the box.

**Latency:**
- US/EU regions: 10-20ms per Redis call
- Write replication across regions: 300-500ms

For budget enforcement, we need one Redis round-trip per request (the Lua
script does check + reserve atomically). 10-20ms added to every LLM request
is acceptable — LLM responses take seconds. This is comparable to what
Portkey adds (20-40ms reported overhead).

**Budget consistency concern:**

Upstash Global uses primary-replica model — reads from nearest replica,
writes go to primary. Budget enforcement does both (read remaining + write
reservation) in one Lua script. Since Lua scripts execute on the primary,
this is consistent. But it means budget enforcement always hits the primary
region, not the nearest replica.

**Mitigation:** Choose an Upstash region close to where most users are
(US East is the safe default). The 10-20ms latency is fine.

**Redis Functions recommendation:**

Instead of EVAL (resends the Lua script text every call), use Redis Functions:
load the budget script once, then call it by name. This saves bandwidth and
parsing time on every request.

**Impact on roadmap:** No changes needed. Just a note to use EVALSHA or
Functions instead of raw EVAL in Phase 2.

---

## 4. Supabase Postgres from Cloudflare Workers

### Verdict: GO — use Hyperdrive

**Two options:**
1. **Supabase JS client (HTTP/PostgREST):** Simpler, never runs out of connections,
   but limited to PostgREST queries (not raw SQL, no Drizzle ORM).
2. **Hyperdrive (direct Postgres):** Connection pooling across CF's network,
   works with Drizzle ORM, sub-5ms cached queries, 3x faster than direct.

**Decision: Hyperdrive + Drizzle ORM.**

This lets us use the same Drizzle schema and query patterns in both the
dashboard (Next.js/Vercel) and the proxy (CF Workers). The setup is
officially documented by both Cloudflare and Drizzle.

**Setup requirements:**
- Create a dedicated DB user in Supabase for Hyperdrive
- Use the Direct connection string (not pooled — Hyperdrive does its own pooling)
- Enable `nodejs_compat` compatibility flag in wrangler config
- Use `node-postgres` (`pg`) driver (not the `postgres` driver we currently use)

**Important note:** The dashboard currently uses the `postgres` driver
(postgres.js). The CF Worker with Hyperdrive needs `node-postgres` (`pg`).
These are different drivers. The Drizzle schema is the same, but the client
initialization differs. This is fine — just two different connection setups
pointing at the same DB.

**Impact on roadmap:** In Phase 0, we need to add `pg` as a dependency for
the proxy package and set up Hyperdrive. The dashboard keeps using `postgres`.
Not a blocker.

---

## 5. Monorepo structure with Wrangler

### Verdict: GO — straightforward

**What works:**
- pnpm workspaces + Wrangler is a well-documented pattern.
- Wrangler is installed per-project (`pnpm add -D wrangler` in `apps/proxy/`).
- Each Worker has its own `wrangler.jsonc` in its directory.
- Shared packages (`packages/cost-engine/`, `packages/shared/`) are consumed
  via pnpm workspace protocol, bundled by Wrangler's esbuild.

**Important note:** Workers run in V8 isolates, not Node.js. Some npm
packages that depend on Node.js built-ins won't work. The `nodejs_compat`
flag enables many (like `pg`, `crypto`), but not all. We need to be
mindful of dependencies in `packages/cost-engine/`.

Specifically:
- `drizzle-orm` works (confirmed by CF docs)
- `pg` (node-postgres) works with `nodejs_compat`
- `@upstash/redis` works (designed for edge)
- `zod` works (pure JS, no Node deps)
- Our own shared types/utils will work (pure TS)

**Impact on roadmap:** No changes. Just ensure `nodejs_compat` is enabled
in wrangler config.

---

## 6. OpenAI streaming response parsing

### Verdict: GO — well-understood format

**What works:**
- OpenAI SSE format is straightforward: `data: {json}\n\n`, ending with `data: [DONE]`
- Usage data arrives in the final chunk with an empty `choices` array
- Must inject `stream_options: { include_usage: true }` if not present
- Both Chat Completions and Responses API are documented

**No big-picture issues.** The parsing is well-documented and the format
hasn't changed across model generations. The main risk is edge cases
(malformed chunks, network interruptions mid-stream), which are implementation
details, not architecture issues.

---

## 7. Anthropic streaming response parsing

### Verdict: GO — but this is the hardest part of the build

**What works:**
- The tech spec documents the exact bug patterns from 5 different projects.
- The streaming format is well-documented by Anthropic.
- The cost formula is known (including cache TTL multipliers).

**Why it's hard:**
- Anthropic's `input_tokens` semantics are the opposite of OpenAI's
  (uncached-only vs. total-inclusive). This single difference has caused
  double-counting bugs in Langfuse, LangChain, LiteLLM, and Cline.
- Streaming splits usage across `message_start` (input) and `message_delta`
  (output), and `message_delta` values are cumulative — treating them as
  incremental is the #1 bug pattern.
- Cache token math has two different multipliers (5-min vs 1-hour TTL)
  and a sub-object with ephemeral breakdowns.

**No architecture-level blockers.** This is an implementation correctness
challenge, not a "can we even do this" question. The research docs give us
a complete test suite derived from real bugs. If we implement against those
test cases, we'll have better cost calculation than the incumbents.

**Impact on roadmap:** Phase 3 will take longer than other phases. Budget
extra time for testing. Consider writing tests before implementation
(TDD approach, using the 5 documented bugs as test cases).

---

## 8. Cost precision: microdollars

### Verdict: GO — standard practice

Using integers (microdollars = cost × 1,000,000) for all financial math
avoids floating-point errors. This is how every serious financial system
works. JavaScript's `Number` can safely represent integers up to 2^53,
which is ~$9 billion in microdollars. More than enough.

For display, divide by 1,000,000 only at the UI layer.

**No issues.**

---

## 9. Model pricing database

### Verdict: GO — use LiteLLM's JSON as seed, plan for updates

**What works:**
- LiteLLM's `model_prices_and_context_window.json` is the most comprehensive
  source (hundreds of models, all providers).
- It's MIT licensed and auto-syncable.

**Concern: Price staleness.**

Model prices change when providers update pricing. LiteLLM's JSON is
community-maintained and sometimes lags. AgentOps tokencost uses GitHub
Actions for daily auto-updates.

**Mitigation:** Import LiteLLM's JSON as initial seed. Set up a periodic
check (weekly GitHub Action or manual) to pull updates. Allow manual
price overrides in the dashboard for users who need exact pricing.

**Impact on roadmap:** Minor — add a "last updated" timestamp to the
pricing data and a manual refresh mechanism in the dashboard. Not urgent
for launch.

---

## 10. Dashboard on Vercel alongside proxy on Cloudflare

### Verdict: GO — clean separation

The dashboard (Next.js) stays on Vercel. The proxy (CF Workers) is a
separate deployment. They share:
- The same Supabase Postgres database (different connection methods)
- The same Drizzle schema
- Shared TypeScript types (via `packages/shared/`)

**No issues with this split.** The dashboard and proxy have fundamentally
different latency requirements (dashboard serves HTML, proxy streams LLM
responses). Running them on different platforms is the right call.

The dashboard reads cost events from Postgres. The proxy writes cost events
to Postgres (via Hyperdrive). No cross-service API calls needed between
them.

**Authentication concern:** The dashboard uses Supabase Auth. The proxy
uses API key auth (`X-NullSpend-Auth`). These are two different auth systems
accessing the same DB. This is fine — the dashboard manages keys, the proxy
validates them. Same pattern as the current codebase.

---

## Summary: Big-picture risk matrix

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| `passThroughOnException` drops POST body | Low | Certain | Clone request before reading body |
| `tee()` buffer overflow on huge responses | Low | Very unlikely | Consume log branch immediately, don't accumulate |
| `waitUntil` wall clock timeout on slow Postgres write | Medium | Possible | Log to Redis first, batch-write to Postgres |
| Anthropic cost calculation bugs | Medium | Likely (if not careful) | TDD with 5 documented bug scenarios as test cases |
| Redis EVAL latency adding 10-20ms per request | Low | Certain | Acceptable for LLM proxy; use EVALSHA/Functions to optimize |
| Model pricing data goes stale | Low | Certain over time | Periodic sync from LiteLLM + manual override in dashboard |
| Different Postgres drivers (proxy vs dashboard) | Low | N/A | Both use Drizzle ORM; only initialization differs |

**No showstoppers found.** All identified risks have clear mitigations.

---

## Adjustments to the roadmap

Based on this research, three minor adjustments:

### Phase 0 additions:
- Set up Cloudflare Hyperdrive binding for Supabase Postgres
- Use `node-postgres` (`pg`) driver in the proxy (not `postgres`)
- Enable `nodejs_compat` flag in wrangler config

### Phase 1 adjustment:
- Use `request.clone()` before reading body (for failover)
- Decide between Redis-first logging or Cloudflare Queues for async
  cost event persistence (to handle `waitUntil` wall clock limits)
- Use EVALSHA or Redis Functions instead of raw EVAL

### Phase 3 note:
- Budget extra time for Anthropic — write tests first using the 5
  documented bug scenarios, then implement against them
