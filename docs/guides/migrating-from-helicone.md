# Migrating from Helicone to NullSpend

Helicone was acquired by Mintlify on March 3, 2026 and is entering maintenance
mode. If you're one of the 16,000 organizations on Helicone, this guide shows
you how to migrate to NullSpend in under 5 minutes.

## Why migrate now

- **Helicone is in maintenance mode.** No new features, bug fixes are
  best-effort, and there's no public timeline for how long the service stays up.
- **Your cost data will become inaccessible.** Helicone hasn't announced a data
  export tool or retention commitment post-acquisition.
- **The integration model is identical.** Both Helicone and NullSpend use the
  same pattern: change your base URL. Migration is literally swapping one URL
  for another.

## The migration: one line change

### Helicone (before)

```bash
OPENAI_BASE_URL=https://oai.helicone.ai/v1
HELICONE_API_KEY=sk-helicone-...
```

### NullSpend (after)

```bash
OPENAI_BASE_URL=https://proxy.nullspend.com/v1
# Remove HELICONE_API_KEY — not needed
```

Add the NullSpend authentication header to your client:

```typescript
const client = new OpenAI({
  baseURL: "https://proxy.nullspend.com/v1",
  defaultHeaders: {
    "X-NullSpend-Key": process.env.NULLSPEND_API_KEY,
  },
});
```

That's it. Your existing code, streaming, error handling — everything else stays
the same.

### For Anthropic

```bash
# Helicone (before)
ANTHROPIC_BASE_URL=https://anthropic.helicone.ai

# NullSpend (after)
ANTHROPIC_BASE_URL=https://proxy.nullspend.com/anthropic
```

## Feature mapping

| Helicone feature | NullSpend equivalent | Notes |
|---|---|---|
| Request logging | Cost event logging | Automatic — every request is logged |
| Cost tracking | Cost tracking | Per-request, per-model, per-key breakdown |
| Dashboard | Analytics dashboard | Daily spend, model breakdown, provider breakdown |
| Custom properties | API key attribution | Costs attributed per API key |
| Alerts | Budget enforcement | Hard stops, not just alerts — prevents overspend |
| Caching | — | Not yet supported (roadmap) |
| Rate limiting | Budget enforcement | Budget ceilings act as spending rate limits |
| User tracking | API key tracking | Track costs per key (one key per agent/user) |
| Prompt templates | — | Not supported (out of scope) |

## What NullSpend adds that Helicone didn't have

### Hard budget enforcement

Helicone could alert you when costs got high. NullSpend **blocks requests** when
a budget ceiling is hit. No soft limits — the proxy returns `429` and the
request never reaches the LLM provider. You don't get charged for blocked
requests.

### Multi-provider unified dashboard

See OpenAI and Anthropic costs in a single dashboard with provider breakdown
charts. Helicone supported multiple providers but the experience was fragmented.

### Identity-based enforcement

Budget enforcement is tied to API keys on the server side. There's no
client-side header that can be spoofed or omitted to bypass the budget. This
was a known issue with Helicone's header-based approach.

### Kill receipts (coming soon)

When a request is blocked by a budget ceiling, NullSpend will generate a
cryptographically signed, tamper-evident receipt — proof that the block happened,
when, and why. Useful for compliance and audit trails.

## Step-by-step migration

### 1. Sign up for NullSpend

Go to [nullspend.com/signup](https://nullspend.com/signup) and create an
account.

### 2. Create an API key

In the dashboard, go to **Settings** → **Create API Key**. Copy the platform
key.

### 3. Set a budget (optional but recommended)

Go to **Budgets** → **Create Budget**. Set a spending ceiling based on your
current Helicone cost data. Start generous — you can tighten later.

### 4. Update your environment variables

Replace your Helicone base URL with the NullSpend proxy URL. Add the
`X-NullSpend-Key` header to your client configuration.

### 5. Remove Helicone dependencies

```bash
# Remove the Helicone package if you installed it
npm uninstall @helicone/helicone
# or
pip uninstall helicone
```

Remove any Helicone-specific headers from your code:

```typescript
// Remove these:
// "Helicone-Auth": "Bearer sk-helicone-..."
// "Helicone-Property-*": ...
// "Helicone-Cache-Enabled": ...
```

### 6. Deploy and verify

Deploy your updated application. Check the NullSpend dashboard — cost events
should appear within seconds of your first LLM call.

## Pricing comparison

| Feature | Helicone (was) | NullSpend |
|---|---|---|
| Free tier | 10K logs, 3-day retention | $1K/mo proxied spend, 7-day retention |
| Budget enforcement | Alerts only | Hard enforcement (all tiers) |
| Starting paid tier | $20/mo (limited) | $49/mo (unlimited budgets, 30-day retention) |

## FAQ

**Will my Helicone data be lost?**
Helicone hasn't announced data export or retention guarantees. We recommend
exporting any critical data from Helicone's dashboard before migrating.

**Can I run both Helicone and NullSpend simultaneously?**
Not easily — both require changing the base URL, and you can only point at one
proxy at a time. However, you could route some traffic to each by using
different API keys with different base URLs.

**How long does migration take?**
The actual code change takes under 5 minutes. It's one environment variable
swap and adding the auth header.

**What if I was using Helicone's caching?**
NullSpend doesn't support response caching yet. If you relied on Helicone's
cache, you'll need to implement caching at the application level or wait for
our caching feature (on the roadmap).

**What about Helicone's custom properties?**
Use API keys to segment costs. Create one key per agent, team, or environment.
Costs are automatically attributed per key in the dashboard.
