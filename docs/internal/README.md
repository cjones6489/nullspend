# NullSpend Internal Documentation

Navigational index for internal project documentation. For developer-facing docs, see [`docs/`](../).

---

## Getting Started (public docs)

| Doc | Description |
|-----|-------------|
| [guides/quickstart.md](../guides/quickstart.md) | 5-minute setup: API key, env vars, first request |
| [guides/provider-setup-openai.md](../guides/provider-setup-openai.md) | OpenAI integration: models, pricing, SDK config |
| [guides/provider-setup-anthropic.md](../guides/provider-setup-anthropic.md) | Anthropic integration: models, cache tokens, SDK config |
| [guides/budget-configuration.md](../guides/budget-configuration.md) | Budgets, velocity limits, thresholds, session limits |
| [guides/migrating-from-helicone.md](../guides/migrating-from-helicone.md) | One-line migration for Helicone customers |

## Architecture & Design

| Doc | Description |
|-----|-------------|
| [architecture.md](architecture.md) | High-level system overview: proxy, cost engine, budget enforcement |
| [adr/0001-initial-stack-and-app-shape.md](adr/0001-initial-stack-and-app-shape.md) | ADR: Next.js + Supabase + Drizzle + Cloudflare Workers |
| [unified-policy-engine-spec.md](unified-policy-engine-spec.md) | Unified policy engine merging proxy + approval system |
| [technical-outlines/unified-enforcement-architecture.md](technical-outlines/unified-enforcement-architecture.md) | Unified platform replacing separate LLM/MCP/SDK paths |
| [technical-outlines/unified-enforcement-implementation.md](technical-outlines/unified-enforcement-implementation.md) | Incremental subphases (2A-3D) for unified enforcement |
| [technical-outlines/budget-enforcement-architecture.md](technical-outlines/budget-enforcement-architecture.md) | Two-layer budget state: Durable Objects + SQLite |

## Roadmaps & Planning

| Doc | Description | Status |
|-----|-------------|--------|
| [finops-pivot-roadmap.md](finops-pivot-roadmap.md) | **Master roadmap** — FinOps layer phases and acceptance criteria | Active |
| [technical-outlines/priority-implementation-roadmap.md](technical-outlines/priority-implementation-roadmap.md) | 0-3 month priorities: tracing, session limits, SDK adapters | Active |
| [frontend-gap-analysis.md](frontend-gap-analysis.md) | Backend-to-frontend capability mapping; dashboard work remaining | Active |
| [archive/roadmap.md](archive/roadmap.md) | Original approval-layer roadmap (superseded by finops-pivot-roadmap) | Archived |
| [archive/v1-build-contract.md](archive/v1-build-contract.md) | Original V1 ship bar (completed) | Archived |

## Technical Specifications

| Doc | Description |
|-----|-------------|
| [technical-outlines/nullspend-prelaunch-design-audit.md](technical-outlines/nullspend-prelaunch-design-audit.md) | 8 pre-launch design items — all shipped 2026-03-18/19 |
| [technical-outlines/agent-tracing-architecture.md](technical-outlines/agent-tracing-architecture.md) | W3C traceparent + trace_id for agent cost correlation |
| [technical-outlines/velocity-limits-architecture.md](technical-outlines/velocity-limits-architecture.md) | Loop/runaway detection via DO SQLite circuit breaker |
| [technical-outlines/webhook-event-stream.md](technical-outlines/webhook-event-stream.md) | QStash-based webhook delivery architecture |
| [technical-outlines/webhook-phases.md](technical-outlines/webhook-phases.md) | Webhook build phases and event payloads |
| [technical-outlines/nullspend-do-migration-revised.md](technical-outlines/nullspend-do-migration-revised.md) | Redis to Durable Objects migration spec |
| [technical-outlines/nullspend-do-migration-implementation.md](technical-outlines/nullspend-do-migration-implementation.md) | DO migration implementation tracker (7 phases) |
| [technical-outlines/nullspend-systems-test-architecture.md](technical-outlines/nullspend-systems-test-architecture.md) | 14-stage end-to-end pipeline verification |
| [technical-outlines/stress-test-remediation-plan.md](technical-outlines/stress-test-remediation-plan.md) | Stress test findings and remediation (2026-03-16) |
| [technical-outlines/Building a FinOps proxy for AI agent tool calls.md](technical-outlines/Building%20a%20FinOps%20proxy%20for%20AI%20agent%20tool%20calls.md) | MCP protocol deep dive + tool call cost tracking |

