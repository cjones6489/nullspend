# API Versioning: Pitfalls, Anti-Patterns, and Lessons Learned

Research conducted 2026-03-19. Companion to `api-versioning-platforms.md`.

---

## Table of Contents

1. [The Case Against Premature Versioning](#1-the-case-against-premature-versioning)
2. [Anti-Patterns](#2-anti-patterns)
3. [Real-World Failure Stories](#3-real-world-failure-stories)
4. [Hyrum's Law — The Invisible Dependency Problem](#4-hyrums-law)
5. [Webhook Versioning Complexity](#5-webhook-versioning-complexity)
6. [The Header vs. URL Path Debate](#6-header-vs-url-path-debate)
7. [Overengineering Pitfalls](#7-overengineering-pitfalls)
8. [When NOT to Version](#8-when-not-to-version)
9. [Alternative Approaches](#9-alternative-approaches)
10. [Relevance to NullSpend](#10-relevance-to-nullspend)

---

## 1. The Case Against Premature Versioning

### Google's recommendation: start without it

Google recommends **ignoring versioning initially** and only adding it if and when you need it. Their reasoning: "if you don't really need versioning — which has been the case for most of our own APIs — then you didn't add unnecessary complexity to the initial API."

Source: https://cloud.google.com/blog/products/api-management/common-misconceptions-about-api-versioning

### Roy Fielding (inventor of REST): versioning is a failure

Roy Fielding characterized API versioning as *"a 'middle finger' to your API customers"*, arguing that if an API needs versioning, the design was wrong. True REST APIs should be evolvable without versions.

Source: https://blog.container-solutions.com/api-versioning-what-is-it-why-so-hard

### The 90% rule for startups

> "In 90% of startup APIs, proper backward compatibility means you rarely need /v2."

Most version bumps result from poor upfront design, not genuine irreconcilable changes. More planning, research, and prototyping can eliminate the need for the first several versions.

Source: https://stellarcode.io/blog/api-development-best-practices-in-2026/

### GitHub: 4 versions in 13 years

GitHub released only 4 API versions across 13 years. The v3-to-v4 transition wasn't even a version bump — it was an architectural shift from REST to GraphQL. This suggests real necessity for versioning is extremely rare for well-designed APIs.

Source: https://www.hmeid.com/blog/just-say-no-to-versioning

---

## 2. Anti-Patterns

### 2a. Semantic versioning in URLs (MAJOR.MINOR.PATCH)

**Problem:** Including MINOR and PATCH versions in API URLs (`/v1.2.3/`) creates a proliferation of endpoints that don't fundamentally differ. Bug fixes and backward-compatible features don't break integrations, so forcing URL changes for these is irrational.

**Cost:** Multiple deployment configurations, complex routing rules, expanded testing matrices, diluted monitoring. Unlike software libraries, old API versions consume active server resources.

**Recommendation:** Major-version-only in URLs (`/v1/`, `/v2/`). Deploy bug fixes and backward-compatible features directly to existing major versions.

Source: https://dev.to/ralphsebastian/rethinking-api-versioning-why-full-semantic-versioning-might-be-an-anti-pattern-for-your-api-3h8b

### 2b. Method-based versioning (disposable endpoints)

**Problem:** Teams create new endpoints (`/create2`, `/create3`) instead of evolving existing ones. Developers treat endpoints as disposable, writing subset functionality in new methods. Clients become trapped — newer methods are missing features from older ones.

**Example:** A company (described by APIs You Won't Hate) had `update` and `update2` endpoints where `update2` contained only a subset of the original's functionality. Clients couldn't upgrade despite wanting to.

Source: https://apisyouwonthate.com/blog/api-versioning-has-no-right-way/

### 2c. The "temporary" old version that lives forever

**Problem:** Teams keep old versions alive "just for a few months" but years later they're still running with significant traffic. Sunsetting old versions is a project, not a toggle.

**Real pattern:** One team kept `/v1` alive "just for a few months." Two years later, it was still there with active consumers who had no incentive to migrate.

Source: https://dev.to/saber-amani/api-versioning-strategies-real-lessons-from-production-incidents-and-fixes-2120

### 2d. Mixed versioning strategies

Using URL path versioning for some endpoints and header versioning for others within the same API. Strongly discouraged — creates confusion and inconsistent client behavior.

Source: https://nordicapis.com/a-pragmatic-take-on-rest-anti-patterns/

### 2e. Global versioning hiding stealth breaking changes

When versioning the entire API (`/v1/` to `/v2/`), smaller breaking changes sneak in with the mindset "it's a major release, that's time to change stuff." Changes may not be documented, and clients are forced to test everything at once rather than migrating incrementally.

**Specific example:** JavaScript clients expecting `{ "error": "some message" }` (v2) received `{ "error": { "message": "something", "code": "err-123" } }` (v3), producing `"Error: [object Object]"` in user-facing error messages.

Source: https://apisyouwonthate.com/blog/api-versioning-has-no-right-way/

### 2f. Versioning instead of fixing the root problem

> "Some APIs are on v14 because the API developers didn't reach out to any stakeholders to ask what they needed."

Excessive versioning often masks organizational dysfunction — poor communication between producers and consumers, insufficient upfront design, or rushing to ship without user research.

Source: https://redocly.com/blog/api-versioning-best-practices

---

## 3. Real-World Failure Stories

### 3a. Stripe: The `verified` -> `status` field change (2014)

Stripe replaced a boolean `verified` field on accounts with a string `status` field. This was a classic backward-incompatible change that broke code checking `if (account.verified)`. This incident was formative in building their version gates architecture.

**Lesson:** Even simple type changes (boolean to string) break real integrations. Design fields with future extensibility — use enums/strings from the start, not booleans that may need more states.

Source: https://stripe.com/blog/api-versioning

### 3b. Stripe: The Charges abstraction debt (10 years of regret)

Stripe built their initial API abstractions around credit card payments (the simplest case), then awkwardly layered complex payment methods on top. The Charge resource grew from 11 properties (2011) to 36 (2018), with creation parameters expanding from 5 to 14.

The Sources/Charges system required users to manage two parallel state machines spanning client and server. For payment methods like iDEAL, connectivity loss meant lost revenue — "the server never created a Charge, we'd refund the money."

**Lesson:** "Abstractions designed for cards were not going to be great at representing more complex payment flows." They eventually introduced PaymentIntents/PaymentMethods (2018) rather than continuing to version the original abstraction.

Source: https://stripe.dev/blog/payment-api-design

### 3c. The `userId` to `user_id` incident

A company pushed a "minor update" changing one field name from `userId` to `user_id`. This single rename broke 147 client applications.

**Lesson:** Field naming convention changes are breaking changes. Never rename fields — deprecate the old name and add the new one alongside it.

Source: https://dev.to/saber-amani/api-versioning-strategies-real-lessons-from-production-incidents-and-fixes-2120

### 3d. Slack: Three simultaneous deprecations (February 2021)

Slack retired all methods in the `channels.*`, `im.*`, `mpim.*`, and `groups.*` namespaces simultaneously, plus truncated event payload fields and changed authentication patterns. The rollout was **gradual and workspace-dependent** — apps worked fine in one workspace but broke in another.

> "Your apps or integrations may work fine in one workspace but break in another."

**Lesson:** Staggered rollouts of breaking changes create extended debugging periods. Developers can't tell if their code is broken or if the change hasn't reached their workspace yet.

Source: https://api.slack.com/changelog/2021-02-24-how-we-broke-your-slack-app

### 3e. Twitter/X: The v1-to-v2 migration disaster

Twitter API v2 changed fundamental response structures — `statuses` array became `data` array, fields went from included-by-default to opt-in via `fields` and `expansions` parameters, and terminology changed ("favorites"/"favourites" unified to "like"). Media upload was only available in v1.1 but newer features required v2, forcing developers to maintain OAuth 1.0a AND OAuth 2.0 simultaneously.

Then they added pricing: Apollo's developer reported projected costs of ~$20M/year for API access. The API is now "effectively unmaintained" according to community consensus.

**Lesson:** Changing default response shapes is maximally disruptive. If v1 returns all fields by default and v2 requires explicit opt-in, every client breaks. Combine this with pricing changes and you destroy developer trust permanently.

Sources: https://developer.twitter.com/en/docs/twitter-api/migrate/data-formats/standard-v1-1-to-v2, https://superface.ai/blog/twitter-api-new-plans

### 3f. Facebook Graph API: Version fatigue

Facebook releases new API versions regularly, deprecating after ~24 months. Nearly 25% of integration problems stem from using a deprecated version. Version updates reorganize data structures, causing a 30% increase in runtime errors when not accounted for. Average developer encounters token-related issues in 30% of migration cases.

**Lesson:** Frequent version cycles with 2-year deprecation windows create constant migration burden. Developers spend significant time just keeping up rather than building features.

Source: https://moldstud.com/articles/p-quick-fixes-for-common-facebook-api-versioning-errors-a-comprehensive-guide

### 3g. Kubernetes: Deprecated API removal breaks clusters

When Kubernetes removes deprecated APIs, any manifests, workloads, or automation relying on them fail. Identifying all instances is difficult — especially idle workloads or external tools. The Kubernetes documentation explicitly says the platform "cannot identify all instances."

**Lesson:** Even with long deprecation periods (alpha/beta/GA stability levels), consumers don't migrate until forced, and the forcing function breaks things.

Source: https://kubernetes.io/docs/reference/using-api/deprecation-guide/

### 3h. CDN caching + query parameter versioning

A team used query parameter versioning (`?version=2`). A misconfigured CDN cached responses without considering the version parameter. v2 clients started receiving v1 data.

**Lesson:** Query parameter versioning interacts badly with caching layers. CDNs, proxies, and intermediaries may normalize, strip, or ignore query parameters.

Source: https://dev.to/saber-amani/api-versioning-strategies-real-lessons-from-production-incidents-and-fixes-2120

---

## 4. Hyrum's Law — The Invisible Dependency Problem {#4-hyrums-law}

> "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody." — Hyrum Wright, Google

### What people depend on (beyond the contract)

1. **List ordering** — whether responses maintain a specific sort order
2. **Error message text** — parsing error strings for programmatic logic
3. **Response timing** — systems built around expected latency
4. **Payload size** — assumptions about response sizes
5. **Field ordering in JSON** — some parsers are order-dependent
6. **Status code specifics** — distinguishing between 400 subtypes

### The enumeration trap

If your `status` field documents 5 possible values, you cannot later reduce it to 4. You also cannot add a 6th without potentially breaking `switch` statements that don't handle `default`.

### Practical implications

- **Any change can be a breaking change** regardless of versioning strategy
- **Bug compatibility pressure**: if an endpoint previously took 15 seconds, some system may depend on that delay
- **Documentation cannot prevent it**: users exploit undocumented behaviors (parsing logs, abusing error messages) as shortcuts

### Mitigation strategies

1. **Chaos mocks** — intentionally vary non-contractual traits (ordering, timing) so developers build resilient integrations
2. **Explicit documentation** of ALL observable behaviors, not just the "API contract"
3. **Conservative output** — be strict in what you send, liberal in what you accept (Robustness Principle)

Sources: https://www.hyrumslaw.com/, https://nordicapis.com/what-does-hyrums-law-mean-for-api-design/

---

## 5. Webhook Versioning Complexity

### The fundamental problem

Webhooks are push-based. Consumers don't make explicit calls with version headers — they receive events sent to them. They must choose a version ahead of time, not per-request.

### Global endpoint versioning (Stripe/Shopify approach)

Set the version of the entire endpoint. All events to that endpoint use the same version.

**Problem — all-or-nothing upgrades:** If you're listening to 50 event types, you must update all 50 code paths in tandem. You can't upgrade `invoice.paid` to v2 while keeping `customer.created` at v1. This makes upgrades risky and monolithic.

### Per-event-type versioning (Svix/Snyk approach)

Each event type has an associated version, e.g., `v2.invoice.paid`. Consumers choose different versions for different event types and upgrade gradually.

**Advantages:** Update one event type at a time, thoroughly test each upgrade, downgrade specific event types if an upgrade has issues.

### Svix's key insight

> "A much easier way of not breaking your webhooks API is: not to break your webhooks API."

Adding a field is non-breaking. You can rename a field by duplicating data (keeping old name, adding new name). Mark deprecated fields in docs and people will ignore them. This avoids versioning entirely in most cases.

Sources: https://www.svix.com/blog/webhook-versioning/, https://docs.stripe.com/webhooks/versioning

---

## 6. The Header vs. URL Path Debate

### URL path (`/v1/resource`)

| Pros | Cons |
|------|------|
| Immediately visible which version is in use | Technically violates REST (URI = unique resource) |
| Easy to test in browser | Cluttered URLs |
| Easy to route/deploy separately | Guaranteed to break clients on version bump |
| Can share versioned links via email | Can't represent a single resource across versions |

### Header-based (`Stripe-Version: 2024-01-01`)

| Pros | Cons |
|------|------|
| Clean URLs, pure REST | Less discoverable, confuses new API users |
| Better separation of concerns | Harder to debug (version not in URL) |
| Easier caching/proxy handling | Harder to test in browser |
| Single resource identity | Proxies/middleware may strip unknown headers |

### Custom media type (`Accept: application/vnd.api.v2+json`)

| Pros | Cons |
|------|------|
| Most "correct" per HTTP spec | Doesn't work with low-code tools |
| Keeps URLs stable | Version changes invisible in URLs |
| Avoids version-specific controller conventions | Confusion about default version when header omitted |

### The real answer

Troy Hunt (Have I Been Pwned) implemented all three approaches simultaneously, concluding: **"Nobody will use your API until you've built it. Stop procrastinating."**

For most teams: URL path is simplest, header-based is cleanest, and the choice matters far less than shipping a stable API.

Source: https://www.troyhunt.com/your-api-versioning-is-wrong-which-is/

---

## 7. Overengineering Pitfalls

### The Stripe tax (complexity cost of date-based versioning)

Stripe maintains backward compatibility with **every API version since 2011** — over 100 backward-incompatible upgrades. Their internal architecture requires:

- A DSL for defining version change modules
- A master list mapping versions to transformation chains
- Walking backward through all applicable transformations per request
- Annotating "changes with side effects" that leak beyond module boundaries
- Scattered conditional checks throughout the codebase for non-encapsulatable changes

This is magnificent engineering, but it's built by a company with 8,000+ employees processing trillions of dollars. **Most companies cannot and should not replicate this.**

> "Every new version is more code to understand and maintain." — Stripe engineering blog

Source: https://stripe.com/blog/api-versioning

### The Salesforce burden

Salesforce releases 3 API versions per year but maintains support for 20+ previous versions simultaneously (back to Spring 2014). This side-by-side approach avoids forced migrations but requires sustained engineering effort that few organizations can sustain.

Source: https://blog.container-solutions.com/api-versioning-what-is-it-why-so-hard

### The testing matrix explosion

Every supported version multiplies:
- Test cases (N versions x M endpoints x P scenarios)
- Deployment configurations
- Monitoring/alerting rules
- Documentation pages
- SDK versions to maintain

**Hidden cost:** Bug triage requires confirming the bug doesn't exist in other versions. A bug found in v2 might exist in v1 and v3 with different manifestations.

Source: https://dev.to/ralphsebastian/rethinking-api-versioning-why-full-semantic-versioning-might-be-an-anti-pattern-for-your-api-3h8b

---

## 8. When NOT to Version

### The coordination approach (internal/small teams)

> "If backend and frontend teams are aligned early and often, there's usually no need to version individual endpoints."

When producer and consumer teams communicate directly, many problems that lead to versioning can be avoided. Changes can be coordinated and rolled out together.

**Works when:** Small team, internal consumers, tight deployment coordination, few clients.

Source: https://keleos.be/api-versioning-necessary-evil-or-avoidable-complexity/

### The additive-only approach

Three rules that eliminate most need for versioning:

1. **Never remove** existing endpoints, parameters, or data fields
2. **Never change** field meanings (e.g., `count` parameter semantics)
3. **All new features must be optional** (new fields have defaults, new parameters are optional)

TCP/IP, HTTP, and HTML demonstrate this works at massive scale through the Robustness Principle.

Source: https://blog.container-solutions.com/api-versioning-what-is-it-why-so-hard

### Google's own practice

Google says most of their own APIs have never needed versioning. Their AIP-185 requires major version numbers in URLs but recommends in-place evolution with minor/patch-equivalent changes delivered to existing versions without migration.

Source: https://google.aip.dev/185

### The pre-launch window

Before you have external consumers, versioning is purely overhead. You can change anything freely. The moment you have your first external integration is when the versioning question becomes real.

---

## 9. Alternative Approaches

### 9a. GraphQL: field deprecation instead of versions

GraphQL avoids versioning entirely through schema evolution:
- Add new types/fields freely (non-breaking)
- Mark old fields with `@deprecated(reason: "Use newField instead")`
- Consumers migrate at their own pace
- Single evolving endpoint, no version URLs

**Trade-off:** Requires consumers to handle deprecated fields gracefully and API providers to maintain deprecated fields indefinitely (or until usage drops to zero).

Source: https://blog.logrocket.com/versioning-fields-graphql/

### 9b. gRPC/Protobuf: field numbering for wire compatibility

Protobuf's binary encoding makes evolution natural:
- Adding new fields is always safe (unknown fields are ignored)
- Never reuse deleted field numbers (use `reserved`)
- Never change field types or numbers
- Both backward and forward compatibility built into the wire format

**Breaking changes:** Removing fields, changing field types, changing field numbers, renaming fields.

Source: https://learn.microsoft.com/en-us/aspnet/core/grpc/versioning

### 9c. The "compatible versioning" approach (no parallel versions)

Instead of running multiple versions simultaneously, design for a single evolving version that never breaks clients:
- Add fields, don't remove them
- Deprecate gracefully with overlap periods
- Use capability negotiation instead of version numbers

This is the cheapest approach for both API producers and consumers, but requires more discipline in initial API design.

Source: https://www.infoq.com/news/2013/12/api-versioning/

### 9d. WeWork's middleware approach

WeWork used Faraday middleware and the `Sunset` HTTP header to signal deprecation timing to clients programmatically. Their `we-call` gem enforced conventions, making deprecation machine-readable rather than relying on developer documentation awareness.

Source: https://apisyouwonthate.com/blog/api-versioning-has-no-right-way/

---

## 10. Relevance to NullSpend

### Our situation

- **Pre-launch API** with zero external consumers
- **Small team** with direct communication channels
- **Proxy + dashboard** architecture (two surfaces to version)
- **Webhook events** for cost alerts and budget notifications
- **SDK** that pins to specific API behavior

### Key takeaways for our context

1. **Don't version yet.** We have no external consumers. Every hour spent on versioning infrastructure is an hour not spent on the product. Google's own APIs mostly don't need versioning.

2. **Design for additive evolution.** Follow the three rules: never remove fields, never change field meanings, all new features optional. This eliminates most future versioning needs.

3. **Use strings/enums instead of booleans.** Stripe's `verified` -> `status` incident teaches us: a boolean that might need more states later should be a string enum from day one.

4. **Avoid premature field commitments.** Every field in our response is a future constraint (Hyrum's Law). Start with minimal responses and let consumers request additional fields.

5. **Webhook versioning is harder than API versioning.** If we add webhooks, follow Svix's advice: make additive changes only, avoid versioning webhooks entirely if possible. If we must version, use per-event-type versioning, not global.

6. **When we do need to version (post-launch):** Use a header-based approach (`NullSpend-Version: 2026-04-01`) with account-level pinning. This is the cleanest approach and doesn't require URL changes. Start simple — we're not Stripe and don't need their architecture.

7. **Set sunset dates from day one.** When we do introduce a version, announce the deprecation timeline immediately. "v1 will be supported until [date]" prevents the "temporary version that lives forever" anti-pattern.

8. **The biggest risk is not versioning — it's bad initial design.** More time spent on API design review now saves orders of magnitude more time than any versioning system later.

---

## Source Index

| Source | URL |
|--------|-----|
| Stripe: API versioning blog | https://stripe.com/blog/api-versioning |
| Stripe: Payment API design (10 years) | https://stripe.dev/blog/payment-api-design |
| Google: API versioning misconceptions | https://cloud.google.com/blog/products/api-management/common-misconceptions-about-api-versioning |
| Google: AIP-185 | https://google.aip.dev/185 |
| APIs You Won't Hate: No right way | https://apisyouwonthate.com/blog/api-versioning-has-no-right-way/ |
| Troy Hunt: Three wrong ways | https://www.troyhunt.com/your-api-versioning-is-wrong-which-is/ |
| Hyrum's Law | https://www.hyrumslaw.com/ |
| Nordic APIs: Hyrum's Law for API design | https://nordicapis.com/what-does-hyrums-law-mean-for-api-design/ |
| Svix: Webhook versioning | https://www.svix.com/blog/webhook-versioning/ |
| Container Solutions: Why versioning is hard | https://blog.container-solutions.com/api-versioning-what-is-it-why-so-hard |
| InfoQ: Costs of versioning | https://www.infoq.com/news/2013/12/api-versioning/ |
| Just say no to versioning | https://www.hmeid.com/blog/just-say-no-to-versioning |
| Keleos: Necessary evil or avoidable complexity | https://keleos.be/api-versioning-necessary-evil-or-avoidable-complexity/ |
| SemVer anti-pattern for APIs | https://dev.to/ralphsebastian/rethinking-api-versioning-why-full-semantic-versioning-might-be-an-anti-pattern-for-your-api-3h8b |
| DEV: Real lessons from production | https://dev.to/saber-amani/api-versioning-strategies-real-lessons-from-production-incidents-and-fixes-2120 |
| Slack: How we broke your app | https://api.slack.com/changelog/2021-02-24-how-we-broke-your-slack-app |
| Shopify: API versioning | https://shopify.dev/docs/api/usage/versioning |
| Stripe: Webhook versioning | https://docs.stripe.com/webhooks/versioning |
| HN: Stripe versioning discussion | https://news.ycombinator.com/item?id=15020726 |
| HN: Date-based versioning | https://news.ycombinator.com/item?id=38950364 |
| Andrew Tarry: Good, bad, ugly | https://andrewtarry.com/posts/api-versioning/ |
| Kubernetes deprecation guide | https://kubernetes.io/docs/reference/using-api/deprecation-guide/ |
| Facebook Graph API versioning | https://developers.facebook.com/docs/graph-api/guides/versioning/ |
| gRPC versioning (Microsoft) | https://learn.microsoft.com/en-us/aspnet/core/grpc/versioning |
| GraphQL field versioning | https://blog.logrocket.com/versioning-fields-graphql/ |
