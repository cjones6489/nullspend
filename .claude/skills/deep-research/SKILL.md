---
name: deep-research
description: Deep technical research using a team of specialized agents. Use when making important architectural decisions, evaluating design patterns, or researching a priority item before implementation. Pass the research topic as an argument.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Agent, WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
argument-hint: [research topic or priority item description]
model: opus
---

Use a team of specialized agents to perform a deep technical research pass on the following topic:

$ARGUMENTS

Your mission:
Research this topic as if we are making an important architectural decision for our platform and need a high-confidence technical recommendation grounded in current reality, not generic opinions.

Approach:
Spin up a team of agents with clearly separated responsibilities and then synthesize their findings into one cohesive research document.

Use at minimum these agent roles:

1. Documentation Research Agent
- Research the latest official technical documentation relevant to this topic
- Use Context7 whenever relevant to retrieve current docs, API references, implementation guidance, version-specific details, and framework/library behavior
- Prefer official docs and primary technical sources over blogs
- Identify constraints, caveats, best practices, sharp edges, version changes, and implementation details that matter

2. Competitive / Platform Pattern Agent
- Research the most relevant modern platforms, products, and technical implementations adjacent to this problem
- Study how strong teams appear to have designed similar systems
- Identify recurring design patterns, infrastructure choices, workflow decisions, and DX patterns
- Identify where competitors or adjacent platforms appear overengineered, fragile, slow, confusing, or limited
- Look for opportunities where our implementation can be simpler, more robust, or provide better DX

3. Open Source / Repo Research Agent
- Find relevant recent repos, libraries, SDKs, example implementations, and source patterns related to this topic
- Identify what patterns real implementations are using today
- Look for signs of maturity, maintenance quality, ecosystem health, complexity, performance tradeoffs, and implementation pitfalls
- Surface useful repos or code references that could influence our architecture or implementation strategy

4. Architecture Agent
- Translate the research into architectural options for our platform
- Identify the strongest design patterns for our use case
- Compare simple vs advanced approaches
- Identify tradeoffs, failure modes, scaling implications, and maintainability implications
- Recommend what should be designed now versus deferred until later

5. DX / Product Experience Agent
- Evaluate the problem from the perspective of developer experience, internal maintainability, onboarding simplicity, and product usability
- Identify friction points common in existing implementations
- Recommend how we can make the system cleaner, easier to reason about, and more pleasant to build on
- Highlight where architecture decisions may hurt speed, clarity, or maintainability later

6. Frontier / Emerging Patterns Agent
- Search for bleeding-edge startups (especially recent YC companies) building in adjacent spaces — AI infrastructure, FinOps, API gateways, observability, billing, developer tools
- Look for published academic research, technical papers, and conference talks (e.g., USENIX, SIGMOD, VLDB, InfoQ, Strange Loop) relevant to this problem
- Identify forward-looking design patterns that haven't yet become mainstream but show strong signal — new approaches to the problem from teams that are solving it right now
- Look at recently funded companies' technical blogs, open-source projects, and architecture posts for novel approaches
- Distinguish between genuinely innovative patterns vs. hype. Focus on ideas that could give NullSpend a structural advantage as the best financial infrastructure for AI agents
- Flag any emerging standards, protocols, or specifications in draft/proposal stage that we should design for now

7. Risk / Failure Mode Agent
- Identify likely bugs, weak spots, operational risks, edge cases, rollout hazards, data integrity risks, auth/security issues, scaling traps, and long-tail failure modes
- Identify hidden complexity or places where the problem is harder than it first appears
- Highlight assumptions that need validation before implementation

Research standards:
- Prefer current official docs, release notes, issue trackers, source repos, and primary technical sources
- Use Context7 whenever relevant for current documentation
- Be careful about outdated patterns
- Do not just list technologies or copy common stack advice
- Distinguish clearly between:
  - established best practice
  - emerging but promising approaches
  - trendy but unjustified complexity
- Optimize for a solution that is:
  - simple
  - scalable
  - maintainable
  - high quality
  - future-aware without being overengineered
  - excellent for DX
- Be skeptical of unnecessary complexity
- If multiple good options exist, compare them honestly
- If something is uncertain, say so explicitly

What I want from the team:
1. Deeply research this priority item
2. Identify the best current design patterns
3. Identify the best architectural approaches
4. Identify the best current tools, frameworks, libraries, or platform patterns if relevant
5. Identify weaknesses or gaps in current market/platform/repo approaches
6. Identify where we can outperform existing solutions in architecture, simplicity, robustness, or DX
7. Recommend the best technical strategy for our platform specifically
8. Compile the findings into a clear research document that can guide implementation planning