### Anthropic Implementation

| Doc | Description |
|-----|-------------|
| [technical-outlines/anthropic-implementation/anthropic-subphase-master-plan.md](technical-outlines/anthropic-implementation/anthropic-subphase-master-plan.md) | Anthropic proxy build phases |
| [technical-outlines/anthropic-implementation/phase-4a-anthropic-pricing-cost-calculator.md](technical-outlines/anthropic-implementation/phase-4a-anthropic-pricing-cost-calculator.md) | Phase 4A: pricing engine + cost calculator |
| [technical-outlines/anthropic-implementation/Anthropic Claude API proxy-complete implementation reference.md](technical-outlines/anthropic-implementation/Anthropic%20Claude%20API%20proxy-complete%20implementation%20reference.md) | Complete Anthropic API proxy reference |

## Audit & Security (Archived)

All audit work is complete (91/91 resolved). These docs are preserved in `archive/` for reference.

| Doc | Description |
|-----|-------------|
| [archive/audit-findings.md](archive/audit-findings.md) | 91-point security audit (91/91 resolved) |
| [archive/audit-research.md](archive/audit-research.md) | Deep research: Next.js security, Supabase RLS, SSRF, rate limiting |
| [archive/audit-v2-findings.md](archive/audit-v2-findings.md) | Post-audit v2: 61 findings |
| [archive/audit-phase7b-fixes.md](archive/audit-phase7b-fixes.md) | Phase 7b post-stress-test audit |
| [archive/architecture-refactor-v2.md](archive/architecture-refactor-v2.md) | Pre-launch tech outline (shipped) |
| [archive/architecture-refactor-implementation.md](archive/architecture-refactor-implementation.md) | 8-phase refactor implementation (shipped) |
| [archive/finops-pivot-tech-audit.md](archive/finops-pivot-tech-audit.md) | Pre-build tech stack audit (decision made) |
| [archive/repo-guide.md](archive/repo-guide.md) | Original repo structure guide (superseded by CLAUDE.md) |

## Open-Source Strategy

| Doc | Description | Status |
|-----|-------------|--------|
| [open-source-migration.md](open-source-migration.md) | Open-core migration plan: licensing, codebase restructuring, implementation phases, revenue model | Active |

## Strategy & Competitive Intelligence

| Doc | Description |
|-----|-------------|
| [competitive-landscape-march-2026.md](competitive-landscape-march-2026.md) | Market map: Helicone acquired, Portkey/LiteLLM/Revenium tiers |
| [nullspend-building Brex for AI Agents-A Complete Strategic Analysis.md](nullspend-building%20Brex%20for%20AI%20Agents-A%20Complete%20Strategic%20Analysis.md) | Strategic vision: 16 Brex patterns mapped to AI agent FinOps |
| [show-hn-draft.md](show-hn-draft.md) | Show HN launch narrative draft |

### Competitor Bug Database

Cataloged bugs across competing platforms with NullSpend remediation test cases.

| Doc | Description |
|-----|-------------|
| [competitor-bug-list/00-index.md](competitor-bug-list/00-index.md) | Index of 34 bugs across 5 categories |
| [competitor-bug-list/01-budget-enforcement-bugs.md](competitor-bug-list/01-budget-enforcement-bugs.md) | 10 budget bypass/enforcement bugs |
| [competitor-bug-list/02-anthropic-cost-bugs.md](competitor-bug-list/02-anthropic-cost-bugs.md) | 7 Anthropic cache token calculation bugs |
| [competitor-bug-list/03-openai-cost-bugs.md](competitor-bug-list/03-openai-cost-bugs.md) | 6 OpenAI cost bugs |
| [competitor-bug-list/04-streaming-bugs.md](competitor-bug-list/04-streaming-bugs.md) | 5 SSE parsing bugs |
| [competitor-bug-list/05-performance-and-ecosystem-gaps.md](competitor-bug-list/05-performance-and-ecosystem-gaps.md) | 13 performance + ecosystem gaps |

