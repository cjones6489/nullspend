# E2E Test Framework

End-to-end tests that run against a live stack — dashboard, proxy, and external
integrations. This directory is the canonical home for tests that can't be
mocked because the bug class they catch only manifests in production.

See `TESTING.md` at the repo root for the full four-tier unit-test map. This
README covers **only** the E2E framework (Tier 3 and above).

## Tier model

| Layer | What it tests | Where it lives | Runs in | Blocks on fail |
|---|---|---|---|---|
| **L2 PR E2E** | Infra smoke + docs link check | `tests/e2e/{infra,docs}/` | CI on every PR | ✅ blocks merge |
| **L3 Post-deploy E2E** | Dashboard API + browser critical paths | `tests/e2e/{infra,dashboard,browser}/` | Every Preview + Production deploy | ✅ marks deploy failed |
| **L4 Nightly regression** | Full proxy model matrix + Python SDK | `tests/e2e/{proxy-nightly,python-sdk}/` | Scheduled 02:00 UTC | ❌ alerts only |
| **L5 On-demand chaos** | Intentional P0 regression + framework self-audit | `tests/e2e/chaos/` | Manual only | ❌ |

**Invariant:** a test lives in exactly one layer. No duplication across tiers.

## Directory layout

```
tests/e2e/
├── README.md                 # this file
├── lib/                      # shared utilities — import from here
│   ├── env.ts                # loads .env.e2e + validates required vars
│   ├── budget-guard.ts       # pre-flight spend ceiling (kill switch)
│   ├── test-org.ts           # seed-on-demand test org + symmetric cleanup
│   └── global-setup.ts       # vitest globalSetup hook
├── infra/                    # L2+L3 — post-deploy infra smoke
├── env/                      # L2+L3 — build-time + deploy-time env validation
├── docs/                     # L2 — link checker wrapper
├── dashboard/                # L3 — dashboard API E2E (ported from scripts/e2e-*.ts)
├── browser/                  # L3 — Playwright critical paths
├── proxy-nightly/            # L4 — full model matrix
├── python-sdk/               # L4 — Python SDK E2E (pytest)
└── chaos/                    # L5 — manual chaos validation
```

## How to add a test

### Vitest E2E test (dashboard, infra, proxy)

1. Create `tests/e2e/<tier>/<name>.e2e.test.ts`
2. Import shared utilities from `tests/e2e/lib/`:
   ```ts
   import { createTestOrg } from "../lib/test-org";
   import { requireEnv } from "../lib/env";
   ```
3. Use `beforeAll` + `afterAll` with **symmetric cleanup**. If the test creates
   a resource, the same `afterAll` must delete it — even if the test crashes.
4. Run locally: `pnpm e2e:run tests/e2e/<tier>/<name>.e2e.test.ts`

### Playwright browser test

1. Create `tests/e2e/browser/<name>.spec.ts`
2. Use the fixtures in `tests/e2e/browser/fixtures/`
3. Run locally: `pnpm e2e:browser`

### Python SDK E2E test

1. Create `tests/e2e/python-sdk/test_<name>.py`
2. Use pytest fixtures from `conftest.py`
3. Run locally: `pnpm e2e:python`

## Environment variables

Copy `.env.e2e.example` to `.env.e2e` and fill in the required values.
`.env.e2e` is gitignored. The test runner loads it automatically via
`vitest.e2e.config.ts`.

For CI: secrets are read from GitHub Actions secrets. See
`.github/workflows/e2e-post-deploy.yml` and `.github/workflows/nightly-e2e.yml`.

## Test isolation

Every test file creates its own isolated test org via `createTestOrg()` in
`tests/e2e/lib/test-org.ts`. Orgs are:

- Prefixed `e2e-` with a timestamp + UUID suffix
- Deleted in `afterAll` (symmetric cleanup)
- Swept by a nightly cron (`scripts/cleanup-orphan-test-orgs.ts`) that deletes
  any `e2e-*` org older than 24h
- **Never** touch the founder's Personal or Test org — those IDs are in a
  hard-coded allowlist in the cleanup script

## Cost tracking

Every proxy call from an E2E test tags the request with:
- `x-nullspend-tags: e2e_tier=<L2|L3|L4>,e2e_suite=<name>`

