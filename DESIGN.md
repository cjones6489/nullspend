# Design System — NullSpend

## Product Context
- **What this is:** FinOps layer for AI agents. Cost tracking, budget enforcement, margin analytics.
- **Who it's for:** Backend developers and eng managers at SaaS startups running AI agents.
- **Space:** FinOps, developer tools, AI infrastructure.
- **Project type:** Data-dense dashboard + proxy control plane.

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian
- **Decoration level:** Minimal — typography and data do all the work. No gradients, no illustrations, no decorative elements.
- **Mood:** Bloomberg terminal meets Vercel dashboard. The product IS the numbers. Every pixel earns its place by showing data or enabling action. The teal-green primary is the only splash of personality.
- **Anti-patterns:** No purple gradients, no 3-column icon grids, no centered-everything layouts, no decorative blobs, no generic hero sections.

## Typography

- **Display/Hero:** Geist Sans — geometric, clean, designed for Vercel's ecosystem. Pairs perfectly with the data-dense aesthetic.
- **Body:** Geist Sans — same family for consistency. No weight-heavy heading distinctions.
- **UI/Labels:** Geist Sans — text-xs with `uppercase tracking-wider` for table headers and section labels.
- **Data/Tables:** Geist Mono — `tabular-nums` for all financial values, percentages, and metrics. Monospace alignment makes columns scannable.
- **Code:** Geist Mono
- **Loading:** `next/font/google` (Geist, Geist_Mono). Variables: `--font-sans`, `--font-mono`.

### Type Scale

| Token | Size | Usage |
|-------|------|-------|
| `text-xl` | 20px | Page titles (h1) |
| `text-lg` | 18px | Hero stat values (with `font-mono`) |
| `text-base` | 16px | Secondary headings |
| `text-sm` | 14px | Body text, card descriptions, form labels |
| `text-[13px]` | 13px | **Primary data size.** Table cells, metric labels, button text. The sweet spot between density and readability. |
| `text-xs` | 12px | Table headers (`uppercase tracking-wider`), captions, small buttons |
| `text-[11px]` | 11px | Health badges, tertiary labels, sparkline annotations |
| `text-[10px]` | 10px | Source badges, minimal inline labels |

### Weight Scale

| Weight | Usage |
|--------|-------|
| `font-bold` | Stat card hero values only |
| `font-semibold` | Page titles (h1), `tabular-nums` metric values |
| `font-medium` | Labels, button text, table headers, card titles |
| Default (400) | Body text, descriptions |

### Special Features
- `font-mono tabular-nums` on all monetary values, percentages, and counts
- `tracking-tight` on page headers
- `tracking-wider` on uppercase table headers and section labels

## Color

- **Approach:** Restrained — 1 primary accent + neutrals. Color is rare and meaningful.
- **Color model:** OKLCH (perceptually uniform, dark-theme optimized)

### Palette

| Token | OKLCH Value | Hex Approx | Usage |
|-------|------------|-----------|-------|
| `--background` | oklch(0.13 0.004 265) | #1a1a2e | Page background |
| `--card` | oklch(0.16 0.005 265) | #212136 | Card/container surfaces |
| `--muted` | oklch(0.20 0.005 265) | #2a2a3e | Disabled states, icon backgrounds |
| `--secondary` | oklch(0.22 0.006 265) | #303046 | Input backgrounds, secondary buttons |
| `--border` | oklch(0.25 0.006 265) | #363650 | Borders (typically at 50% opacity: `border-border/50`) |
| `--foreground` | oklch(0.93 0.005 265) | #eeeef2 | Primary text |
| `--muted-foreground` | oklch(0.63 0.01 265) | #9090a8 | Secondary text, labels |
| `--primary` | oklch(0.72 0.19 160) | #22c55e | Teal-green accent. Links, active states, charts. |
| `--destructive` | oklch(0.65 0.2 25) | #ef4444 | Errors, critical alerts, negative margins |

### Semantic Colors

| Purpose | Color | Usage |
|---------|-------|-------|
| Success/Healthy | `text-green-400` / `bg-green-400/10` | Healthy margins, positive values |
| Warning/At Risk | `text-amber-400` / `bg-amber-400/10` | At-risk margins, budget warnings |
| Error/Critical | `text-red-400` / `bg-red-400/10` | Critical margins, blocked requests |
| Info/Moderate | `text-blue-400` / `bg-blue-400/10` | Moderate tier, informational badges |

