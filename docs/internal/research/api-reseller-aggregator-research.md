# AI API Reseller/Aggregator Research

Research date: 2026-03-26

## 1. How These Platforms Work Technically

### OpenRouter

**Business model**: Unified API gateway across 300+ models from dozens of providers. Users pay OpenRouter; OpenRouter pays providers with its own API keys.

**Credit system**: Prepaid wallet model. Users purchase credits via credit card or crypto (Coinbase). Credits are consumed per-request based on token usage. Enterprise customers can get invoiced billing and even negative-balance credit lines (spend now, pay later). "Zero Completion Insurance" means failed requests are not charged.

**Pricing/margin**: OpenRouter claims "no markup" on provider token pricing -- the per-token rates shown match what providers charge directly. Revenue comes from a **5.5% platform fee** on pay-as-you-go plans. Enterprise gets custom (lower) fee rates and bulk credit discounts. This is a volume play -- they need massive throughput to make the economics work at 5.5%.

**API key architecture**: Users get an OpenRouter API key. Requests hit `https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible). OpenRouter's backend selects a provider, uses OpenRouter's own provider API key to make the upstream call, streams the response back.

**BYOK (Bring Your Own Key)**: OpenRouter supports a dual mode. Users can register their own provider keys (OpenAI, Anthropic, Azure, AWS Bedrock, Google Vertex). When BYOK keys are configured:
- BYOK endpoints get **absolute routing priority** -- they're tried first regardless of provider ordering
- If BYOK key is rate-limited, falls back to OpenRouter's shared keys (unless "Always use this key" is enabled)
- BYOK requests incur a reduced platform fee (percentage not publicly specified; some tier of monthly BYOK requests has waived fees)
- Provider keys are encrypted at rest in OpenRouter's infrastructure
- Supported providers: OpenAI, Anthropic, Azure (endpoint + key + model slug), AWS Bedrock (API key or IAM credentials + region), Google Vertex AI (service account JSON + region)

**Provider routing**: Multi-provider failover powered by NotDiamond (acquired/partnered). When a provider is down, rate-limited, or refuses a request, automatic failover to the next provider. Users can configure provider preferences (optimize for cost, latency, or throughput). Each model has a `top_provider` designation.

**Rate limiting**: Credit-based quotas rather than pure request-rate limits. Per-API-key credit limits with daily/weekly/monthly reset. DDoS protection layer. OpenRouter negotiates higher rate limits directly with providers due to aggregate volume.

**Customer isolation**: Organization management with sub-user analytics, guardrails (spending limits, model restrictions, data policies), per-key credit limits. No true per-customer provider account isolation -- all customers share OpenRouter's provider accounts, isolated by OpenRouter's application layer.

### Together AI

**Model**: Infrastructure-as-a-service for AI inference. Runs open-source and third-party models on their own GPU clusters. Not purely a reseller -- they actually host and serve models on their hardware.

**Pricing**: Per-token pricing varying by model size. Small models (Llama 3.8B): $0.10/M tokens. Large models (DeepSeek-R1): $3-7/M tokens. Batch API at 50% discount. Also offers dedicated GPU instances ($3.99-9.95/hr for H100/H200/B200) and fine-tuning services.

**Key handling**: Users get Together AI API keys. Together handles all provider infrastructure. No BYOK concept because they host the models themselves.

**Business model**: Margin on inference compute. They run optimized inference stacks (likely using vLLM, TensorRT-LLM, or custom kernels) to serve models cheaper than the raw GPU cost, capturing the spread.

### Fireworks AI

**Model**: Similar to Together AI -- inference infrastructure provider. Runs 400+ models on their own GPU fleet with custom optimization.

**Pricing**: Tiered by model parameter count. <4B: $0.10/M tokens. 4-16B: $0.20/M tokens. 16B+: $0.90/M tokens. MoE models: $0.50-1.20/M tokens. Cached input tokens at 50% discount. On-demand GPU pricing: A100 $2.90/hr, H100 $6.00/hr, B200 $9.00/hr.

**Key handling**: Users get Fireworks API keys. They also resell access to third-party proprietary models (including OpenAI models) through their unified API.

**Business model**: Infrastructure margin on GPU compute + inference optimization. Enterprise tier offers faster speeds, lower costs, higher rate limits.

### Replicate

**Model**: Serverless inference platform. Hosts both open-source and proprietary models (including Claude). Unique model: users can deploy custom models via Cog (open-source packaging tool).

**Pricing**: Dual billing -- some models billed by time (per-second of GPU time), others by tokens/outputs. Hardware tiers from CPU ($0.09/hr) to 8x A100 ($40.32/hr). Volume discounts for large spend.

**Key handling**: Users get Replicate API keys. Replicate manages all provider relationships and infrastructure. Custom model deployment on dedicated hardware.

### Martian (Model Router)

**Status**: Domain is for sale (redirects to Afternic). The company appears to have shut down as of 2026. Previously positioned as an intelligent model router that selected the optimal model per request. This is a cautionary data point about the viability of the "routing only" value proposition.

### Not Diamond (Model Router)

**Model**: Intelligent routing layer, not a reseller. Predicts which model to use per-input, optimizing for accuracy/cost/latency tradeoffs. Stack-agnostic -- integrates via API or runs in your environment.

**Key handling**: Users likely maintain their own provider credentials. Not Diamond is middleware/optimization, not a proxy that holds provider keys.

**Business model**: SaaS fee for the routing intelligence. SOC-2, ISO 27001 certified. Enterprise-focused.

### LiteLLM Proxy

**Model**: Open-source proxy server (self-hosted or LiteLLM-hosted). Unified OpenAI-compatible API across 100+ providers. 1.5k+ req/sec in load tests.

**Key handling**: **Admin provides provider keys in YAML config** -- LiteLLM does NOT provide its own keys. Purely BYOK at the admin level. Users get "virtual keys" that map to the admin's upstream provider keys.

**Multi-tenant isolation**:
- Virtual keys with per-key `max_budget`, `budget_duration`, `tpm_limit`, `rpm_limit`, `max_parallel_requests`
- Team-based routing (deprecated) replaced by tag-based routing
- Tag-based routing: deployments tagged (e.g., "free", "paid"), requests routed by tag match
- Regex pattern matching on User-Agent for automatic traffic classification
- Team-specific model aliasing (team A's "gpt-4" routes to Azure EU, team B's routes to OpenAI US)
- PostgreSQL backend for storing team configs, spend tracking, routing mappings

**Budget management**: Automatic spend tracking using LiteLLM's pricing database. Per-key, per-team, per-user budget caps with duration-based resets.

**Key insight for NullSpend**: LiteLLM is the closest architectural analog. It's what NullSpend's proxy already does, but LiteLLM doesn't offer managed provider keys.

---

## 2. Provider Terms of Service

### OpenAI

OpenAI's terms page returns 403 (blocks automated fetching), but key points from developer documentation and industry knowledge:

- **Building applications**: OpenAI explicitly allows building products/services that use the API for your end users. This is the entire point of the API.
- **Reselling the raw API**: The Business Terms reportedly prohibit reselling the Services "except as expressly approved by OpenAI." The key distinction is between (a) building an application that uses OpenAI under the hood (allowed) vs. (b) reselling raw API access as a pass-through (requires approval).
- **How OpenRouter/others operate**: These platforms have enterprise agreements with OpenAI that explicitly authorize their reseller model. OpenAI has a partner program. Volume customers get custom terms.
- **Key sharing**: Standard terms prohibit sharing API keys. Resellers use their own organizational keys, not sharing individual keys.
- **Rate limits by tier**: OpenAI has usage tiers (1-5) based on spend history. Higher tiers get higher rate limits. Resellers likely operate at Tier 5+ with custom negotiated limits.

### Anthropic

From Anthropic's Commercial Terms of Service (directly fetched):

- **Allowed**: Commercial API users can "power products and services Customer makes available to its own customers and end users" -- integrating Claude into your own applications for your direct end-users is explicitly permitted.
- **Prohibited**: Customers cannot "resell the Services except as expressly approved by Anthropic." Unauthorized resale or redistribution of API access itself is forbidden.
- **The bright line**: API access is for your organization's use or your organization's customers, not for resale as a service to third parties without prior authorization.
- **How OpenRouter operates with Anthropic**: They have explicit approval/partnership agreements. This is not available to anyone who just signs up for an API key.

### Key Takeaway on Terms

Both providers draw the same line:
1. **OK**: Build an app that uses their API to serve your users (the "application layer")
2. **Not OK without explicit approval**: Resell raw API access as a pass-through proxy
3. **How resellers get approval**: Enterprise/partnership agreements with custom terms, volume commitments, compliance requirements

The distinction matters for NullSpend: if NullSpend uses its own provider keys to serve customers' agent requests, that's legally a reseller arrangement requiring explicit provider approval. This is NOT something you can just start doing -- it requires negotiating agreements with OpenAI and Anthropic.

---

## 3. Business Model Analysis

### Margin Structure

| Platform | Margin Model | Approximate Take Rate |
|---|---|---|
| OpenRouter | Platform fee on provider-priced tokens | 5.5% pay-as-you-go, custom enterprise |
| Together AI | Infrastructure spread (own GPUs) | Not disclosed; likely 30-60% gross margin on inference compute |
| Fireworks AI | Infrastructure spread (own GPUs) | Not disclosed; similar to Together |
| Replicate | Infrastructure spread + time-based billing | Not disclosed; per-second GPU billing creates natural margin |
| LiteLLM | Open-source (free) + hosted plan | SaaS subscription for hosted proxy, no token margin |

### How They Handle Rate Limits Across Customers

**Shared provider accounts**: All resellers (OpenRouter, etc.) use their own organizational API keys with providers. Multiple customers share the same provider rate limit pool. Strategies:

1. **Negotiate higher limits**: Volume customers get custom rate limits from providers. OpenRouter explicitly says they work "directly with providers to provide better rate limits and more throughput."
2. **Multi-account pooling**: Some may use multiple provider accounts/API keys to multiply their rate limit ceiling.
3. **Request queuing**: When hitting provider rate limits, queue and retry rather than immediately failing.
4. **Multi-provider failover**: If OpenAI rate-limits, route to Anthropic or another provider serving a compatible model.
5. **Per-customer quotas**: OpenRouter applies per-key credit limits and rate limits to prevent any single customer from exhausting shared capacity.

### Per-Customer Isolation on Shared Provider Accounts

True isolation is **not achieved** at the provider level. All customers share the reseller's provider accounts. Isolation is purely at the application layer:

- Per-key spend tracking and budget limits
- Per-key rate limiting (RPM, TPM)
- Per-key model access restrictions
- Audit logging per key
- Organization/team hierarchy

This means a provider-level rate limit hit affects ALL customers. The reseller must over-provision their provider capacity relative to their customer base to avoid this.

### Volume Discounts from Providers

- OpenAI: Yes, enterprise customers get volume pricing. Exact discounts are not public but are known to be significant at scale (reportedly 20-50% off list prices for very large commitments).
- Anthropic: Yes, enterprise pricing available. Similarly opaque.
- This is how the economics work for 5.5%-margin businesses like OpenRouter: their actual cost per token is significantly lower than list price due to volume agreements. The "no markup on provider pricing" claim is technically true (they charge list price) but they pay less than list.

---

## 4. The NullSpend Question: Managed Keys Mode

### Could NullSpend offer this?

Yes, technically. The architecture would be:

```
User funds NullSpend wallet (Stripe)
  -> Agent makes API call to NullSpend proxy
    -> NullSpend uses its own OpenAI/Anthropic API key
      -> Response streamed back
        -> Cost deducted from wallet
