---
name: deploy
description: Run pre-deploy checks and deploy the proxy worker to Cloudflare. Use when asked to deploy, ship, or push to production.
allowed-tools: Bash
user-invocable: true
---

Run pre-deploy verification, then deploy if all checks pass.

## Pre-deploy checks (run in parallel where possible)

1. `pnpm typecheck` — must pass with zero errors
2. `pnpm lint` — must pass
3. `pnpm test` — root dashboard tests must pass
4. `pnpm proxy:test` — proxy worker tests must pass

## If all checks pass

Ask the user for confirmation before deploying:

> All pre-deploy checks passed (typecheck, lint, {N} root tests, {M} proxy tests). Ready to deploy?

If confirmed, run:

```bash
cd apps/proxy && pnpm deploy
```

## If any check fails

Do NOT deploy. Report which checks failed with the error output and suggest fixes.