Dashboard analytics filter these tags out of customer-facing reports. Per-suite
cost trends are visible in the internal observability dashboard.

**Kill switch:** `tests/e2e/lib/budget-guard.ts` checks the `e2e-smoke-parent`
org's remaining daily budget before any proxy test runs. If remaining <
the slice's declared ceiling, the test suite aborts with a clear error.

## When a test fails

1. Check the GitHub Actions run — JUnit output lists the exact assertion
2. Download the `test-results` artifact for vitest output + Playwright trace
3. For Playwright failures, the trace is viewable via `pnpm playwright show-trace`
4. Nightly failures post to `#qa-alerts` in Slack

## Triage runbook — post-deploy E2E failures

When `E2E Post-Deploy` goes red, here's the decision tree.

### Step 1 — identify which test file failed

From the GitHub Actions run page, look at the "Run e2e infra tests (Slice 1)"
step output. Vitest prints the failing file name in red. Failures fall
into one of 5 buckets, each with a distinct root-cause class:

| File | What a failure means | First thing to check |
|---|---|---|
| `csp-nonce.e2e.test.ts` | CDN started caching HTML (launch P0-1/A2 class) | `proxy.ts` Cache-Control header, `app/layout.tsx` headers() call |
| `health-endpoint.e2e.test.ts` | A component probe reports `error` | Follow the component name → see "Component probe failures" below |
| `dns-ssl.e2e.test.ts` | DNS or TLS change | Cloudflare zone + Vercel domain config. See memory/project_production_urls.md. |
| `proxy-reachable.e2e.test.ts` | Proxy worker broken or cost event chain broken | `apps/proxy/` recent commits + Cloudflare Queue metrics |
| `dashboard-routes-sweep.e2e.test.ts` | Route handler 500/502/504 | Vercel runtime logs for the specific route. Sweep accepts 503 (circuit open). |

### Step 2 — component probe failures (health-endpoint.e2e.test.ts)

Each component probe maps to a specific launch-night P0. If the named
component is `error`:

| Component | Root cause class | Fix |
|---|---|---|
| `database` | Postgres unreachable | DATABASE_URL Vercel env var — check it points at the pooler URL, not IPv6 direct |
| `schema` | REQUIRED_SCHEMA drifted vs drizzle | Drizzle schema changed; update `app/api/health/required-schema.ts` or revert the schema change |
| `parameterized_query` | Supabase pooler compat broken (P1-19 class) | Check `lib/db/client.ts` has `prepare: false, fetch_types: false` |
| `supabase_auth` | Supabase env var missing/wrong | Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `cookie_secret` | `COOKIE_SECRET` missing in production (P0-E class) | Vercel env: add `COOKIE_SECRET` to Production |
| `redis` | Upstash unreachable | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` |

### Step 3 — deploy-time vs. runtime distinction

If the workflow failed at the **Verify deployed commit SHA** step, the
test code didn't even run:

- **"SHA mismatch after 5 attempts"** → Vercel auto-rolled back the
  deployment. Check Vercel dashboard → Deployments for the failed
  build logs. Do NOT merge new work until the rollback is understood.
- **"SHA returned null"** → Target is not a Vercel deployment.
  Expected for manual `workflow_dispatch` runs against arbitrary URLs.
  No action needed.

If the workflow failed at **Verify required secrets**, a GitHub Actions
secret is missing:

- Run `gh api repos/<owner>/<repo>/actions/secrets --jq '.secrets[] | .name' | sort`
- Compare against the required list in the workflow's pre-flight step
- Missing secret? Ask the user to set it (do NOT set CI secrets
  autonomously unless explicitly authorized).

### Step 4 — rollback decision tree

**When to auto-rollback:** never — Vercel's auto-rollback runs on its
own criteria. The E2E workflow reports status AFTER the deploy lands,
so a red workflow does NOT cause a rollback.

**When to manually rollback:** if the failing component probe maps to
a broken production feature users will hit (auth, billing, signup), AND
the fix is non-trivial, roll back via the Vercel dashboard → Deployments
→ select prior good deploy → "Promote to Production."

**When to leave the deploy up and fix forward:** if the failure is
informational (degraded component that doesn't affect users — e.g.,
redis circuit breaker flapping on a tracking-only path) or flaky
(transient network error during the test run, reproduces as green
on a manual re-run).

### Step 5 — reproduce locally

```bash
# Fetch the commit that's currently in production
git checkout <production_sha>

