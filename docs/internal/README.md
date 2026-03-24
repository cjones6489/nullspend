# NullSpend Internal Documentation

Navigational index for internal project documentation. For user-facing docs, see [`docs/`](../).

Last updated: 2026-03-23

---

## Architecture & Design

| Doc | Created | Description | Status |
|-----|---------|-------------|--------|
| [architecture.md](architecture.md) | 2026-03-07 | High-level system overview: proxy, cost engine, budget enforcement | Current |
| [adr/0001-initial-stack-and-app-shape.md](adr/0001-initial-stack-and-app-shape.md) | 2026-03-07 | ADR: Next.js + Supabase + Drizzle + Cloudflare Workers | Current |
| [unified-policy-engine-spec.md](unified-policy-engine-spec.md) | 2026-03-11 | Unified policy engine merging proxy + approval system | Current |
| [open-source-migration.md](open-source-migration.md) | 2026-03-21 | Open-core migration plan: licensing, codebase restructuring, revenue model | Active |

## Roadmaps & Planning

| Doc | Created | Description | Status |
|-----|---------|-------------|--------|
| [finops-pivot-roadmap.md](finops-pivot-roadmap.md) | 2026-03-09 | **Master roadmap** — FinOps layer phases and acceptance criteria | Active |
| [technical-outlines/priority-implementation-roadmap.md](technical-outlines/priority-implementation-roadmap.md) | 2026-03-19 | 0-3 month priorities: tracing, session limits, SDK adapters | Active |
| [frontend-gap-analysis.md](frontend-gap-analysis.md) | 2026-03-11 | Backend-to-frontend capability mapping; dashboard work remaining | Active |
| [launch-prep.md](launch-prep.md) | 2026-03-21 | Pre-launch checklist and open-source prep | Active |
| [documentation-plan.md](documentation-plan.md) | 2026-03-21 | Documentation site structure and content plan | Active |
| [show-hn-draft.md](show-hn-draft.md) | 2026-03-13 | Show HN launch narrative draft | Active |

## Technical Outlines

Implementation plans and migration specs. Ordered newest-first.

| Doc | Created | Description | Status |
|-----|---------|-------------|--------|
| [technical-outlines/proxy-deep-audit-2026-03-23.md](technical-outlines/proxy-deep-audit-2026-03-23.md) | 2026-03-23 | 26-finding deep audit across 5 implementation phases | Shipped |
| [technical-outlines/qstash-to-queue-migration.md](technical-outlines/qstash-to-queue-migration.md) | 2026-03-23 | QStash → Cloudflare Queues migration for webhooks | Shipped |
| [technical-outlines/velocity-limits-architecture.md](technical-outlines/velocity-limits-architecture.md) | 2026-03-19 | Loop/runaway detection via DO SQLite circuit breaker | Shipped |
| [technical-outlines/nullspend-prelaunch-design-audit.md](technical-outlines/nullspend-prelaunch-design-audit.md) | 2026-03-18 | 8 pre-launch design items — all shipped 2026-03-18/19 | Shipped |
| [technical-outlines/agent-tracing-architecture.md](technical-outlines/agent-tracing-architecture.md) | 2026-03-18 | W3C traceparent + trace_id for agent cost correlation | Shipped |
| [technical-outlines/budget-enforcement-architecture.md](technical-outlines/budget-enforcement-architecture.md) | 2026-03-18 | Two-layer budget state: Durable Objects + SQLite | Shipped |
| [technical-outlines/nullspend-do-migration-revised.md](technical-outlines/nullspend-do-migration-revised.md) | 2026-03-17 | Redis → Durable Objects migration spec | Shipped |
| [technical-outlines/nullspend-do-migration-implementation.md](technical-outlines/nullspend-do-migration-implementation.md) | 2026-03-17 | DO migration implementation tracker (7 phases) | Shipped |
| [technical-outlines/unified-enforcement-architecture.md](technical-outlines/unified-enforcement-architecture.md) | 2026-03-16 | Unified platform replacing separate LLM/MCP/SDK paths | Shipped |
| [technical-outlines/unified-enforcement-implementation.md](technical-outlines/unified-enforcement-implementation.md) | 2026-03-16 | Incremental subphases (2A-3D) for unified enforcement | Shipped |
| [technical-outlines/stress-test-remediation-plan.md](technical-outlines/stress-test-remediation-plan.md) | 2026-03-16 | Stress test findings and remediation | Shipped |
| [technical-outlines/webhook-event-stream.md](technical-outlines/webhook-event-stream.md) | 2026-03-15 | Cloudflare Queue-based webhook delivery architecture | Shipped |
| [technical-outlines/webhook-phases.md](technical-outlines/webhook-phases.md) | 2026-03-15 | Webhook build phases and event payloads | Shipped |
| [technical-outlines/nullspend-systems-test-architecture.md](technical-outlines/nullspend-systems-test-architecture.md) | 2026-03-12 | 14-stage end-to-end pipeline verification | Shipped |

### Anthropic Implementation

