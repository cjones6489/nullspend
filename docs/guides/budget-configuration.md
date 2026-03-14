# Budget Configuration

Set spending ceilings to prevent cost overruns from runaway agents.

## How budgets work

A budget is a spending ceiling attached to an API key. When the cumulative cost
of requests through that key exceeds the budget, the proxy blocks further
requests with a `429 Too Many Requests` response.

Budget enforcement happens **before** the request is forwarded to the LLM
provider. The proxy checks the current spend against the budget atomically using
Redis, so there are no race conditions even under concurrent load.

## Creating a budget

1. Open the [NullSpend dashboard](https://nullspend.com/app/budgets)
2. Click **Create Budget**
3. Configure:
   - **Name** — descriptive label (e.g., "Production Monthly", "Agent Alpha")
   - **Amount** — spending ceiling in dollars (e.g., $50.00)
   - **Period** — time window for the budget (monthly)
   - **API Key** — which key this budget applies to
4. Click **Save**

The budget takes effect immediately. No proxy restart or redeployment needed.

## Budget enforcement behavior

When a request would exceed the budget:

1. The proxy returns HTTP `429 Too Many Requests`
2. The response body includes a clear error message:
   ```json
   {
     "error": "Budget exceeded",
     "message": "API key budget of $50.00 has been exceeded. Current spend: $51.23"
   }
   ```
3. Your application receives a standard HTTP error — handle it like any other
   rate limit or quota error

The blocked request is **never forwarded** to the LLM provider. You are not
charged by OpenAI/Anthropic for blocked requests.

## Budget tracking

Budget spend is tracked in **real-time** using Upstash Redis with atomic Lua
scripts. This means:

- Spend updates are instantaneous (no batch processing delay)
- Concurrent requests can't race past the budget
- Budget state survives proxy restarts (persisted in Redis)

## Viewing budget status

In the dashboard, go to **Budgets** to see:

- Current spend vs. ceiling for each budget
- Percentage utilization
- Which API key each budget is attached to

## Best practices

### Start generous, tighten later

Set your initial budget higher than you expect to need. Once you have a few days
of cost data in the analytics dashboard, you can tighten the budget to a
reasonable ceiling with confidence.

### One budget per concern

Create separate API keys (and budgets) for different agents, environments, or
teams:

- `production-agent-alpha` — $200/month
- `production-agent-beta` — $100/month
- `staging` — $20/month
- `development` — $5/month

### Monitor before enforcing

Use the analytics dashboard to understand your spending patterns before setting
tight budgets. The daily spend chart and model breakdown help you identify which
models and agents drive the most cost.

## Pricing tier limits

| Tier | Budgets |
|---|---|
| Free | 1 |
| Pro | Unlimited |
| Team | Unlimited |
| Enterprise | Unlimited |

The Free tier includes one budget, which is enough for a single production key.
Upgrade to Pro for unlimited budgets across multiple keys and environments.