# Run the failing test against production to reproduce
NULLSPEND_BASE_URL=https://www.nullspend.dev \
  pnpm e2e:run tests/e2e/infra/<failing-file>.e2e.test.ts

# Or run against a local dev server to isolate network from app logic
pnpm dev &
pnpm e2e:run tests/e2e/infra/<failing-file>.e2e.test.ts
```

Do NOT run the `dashboard-routes-sweep.e2e.test.ts` against production
in a tight loop — it generates ~37 unauthenticated requests per run
which, pre-Slice 1g, could trip the Supabase auth circuit breaker.
The Slice 1g fix made this safe, but one-shot > loop for safety.

### Step 6 — dispatch a manual re-run after a fix

```bash
gh workflow run e2e-post-deploy.yml \
  -f preview_url=https://www.nullspend.dev \
  -r main
sleep 90
gh run list --workflow e2e-post-deploy.yml --limit 1
```

If the manual dispatch passes but the Vercel-deploy-triggered run is
still red, there's a race between the deploy and the workflow trigger.
The Slice 1k commit-SHA verification catches this — if you see a SHA
mismatch, the deploy hasn't actually landed at the stable URL yet.

## Cost observability

Every proxy call from an E2E test carries these tags in the
`X-NullSpend-Tags` header, which become a `tags` JSONB column on the
resulting `cost_events` row:

- `e2e_tier` — one of `L2` (PR), `L3` (post-deploy), `L4` (nightly)
- `e2e_suite` — test file name stem (e.g. `proxy-reachable`)
- `e2e_run_id` — optional per-run unique ID for end-to-end verification

### Filtering E2E events out of customer reports

Any SQL query that reports customer-facing metrics should exclude rows
where `tags ? 'e2e_tier'` (tag key present), for example:

```sql
-- Customer cost dashboard (excludes E2E noise)
SELECT provider, model, SUM(cost_microdollars) / 1e6 AS dollars
FROM cost_events
WHERE created_at > now() - interval '7 days'
  AND NOT (tags ? 'e2e_tier')
GROUP BY provider, model
ORDER BY dollars DESC;
```

### Per-tier E2E spend trend

```sql
-- How much does the E2E framework cost us per day, per tier?
SELECT
  date_trunc('day', created_at) AS day,
  tags ->> 'e2e_tier' AS tier,
  COUNT(*) AS calls,
  SUM(cost_microdollars) / 1e6 AS dollars
FROM cost_events
WHERE tags ? 'e2e_tier'
  AND created_at > now() - interval '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

### Per-suite breakdown (which test is burning budget)

```sql
SELECT
  tags ->> 'e2e_suite' AS suite,
  COUNT(*) AS calls,
  SUM(cost_microdollars) / 1e6 AS dollars
FROM cost_events
WHERE tags ? 'e2e_tier'
  AND created_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY dollars DESC;
```

### Alerting on E2E spend anomalies

If daily E2E spend exceeds the expected envelope (currently ~$0.50/day
for Slice 1, ~$5/day once Slice 6 nightly ships), investigate:
- Runaway test firing in a loop (check workflow run counts)
- Reasoning model accidentally included in the matrix
- Rate-limited retries spamming the proxy

The `e2e_run_id` tag lets you isolate a single test run's spend for
forensics.

## Not in scope

The following tests live elsewhere and are **not** part of this framework:

- Unit tests (`lib/**/*.test.ts`, `apps/proxy/src/__tests__/**`) — CI ci.yml
- Proxy smoke (`apps/proxy/smoke-*.test.ts`) — the framework promotes a
  subset into nightly CI, but the files themselves stay in place
- Proxy stress (`apps/proxy/stress-*.test.ts`) — manual only, never CI

## Build status

This framework is being built incrementally. Current slice status is tracked
in commit history under `feat(e2e): ...` messages and in `TESTING.md`.