| Doc | Created | Description |
|-----|---------|-------------|
| [technical-outlines/anthropic-implementation/anthropic-subphase-master-plan.md](technical-outlines/anthropic-implementation/anthropic-subphase-master-plan.md) | 2026-03-12 | Anthropic proxy build phases |
| [technical-outlines/anthropic-implementation/phase-4a-anthropic-pricing-cost-calculator.md](technical-outlines/anthropic-implementation/phase-4a-anthropic-pricing-cost-calculator.md) | 2026-03-12 | Phase 4A: pricing engine + cost calculator |
| [technical-outlines/anthropic-implementation/Anthropic Claude API proxy-complete implementation reference.md](technical-outlines/anthropic-implementation/Anthropic%20Claude%20API%20proxy-complete%20implementation%20reference.md) | 2026-03-12 | Complete Anthropic API proxy reference |

### MCP Tool Tracking

| Doc | Created | Description |
|-----|---------|-------------|
| [technical-outlines/Building a FinOps proxy for AI agent tool calls.md](technical-outlines/Building%20a%20FinOps%20proxy%20for%20AI%20agent%20tool%20calls.md) | — | MCP protocol deep dive + tool call cost tracking |
| [technical-outlines/mcp-tool-tracking/MCP tool cost tracking.md](technical-outlines/mcp-tool-tracking/MCP%20tool%20cost%20tracking.md) | — | MCP tool cost tracking implementation |

## Research

Deep research driving architecture decisions and feature design. Ordered newest-first.

| Doc | Created | Topic |
|-----|---------|-------|
| [research/proxy-latency-optimization.md](research/proxy-latency-optimization.md) | 2026-03-22 | Proxy + DO optimization deep research (145ms → 7ms) |
| [research/frontier-proxy-architecture-deep-dive.md](research/frontier-proxy-architecture-deep-dive.md) | 2026-03-23 | Frontier proxy architecture patterns |
| [research/frontier-research-review.md](research/frontier-research-review.md) | 2026-03-23 | Frontier research review and codebase alignment |
| [research/academic-research-novel-hypotheses.md](research/academic-research-novel-hypotheses.md) | 2026-03-23 | Academic research and novel hypotheses |
| [research/wild-cross-pollination-hypotheses.md](research/wild-cross-pollination-hypotheses.md) | 2026-03-23 | Cross-domain pattern cross-pollination |
| [research/thin-webhook-events-research.md](research/thin-webhook-events-research.md) | 2026-03-21 | Thin webhook payload mode design |
| [research/claude-agent-sdk-adapter.md](research/claude-agent-sdk-adapter.md) | 2026-03-20 | SDK subprocess integration via config transformer |
| [research/proxy-latency-metrics-aggregation.md](research/proxy-latency-metrics-aggregation.md) | 2026-03-20 | Analytics Engine + KV for p50/p95/p99 overhead |
| [research/architecture-review-2026-03-20.md](research/architecture-review-2026-03-20.md) | 2026-03-19 | Post-audit comprehensive architecture review |
| [research/api-versioning.md](research/api-versioning.md) | 2026-03-19 | NullSpend versioning strategy |
| [research/api-versioning-platforms.md](research/api-versioning-platforms.md) | 2026-03-19 | 8-platform versioning patterns (Stripe, Twilio, GitHub, etc.) |
| [research/api-versioning-pitfalls.md](research/api-versioning-pitfalls.md) | 2026-03-19 | Versioning anti-patterns |
| [research/velocity-limits-deep-research.md](research/velocity-limits-deep-research.md) | 2026-03-19 | Velocity limits: DO SQLite append-only log |
| [research/velocity-limits-technical-research.md](research/velocity-limits-technical-research.md) | 2026-03-19 | DO limits, Cloudflare constraints, algorithms |
| [research/velocity-limits-frontier-risk-analysis.md](research/velocity-limits-frontier-risk-analysis.md) | 2026-03-19 | Frontier patterns: AgentBudget, Helicone, Respan |
| [research/traceparent-trace-id-research.md](research/traceparent-trace-id-research.md) | 2026-03-19 | W3C traceparent standard and agent framework adoption |
| [research/session-level-budget-aggregation.md](research/session-level-budget-aggregation.md) | 2026-03-19 | Session-limit architecture in DO SQLite |
| [research/cost-events-source-column.md](research/cost-events-source-column.md) | 2026-03-19 | `source` column for cost_events table |

## Strategy & Competitive Intelligence

| Doc | Created | Description |
|-----|---------|-------------|
| [competitive-landscape-march-2026.md](competitive-landscape-march-2026.md) | 2026-03-13 | Market map: Helicone acquired, Portkey/LiteLLM/Revenium tiers |
| [nullspend-building Brex for AI Agents-A Complete Strategic Analysis.md](nullspend-building%20Brex%20for%20AI%20Agents-A%20Complete%20Strategic%20Analysis.md) | — | Strategic vision: 16 Brex patterns mapped to AI agent FinOps |

### Competitor Bug Database

Cataloged bugs across competing platforms with NullSpend remediation test cases.

