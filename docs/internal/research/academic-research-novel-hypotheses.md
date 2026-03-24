# Academic Research Synthesis: Novel Hypotheses for NullSpend

**Date:** 2026-03-22
**Purpose:** Cross-pollinate academic research from RL, distributed systems, control theory, ad tech, and payment networks into novel technical ideas for NullSpend. These are hypothesis-driven R&D directions, not immediate implementation plans.

---

## The Big Insight

Three independent research streams converge on the same idea: **budget enforcement doesn't have to be binary (approve/deny) — it can be intelligent, predictive, and self-optimizing.**

- **Payment networks** (Visa STIP) learned to make autonomous approve/deny decisions when the authoritative source is unavailable — using ML trained on historical patterns, with bounded error.
- **Ad tech** (Google, Meta, Snap) learned that PID controllers and RL can pace a fixed budget over time with provable regret bounds — not just block when you're over, but smooth the spend rate.
- **AI agent research** (Google BATS, BAMAS, INTENT) proved that agents that know their budget spend 31-86% less — budget awareness changes agent behavior, not just enforcement.

NullSpend currently does one thing: synchronous approve/deny at the proxy. The research suggests we could evolve into a **spend intelligence system** — predicting costs before they happen, pacing budgets over time, adapting rate limits to traffic patterns, and making agents themselves smarter about spending.

---

## Novel Hypothesis 1: Escrow-Based Budget Rights Distribution

### The Idea
Distribute "rights to spend" from the Durable Object to edge Workers, so most budget checks require zero coordination.

