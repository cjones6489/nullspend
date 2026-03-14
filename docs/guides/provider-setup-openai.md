# OpenAI Provider Setup

Detailed guide for routing OpenAI API calls through NullSpend.

## Supported models

NullSpend tracks costs for all current OpenAI models:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4.1 | $2.00 | $8.00 |
| gpt-4.1-mini | $0.40 | $1.60 |
| gpt-4.1-nano | $0.10 | $0.40 |
| o3 | $10.00 | $40.00 |
| o3-mini | $1.10 | $4.40 |
| o4-mini | $1.10 | $4.40 |
| gpt-4-turbo | $10.00 | $30.00 |
| gpt-3.5-turbo | $0.50 | $1.50 |

Cached input tokens and reasoning tokens are tracked and priced separately
where applicable.

## Configuration

### Node.js (openai package)

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://proxy.nullspend.com/v1",
  defaultHeaders: {
    "X-NullSpend-Auth": process.env.PLATFORM_AUTH_KEY,
  },
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

### Python (openai package)

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url="https://proxy.nullspend.com/v1",
    default_headers={
        "X-NullSpend-Auth": os.environ["PLATFORM_AUTH_KEY"],
    },
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
```

### Environment variables

```bash
OPENAI_BASE_URL=https://proxy.nullspend.com/v1
OPENAI_API_KEY=sk-your-real-openai-key
PLATFORM_AUTH_KEY=your-nullspend-platform-key
```

### cURL

```bash
curl https://proxy.nullspend.com/v1/chat/completions \
  -H "Authorization: Bearer sk-your-openai-key" \
  -H "X-NullSpend-Auth: your-platform-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## Streaming

Streaming works identically to direct OpenAI calls. The proxy transparently
passes through Server-Sent Events (SSE). Set `stream: true` as usual:

```typescript
const stream = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

Cost is calculated after the stream completes, using the `usage` data from the
final SSE chunk.

## Supported endpoints

| Endpoint | Status |
|---|---|
| `POST /v1/chat/completions` | Supported |

Other OpenAI endpoints (responses, embeddings, images, audio, fine-tuning) are
not currently proxied. Requests to unsupported endpoints return `404`.

## Cost calculation details

Costs are calculated in **microdollars** (1 microdollar = $0.000001) to avoid
floating-point precision issues. The calculation accounts for:

- **Input tokens** — standard per-token rate
- **Output tokens** — standard per-token rate
- **Cached input tokens** — discounted rate (typically 50% of input rate)
- **Reasoning tokens** — charged at output token rate

Token counts come from the `usage` object in the OpenAI response, which is
authoritative.

## Model aliases

The proxy resolves common model aliases automatically:

- `gpt-4o-2024-08-06` → priced as `gpt-4o`
- `gpt-4o-mini-2024-07-18` → priced as `gpt-4o-mini`
- Date-stamped model variants are resolved to their base model pricing
