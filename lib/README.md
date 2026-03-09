# Lib Directory

This folder holds durable application logic shared across routes, components, and packages.

Subfolders:

- `actions/` — action lifecycle operations: create, get, approve, reject, list, expiration logic, state transitions
- `auth/` — Supabase session resolution, API key verification (SHA-256 hashed), dev-actor fallback
- `db/` — Drizzle database client and schema definitions (`actions`, `api_keys` tables)
- `queries/` — TanStack Query hooks and key factories for client-side data fetching
- `validations/` — Zod schemas for API request/response validation
- `utils/` — shared helpers: status constants, state machine, formatting utilities
- `api/` — internal API client for dashboard data fetching

Keep business logic here rather than in route handlers or components.
