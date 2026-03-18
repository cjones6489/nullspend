# Anthropic Provider Setup

Detailed guide for routing Anthropic API calls through NullSpend.

## Supported models

NullSpend tracks costs for all current Anthropic models:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| claude-sonnet-4-20250514 | $3.00 | $15.00 |
| claude-opus-4-20250514 | $15.00 | $75.00 |
| claude-3-5-sonnet-20241022 | $3.00 | $15.00 |
| claude-3-5-haiku-20241022 | $0.80 | $4.00 |
| claude-3-haiku-20240307 | $0.25 | $1.25 |
| claude-3-opus-20240229 | $15.00 | $75.00 |

Cache read tokens and cache creation tokens are tracked and priced separately.

## Configuration

### Node.js (anthropic package)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://proxy.nullspend.com/anthropic",
  defaultHeaders: {
    "X-NullSpend-Key": process.env.NULLSPEND_API_KEY,
  },
});

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
```

### Python (anthropic package)

```python
from anthropic import Anthropic
import os

client = Anthropic(
    base_url="https://proxy.nullspend.com/anthropic",
    default_headers={
        "X-NullSpend-Key": os.environ["NULLSPEND_API_KEY"],
    },
)

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
```

### Environment variables

```bash
ANTHROPIC_BASE_URL=https://proxy.nullspend.com/anthropic
ANTHROPIC_API_KEY=sk-ant-your-real-anthropic-key
NULLSPEND_API_KEY=your-nullspend-platform-key
```

### cURL

```bash
curl https://proxy.nullspend.com/anthropic/v1/messages \
  -H "x-api-key: sk-ant-your-anthropic-key" \
  -H "X-NullSpend-Key: your-platform-key" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Streaming

Streaming works identically to direct Anthropic calls. The proxy transparently
passes through SSE streams:

```typescript
const stream = await client.messages.stream({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});

for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    process.stdout.write(event.delta.text);
  }
}
```

Cost is calculated after the stream completes, using the `usage` data from the
`message_delta` event.

## Supported endpoints

| Endpoint | Status |
|---|---|
| `POST /anthropic/v1/messages` | Supported |

Other Anthropic endpoints are not currently proxied.

## Cost calculation details

Costs are calculated in **microdollars** (1 microdollar = $0.000001). The
calculation accounts for:

- **Input tokens** — standard per-token rate
- **Output tokens** — standard per-token rate
- **Cache read tokens** — discounted rate (typically 10% of input rate)
- **Cache creation tokens** — premium rate (typically 125% of input rate)

Token counts come from the `usage` object in the Anthropic response.

## Anthropic-specific notes

### API versioning

The proxy passes through the `anthropic-version` header to the upstream API.
Use the same version header you would with direct Anthropic calls.

### Authentication

Anthropic uses `x-api-key` instead of `Authorization: Bearer`. The proxy
handles both authentication methods — your Anthropic key goes in `x-api-key`,
your NullSpend platform key goes in `X-NullSpend-Key`.

### Model naming

Use the full model name including the date suffix (e.g.,
`claude-sonnet-4-20250514`, not just `claude-sonnet-4`). The proxy resolves
model aliases but the full name is recommended for accurate pricing.
