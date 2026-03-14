# Show HN: NullSpend — FinOps for AI Agents (budget enforcement that actually works)

We built NullSpend after watching an agent burn $47K in a single weekend on
runaway GPT-4 calls. The developer didn't know until the invoice hit.

The problem is simple: AI agents call LLMs autonomously, at scale, across
providers. Without real-time cost controls, a misconfigured loop or hallucinating
agent can rack up thousands in minutes. Existing solutions either gate budget
enforcement behind enterprise pricing, require you to self-host Docker + Postgres
+ Redis + YAML, or just got acquired and shut down.

**NullSpend is one environment variable change:**

```bash
OPENAI_BASE_URL=https://proxy.nullspend.com/v1
```

Your existing OpenAI/Anthropic SDK, streaming, error handling — all works
identically. No packages to install, no clients to wrap, no config files.

**What you get:**

- Real-time cost tracking per request, model, provider, and API key
- Hard budget enforcement — the proxy blocks requests that would exceed your
  ceiling (no soft limits, no "alerts")
- Multi-provider support (OpenAI + Anthropic today)
- Dashboard with analytics, activity log, and budget management
- Zero latency overhead — cost calculation happens asynchronously after the
  stream completes

**The proxy never modifies your requests or responses.** It's a transparent
pass-through that meters and enforces. Your provider keys stay with you (BYOK).

**Stack:** Cloudflare Workers (proxy), Next.js + Vercel (dashboard), Supabase
Postgres (ledger), Upstash Redis (budget state with atomic Lua scripts).

**Free tier:** $1,000/mo in proxied LLM spend, 1 budget, 7-day retention. No
credit card required.

We're particularly interested in feedback from developers running autonomous
agents in production. What cost controls do you wish you had?

Try it: https://nullspend.com
