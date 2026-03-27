# Policy Engines for AI Agents — Landscape Research (March 2026)

## Executive Summary

"Policy engine for agents" is not one thing — it fragments into three distinct categories that are converging:

1. **Financial policy engines** (Payman, Skyfire, Stripe Issuing) — spending limits, approval thresholds, per-transaction caps
2. **Authorization policy engines** (AWS Cedar/AgentCore, OPA, Galileo Agent Control) — tool-level access control with formal policy languages
3. **Gateway guardrails** (Portkey, LiteLLM, OpenRouter, Helicone) — rate limits, budget caps, model allowlists, content filtering

NullSpend currently operates in category 1 with some elements of category 3. The most significant development is AWS shipping Cedar-based agent governance in AgentCore (GA March 2026), which establishes a real standard for declarative agent policy. No one has unified all three categories yet.

---

## 1. Products Shipping as "Policy Engines" for Agents

### Payman AI

**What it is:** Payment rails for AI agents with built-in spending governance.

**Policy model:** Policies are mandatory — no wallet connected to an app or agent can move money without a governing policy. Each policy defines:
- **Threshold amount** — the dollar value above which human approval is required
- **Per-transaction caps** — maximum single payment
- **Daily/periodic limits** — rolling spend caps
- **Payee restrictions** — who can receive funds

**Evaluation:** Simple threshold-based. If `transaction_amount > threshold`, trigger manual approval flow. No composable rule language — policies are configured per-wallet through the dashboard or API.

**Developer experience:** Dashboard UI for policy creation with system policy templates that can be cloned and customized. SDK integration via PayKit (works with Vercel AI SDK, LangChain). Auth via `x-payman-api-secret` header. No declarative policy file format — everything is API/dashboard-driven.

**What's real:** Shipped and documented. Concrete but shallow — effectively "if amount > X, ask human." No conditional logic, no role-based rules, no composable policies.

