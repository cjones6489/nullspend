---
name: research
description: Quick competitive and technical research for a feature or topic. Use before designing any feature to understand competitor implementations, frontier patterns, best DX practices, known pitfalls, and industry standards. Lighter than deep-research — returns findings inline, no document created.
allowed-tools: Read, Grep, Glob, Agent, WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
argument-hint: [feature or topic to research]
model: opus
user-invocable: true
---

Perform a focused research pass on the following topic:

$ARGUMENTS

You are researching this topic to inform a design decision for NullSpend — a FinOps proxy for AI agents (the "Ramp for AI spend"). The goal is to understand the landscape deeply enough to build something cutting-edge that avoids known pitfalls natively.

## Research approach

Launch 3 agents in parallel with clearly separated responsibilities:

### Agent 1: Competitor & Platform Patterns
Research how competitors and adjacent platforms implement this feature or solve this problem.

Focus on:
- **AI infrastructure**: LiteLLM, Portkey, Helicone, OpenRouter, Bifrost, Martian, Braintrust, Langfuse, AgentBudget, SatGate
- **FinOps/billing**: Stripe, Brex, Ramp, CloudZero, Vantage, Kubecost, FOCUS spec
- **Cloud providers**: AWS, GCP, Azure (for billing/governance patterns)
- **Developer tools**: Datadog, PostHog, Vercel, Cloudflare (for DX patterns)
- **Recent YC companies** building in adjacent spaces

For each relevant implementation found:
- What's their entity/data model for this feature?
- What's the API/SDK surface look like (DX)?
- What works well? What's broken, confusing, or over-engineered?
- Are there known bugs, GitHub issues, or community complaints?
- What would we do differently?

Use WebSearch extensively. Prioritize 2025-2026 sources.

### Agent 2: Technical Docs, Open Source & Known Pitfalls
Research the technical foundations — libraries, protocols, standards, open-source implementations, and constraints that affect implementation.

Focus on:
- Official docs for any libraries/frameworks/APIs involved
- Use Context7 for current documentation on relevant packages
- **Open-source repos** that implement this feature or solve similar problems well. Search GitHub for relevant projects — look at AI gateways, FinOps tools, billing systems, developer platforms, and infrastructure projects
- Known bugs, breaking changes, version-specific gotchas
- GitHub issues and discussions revealing implementation traps
- Performance characteristics and scaling limits
- Security considerations

For each relevant open-source repo found:
- Repo name, URL, stars, last activity, language
- What design pattern or architecture they use for this feature
- Specific files/modules worth studying (link to the code)
- What they got right (clean patterns worth borrowing)
- What they got wrong (complexity, bugs, scaling issues)
- License compatibility

For each pitfall/constraint found:
- What's the constraint or pitfall?
- How do existing implementations get burned by it?
- How should we design around it natively?

### Agent 3: Frontier Patterns & Best DX
Research bleeding-edge approaches and the best developer experiences for this feature.

Focus on:
- Novel approaches from recent startups, papers, or open-source projects
- Emerging standards or specs in draft/proposal stage
- The cleanest API/SDK designs for this feature (who has the best DX and why?)
- Patterns that haven't become mainstream but show strong signal
- Academic research (USENIX, SIGMOD, arxiv) if relevant

For each pattern:
- Who's doing it and since when?
- Maturity: production-proven / early-adopter / experimental
- Why it's better than the conventional approach
- Whether to adopt now, design for later, or just watch

## What to deliver

After all agents return, synthesize findings into a structured response with these sections:

### How others do it
Concise comparison table of the most relevant implementations. Include entity model, API surface, and notable DX choices.

### Open-source references
Table of the most relevant repos with: name, URL, stars, what pattern to study, and specific files/modules worth reading. Focus on repos with clean architectures we can learn from — not just popular ones.

### Known pitfalls and bugs
Specific issues, gotchas, and failure modes found in existing implementations. For each: what goes wrong, who it affects, and how to avoid it natively.

### Best DX patterns
The cleanest API designs and developer experiences found. What makes them good and what we should steal.

### Frontier approaches
Emerging patterns worth considering. Clearly separate production-proven from experimental.

### Recommended design direction
Concrete recommendation for NullSpend specifically:
- Suggested data model / architecture
- API surface / DX design
- What to build now vs. defer
- What to explicitly avoid
- How this positions us ahead of competitors

### Open questions
Anything uncertain that needs validation before implementation.

## Research standards

- Prefer 2025-2026 sources. Flag anything older than 2024 as potentially stale.
- Every claim should be traceable to a source. Include URLs inline.
- Distinguish between established best practice, emerging patterns, and hype.
- Be skeptical of unnecessary complexity. Simpler is better unless complexity is clearly justified.
- Optimize for: simple, scalable, maintainable, excellent DX, future-aware without overengineering.
- Do NOT produce a separate research document. Return findings directly in the conversation.
- Keep it concise — tables over paragraphs, bullets over prose. The user wants to make a design decision, not read a thesis.
