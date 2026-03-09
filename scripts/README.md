# Scripts Directory

Repeatable scripts and local utilities. Use explicit names and prefer scripts that are safe, documented, and easy to rerun.

## Available scripts

| Script | Command | Description |
|---|---|---|
| `e2e-smoke.ts` | `pnpm e2e` | End-to-end smoke tests against a running dev server (27 tests) |
| `expiration-edge-cases.ts` | `pnpm tsx scripts/expiration-edge-cases.ts` | Edge-case experiments for action expiration (10 tests) |
| `expiration-edge-cases-2.ts` | `pnpm tsx scripts/expiration-edge-cases-2.ts` | Second wave of expiration edge-case experiments (10 tests) |

All scripts require the dev server to be running (`pnpm dev`) and a configured `.env.local`.