| Doc | Created | Description |
|-----|---------|-------------|
| [competitor-bug-list/00-index.md](competitor-bug-list/00-index.md) | 2026-03-11 | Index of 34 bugs across 5 categories |
| [competitor-bug-list/01-budget-enforcement-bugs.md](competitor-bug-list/01-budget-enforcement-bugs.md) | 2026-03-11 | 10 budget bypass/enforcement bugs |
| [competitor-bug-list/02-anthropic-cost-bugs.md](competitor-bug-list/02-anthropic-cost-bugs.md) | 2026-03-11 | 7 Anthropic cache token calculation bugs |
| [competitor-bug-list/03-openai-cost-bugs.md](competitor-bug-list/03-openai-cost-bugs.md) | 2026-03-11 | 6 OpenAI cost bugs |
| [competitor-bug-list/04-streaming-bugs.md](competitor-bug-list/04-streaming-bugs.md) | 2026-03-11 | 5 SSE parsing bugs |
| [competitor-bug-list/05-performance-and-ecosystem-gaps.md](competitor-bug-list/05-performance-and-ecosystem-gaps.md) | 2026-03-11 | 13 performance + ecosystem gaps |

## Claude Research (raw deep dives)

Extended research artifacts from Claude conversations. These feed into the research/ and technical-outlines/ docs above.

| Doc | Created | Topic |
|-----|---------|-------|
| [claude-research/agent-tracing-cost-correlation-research.md](claude-research/agent-tracing-cost-correlation-research.md) | 2026-03-18 | 10-agent distributed tracing survey |
| [claude-research/competitor-infrastructure-bugs-research.md](claude-research/competitor-infrastructure-bugs-research.md) | 2026-03-18 | 80+ bugs across LiteLLM, Langfuse, Helicone, Portkey |
| [claude-research/developer-adoption-tracing-research.md](claude-research/developer-adoption-tracing-research.md) | 2026-03-18 | DX adoption patterns for trace propagation |
| [claude-research/webhook-taxonomy-research.md](claude-research/webhook-taxonomy-research.md) | 2026-03-18 | Webhook event taxonomy and versioning |
| [claude-research/nullspend-kill-shot-analysis.md](claude-research/nullspend-kill-shot-analysis.md) | 2026-03-10 | Competitive positioning vs. LiteLLM, Portkey, Helicone |
| [claude-research/nullspend-competitor-weakness-analysis.md](claude-research/nullspend-competitor-weakness-analysis.md) | 2026-03-10 | Detailed weakness mapping for all competitor tiers |
| [claude-research/nullspend-competitor-bug-database-complete.md](claude-research/nullspend-competitor-bug-database-complete.md) | 2026-03-11 | 50+ competitor bugs with NullSpend test cases |
| [claude-research/nullspend-cost-engine-action-plan.md](claude-research/nullspend-cost-engine-action-plan.md) | 2026-03-10 | Cost calculation bugs in 7 categories |
| [claude-research/nullspend-fintech-patterns-research.md](claude-research/nullspend-fintech-patterns-research.md) | 2026-03-11 | Fintech patterns (JIT funding, subaccounts) for agents |
| [claude-research/compass_artifact_wf-4db73083-*.md](claude-research/) | 2026-03-09 | Original competitive landscape analysis |
| [claude-research/compass_artifact_wf-40b71591-*.md](claude-research/) | 2026-03-09 | Technical build spec |

## Archive

Completed or superseded docs preserved for reference.

| Doc | Created | Description | Why Archived |
|-----|---------|-------------|--------------|
| [archive/audit-findings.md](archive/audit-findings.md) | 2026-03-10 | 91-point security audit (91/91 resolved) | All findings resolved |
| [archive/audit-research.md](archive/audit-research.md) | 2026-03-10 | Deep research: Next.js security, Supabase RLS, SSRF, rate limiting | Findings applied |
| [archive/audit-v2-findings.md](archive/audit-v2-findings.md) | 2026-03-13 | Post-audit v2: 61 findings | All findings resolved |
| [archive/audit-phase7b-fixes.md](archive/audit-phase7b-fixes.md) | 2026-03-17 | Phase 7b post-stress-test audit | All findings resolved |
| [archive/architecture-refactor-v2.md](archive/architecture-refactor-v2.md) | 2026-03-15 | Pre-launch tech outline | Shipped |
| [archive/architecture-refactor-implementation.md](archive/architecture-refactor-implementation.md) | 2026-03-15 | 8-phase refactor implementation | Shipped |
| [archive/finops-pivot-tech-audit.md](archive/finops-pivot-tech-audit.md) | 2026-03-09 | Pre-build tech stack audit | Decision made |
| [archive/roadmap.md](archive/roadmap.md) | 2026-03-07 | Original approval-layer roadmap | Superseded by finops-pivot-roadmap |
| [archive/v1-build-contract.md](archive/v1-build-contract.md) | 2026-03-07 | Original V1 ship bar | Completed |
| [archive/repo-guide.md](archive/repo-guide.md) | 2026-03-07 | Original repo structure guide | Superseded by CLAUDE.md |
