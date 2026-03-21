---
paths:
  - "proxy.ts"
  - "lib/auth/**"
  - "lib/validations/**"
  - "lib/slack/**"
  - "app/api/**"
  - "apps/proxy/src/**"
---

# Security Rules

- All secret comparisons MUST use timing-safe functions (`timingSafeEqual`)
- Webhook URLs MUST be validated with `new URL()` + hostname check, never `startsWith()`
- Zod validation errors MUST be sanitized before returning to clients (strip `code`, `expected`, `received`)
- Body size limits (1MB) MUST be enforced on all state-changing endpoints
- CSRF Origin validation is in `proxy.ts` — do not bypass or weaken it
- API key auth returns 401 (not 403) for invalid/missing keys
- Never log full database connection strings or credentials in error handlers
- Never commit `.env.local` or files containing secrets