## Research

Deep research driving architecture decisions and feature design.

| Doc | Topic |
|-----|-------|
| [research/architecture-review-2026-03-20.md](research/architecture-review-2026-03-20.md) | Post-audit comprehensive architecture review |
| [research/api-versioning.md](research/api-versioning.md) | NullSpend versioning strategy |
| [research/api-versioning-platforms.md](research/api-versioning-platforms.md) | 8-platform versioning patterns (Stripe, Twilio, GitHub, etc.) |
| [research/api-versioning-pitfalls.md](research/api-versioning-pitfalls.md) | Versioning anti-patterns |
| [research/velocity-limits-deep-research.md](research/velocity-limits-deep-research.md) | Velocity limits: DO SQLite append-only log |
| [research/velocity-limits-technical-research.md](research/velocity-limits-technical-research.md) | DO limits, Cloudflare constraints, algorithms |
| [research/velocity-limits-frontier-risk-analysis.md](research/velocity-limits-frontier-risk-analysis.md) | Frontier patterns: AgentBudget, Helicone, Respan |
| [research/traceparent-trace-id-research.md](research/traceparent-trace-id-research.md) | W3C traceparent standard and agent framework adoption |
| [research/session-level-budget-aggregation.md](research/session-level-budget-aggregation.md) | Session-limit architecture in DO SQLite |
| [research/proxy-latency-metrics-aggregation.md](research/proxy-latency-metrics-aggregation.md) | Analytics Engine + KV for p50/p95/p99 overhead |
| [research/cost-events-source-column.md](research/cost-events-source-column.md) | `source` column for cost_events table |
| [research/claude-agent-sdk-adapter.md](research/claude-agent-sdk-adapter.md) | SDK subprocess integration via config transformer |

### Claude Research (raw deep dives)

Extended research artifacts from Claude conversations. These feed into the research/ and technical-outlines/ docs above.

| Doc | Topic |
|-----|-------|
| [claude-research/agent-tracing-cost-correlation-research.md](claude-research/agent-tracing-cost-correlation-research.md) | 10-agent distributed tracing survey |
| [claude-research/competitor-infrastructure-bugs-research.md](claude-research/competitor-infrastructure-bugs-research.md) | 80+ bugs across LiteLLM, Langfuse, Helicone, Portkey |
| [claude-research/developer-adoption-tracing-research.md](claude-research/developer-adoption-tracing-research.md) | DX adoption patterns for trace propagation |
| [claude-research/webhook-taxonomy-research.md](claude-research/webhook-taxonomy-research.md) | Webhook event taxonomy and versioning |
| [claude-research/nullspend-kill-shot-analysis.md](claude-research/nullspend-kill-shot-analysis.md) | Competitive positioning vs. LiteLLM, Portkey, Helicone |
| [claude-research/nullspend-competitor-weakness-analysis.md](claude-research/nullspend-competitor-weakness-analysis.md) | Detailed weakness mapping for all competitor tiers |
| [claude-research/nullspend-competitor-bug-database-complete.md](claude-research/nullspend-competitor-bug-database-complete.md) | 50+ competitor bugs with NullSpend test cases |
| [claude-research/nullspend-cost-engine-action-plan.md](claude-research/nullspend-cost-engine-action-plan.md) | Cost calculation bugs in 7 categories |
| [claude-research/nullspend-fintech-patterns-research.md](claude-research/nullspend-fintech-patterns-research.md) | Fintech patterns (JIT funding, subaccounts) for agents |
| [claude-research/compass_artifact_wf-4db73083-*.md](claude-research/) | Original competitive landscape analysis |
| [claude-research/compass_artifact_wf-40b71591-*.md](claude-research/) | Technical build spec |
