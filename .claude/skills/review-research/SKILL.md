---
name: review-research
description: Review a research document against the actual codebase. Use after deep-research to validate recommendations against real code, find misalignments between research assumptions and implementation reality, and identify where recommendations don't fit our architecture, conventions, or constraints.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Grep, Glob, Agent, Bash(git diff *), Bash(git log *), Bash(git show *), WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
argument-hint: [path to research document or topic name]
model: opus
---

Review the research document against our actual codebase and identify misalignments.

$ARGUMENTS

Your role:
Act as a senior staff engineer who deeply knows this codebase, reviewing a research document produced by an external research team. Your job is to ground-truth every recommendation against the real code, conventions, constraints, and architecture of this project.

Objective:
Find where research recommendations conflict with reality — wrong assumptions about how the code works, recommendations that ignore existing patterns, suggestions that would break conventions, architectural options that don't account for our infrastructure, and anything that sounds good in theory but doesn't fit our codebase.

Instructions:

1. **Read the research document thoroughly.** Identify every concrete recommendation, architectural option, naming convention, library suggestion, and implementation detail.

2. **For each recommendation, verify against the codebase:**
   - Does the recommended pattern match how we already do things? Search for existing conventions.
   - Does the recommended naming match our naming patterns? Check schema, validation, and API response conventions.
   - Does the recommended library/tool/approach work with our stack (Next.js 16, Drizzle ORM, Cloudflare Workers, Supabase Postgres, Upstash Redis)?
   - Does the recommended architecture account for our split between dashboard (Next.js) and proxy (Cloudflare Workers)?
   - Are there existing implementations the research missed that already solve part of the problem?

3. **Check for assumption errors:**
   - Did the research assume a table structure, column type, or index that doesn't match reality?
   - Did the research assume a code path, function signature, or module boundary that doesn't exist?
   - Did the research reference files, functions, or patterns that have since changed?
   - Did the research assume capabilities our infrastructure doesn't have?

4. **Check for convention violations:**
   - Does the recommendation follow our existing patterns? (Check CLAUDE.md, TESTING.md, existing schema, existing validation patterns)
   - Would the recommendation create inconsistency with how similar features are already implemented?
   - Does the recommendation follow the migration principle from our audit doc? ("fully replace old patterns — no backward compatibility layers")

5. **Check for missing context:**
   - Are there constraints the research didn't account for? (RLS policies, proxy ESM requirements, SYNC'd webhook builders, etc.)
   - Are there related features or systems the research didn't consider?
   - Are there test patterns the research didn't account for?

6. **Validate effort estimates:**
   - Based on the actual files that need changing, are the effort estimates realistic?
   - Are there files the research missed that would also need updating?
   - Are there test files that would need updating?

7. **Use Context7 when needed** to verify any framework, library, or API claims made in the research.

Return the review in exactly this structure:

## Research Review Summary
- Alignment score: /10 (how well recommendations fit our codebase)
- Ready to implement as-is: Yes / No
- Biggest misalignments

## Validated Recommendations
List recommendations that are confirmed correct after codebase verification. For each:
- What was recommended
- How it aligns with existing code (cite files/patterns)
- Any minor adjustments needed

## Misalignments Found
For each misalignment:
- Severity: Critical / High / Medium / Low
- What the research recommended
- What the codebase actually does or requires
- Evidence (file paths, code snippets, existing patterns)
- How to fix the recommendation

## Missing Context
List important codebase details the research didn't account for that affect the recommendations.

## Existing Code the Research Missed
List functions, utilities, patterns, or prior implementations that already exist and should be reused rather than rebuilt.

## Convention Violations
List where recommendations would break established project conventions, with the correct convention cited.

## Revised Recommendation
Based on the review, provide the corrected implementation approach that accounts for all misalignments, uses existing code where possible, and follows project conventions.

## Updated File List
Provide the corrected list of files that actually need to change, with specific changes for each.

## Updated Effort Estimate
Provide a revised effort estimate based on the actual scope.

Final rule:
Trust the codebase over the research. If the research says one thing and the code says another, the code wins. Optimize for an implementation that fits naturally into the existing codebase.