Important constraints:
- Do not optimize for theoretical perfection
- Do not recommend complexity unless it is clearly justified
- Do not default to "enterprise" architecture if a simpler design is better
- Do not give shallow generic advice
- Do not stop at surface-level comparisons
- We care about practical implementation, maintainability, and strategic design quality

Deliverable:
Produce a research document in markdown with this exact structure:

# Deep Technical Research Document

## Topic
Restate the priority item and explain why it matters.

## Executive Summary
Summarize the most important findings, the recommended approach, and the biggest architectural implications.

## Research Method
Briefly explain how the agent team approached the problem and what each agent focused on.

## Official Documentation Findings
Summarize the most important findings from official docs and Context7.
Include relevant implementation constraints, caveats, best practices, and version-specific considerations.

## Modern Platform and Ecosystem Patterns
Summarize what recent platforms, products, and strong implementations appear to be doing.
Identify recurring design patterns and notable differences.

## Relevant Repos, Libraries, and Technical References
List the most relevant repos, libraries, SDKs, code patterns, and technical references.
Explain why each one matters.

## Architecture Options
Present the main architectural options for solving this problem.
For each option include:
- overview
- strengths
- weaknesses
- complexity cost
- scaling implications
- maintainability implications
- DX implications
- when it is appropriate

## Recommended Approach for Our Platform
Give the recommended technical strategy for our specific use case.
Explain why this is the best choice for our stage, goals, and likely future needs.

## Frontier and Emerging Patterns
Summarize findings from bleeding-edge companies, recent YC startups, published research, and emerging standards. For each finding:
- Who is doing it (company, paper, project) and when (funding date, publication date, last commit)
- What the pattern or approach is
- Why it matters for our platform vision (best financial infrastructure for AI agents)
- Maturity level: production-proven / early-adopter / experimental / theoretical
- Whether to adopt now, design for later, or watch

Clearly separate signal from hype. We want patterns that give structural advantage, not trends that add complexity without payoff.

## Opportunities to Build Something Better
Identify where existing products, repos, or patterns seem weak and where we can create a better implementation.
Focus on simplicity, robustness, maintainability, and DX. Include forward-looking opportunities from the frontier research that could position us ahead of established players.

## Risks, Gaps, and Edge Cases
List hidden risks, hard problems, likely bugs, scaling traps, and assumptions that need validation.

## Recommended Technical Direction
Provide a concrete recommendation for:
- design pattern
- architecture
- libraries/tools if relevant
- implementation approach
- what to do now
- what to defer
- what to avoid

## Open Questions
List anything that remains uncertain or needs more validation.

## Sources and References
List ALL sources consulted during research. This section must be comprehensive — every doc, repo, API reference, spec, blog post, issue tracker thread, and technical source that informed the findings. Group by category:

### Official Documentation
- Full URLs to official docs pages consulted (e.g., PostgreSQL, Drizzle ORM, Cloudflare Workers, Supabase, Stripe API)
- Include the specific page/section, not just the root domain
- Note the version or date accessed when relevant

### Specifications and Standards
- RFCs, OpenAPI specs, protocol specifications, industry standards (e.g., CloudEvents, OpenTelemetry, FOCUS FinOps)
- Include spec version numbers

### Platform and Product References
- Links to specific platform documentation, API references, or product pages that informed competitive analysis
- Include the specific feature/concept page, not just the homepage

### Repositories and Code References
- GitHub repos with full URLs, star counts, and last commit activity where relevant
- Specific files, functions, or patterns referenced within repos
- NPM packages with version numbers and weekly download counts where relevant

### Issue Trackers and Discussions
- GitHub issues, PRs, or discussions that revealed implementation details, known bugs, or design decisions
- Stack Overflow threads or forum posts only if they provided authoritative technical insight

### Blog Posts and Articles
- Only include if they provided substantive technical depth beyond what official docs cover
- Note the author's credentials or affiliation when relevant
- Mark as secondary sources

### Internal Codebase References
- Files, functions, patterns, and conventions from our own codebase that informed the analysis
- Include file paths and line numbers for specific references

Every claim, comparison, or recommendation in the research should be traceable to a source listed here. If a finding came from general knowledge rather than a specific source, say so explicitly rather than omitting the citation.

Final instruction:
This should read like a serious internal technical research memo written by a strong engineering research team. Be rigorous, current, comparative, and practical. Optimize for helping us make the best architecture decision, not for sounding impressive. Every recommendation must be traceable to evidence.