Sources:
- [Understanding Policies](https://docs.paymanai.com/dashboard-guide/policies)
- [API Reference](https://docs.paymanai.com/api-reference/introduction)

---

### Coinbase AgentKit

**What it is:** Toolkit giving AI agents crypto wallets and onchain capabilities.

**Policy model:** "Smart Security Guardrails" including:
- Per-session and per-transaction spending limits
- KYT (Know Your Transaction) screening that blocks high-risk interactions
- Wallet-level fund isolation (agents get pre-funded wallets, not bank account access)

**Developer experience:** Python and TypeScript SDKs. Wallet provider configuration with gas parameters. Framework-agnostic (works with any AI framework). Wallet-agnostic (works with any wallet).

**What's real:** The spending limits are infrastructure-level constraints on the wallet, not a declarative policy system. No policy language, no composable rules. The "policy" is effectively: fund the wallet with $X, set max-per-transaction to $Y. KYT screening is opaque — you don't configure rules, you get Coinbase's built-in risk scoring.

Sources:
- [AgentKit GitHub](https://github.com/coinbase/agentkit)
- [Coinbase Developer Documentation](https://docs.cdp.coinbase.com/agent-kit/welcome)

---

### Stripe — Two Distinct Systems

#### Stripe Issuing for Agents

**What it is:** Programmable virtual cards for AI agents with real-time spending controls. This is the most mature financial policy engine in the market.

**Policy model:** Rich, composable spending controls via API:

| Parameter | Type | Description |
|-----------|------|-------------|
| `allowed_categories` | array | Whitelist of merchant category codes (MCCs) |
| `blocked_categories` | array | Blacklist of MCCs |
| `spending_limits` | array | Amount-based rules with intervals |
| `allowed_merchant_countries` | array | Geographic whitelist |
| `blocked_merchant_countries` | array | Geographic blacklist |

Spending limit objects have structure:
```json
{
  "amount": 50000,       // cents, smallest currency unit
  "interval": "monthly", // per_authorization | daily | weekly | monthly | yearly | all_time
  "categories": ["5411", "5412"]  // optional MCC filter
}
```

**Evaluation model:**
1. Spending controls run first (can decline before webhook fires)
2. Real-time authorization webhook fires for custom logic
3. If multiple overlapping limits exist, most restrictive wins
4. Controls apply at both Card and Cardholder level, cascading down
5. Default: 500 USD/day per card if no limits set; 10,000 USD hard cap per authorization

**What makes this real:** The `spending_controls` parameter is a first-class API object on Card and Cardholder resources. You can set it at creation or update it later. Dashboard UI also available. This is not marketing — it's a production API with well-defined semantics.

#### Stripe Agentic Commerce Protocol (ACP)

**What it is:** An open standard (co-maintained with OpenAI, Apache 2.0) for agent-to-seller checkout flows.

**Policy model:** Not a policy engine per se, but defines the security boundary:
- Shared Payment Tokens (SPTs) are scoped to a single transaction + seller + amount
- Time-limited tokens
- Stripe Radar fraud signals layered on top
- Revocation per User-Agent string

**Developer experience:** RESTful interface or MCP server implementation. Four endpoints: CreateCheckout, UpdateCheckout, CompleteCheckout, CancelCheckout. Date-based versioning (YYYY-MM-DD).

Sources:
- [Issuing for Agents](https://docs.stripe.com/issuing/agents)
- [Issuing Spending Controls](https://docs.stripe.com/issuing/controls/spending-controls)
- [Agentic Commerce Protocol](https://docs.stripe.com/agentic-commerce/protocol)
- [ACP Website](https://agenticcommerce.dev)

---

### Skyfire

**What it is:** Payment network for AI agents with wallet-based spending controls.

**Policy model:** Similar to Payman but positioned as enterprise:
- Per-transaction limits
- Time-period aggregate limits (daily, weekly, monthly)
- Per-service-provider restrictions
- Just-in-time human approval via SMS for high-value transactions
- Dashboard visibility into agent spending

**Developer experience:** Deposit funds into agent wallet, configure limits. Dashboard for monitoring. API for programmatic control. Integrates with Apify and other agent platforms.

**What's real:** Shipped and out of beta (March 2025 GA). Enterprise controls documented. But like Payman, the "policy" is threshold-based limits, not a composable rule language.

Sources:
- [Skyfire Launch](https://www.businesswire.com/news/home/20250306938250/en/Skyfire-Exits-Beta-with-Enterprise-Ready-Payment-Network-for-AI-Agents)
- [Apify Integration](https://docs.apify.com/platform/integrations/skyfire)

---

### AWS Bedrock AgentCore Policy (Cedar-based)

**What it is:** The most sophisticated agent policy engine shipped to date. GA across 13 AWS regions as of March 2026. Uses Cedar, AWS's open-source policy language, to control agent-to-tool interactions.

**Policy model:** Full Cedar policy language with:
- `permit` and `forbid` statements
- Principal (OAuth user), Action (tool call), Resource (gateway) triplets
- `when` conditions that inspect tool input parameters
- `unless` exception clauses
- Pattern matching via `like` operator
- Tag-based attribute checks (roles, scopes, usernames)

**Concrete policy examples (real, from AWS docs):**

Limit refunds to under $1,000:
```cedar
permit(
  principal,
  action == AgentCore::Action::"RefundTarget___process_refund",
  resource == AgentCore::Gateway::"arn:aws:bedrock-agentcore:us-west-2:123456789012:gateway/refund-gateway"
) when {
  context.input.amount < 1000
};
```

Role-based restriction using `forbid` + `unless`:
```cedar
forbid(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"InsuranceAPI__update_coverage",
  resource == AgentCore::Gateway::"..."
) unless {
  principal.hasTag("role") &&
  (principal.getTag("role") == "senior-adjuster" || principal.getTag("role") == "manager")
};
```

Validate tool input parameters:
```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"InsuranceAPI__file_claim",
  resource == AgentCore::Gateway::"..."
) when {
  context.input has claimType &&
  (context.input.claimType == "health" ||
   context.input.claimType == "property" ||
   context.input.claimType == "auto")
};
```

**Evaluation model:**
1. Default deny — anything not explicitly permitted is denied
2. Forbid wins — any matching `forbid` overrides all `permit` statements
3. Policy engine evaluates ALL applicable policies per request
4. Policies attach to a policy engine, which attaches to a gateway
5. Every decision logged to CloudWatch

**Developer experience:**
- Policies written in Cedar (plain text) or generated from natural language prompts
- Python SDK (`bedrock-agentcore-starter-toolkit`)
- Policy engine created via API, attached to gateway in ENFORCE mode
- Policies can be CRUD'd independently of agent code
- OAuth (Cognito) integration built in
- ~2-3 minutes to set up from scratch

**What makes this significant:** This is the first production system that applies a formal authorization language to agent tool governance. Cedar's semantics are well-defined, analyzable, and deterministic. It's not an LLM interpreting rules — it's a proper policy evaluation engine.

Sources:
- [AgentCore Policy Overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html)
- [Example Policies](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/example-policies.html)
- [Getting Started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html)
- [Cedar Playground](https://www.cedarpolicy.com/)

---

### Galileo Agent Control (Open Source, March 2026)

**What it is:** Open-source control plane for governing AI agents at scale. Apache 2.0. Announced March 11, 2026.

**Policy model:** Decorator-based enforcement with remote policy evaluation:
```python
@control()
async def query_database(sql: str) -> Results:
    return await db.execute(sql)
```

Five enforcement decisions: `deny`, `steer`, `warn`, `log`, `allow`.

Policies are defined remotely (not in code) and evaluated at runtime. Pluggable evaluators include Galileo Luna (toxicity), NVIDIA NeMo (topic guardrailing), AWS Bedrock checks, regex patterns, and custom evaluators.

**Developer experience:** Add a decorator, point at a policy server, let compliance teams manage rules in a dashboard. Policy changes propagate without redeployment. Partners include AWS, CrewAI, and Glean.

**What's real:** Just launched (2 weeks old as of this writing). The `@control()` pattern is elegant but the policy specification format is not yet documented publicly. It's more of a control plane abstraction than a policy language.

Sources:
- [Galileo Blog Announcement](https://galileo.ai/blog/announcing-agent-control)
- [The New Stack Coverage](https://thenewstack.io/galileo-agent-control-open-source/)

---

## 2. What a Policy Engine Actually Does in Practice

### The Three Policy Evaluation Models

**Threshold-based (Payman, Skyfire, Coinbase):**
```
IF amount > threshold THEN require_approval
IF daily_spend > daily_limit THEN deny
```
Simple, effective for financial limits. No composition. No conditional logic beyond amount checks.

**Attribute-based access control / ABAC (AWS Cedar/AgentCore):**
```
IF principal.role == "manager" AND context.input.amount < 1000 AND action == "process_refund" THEN permit
```
Rich composition. Inspects request attributes at evaluation time. Formal semantics (default-deny, forbid-wins). This is a real policy engine.

**Gateway rule chains (Portkey, LiteLLM, OpenRouter, Helicone):**
```
IF key.spend_this_month > max_budget THEN reject
IF model NOT IN allowed_models THEN reject
IF content MATCHES pii_pattern THEN redact
```
Layered checks executed in sequence. Mix of budget enforcement, content filtering, and routing rules. Configured per-key or per-team, not per-action.

### How Policies Compose

| System | Composition Model |
|--------|-------------------|
| AWS Cedar | Formal: forbid-wins, default-deny, all policies evaluated |
| Stripe Issuing | Hierarchical: Card controls + Cardholder controls, most restrictive wins |
| OpenRouter | Intersection: member guardrail AND key guardrail, strictest wins |
| LiteLLM | Hierarchical: key < team member < team < user < global |
| Portkey | Sequential or parallel checks, configurable deny/warn/log actions |
| Payman/Skyfire | No composition — one policy per wallet |

### What a Real Policy Looks Like

The most concrete, production-ready policy systems as of March 2026:

**Stripe Issuing** (API call):
```json
{
  "spending_controls": {
    "allowed_categories": ["5411", "5045"],
    "spending_limits": [
      { "amount": 100000, "interval": "monthly" },
      { "amount": 5000, "interval": "per_authorization", "categories": ["5812"] }
    ],
    "blocked_merchant_countries": ["RU", "BY"]
  }
}
```

**AWS Cedar** (policy file):
```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"OrderAPI__place_order",
  resource == AgentCore::Gateway::"arn:..."
) when {
  context.input has amount &&
  context.input.amount < 500 &&
  principal.hasTag("department") &&
  principal.getTag("department") == "procurement"
};
```

**LiteLLM** (YAML config + API):
```yaml
general_settings:
  master_key: sk-1234
litellm_settings:
  max_budget: 500
  budget_duration: 30d
```
```bash
curl 'http://localhost:4000/key/generate' \
  -d '{"max_budget": 10, "budget_duration": "1d", "rpm_limit": 60, "model_max_budget": {"gpt-4": 5}}'
```

**Helicone** (request header):
```
Helicone-RateLimit-Policy: 500;w=3600;u=cents;s=user
```
(500 cents = $5 per hour per user, cost-based rate limiting)

---

## 3. FinOps/Observability Tools and Policies

### Helicone

**Policy system:** Header-based rate limiting only. No declarative policy engine.

Format: `Helicone-RateLimit-Policy: "[quota];w=[window];u=[unit];s=[segment]"`
- `u=request` (default) or `u=cents` for cost-based
- `s=user` for per-user, or custom property name for per-org
- Minimum window: 60 seconds
- Returns 429 when exceeded

**Verdict:** Observability-first, policy-second. Rate limits are useful but there's no rule composition, no conditional logic, no approval flows.

### Portkey

**Policy system:** The most feature-rich guardrails among observability tools.

Configuration via JSON configs:
```json
{
  "input_guardrails": ["guardrails-id-xxx"],
  "output_guardrails": ["guardrails-id-yyy"]
}
```

20+ deterministic guardrails (regex, JSON schema, code detection) plus LLM-based (gibberish, prompt injection). Custom HTTP status codes: 246 (failed but proceed), 446 (failed and block).

Seven action types: async/sync execution, deny/allow, sequential/parallel, feedback loops.

Advanced orchestration: fallback to different provider on guardrail failure, retry on soft failure.

**Verdict:** Closest to a real policy system among observability tools. But it's content/format guardrails, not financial policy or authorization. No budget enforcement, no spending limits, no approval workflows.

### LiteLLM

**Policy system:** The most complete budget enforcement among gateways.

Five-tier budget hierarchy: Virtual Key > Team Member > Team > Internal User > Global Proxy. Each tier supports `max_budget` (hard USD cap), `budget_duration` (reset interval), `tpm_limit`, `rpm_limit`, `max_parallel_requests`, and per-model budget caps.

Configuration: YAML file for global settings, REST API for runtime key/team creation. Hard limits return 400 with `ExceededBudget`. Soft limits trigger alerts without blocking.

Model-specific budgets (Enterprise): `"model_max_budget": {"gpt-4": 5, "gpt-3.5-turbo": 20}`

**Verdict:** LiteLLM has a real budget policy system with hierarchical enforcement. It's the closest analogue to what NullSpend does, but it's budget-only — no tool-level authorization, no conditional approval rules, no human-in-the-loop.

### Braintrust

**Policy system:** None. Braintrust is evaluation and observability. No budget enforcement, no guardrails, no policy engine. Their AI gateway (proxy) does routing and caching but not policy enforcement.

### OpenRouter

**Policy system:** Dashboard-configured guardrails with four controls:
- Budget limits (USD, daily/weekly/monthly reset, per-key and per-member)
- Model allowlists
- Provider allowlists
- Zero Data Retention enforcement

Composition: intersection logic (strictest wins). Account-wide defaults serve as baseline.

**Verdict:** Clean and simple. Budget limits + model restrictions. No conditional rules, no content guardrails, no approval flows.

---

## 4. Open Standards for Agent Governance Policies

### NIST AI Agent Standards Initiative (February 2026)

NIST CAISI launched a formal initiative to develop:
- Security controls and risk management frameworks for AI agents
- Human supervision mechanisms, escalation protocols, access controls
- Accountability structures for agent behavior in production
- Agent identity and authorization guidance (NCCoE concept paper)

**Status:** Request for Information phase. Concept papers published. Finalized standards expected 2027 at earliest. No policy specification format yet.

### CSA Agentic Trust Framework (February 2026)

Open specification applying Zero Trust to AI agents. Four maturity levels:

| Level | Name | Autonomy | Human Involvement |
|-------|------|----------|-------------------|
| 1 | Intern | Observe only | Continuous supervision |
| 2 | Junior | Recommend | Approves all actions |
| 3 | Senior | Act with guardrails | Notified after actions |
| 4 | Principal | Autonomous in scope | Strategic oversight only |

Five core elements: Identity, Behavior Monitoring, Data Governance, Segmentation, Incident Response.

Promotion between levels requires five gates: performance, security validation, business value, clean incident record, governance sign-off. Agents can be demoted.

Published under Creative Commons. GitHub: [massivescale-ai/agentic-trust-framework](https://github.com/massivescale-ai/agentic-trust-framework).

**Status:** Governance framework, not a policy specification. Tells you WHAT controls you need, not HOW to express them in code. No policy language.

### Agentic Commerce Protocol (ACP)

Open standard co-maintained by OpenAI and Stripe (Apache 2.0). Defines checkout flows between buyers, AI agents, and sellers. Uses Shared Payment Tokens scoped to transaction + seller + amount.

**Status:** Beta. Not a policy engine — it's a commerce protocol. But it establishes the security boundary (scoped tokens, HMAC signing) that policy engines can build on.

### OpenID AuthZEN

Emerging standard to standardize authorization protocols (like OAuth did for authentication). Could reduce vendor lock-in between OPA, Cedar, and other policy engines. For MCP implementations, AuthZEN compliance may become as important as OAuth.

**Status:** Early. No shipped implementations for agent governance yet.

### OWASP Top 10 for Agentic Applications (December 2025)

Identifies the top 10 security threats for agent applications. Not a policy specification but influences what policies need to cover. CSA ATF explicitly references this for threat mitigations.

---

## 5. Developer Experience Comparison

| System | Config Method | Policy Format | Live Update? | Dashboard? |
|--------|--------------|---------------|-------------|------------|
| **AWS AgentCore** | Python SDK, API | Cedar language | Yes (CRUD policies) | AWS Console |
| **Stripe Issuing** | REST API, Dashboard | JSON (spending_controls) | Yes (update Card/Cardholder) | Stripe Dashboard |
| **Payman** | Dashboard, API, SDK | Proprietary (threshold-based) | Yes | Yes |
| **Skyfire** | Dashboard, API | Proprietary (limit-based) | Yes | Yes |
| **Coinbase AgentKit** | SDK config | Code-level (wallet params) | Limited | Coinbase Dashboard |
| **LiteLLM** | YAML + REST API | YAML (budget fields) | Yes (key/team API) | Admin UI |
| **Portkey** | JSON configs + Dashboard | JSON (guardrail IDs) | Yes | Yes |
| **OpenRouter** | Dashboard | Dashboard UI only | Yes | Yes |
| **Helicone** | Request headers | Header string format | Per-request | Analytics only |
| **Galileo Agent Control** | Python decorator + remote | Remote (undocumented format) | Yes (no redeploy) | Yes |

### Developer Experience Patterns

**Best DX for financial policies:** Stripe Issuing. Well-documented API, clear parameter semantics, Dashboard UI for non-developers, predictable evaluation (most restrictive wins).

**Best DX for authorization policies:** AWS AgentCore Policy. Cedar is readable, the SDK workflow is straightforward, natural language policy generation is a nice on-ramp, and the enforcement is deterministic.

**Best DX for budget governance:** LiteLLM. YAML for global config, REST API for runtime changes, five-tier hierarchy covers most org structures, per-model budgets are a differentiator.

**Weakest DX:** Payman and Skyfire both rely heavily on dashboard-first configuration with limited programmatic policy management. Coinbase AgentKit's "policies" are just wallet funding amounts — no declarative system at all.

---

## 6. Implications for NullSpend

### Where NullSpend sits today
NullSpend is a financial policy engine (category 1) with gateway-style budget enforcement (category 3): per-key budgets, velocity limits, session limits, cost tracking, human-in-the-loop approval. This puts it closest to LiteLLM's budget system + Payman's approval flows.

### Gaps relative to the market

1. **No declarative policy language.** AWS Cedar sets the bar. NullSpend's policies are implicit in API key configuration and budget entity setup, not expressed as reviewable, composable rules.

2. **No tool-level authorization.** AgentCore Policy evaluates what tool an agent is calling and inspects its parameters. NullSpend only sees the LLM request, not what the agent does with the response.

3. **No MCC/category-style restrictions.** Stripe Issuing can block spending by merchant category. NullSpend has tag-based attribution but no category-based deny rules.

4. **No formal policy composition semantics.** When multiple budgets/limits apply, the evaluation order is implicit. No documented "forbid-wins" or "most-restrictive-wins" rule.

### Opportunities

1. **Cedar is open source.** NullSpend could adopt Cedar syntax for expressing budget rules, giving users a familiar, analyzable policy language without building one from scratch.

2. **The observability tools don't do approval.** LiteLLM, Portkey, and Helicone all enforce hard limits (reject or allow). None of them have human-in-the-loop approval flows. This remains a NullSpend differentiator.

3. **No one unifies financial + authorization policy.** Stripe Issuing does financial controls. AWS AgentCore does tool authorization. No product does both. A policy engine that says "agent X can spend up to $500/day on model Y, but if it tries to call tool Z with amount > $100, route to human approval" doesn't exist yet.

4. **CSA ATF maturity levels map to NullSpend's budget tiers.** An "Intern" agent gets $0 autonomous spend (everything requires approval). A "Senior" agent gets $1,000/day with velocity alerts. A "Principal" agent gets higher limits with strategic oversight. NullSpend could frame its budget/approval configuration as trust-level tiers.

5. **LiteLLM's YAML config is the developer experience bar for budget policies.** Developers expect to configure budgets in a config file, not just through API calls. A `nullspend.yaml` or similar could be valuable.
