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

## Not in scope

The following tests live elsewhere and are **not** part of this framework:

- Unit tests (`lib/**/*.test.ts`, `apps/proxy/src/__tests__/**`) — CI ci.yml
- Proxy smoke (`apps/proxy/smoke-*.test.ts`) — the framework promotes a
  subset into nightly CI, but the files themselves stay in place
- Proxy stress (`apps/proxy/stress-*.test.ts`) — manual only, never CI

## Build status

This framework is being built incrementally. Current slice status is tracked
in commit history under `feat(e2e): ...` messages and in `TESTING.md`.
