# Quickstart

Get cost tracking and budget enforcement for your AI agent in under 5 minutes.

## Prerequisites

- A NullSpend account ([sign up at nullspend.com](https://nullspend.com/signup))
- An existing application that calls OpenAI or Anthropic APIs

## Step 1: Create an API key

1. Log in to the [NullSpend dashboard](https://nullspend.com/app/analytics)
2. Go to **Settings** (sidebar or `Cmd+K` → "Settings")
3. Click **Create API Key**
4. Give it a name (e.g., "Production" or "My Agent")
5. Copy the key — you'll need it in the next step

## Step 2: Set your environment variables

Add two environment variables to your application:

### For OpenAI

```bash
# Point your OpenAI SDK at the NullSpend proxy
OPENAI_BASE_URL=https://proxy.nullspend.com/v1

# Your real OpenAI key — unchanged
OPENAI_API_KEY=sk-your-openai-key
```

The OpenAI SDK (Python, Node, or any HTTP client) automatically uses
`OPENAI_BASE_URL` when set. No code changes needed.

### For Anthropic

```bash
# Point your Anthropic SDK at the NullSpend proxy
ANTHROPIC_BASE_URL=https://proxy.nullspend.com/anthropic

# Your real Anthropic key — unchanged
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
```

### Authentication

Every request to the proxy must include your NullSpend platform key in the
`X-NullSpend-Auth` header. If you're using the SDK directly:

```typescript
// OpenAI example
const openai = new OpenAI({
  baseURL: "https://proxy.nullspend.com/v1",
  defaultHeaders: {
    "X-NullSpend-Auth": process.env.PLATFORM_AUTH_KEY,
  },
});
```

```python
# OpenAI Python example
client = OpenAI(
    base_url="https://proxy.nullspend.com/v1",
    default_headers={
        "X-NullSpend-Auth": os.environ["PLATFORM_AUTH_KEY"],
    },
)
```

## Step 3: Run your agent

Run your application as normal. Every LLM API call is now routed through
NullSpend, which:

1. Forwards the request to the real provider (OpenAI / Anthropic)
2. Streams the response back to your application — zero latency overhead
3. Calculates the cost (model, input tokens, output tokens, cached tokens)
4. Logs the cost event to your dashboard

## Step 4: See your costs

Open the [NullSpend dashboard](https://nullspend.com/app/analytics). You should
see:

- **Daily spend chart** — cost over time
- **Model breakdown** — which models are costing the most
- **Provider breakdown** — OpenAI vs Anthropic spend
- **Per-key breakdown** — costs attributed to each API key

Cost events appear within seconds of the LLM response completing.

## Step 5: Set a budget (optional)

1. Go to **Budgets** in the sidebar
2. Click **Create Budget**
3. Set a spending ceiling (e.g., $50/month)
4. Assign it to an API key

Once the budget is hit, the proxy returns a `429` response with a clear error
message explaining the budget has been exceeded. Your agent receives a standard
HTTP error — no special handling needed.

## What's next

- [OpenAI Provider Setup](./provider-setup-openai.md) — detailed OpenAI configuration
- [Anthropic Provider Setup](./provider-setup-anthropic.md) — detailed Anthropic configuration
- [Budget Configuration](./budget-configuration.md) — advanced budget management

## Troubleshooting

**Requests return 401 Unauthorized**
- Verify your `X-NullSpend-Auth` header contains a valid platform key
- Check that the key hasn't been revoked in Settings

**Requests return 429 Too Many Requests**
- You've hit a budget ceiling. Check Budgets in the dashboard.
- Or you've exceeded the proxy rate limit (600 req/min by default)

**Costs don't appear in the dashboard**
- Cost logging is asynchronous. Wait a few seconds and refresh.
- Verify the request completed successfully (check your application logs)

**Streaming doesn't work**
- The proxy transparently passes through SSE streams. If streaming worked
  before pointing at NullSpend, it should work identically after.
