# Components Directory

This folder contains reusable UI components and page-level presentation pieces.

Subfolders:

- `ui/` — shadcn/ui primitives (button, card, badge, table, tabs, dialog, etc.)
- `dashboard/` — dashboard shell components (sidebar, user menu)
- `actions/` — action-specific components (status badge, payload viewer, decision controls, action timeline)
- `providers/` — React context providers (TanStack Query provider)

Keep components focused on presentation. Avoid hiding business logic here — use `lib/` instead.