```

NullSpend already has ~90% of the infrastructure for this:
- Proxy that forwards to OpenAI/Anthropic (exists)
- Cost calculation engine (exists)
- Budget enforcement (exists)
- Per-org spend tracking (exists)
- Wallet/billing via Stripe (partially exists)

### Technical Requirements

What NullSpend would need to add:

1. **Provider API key management**: Securely store and rotate NullSpend's own OpenAI/Anthropic keys. Use multiple keys to pool rate limits.
2. **Wallet system**: Credit-based prepaid balance per organization. Top-up via Stripe. Real-time balance checks before forwarding requests.
3. **Margin/pricing engine**: Apply markup over provider costs (or platform fee). Track cost basis vs. revenue per request.
4. **Rate limit management**: Per-customer rate limiting to prevent any single customer from exhausting shared provider capacity. Fair queuing.
5. **Provider account scaling**: Multiple provider accounts/keys to scale rate limits. Monitoring of per-key usage and automatic rotation.
6. **Reconciliation**: Match provider invoices against billed customer usage. Handle refunds for failed requests.

### Commercial Requirements

1. **Provider agreements**: Must negotiate enterprise/partner agreements with OpenAI and Anthropic that explicitly authorize reselling. This is the biggest blocker -- you can't just start reselling on standard API terms.
2. **Volume commitments**: Providers may require minimum spend commitments (e.g., $X/month minimum).
3. **Compliance**: SOC-2, data handling agreements, possibly PCI compliance for payment processing.
4. **Margin sustainability**: At OpenRouter's 5.5% platform fee, you need massive volume to cover infrastructure costs. If you also get volume discounts from providers, effective margin improves, but you still need significant scale.
5. **Pricing strategy**: Either charge provider list price + platform fee (OpenRouter model) or charge a flat markup over your actual cost (traditional reseller model).
6. **Float risk**: You collect prepaid credits but pay providers in arrears. This creates positive float (you hold customer money before spending it), but also credit risk if customers consume faster than you can bill.

### Is This a Good Idea?

**Arguments for:**
- Removes the biggest friction point in user onboarding (getting your own API keys)
- Unlocks a new revenue stream (margin on token spend)
- Creates stickier customers (wallet lock-in, switching costs)
- Enables NullSpend to offer "one-stop shop" for agent infrastructure
- Prepaid wallet model means positive cash flow (collect before spending)

**Arguments against:**
- **Massive distraction from core product**: NullSpend's value proposition is FinOps (cost tracking, budgets, HITL). Becoming an API reseller is an entirely different business.
- **Provider relationship dependency**: You're at the mercy of OpenAI/Anthropic partnership terms. They could change terms, raise prices, or cut you off. OpenRouter has spent years building these relationships.
- **Margin compression**: 5.5% on token spend is razor-thin. OpenRouter makes this work with hundreds of millions of requests. NullSpend starting from zero volume will lose money on infrastructure costs.
- **Rate limit management is hard**: Sharing provider accounts across customers creates operational complexity. One customer's burst can degrade service for all.
- **Competitive positioning confusion**: Are you a FinOps tool or an API provider? Trying to be both muddles the message.
- **Capital requirements**: Need to fund provider accounts, maintain float, handle refunds.
- **OpenRouter already exists**: Why would someone choose NullSpend-as-reseller over OpenRouter, which has 300+ models, years of reliability track record, and established provider partnerships?

**Verdict**: This is a bad idea for NullSpend at this stage. The core product is FinOps observability and budget enforcement. Becoming an API reseller is a different business with different economics, different risks, and different competitive dynamics. It would distract from the core value proposition without providing a defensible advantage.

The one exception: if NullSpend finds that >50% of prospects churn because "I don't want to manage my own API keys," then a managed mode becomes a necessary onboarding tool. But solve this by partnering with OpenRouter (user connects OpenRouter account to NullSpend) rather than building reseller infrastructure.

---

## 5. Hybrid Model: BYOK + Managed

### How Platforms Handle Dual Mode

**OpenRouter** is the best example of the hybrid approach:
- Default: User uses OpenRouter's managed keys (credits consumed, 5.5% platform fee)
- BYOK: User registers their own provider keys (reduced/waived fees, BYOK keys get routing priority)
- Seamless fallback: If BYOK key is rate-limited, falls back to managed keys
- Both modes coexist in the same account simultaneously

**LiteLLM**: Only BYOK at the admin level. No managed mode. Virtual keys provide multi-tenant isolation on top of admin-provided provider keys.

### Migration Path from BYOK to Managed

This is actually the wrong direction for NullSpend. The natural path is:

1. **Start with BYOK** (what NullSpend does today): User brings their own OpenAI/Anthropic keys. NullSpend proxies requests, tracks costs, enforces budgets.
2. **If managed mode is added later**: User opts in. NullSpend provides its own keys for convenience. User's wallet is debited. BYOK users can optionally switch or use both.
3. **Fallback**: If user's BYOK key is rate-limited, optionally fall back to managed keys (with user permission and wallet deduction).

### What NullSpend Should Actually Do

Instead of becoming a reseller, consider these alternatives:

1. **OpenRouter integration**: Let users connect their OpenRouter account. NullSpend proxies to OpenRouter instead of directly to providers. OpenRouter handles the multi-provider complexity, NullSpend handles FinOps. Users who don't want to manage provider keys use OpenRouter; users who want direct access use BYOK.

2. **"Connected accounts" model**: Integrate with providers' organization features. User creates their own OpenAI/Anthropic org, NullSpend connects via OAuth or service account. NullSpend gets read access to usage data and write access to make API calls, but the user owns and pays for their own provider account. No reselling required.

3. **Stay focused on BYOK**: The BYOK model is working. The friction of "go get an API key" is a one-time onboarding cost. It selects for serious users who understand what they're paying for. Don't dilute the product to reduce onboarding friction for tire-kickers.

---

## Summary

| Dimension | Assessment |
|---|---|
| Is API reselling technically feasible for NullSpend? | Yes -- 90% of the proxy infrastructure exists |
| Is it legally permissible on standard API terms? | No -- requires explicit provider partnership agreements |
| Is the margin attractive? | No -- 5.5% platform fee needs massive scale |
| Does it strengthen the core product? | No -- it distracts from FinOps value proposition |
| Should NullSpend do this? | No, not now. Stay focused on BYOK + FinOps. Consider OpenRouter integration instead. |
| Could this change later? | Yes -- if customer demand proves onboarding friction is the #1 churn driver |