### Chart Colors
5-color sequential palette for data visualization:
- `--chart-1`: oklch(0.72 0.19 160) — primary teal
- `--chart-2`: oklch(0.65 0.17 145)
- `--chart-3`: oklch(0.60 0.15 175)
- `--chart-4`: oklch(0.68 0.20 130)
- `--chart-5`: oklch(0.55 0.14 190)

## Spacing

- **Base unit:** 4px
- **Density:** Compact — optimized for information density, not whitespace beauty.

### Scale

| Token | Value | Usage |
|-------|-------|-------|
| `space-y-6` | 24px | Major section stacks |
| `space-y-4` | 16px | Card content stacks |
| `space-y-3` | 12px | Form field groups |
| `gap-3` | 12px | Grid items, card flexbox |
| `gap-2` | 8px | Icon + text pairs |
| `gap-1.5` | 6px | Button icon + text |
| `gap-1` | 4px | Tight horizontal spacing |
| `p-4` | 16px | Card padding (default) |
| `p-3` | 12px | Card padding (compact) |
| `p-2` | 8px | Icon containers |

## Layout

- **Approach:** Grid-disciplined — strict columns, predictable alignment.
- **Grid:** `grid-cols-2` (mobile) / `sm:grid-cols-4` (desktop) for stat cards.
- **Max content width:** Sidebar layout, no explicit max-width on content.
- **Border radius:** Hierarchical scale:
  - Cards/dialogs: `rounded-lg` (8px)
  - Inputs/buttons: `rounded-md` (6px)
  - Badges: `rounded-full`
  - Base variable: `--radius: 0.5rem`

## Motion

- **Approach:** Minimal-functional — only transitions that aid comprehension.
- **Standard hover:** `transition-colors` (default for all interactive elements)
- **Loading:** `animate-spin` on RefreshCw/loader icons
- **Charts:** `animationDuration={600}` on Recharts components
- **No entrance animations on data.** Data should appear instantly. The user is here to read numbers, not watch things slide in.

### Easing
- Enter: `ease-out`
- Exit: `ease-in`
- Move: `ease-in-out`

### Duration
- Micro (hover): CSS default (~150ms)
- Short (state change): 200ms
- Medium (charts): 600ms

## Component Conventions

### Buttons
- Default size: `h-8` with `text-[0.8rem]`
- Primary: `bg-primary text-primary-foreground`
- Outline: `border-border bg-background hover:bg-muted` (most common in dashboard)
- Ghost: `hover:bg-muted` (icon buttons, destructive actions)
- Always include icon + label. Icon-only buttons only for repeated compact actions (sort arrows, close).

### Cards
- Container: `rounded-xl bg-card` with `border-border/50`
- Padding: `p-4` (default), `p-3` (compact/data-size=sm)
- No card shadows. Borders only.

### Tables
- Headers: `text-[11px] font-medium uppercase tracking-wider text-muted-foreground`
- Rows: `border-border/30` with `hover:bg-accent/40` for interactive rows
- Data cells: `text-[13px]` with `font-mono tabular-nums` for numbers
- Always right-align numeric columns.

### Health Badges
- Shape: `rounded-full px-2 py-0.5 text-[11px] font-medium`
- Variants: `{color}-400` text + `{color}-400/10` background
- Always include icon + label, not color alone.

### Empty States
- Centered: `flex flex-col items-center justify-center gap-4 py-16`
- Dashed border: `border-dashed border-border/50`
- Icon: `h-12 w-12` in a muted circle
- Copy: 1-line instruction, not a paragraph.

### Stat Cards
- Hero value: `font-mono text-lg font-semibold tabular-nums`
- Label: `text-xs text-muted-foreground`
- No units in the label. Put $ in the value.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-05 | Initial design system created | Formalized implicit patterns from codebase. Approved Variant A (dense, Bloomberg terminal feel). |
| 2026-04-05 | text-[13px] as primary data size | Denser than the standard 14px. More data per viewport. Acceptable readability for developer audience. |
| 2026-04-05 | OKLCH color model | Perceptually uniform, future-proof. Harder to modify by hand but correct for dark themes. |
| 2026-04-05 | No entrance animations on data | Data appears instantly. Users are here to read numbers, not watch animations. |
| 2026-04-05 | Minimal decoration | No gradients, illustrations, or decorative elements. The green-teal primary is the only personality. |
