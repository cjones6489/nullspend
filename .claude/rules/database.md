---
paths:
  - "drizzle/**"
  - "packages/db/**"
  - "supabase/**"
---

# Database and Supabase

- Project ref: set in `.env.local` (not committed)
- Use `apply_migration` (not `execute_sql`) for DDL via MCP
- RLS policies scope to `auth.uid()::text` for `authenticated` role
