# NullSpend Technical Deep Dive: Index

> **How to use these files in Cursor:** Each file is a self-contained reference
> for a specific category of competitor bugs and our technical remediation.
> When working on a feature, open the relevant file for context on what bugs
> to avoid and what tests to write.

---

## Files

| File | Category | Bug Count | Priority |
|---|---|---|---|
| `01-budget-enforcement-bugs.md` | Budget bypass, enforcement, state management | 10 bugs | **This week** |
| `02-anthropic-cost-bugs.md` | Anthropic cache token math, TTL rates, long context | 7 bugs | **Week 2-3** |
| `03-openai-cost-bugs.md` | OpenAI cached tokens, reasoning tokens, API formats | 6 bugs | **Week 2-3** |
| `04-streaming-bugs.md` | SSE parsing, chunk boundaries, reconciliation | 5 bugs | **Week 2-3** |
| `05-performance-and-ecosystem-gaps.md` | Performance advantages, UX rules, OpenClaw features | 6 perf + 7 gaps | **Launch + post-launch** |

---

## Build Sequence

### This Week: Budget Enforcement (File 01)
Focus: `01-budget-enforcement-bugs.md`

The proxy works. Budget enforcement makes it a product. Every bug in File 01
is a LiteLLM vulnerability that our architecture avoids by design. Ship:
- Redis Lua check-and-reserve (BE-8)
- Pre-request budget check (BE-1, BE-4)
- Post-response reconciliation (BE-9)
- HTTP 429 with budget details (UX-4)
- Budget CRUD API (BE-5, BE-7)
- Concurrent request test (BE-8)

### Week 2-3: Cost Accuracy (Files 02, 03, 04)
Focus: `02-anthropic-cost-bugs.md`, `03-openai-cost-bugs.md`, `04-streaming-bugs.md`

Cost accuracy makes budget enforcement trustworthy. Every test is derived from
a real competitor bug. Ship:
- Anthropic parser with cache math (AC-1 through AC-7)
- OpenAI parser with cached token discount (OC-1 through OC-6)
- Streaming state machines for both providers (SP-1 through SP-5)
- Streaming → cost → budget reconciliation end-to-end

### Launch: Performance & Positioning (File 05)
Focus: `05-performance-and-ecosystem-gaps.md`

Verify performance claims, enforce UX design rules, prepare ecosystem
integration. Ship:
- Latency benchmarks (PA-1, PA-2)
- "Never silent $0" cost logging (UX-3)
- Actionable 429 response format (UX-4)

### Post-Launch: Ecosystem Features (File 05, Section C)
Focus: `05-performance-and-ecosystem-gaps.md` Section C

Driven by user demand. Backlog:
- Context cost alerting (EG-2)
- Agent ID attribution (EG-3)
- Runaway loop detection (EG-4)
- Kill receipts (EG-6)

---

## Cross-Reference: Bug → Test → Feature

| Bug ID | Source | Test ID | Feature |
|---|---|---|---|
| BE-1 | LiteLLM #12977 | BE-1 test | Identity-based enforcement |
| BE-2 | LiteLLM #12905 | BE-2a,b,c | Entity hierarchy |
| BE-5 | LiteLLM #14266 | BE-5 test | Atomic budget reset |
| BE-7 | LiteLLM #19781 | BE-7 test | Budget lifecycle CRUD |
| BE-8 | LiteLLM architecture | BE-8 test | Concurrent request safety |
| BE-9 | Architectural | BE-9 test | Reservation cleanup |
| BE-10 | Portkey docs | BE-10a,b | Unknown model fallback |
| AC-1 | Langfuse #12306 | AC-1 test | No double-count |
| AC-2 | LiteLLM #6575/#9812 | AC-2 test | Cache write rate |
| AC-3 | LiteLLM #5443 | AC-3 test | Cache costs included |
| AC-4 | LiteLLM #11789 | AC-4 criteria | Streaming = non-streaming cost |
| AC-5 | Anthropic docs | AC-5a,b | TTL-specific rates |
| AC-6 | Anthropic docs | AC-6a,b,c | Long context doubling |
| OC-1 | LiteLLM #19680 | OC-1 test | Cached token discount |
| OC-2 | Langfuse docs | OC-2a,b | Reasoning tokens |
| OC-3 | OpenAI docs | OC-3a,b,c | API format detection |
| OC-6 | Langfuse #7767 | OC-6 test | Failed = zero cost |
| SP-1 | LangChain #10249 | SP-1 test | Cumulative delta handling |
| SP-2 | OpenAI docs | SP-2 test | Final chunk extraction |
| SP-3 | Architectural | SP-3a,b,c | Chunk boundary parsing |
| SP-5 | Architectural | SP-5 test | Streaming reconciliation |

---

## Design Constraints (from all 5 files)

1. **Budget check is identity-based, not route-based** (File 01)
2. **All budget mutations via Redis Lua scripts** (File 01)
3. **Each provider gets its own parser — no generic handler** (Files 02, 03)
4. **Streaming: overwrite, never sum** (File 04)
5. **Parse from raw provider response, never pre-normalized** (Files 02, 03)
6. **Integer arithmetic (microdollars) for all money** (Files 02, 03)
7. **Cost logging never blocks the response** (File 05)
8. **Failed requests = $0 cost** (File 03)
9. **Unknown models get conservative estimate, not $0** (File 01)
10. **Setup = API key + base URL, nothing else** (File 05)
