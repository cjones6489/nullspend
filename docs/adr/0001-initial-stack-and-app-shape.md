# ADR 0001: Initial Stack and App Shape

## Status

Accepted

## Context

NullSpend is a new product and the near-term goal is to prove the smallest useful approval loop for risky AI agent actions.

The project needs:

- fast iteration
- simple local setup
- a clean path to a web dashboard and backend API
- typed validation and database access
- minimal structural overhead

The product does not yet need a monorepo, realtime infrastructure, or broad platform abstractions.

## Decision

We will start with:

- one Next.js App Router application
- TypeScript
- Tailwind CSS and shadcn/ui
- Supabase for auth and Postgres
- Drizzle ORM for schema and typed queries
- Zod for validation
- polling for approval decisions in v1

## Alternatives Considered

### Monorepo from day one

Rejected for now.

This adds structure before the product shape is proven and increases setup, tooling, and repo complexity without clear immediate value.

### Realtime-first approval flow

Rejected for v1.

Polling is simpler, easier to debug, and sufficient to prove the product loop.

### Broad SDK or framework-specific integrations first

Rejected for v1.

The earliest value is proving one compact propose-and-wait flow, not supporting many ecosystems immediately.

## Consequences

### Positive

- Faster path to a working demo
- Lower structural complexity
- Easier onboarding and maintenance
- Clear separation between product proof and later platform expansion

### Negative

- Some future refactoring may be needed if the product expands into multiple apps or packages
- Polling is less elegant than realtime

## Follow-Up

Revisit this decision if:

- multiple packages clearly emerge
- the SDK needs its own publishable package
- realtime materially improves the user experience