### Source
- **Bounded Counter CRDT** (Balegas et al., SRDS 2015, arXiv 1503.09052)
- **Escrow Transactional Method** (O'Neil, ACM TODS 1986)
- **Demarcation Protocol** (Barbara-Milla, Garcia-Molina, VLDB Journal 1994)

### How It Works
1. Budget entity has $100 remaining. 3 Workers are active.
2. DO allocates $30 of "spend rights" to each Worker, retaining $10 as reserve.
3. Worker A receives a $5 request → approves locally (no DO round-trip). Remaining local rights: $25.
4. Worker B receives a $35 request → local rights insufficient ($30) → coordinates with DO for more rights or denial.
5. When Worker C goes idle, its unused $30 in rights returns to the DO pool.

### Why It's Novel for AI FinOps
Nobody in the AI proxy space does this. Every competitor either:
- Checks a central store synchronously (adds latency), or
- Caches budget state and accepts staleness (risks overspend)

The escrow approach gives you **zero-latency enforcement with a formally bounded overspend guarantee**. Maximum overspend = `active_workers * rights_per_allocation`. You can tune this: small allocations = tighter bound but more coordination; large allocations = fewer round-trips but larger overspend window.

### Implementation on CF Workers
This is actually feasible with our architecture:
- DO allocates rights via RPC response (`{ approved: true, rightsGranted: 3000000 }` = $3.00 in microdollars)
- Worker stores rights in module-level memory (survives across requests within same isolate)
- Worker decrements locally for each approved request
- When rights < estimated_cost, Worker contacts DO for reallocation
- DO tracks total outstanding rights across all Workers
- `waitUntil()` periodically reconciles unused rights back to DO

### Risk
Workers are stateless across isolate evictions. If a Worker is evicted with unreconciled rights, those rights are temporarily "lost" until the DO reclaims them (via TTL or heartbeat). The overspend bound accounts for this.

### Estimated Impact
- **Latency:** Eliminates DO round-trip for ~80-95% of requests (those clearly within rights)
- **Overspend bound:** Configurable per budget entity. For a $1000 budget with 5 active Workers and $10 allocations: max overspend = $50 (5%).
- **Complexity:** Medium. Requires Worker-level state management and DO allocation logic.

---

## Novel Hypothesis 2: Predictive Cost Estimation (Speculative Budget Checks)

### The Idea
Predict the output token count (and thus cost) before the API call completes, enabling tighter pre-flight budget checks and speculative approval.

### Source
- **EGTP: Entropy-Guided Token Pooling** (Huang et al., ICLR 2026, arXiv 2602.11812) — Predicts output length from LLM hidden states. MAE of 103 tokens.
- **TALE-EP** (ACL Findings 2025, arXiv 2412.18547) — Zero-shot token budget estimation.
- **SelfBudgeter** (arXiv 2505.11274) — Model autonomously predicts required token budgets.

### How It Works for NullSpend
Currently, `estimateMaxCost()` uses `max_tokens` as the upper bound — a worst-case estimate that's often 10-100x the actual cost. This causes unnecessary budget blocks for requests that would have been affordable.

A prediction model could estimate actual output length from:
- Input token count
- Model identifier (reasoning models produce more tokens)
- Prompt characteristics (question complexity, "explain in detail" vs "yes/no")
- Historical data for this API key / session (agents tend to have consistent patterns)

Even a simple heuristic (e.g., "output ≈ 0.3x input for chat, 2x input for reasoning models") would tighten estimates dramatically.

### Three Tiers of Prediction
1. **Heuristic (now):** Model-specific multipliers on input tokens. Zero ML, works today.
2. **Statistical (6 months):** Per-key historical average output/input ratio with EWMA smoothing. Uses data we already collect.
3. **Learned (12 months):** Lightweight classifier trained on NullSpend's cost event data. Features: model, input_tokens, provider, time_of_day, tags.

### Estimated Impact
- **Tier 1:** Reduces false budget blocks by ~50-70% (eliminates worst-case `max_tokens` overestimation)
- **Tier 2:** Reduces false blocks by ~80-90% (personalized to actual usage patterns)
- **Tier 3:** MAE of ~100 tokens per the EGTP paper = cost prediction within ~$0.001 for most models

---

## Novel Hypothesis 3: PID-Controlled Spend Pacing

### The Idea
Instead of hard budget limits that block at a threshold, use a PID controller to pace spend evenly over the budget period — like ad tech paces campaign budgets.

### Source
- **Dual-Based PID Controllers** (Balseiro, Lu, Mirrokni, 2022, arXiv 2202.06152) — Proves regret bounds for PID-based budget pacing.
- **Bucketized Hysteresis Controller** (Apparaju, Niu, Qi, Snap Inc., 2025, arXiv 2509.25429) — 13% less pacing error, 54% less volatility than PID.
- **Field Guide for Budget Pacing** (Balseiro et al., Google Research, ICML 2024, arXiv 2302.08530) — Min-pacing algorithm: run each constraint independently, apply the minimum.
- **Google Patent US10878448B1** — PID controller for campaign spend pacing.

### How It Works for NullSpend
User sets: "Spend $100/day on this project."

Currently: Agent burns $95 in the first hour, gets blocked for the remaining 23 hours.

With PID pacing:
- **Target rate:** $100 / 24h = $4.17/hour
- **Error signal:** actual_rate - target_rate
- **Controller output:** Adjusts approval probability or introduces micro-delays
- **P term:** Corrects current overspend/underspend
- **I term:** Eliminates steady-state drift
- **D term:** Dampens oscillation (prevents approve-block-approve cycling)

When the agent is spending at $2/hour (under target): no throttling.
When the agent hits $8/hour (2x target): gently reduce approval rate.
When the agent spikes to $50/hour (12x target): aggressively throttle.

The Bucketized Hysteresis Controller (BHC) improves on basic PID: large steps for large errors (fast correction), small steps for small errors (stability). This prevents the oscillation problem where an agent alternates between full-speed and blocked.

### Why It's Novel for AI FinOps
Nobody in the AI cost space does spend pacing. Everyone does hard limits. But ad tech has been doing this for 15+ years at Google/Meta/Snap scale with billions of dollars. The algorithms are proven, the math is well-understood, and the implementation is straightforward.

### Implementation on CF Workers
The PID controller state (error integral, previous error) lives in the Durable Object alongside budget state. On each budget check:
1. Calculate current spend rate (from recent cost events)
2. Compute error vs target rate
3. PID output determines: approve immediately, approve with delay hint, or soft-block with retry-after
4. Return `{ approved: true, paceDelayMs: 200 }` or `{ approved: false, retryAfterMs: 5000 }`

### Product Implications
This enables a new budget policy: `paced` (alongside `strict_block`, `soft_block`, `warn`). The agent still gets value from its full budget — it's just spread evenly over the period instead of front-loaded.

### Estimated Impact
- **User experience:** Eliminates the "budget cliff" where agents burn budget fast then sit idle
- **Agent efficiency:** Agents that are paced produce more total value from the same budget (per ad tech literature)
- **Complexity:** Low-Medium. PID math is trivial. The challenge is the product design (what does "pacing" mean for an AI agent vs an ad campaign?).

---

## Novel Hypothesis 4: Visa STIP-Style Stand-In Processing

### The Idea
When the Durable Object is slow or unreachable, the Worker makes an autonomous approve/deny decision using a lightweight model trained on historical patterns — like Visa's Stand-In Processing.

### Source
- **Visa Smarter STIP** (Visa, 2020) — Deep learning model trained on billions of transactions, 95% accuracy in emulating issuer decisions. Handles 101M outage transactions/year.
- **Distributed Speculative Execution** (Li et al., arXiv 2412.13314, 2024) — Approve speculatively, repair on failure. Up to 10x latency reduction.

### How It Works for NullSpend
Normal path: Worker → DO budget check → approve/deny → upstream.

When DO is slow (>50ms) or unavailable:
1. Worker has a local decision model: `shouldApproveStandIn(apiKey, model, estimatedCost, recentSpendRate)`
2. Model considers: remaining budget (last known), spend velocity, cost relative to budget, historical approval rate for this key
3. If high confidence approve: forward request, flag as "stand-in approved", reconcile when DO recovers
4. If uncertain: hold request briefly, retry DO
5. If high confidence deny: reject immediately

### Why It's Novel
No AI proxy has a fallback decision model. They either fail-open (approve everything during outage = unlimited spend) or fail-closed (block everything = service disruption). STIP-style stand-in gives you a middle path with bounded error.

### Implementation
The "model" doesn't need to be ML initially. A simple rule set works:
- If remaining budget > 10x estimated cost → approve (high headroom)
- If remaining budget < 2x estimated cost → deny (too close to limit)
- If spend rate in last 5 minutes > 2x average → deny (possible runaway)
- Otherwise → hold and retry

Over time, this could be replaced with a lightweight classifier trained on NullSpend's actual approve/deny decisions.

### Estimated Impact
- **Availability:** 99.9% → 99.99% for budget-enforced requests (DO outages no longer block traffic)
- **Overspend risk:** Bounded by stand-in duration * approval rate * average cost
- **Complexity:** Low for rule-based, Medium for ML-based

---

## Novel Hypothesis 5: Adaptive Rate Limiting via RL

### The Idea
Replace static rate limits (120 req/min per IP, 600 req/min per key) with a learned policy that adapts to traffic patterns, budget utilization, and upstream provider health.

### Source
- **Multi-Objective Adaptive Rate Limiting** (Lyu et al., arXiv 2511.03279, ACM AIIIP 2025) — DQN + A3C hybrid. 30.9% throughput improvement, 38.2% P99 latency reduction. 90-day production deployment on 500M daily requests.
- **Adaptive Event Processing in API Gateways** (Springer 2025) — PPO for gateway policies. 41% latency reduction for high-priority events.

### How It Would Work
State space: {request_rate, budget_utilization, error_rate, upstream_latency, time_of_day}
Action space: {rate_limit_multiplier ∈ [0.1, 3.0]}
Reward: {throughput - α*latency_p99 - β*budget_violations - γ*upstream_errors}

The RL agent learns:
- When budget is nearly full → allow higher rates (let agents get value from remaining budget)
- When budget is nearly empty → tighten rates (prevent burst overspend)
- When upstream is degraded → reduce rates (prevent wasted spend on errors)
- At night → relax limits (lower traffic, less contention)

### Why This Matters
Static rate limits are a blunt instrument. An agent doing legitimate batch processing at 3am hits the same limits as a DDoS at noon. Adaptive limits would give legitimate agents more headroom while providing better protection during actual attack patterns.

### Implementation Path
1. **Now:** Collect state signals in Analytics Engine (already have request metrics, budget metrics)
2. **6 months:** Train offline on historical data, deploy as a lookup table in the DO
3. **12 months:** Online learning with conservative exploration (epsilon-greedy with small epsilon)

### Estimated Impact
- **Throughput:** 20-30% improvement for legitimate traffic (per paper benchmarks)
- **False positives:** Significant reduction in rate-limiting legitimate burst traffic
- **Complexity:** High. RL in production is hard. Start with offline training + static deployment.

---

## Novel Hypothesis 6: Anomaly Detection via Change-Point Detection

### The Idea
Detect when an agent's spend pattern fundamentally changes (enters a loop, changes task type, gets compromised) using online change-point detection — cheaper and more interpretable than ML anomaly detection.

### Source
- **BOCPD: Bayesian Online Changepoint Detection** (Adams & MacKay, 2007, arXiv 0710.3742) — O(1) per observation with approximation. Computes posterior probability of "time since last change."
- **Online Changepoint Detection on a Budget** (Wang, 2022, arXiv 2201.03710) — Bounded storage, constant per-observation computation.
- **CUSUM / EWMA** — Classical statistical process control. Trivially implementable, works with 50+ samples.

### How It Works for NullSpend
The DO already tracks per-entity spend over time. Add a lightweight change-point detector:

**EWMA (simplest, implement now):**
```
ewma_rate = α * current_rate + (1 - α) * ewma_rate
if current_rate > ewma_rate * threshold_multiplier:
    emit "spend_anomaly" webhook
```

**CUSUM (slightly more sophisticated):**
```
cusum_pos = max(0, cusum_pos + (current_rate - target_rate - drift))
cusum_neg = max(0, cusum_neg - (current_rate - target_rate + drift))
if cusum_pos > threshold or cusum_neg > threshold:
    emit "spend_pattern_change" webhook
```

**BOCPD (most powerful):**
Track posterior distribution over "run length" (time since last change). When the probability of a recent change-point exceeds a threshold, trigger an alert. This naturally handles both sudden spikes and gradual regime shifts.

### Why It's Better Than Our Current Velocity Limits
Our velocity limits are binary: "more than $X in Y seconds = blocked." They can't distinguish between:
- An agent legitimately processing a large batch (expected spike)
- An agent stuck in a loop (unexpected sustained elevation)
- A gradual cost increase over hours (slowly drifting up)

Change-point detection catches all three patterns with appropriate sensitivity. It also produces a confidence score (posterior probability) rather than a binary trigger.

### Product Feature: "Spend Anomaly Detection"
- CUSUM/EWMA running in the DO for every budget entity (nearly zero overhead)
- When anomaly detected: emit `spend.anomaly_detected` webhook with confidence score and baseline comparison
- Dashboard shows anomaly timeline with detected change-points
- This is a Guardian Agent feature — exactly what Gartner's new category describes

### Estimated Impact
- **Detection speed:** Catches loops 10-60s faster than current velocity limits (CUSUM detects small persistent shifts that sliding windows miss)
- **False positive rate:** Lower than static thresholds because it adapts to each agent's baseline
- **Implementation:** EWMA is ~5 lines of code in the DO. CUSUM is ~15 lines. BOCPD is ~50 lines.
- **Complexity:** Low for EWMA/CUSUM, Medium for BOCPD

---

## Novel Hypothesis 7: Budget-Aware Agent Response Headers

### The Idea
Return budget state information in response headers so agents can self-regulate without additional API calls.

### Source
- **Google BATS: Budget-Aware Tool-Use** (Liu et al., arXiv 2511.17006, Google, Nov 2025) — Agents with budget awareness use 40.4% fewer tool calls, 31.3% cost reduction while maintaining accuracy.
- **INTENT** (Liu et al., arXiv 2602.11541, Feb 2026) — Budget-constrained tool agents with intention-aware planning.
- **BAVT** (Li et al., arXiv 2603.12634, UBC/Vector Institute, Mar 2026) — Budget-conditioned node selection that transitions from exploration to exploitation as budget depletes.

### How It Works
Every proxy response includes:
```
X-NullSpend-Budget-Remaining: 4523000    # microdollars remaining
X-NullSpend-Budget-Utilization: 0.55     # 55% spent
X-NullSpend-Spend-Rate: 125000           # microdollars/minute current rate
X-NullSpend-Request-Cost: 45200          # microdollars this request cost
```

An agent (or agent framework) reads these headers and adapts:
- At 80% utilization → switch to cheaper model
- At 90% utilization → reduce exploration, focus on exploitation
- At 95% utilization → complete only critical tasks
- Spend rate accelerating → slow down, batch requests

### Why This Is the Highest-Leverage Feature
Google's BATS paper proves this with data: **agents that know their budget spend 31% less.** That's not a proxy optimization — it's a fundamental change in agent behavior. And it requires almost zero engineering: add 4 response headers.

The proxy already calculates all of these values. `budgetCheckOutcome` from the DO contains remaining budget. Cost is calculated post-response. Utilization is remaining/limit. Spend rate can be derived from the velocity tracker.

### Estimated Impact
- **Cost reduction for users:** 20-40% (per BATS paper benchmarks)
- **Implementation:** ~20 lines of code in the response path
- **Complexity:** Very low

---

## Novel Hypothesis 8: Count-Min Sketch for Edge-Local Budget Tracking

### The Idea
Use a Count-Min Sketch at the Worker edge for approximate spend tracking — with the key insight that CMS always **overestimates**, which is the safe direction for budget enforcement.

### Source
- **Count-Min Sketch** (Cormode & Muthukrishnan, 2005)
- **Tight Streaming Lower Bounds** (arXiv 2406.12149, 2024) — Proves fundamental limits on approximate counting space.

### How It Works
A CMS with width=1000 and depth=5 uses ~5KB of memory. It can track approximate spend across thousands of budget entities at the Worker edge. For each request:
1. Worker queries CMS: "approximate spend for this entity?"
2. If approximate_spend + estimated_cost < budget_limit * safety_margin → approve locally
3. If approximate_spend is near the budget limit → escalate to DO for authoritative check
4. After response, update CMS with actual cost

Since CMS overestimates, it will sometimes escalate to the DO unnecessarily (false positive) but will **never approve a request that's actually over budget** (no false negatives). This is exactly the right error direction for financial enforcement.

### Synergy with Hypothesis 1 (Escrow)
CMS and escrow are complementary. CMS gives you a fast "is this entity anywhere near their budget?" check. Escrow gives you the actual spend rights. Together:
1. CMS first: "is this entity clearly within budget?" (sub-microsecond)
2. If yes: decrement escrow rights locally (microseconds)
3. If uncertain: escalate to DO (milliseconds)

### Estimated Impact
- **DO round-trips eliminated:** 60-80% (for entities clearly within budget)
- **Memory:** ~5KB per Worker isolate
- **Accuracy:** With width=1000 and depth=5, error ≤ 0.1% of total observed spend with 97% probability
- **Complexity:** Low. CMS is ~30 lines of code.

---

## Novel Hypothesis 9: Formal Verification of Budget Protocol (TLA+)

### The Idea
Write a TLA+ specification of the reserve-proxy-reconcile protocol and formally verify that total spend never exceeds budget + bounded_epsilon.

### Source
- **How AWS Uses Formal Methods** (Newcombe et al., CACM 2015) — Found subtle bugs in S3, DynamoDB, EBS.
- **MongoDB TLA+ Verification** (VLDB 2025) — Compositional TLA+ spec with automated test generation.
- **Smart Casual Verification** (NSDI 2025, Microsoft Research) — TLA+ spec + trace validation against production.
- **Token Bucket TLA+ Model** (Demirbas, March 2026) — Rate limiting modeled in PlusCal/TLA+.

### What We'd Verify
- **Safety:** `∀ entity: actual_spend(entity) ≤ budget(entity) + epsilon`
- **Liveness:** `∀ reservation: eventually(reconciled(reservation))`
- **Bounded staleness:** `∀ worker_cache: age(cache) ≤ max_ttl`
- **No lost rights:** `sum(outstanding_rights) + do_reserve ≤ original_budget` (for escrow hypothesis)

### Why It Matters
We're building financial infrastructure. "The Stripe of AI FinOps" can't have budget enforcement bugs that allow overspend. Formal verification gives us a **provably correct** protocol — a real differentiator when selling to enterprises. "Our budget enforcement is formally verified with TLA+" is a marketing claim nobody else can make.

### Implementation Path
1. Write TLA+ spec of current reserve-reconcile protocol (~1-2 days)
2. Model check with TLC for small state spaces
3. If escrow hypothesis is adopted, verify the distributed rights protocol
4. Use Smart Casual approach: validate production traces against the spec

### Estimated Impact
- **Bug prevention:** Catches edge cases in concurrent budget checks that tests miss
- **Enterprise credibility:** Formal verification is a meaningful differentiator for financial software
- **Complexity:** Medium. TLA+ has a learning curve but the protocol is small.

---

## Prioritized Research Roadmap

### Tier 1 — Build Now (low effort, high impact, proven techniques)

| # | Hypothesis | Effort | Impact | Risk |
|---|-----------|--------|--------|------|
| 7 | Budget-aware response headers | 1-2 days | 20-40% cost reduction for users | Very low |
| 6 | EWMA/CUSUM anomaly detection in DO | 2-3 days | Faster loop detection, Guardian Agent feature | Very low |
| 2a | Heuristic cost prediction (model-specific multipliers) | 1-2 days | 50-70% fewer false budget blocks | Very low |

### Tier 2 — Build Next (medium effort, high impact, well-understood)

| # | Hypothesis | Effort | Impact | Risk |
|---|-----------|--------|--------|------|
| 3 | PID spend pacing | 1-2 weeks | Eliminates budget cliff, new policy mode | Low |
| 4 | STIP stand-in (rule-based) | 1 week | 99.9% → 99.99% availability | Low |
| 9 | TLA+ formal verification | 1-2 weeks | Enterprise credibility, bug prevention | Low |
| 2b | Statistical cost prediction (per-key EWMA) | 1 week | 80-90% fewer false budget blocks | Low |

### Tier 3 — Research & Prototype (higher effort, potentially transformative)

| # | Hypothesis | Effort | Impact | Risk |
|---|-----------|--------|--------|------|
| 1 | Escrow-based budget rights | 2-3 weeks | Eliminates DO round-trip for 80-95% of requests | Medium |
| 8 | Count-Min Sketch edge tracking | 1 week | Additional DO round-trip elimination | Medium |
| 6b | BOCPD change-point detection | 1 week | Better anomaly detection than CUSUM | Medium |
| 5 | Adaptive RL rate limiting | 2-3 months | 20-30% throughput improvement | High |

---

## Key Papers (Full Citations)

### Reinforcement Learning & Budget Optimization
- Lyu et al., "Multi-Objective Adaptive Rate Limiting using Deep RL," ACM AIIIP 2025, [arXiv 2511.03279](https://arxiv.org/abs/2511.03279)
- Liu et al. (Google), "Budget-Aware Tool-Use Enables Effective Agent Scaling (BATS)," [arXiv 2511.17006](https://arxiv.org/abs/2511.17006)
- Qian et al. (AAAI 2026), "BAMAS: Budget-Aware Multi-Agent Systems," [arXiv 2511.21572](https://arxiv.org/abs/2511.21572)
- Liu et al., "INTENT: Budget-Constrained Agentic LLMs," [arXiv 2602.11541](https://arxiv.org/abs/2602.11541)
- Li et al. (UBC/Vector), "BAVT: Spend Less, Reason Better," [arXiv 2603.12634](https://arxiv.org/abs/2603.12634)
- Jin et al., "CoRL: Controlling Performance and Budget of Multi-agent LLM System," [arXiv 2511.02755](https://arxiv.org/abs/2511.02755)
- Qian et al. (Salesforce), "xRouter: Cost-Aware LLM Orchestration via RL," [arXiv 2510.08439](https://arxiv.org/abs/2510.08439)
- PILOT, "Adaptive LLM Routing under Budget Constraints," EMNLP 2025, [arXiv 2508.21141](https://arxiv.org/abs/2508.21141)
- TREACLE, "Budget-Constrained LLM Cascades," NeurIPS 2024
- TREBI, "Safe Offline RL with Real-Time Budget Constraints," ICML 2023, [arXiv 2306.00603](https://arxiv.org/abs/2306.00603)

### Control Theory & Ad Tech Budget Pacing
- Balseiro, Lu, Mirrokni, "PID Controllers via Convolutional Mirror Descent," 2022, [arXiv 2202.06152](https://arxiv.org/abs/2202.06152)
- Apparaju, Niu, Qi (Snap), "Bucketized Hysteresis Controller," 2025, [arXiv 2509.25429](https://arxiv.org/abs/2509.25429)
- Balseiro et al. (Google), "Field Guide for Budget Pacing," ICML 2024, [arXiv 2302.08530](https://arxiv.org/abs/2302.08530)
- Google Patent US10878448B1 — PID for campaign spend pacing

### Predictive Cost Estimation
- Huang et al., "EGTP: Predicting LLM Output Length," ICLR 2026, [arXiv 2602.11812](https://arxiv.org/abs/2602.11812)
- TALE, "Token-Budget-Aware LLM Reasoning," ACL Findings 2025, [arXiv 2412.18547](https://arxiv.org/abs/2412.18547)
- Chen, Zaharia, Zou (Stanford), "FrugalGPT," 2023, [arXiv 2305.05176](https://arxiv.org/abs/2305.05176)
- C3PO, "LLM Cascades with Probabilistic Cost Constraints," NeurIPS 2025, [arXiv 2511.07396](https://arxiv.org/abs/2511.07396)

### Anomaly & Change-Point Detection
- Adams & MacKay, "Bayesian Online Changepoint Detection," 2007, [arXiv 0710.3742](https://arxiv.org/abs/0710.3742)
- Wang, "Online Changepoint Detection on a Budget," 2022, [arXiv 2201.03710](https://arxiv.org/abs/2201.03710)

### Distributed Systems & Consistency
- Balegas et al., "Bounded Counter CRDT," SRDS 2015, [arXiv 1503.09052](https://arxiv.org/abs/1503.09052)
- O'Neil, "Escrow Transactional Method," ACM TODS 1986
- Visa, "Smarter STIP," 2020
- Mako, "Speculative Distributed Transactions," OSDI 2025
- Tiga, "Geo-Distributed Transactions with Synchronized Clocks," SOSP 2025
- Li et al., "Distributed Speculative Execution," [arXiv 2412.13314](https://arxiv.org/abs/2412.13314)

### Formal Verification
- Newcombe et al., "How AWS Uses Formal Methods," CACM 2015
- Schultz et al. (MongoDB), "Modular Verification of Distributed Transactions," VLDB 2025
- Howard et al. (MSR), "Smart Casual Verification," NSDI 2025

### Mechanism Design & Fairness
- Ghodsi et al., "Dominant Resource Fairness," NSDI 2011
- "Real-Time AI Service Economy," [arXiv 2603.05614](https://arxiv.org/abs/2603.05614), March 2026

### Data Structures
- Cormode & Muthukrishnan, "Count-Min Sketch," 2005
- Flajolet et al., "HyperLogLog," 2007
