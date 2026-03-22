# Rate Limits

The NullSpend proxy enforces sliding window rate limits to protect against abuse. Two layers run in sequence: per-IP, then per-key.

---

## Two Layers

| Layer | Default | Env Override | Identifier | Scope |
|---|---|---|---|---|
| Per-IP | 120/min | `PROXY_RATE_LIMIT` | `cf-connecting-ip` | All requests |
| Per-key | 600/min | `PROXY_KEY_RATE_LIMIT` | `x-nullspend-key` | Authenticated requests |

Both layers use the Upstash Redis sliding window algorithm.

---

## Enforcement Order

1. **IP rate limit** — Checked first. Applies to all requests that reach the route lookup stage.
2. **Key rate limit** — Checked second, only if the IP limit passes **and** a valid `x-nullspend-key` header is present.
3. Either failure → `429` immediately. The request never reaches authentication or the upstream provider.

Rate limiting runs **before** authentication in the [request pipeline](proxy-endpoints.md#request-processing-pipeline).

---

## Edge Cases

- **Missing or empty `x-nullspend-key`** — Only the IP limit is checked. The key limit is skipped.
- **Key longer than 128 characters** — Treated as invalid for rate limiting purposes. Only the IP limit is checked.
- **Both layers** use the same Upstash Redis sliding window algorithm with per-layer prefixes.

---

## Response Headers

When a rate limit is exceeded, the `429` response includes:

| Header | Value |
|---|---|
| `X-RateLimit-Limit` | Request limit for this window (e.g., `120`) |
| `X-RateLimit-Remaining` | Remaining requests in this window |
| `X-RateLimit-Reset` | Unix timestamp in milliseconds when the window resets |
| `Retry-After` | Seconds until it's safe to retry |

See [Custom Headers](custom-headers.md#rate-limit-headers-on-429-responses-only) for the full response header reference.

---

## Failure Mode: Fail-Open

If Redis is unreachable, rate limiting is **skipped silently**. The request proceeds as if no rate limit exists.

This is intentional: rate limiting is protective, not a correctness requirement. Budget enforcement — which is independent of rate limiting — still applies and **fails closed** (returns `503`).

---

## Rate Limits vs Budget Enforcement

| | Rate Limits | Budget Enforcement |
|---|---|---|
| What it caps | Request count per minute | Dollar spend per period |
| Failure mode | Fail-open (skip if Redis down) | Fail-closed (`503` if unavailable) |
| Error code | `rate_limited` | `budget_exceeded` / `velocity_exceeded` |
| Scope | Per-IP + per-key | Per-user + per-key + per-tag |
| Pipeline position | Before auth | Inside route handler |

---

## Related

- [Errors](errors.md#rate-limiting) — rate limit error format
- [Custom Headers](custom-headers.md) — response header reference
- [Proxy Endpoints](proxy-endpoints.md) — request pipeline order
