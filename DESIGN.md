---
version: alpha
name: argo
description: "A data-dense personal homelab dashboard that reads as a calm, professional financial terminal — not a toy. Dark-first sleek surfaces (Blueprint charcoal ramp) with a full light theme, anchored on one confident blue (#4c90f0 dark / #2d72d2 light) used scarcely. Color is earned, never decorative: neutral grey carries single values and structure, and a hue appears only for trend, signal/status, or genuine multi-series separation. Type is system-sans carried by size+weight; numbers render mono. Restraint as identity — Linear's dark-surface craft, IBM Carbon's discipline, Coinbase's signal-only color."

# Schema note: Google design.md is FLAT (one hex per token); Argo models every color as a
# {light,dark} PAIR in packages/charts/src/palette.ts (the executable source of truth). This
# front matter is a DARK-FIRST SNAPSHOT for linting (WCAG contrast + token-ref integrity) +
# portable export. It declares the design SYSTEM (surfaces, text, semantics, status, trend) —
# NOT the per-metric data dictionary (HRV→blue, bench→blue, gym→red, …), which lives only in
# palette.ts. The identity ACCENT families are documented in prose (Colors), not as tokens here.
status: proof-of-concept # greenfield POC → promote to global config + basalt-ui
influences: [ibm-carbon, linear, coinbase] # see Overview › Influences
sourceOfTruth:
  color: packages/charts/src/palette.ts
  tokens: packages/charts/src/tokens.ts
  cssVars: packages/charts/src/theme-vars.ts
  mantine: apps/dashboard/src/theme.ts
  enforcement: scripts/check-theme.mjs # raw-color guard, wired into `bun run lint`
  designLint: 'bun run check:design' # npx @google/design.md lint (opt-in, pinned)

colors:
  # — Brand (the single earned identity hue) —
  primary: '#4c90f0' # BP.blue dark (light: #2d72d2) — links, accents
  primary-strong: '#2d72d2' # deeper blue — primary button fill (white text passes AA)
  on-primary: '#ffffff'
  on-accent: '#111418' # dark text on a light status/accent fill

  # — Text (on dark canvas) —
  ink: '#c5cbd3' # primary text
  ink-muted: '#8f99a8' # secondary
  ink-subtle: '#738091' # tertiary / legend / disabled

  # — Surfaces (dark ramp, à la Linear) —
  canvas: '#1c2127' # page background
  surface-1: '#252a31' # cards / panels
  surface-2: '#2f343c' # chart area / elevated / tooltip
  hairline: '#383e47' # 1px borders / dividers
  hairline-strong: '#404854' # stronger divider

  # — Data ink —
  data-neutral: '#c5cbd3' # the "earned-nothing" default for single-series marks (= VX.line)
  trend-up: '#43bf4d' # positive delta (direction, not metric)
  trend-down: '#ec9a3c' # negative delta

  # — Semantic status (good / warn / bad) —
  semantic-good: '#43bf4d'
  semantic-warn: '#f0b726'
  semantic-bad: '#e76a6e'

  # — Score / zone scale (excellent → poor) —
  status-excellent: '#43bf4d'
  status-good: '#b6d94c'
  status-warn: '#f0b726'
  status-bad: '#eb6847'
  status-neutral: '#8f99a8'

typography:
  # Mantine v9 inherited scale (system-sans). SNAPSHOT — a deliberate type ladder is a
  # next-session hardening target.
  display-xl:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 34px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.5px
  display-lg:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 26px
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: -0.3px
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: -0.2px
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: 0
  subhead:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0
  body-lg:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body-sm:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  caption:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.2px
  button:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0
  number:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0

spacing:
  # OWNED in theme.ts (`spacing`) — no longer inherited. Values match v9 today (a zero-pixel
  # ownership step); a strict 4px-grid tightening (xs 10→8, lg 20→24) is a ready one-line follow-up.
  # The guard rejects raw spacing props equal to a step (use the token: p="md", gap="sm").
  xs: 10px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 32px

rounded:
  # OWNED in theme.ts (`radius`); `defaultRadius: 'sm'` (4px) for controls, cards at `md` (8px) —
  # tight, à la Linear/Carbon. Tightening large radii (lg 16→12, xl 32→16) is a ready follow-up.
  # The guard rejects any numeric `radius` prop (use the token: radius="sm").
  xs: 2px
  sm: 4px
  md: 8px
  lg: 16px
  xl: 32px
  pill: 9999px

components:
  # Argo's load-bearing UI, each bound to system tokens. The component layer is mostly Mantine
  # (reskinned from BP) + @argo/charts primitives; this inventory documents the recurring few.
  page:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
  link:
    textColor: '{colors.primary}'
    typography: '{typography.body}'
  button-primary:
    backgroundColor: '{colors.primary-strong}'
    textColor: '{colors.on-primary}'
    typography: '{typography.button}'
    rounded: '{rounded.sm}'
    padding: '8px 14px'
  card:
    backgroundColor: '{colors.surface-1}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '16px'
  divider:
    backgroundColor: '{colors.hairline}' # 1px rule
  divider-strong:
    backgroundColor: '{colors.hairline-strong}' # section rule
  text-input:
    backgroundColor: '{colors.surface-1}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
    rounded: '{rounded.sm}'
    padding: '8px 12px'
  caption:
    textColor: '{colors.ink-muted}'
    typography: '{typography.caption}'
  chart-card:
    backgroundColor: '{colors.surface-2}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: '16px'
  chart-line:
    textColor: '{colors.data-neutral}' # neutral default series stroke
    typography: '{typography.number}'
  chart-legend:
    textColor: '{colors.ink-subtle}'
    typography: '{typography.caption}'
  tooltip:
    backgroundColor: '{colors.surface-2}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: '8px 12px'
  delta-up:
    textColor: '{colors.trend-up}'
    typography: '{typography.number}'
  delta-down:
    textColor: '{colors.trend-down}'
    typography: '{typography.number}'
  badge-good:
    backgroundColor: '{colors.semantic-good}'
    textColor: '{colors.on-accent}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
  badge-warn:
    backgroundColor: '{colors.semantic-warn}'
    textColor: '{colors.on-accent}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
  badge-bad:
    backgroundColor: '{colors.semantic-bad}'
    textColor: '{colors.on-accent}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
  zone-excellent:
    backgroundColor: '{colors.status-excellent}'
  zone-good:
    backgroundColor: '{colors.status-good}'
  zone-warn:
    backgroundColor: '{colors.status-warn}'
  zone-bad:
    backgroundColor: '{colors.status-bad}'
  zone-neutral:
    backgroundColor: '{colors.status-neutral}'
---

# Argo Design System

This is the **law** for Argo's visual identity. `CLAUDE.md` points here; the global `/dataviz`
skill defers here. When building or restyling any UI, this file wins over habit, over library
defaults, and over "what looks nice in isolation."

Argo is a **greenfield proof-of-concept** for a personal design system. The principles are written
to be **promotable**: the _philosophy_ is project-agnostic and lifts verbatim into the global
config and `basalt-ui`; only the _Argo instantiation_ blocks (concrete palette, scales) get
re-instantiated. Keep that seam clean.

> **This file governs the system, not the data.** It declares the palette families, the surfaces,
> the type/space scales, and the rules. The **per-metric color assignments** (HRV→blue,
> bench→blue, gym→red, …) are a data dictionary that lives only in `packages/charts/src/palette.ts`
> — the executable `{light,dark}` source of truth. The YAML above is a **dark-first snapshot** for
> the linter (WCAG contrast + token refs) and portable export; **light** values live in palette.ts
> (each token is a `{light,dark}` pair). They must not drift — codegen will later generate one from
> the other.

## Overview

Argo reads like a quiet financial terminal: dense, dark-first, professional. The single brand
voltage is **blue**, used scarcely; everything else is ink, grey, and earned signal. Five
principles, in priority order — universal, promote as-is:

1. **Ink earns its color.** Color is a _signal_, never decoration. A mark is colored only for a
   **trend** (up/down), a **signal/status** (good/warn/bad), or **categorical separation**
   (genuinely distinct series in one frame). Everything else is neutral. Settled doctrine — IBM
   Carbon: _"every color should have a reason"_; Datawrapper: _"grey is the most important color
   in data visualization."_
2. **Neutral by default.** A single value, a single-series sparkline, one stat tile → neutral
   (`{colors.data-neutral}` / `VX.line`: grey on light, near-white on dark). The label says what
   it is; the color says nothing, on purpose.
3. **One identity, reused everywhere.** A small, harmonious accent palette from one designed source
   (Blueprint v6), reused across every page. Blue anchors; warm accents (red/orange/gold/forest)
   are spent sparingly. Never raw Material/AntD/Tailwind primaries.
4. **Tokens only — no raw values.** Every color comes from a token. No hex/`rgb()`/`hsl()` in
   component or chart source; opacity via `alpha(token, a)`, never `rgba()`. Enforced, not
   requested.
5. **Theme is data, not branching.** Light/dark differ by _shade_, not code path. Each token is a
   `{light,dark}` pair resolved in pure CSS off `[data-mantine-color-scheme]`. Never branch on
   scheme in JS; never read `localStorage.getItem('theme')`.

### Influences

Argo's system is a smart combination of three studied DESIGN.md systems — the best of each:

- **IBM Carbon** → _discipline_: one scarce accent, a defined spacing/type scale, hairline-not-
  shadow elevation, "every color has a reason." The restraint backbone.
- **Linear** → _dark-first craft_: the deep surface ramp (`canvas → surface-1/2` + layered
  hairlines) with light as the flip, and tight radii that read precise/technical.
- **Coinbase** → _signal-only color_: up/down deltas as text color (never a fill) and numbers in
  mono — "ink earns its color" applied to a finance dashboard.

## Token architecture

Three tiers, matching the W3C Design Tokens model. The promotable structure; names below are
Argo's instantiation.

| Tier          | What                 | Where (Argo)                                                         | Example                                         |
| ------------- | -------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| **Primitive** | Raw designed hues    | `BP` in `palette.ts`                                                 | `BP.blue[2]` = `#2d72d2`                        |
| **Semantic**  | Intent-bearing pairs | `SERIES`/`STATUS`/`SEMANTIC`/`NEUTRAL`/`SURFACE` → `--vx-*` → `VX.*` | `VX.status.good`, `VX.line`, `VX.surface.panel` |
| **Component** | Element-specific     | Mantine theme + chart primitives                                     | `ChartCard`, Mantine `color="blue"`             |

Flow: `palette.ts` (pure data, `{light,dark}` pairs) → `theme-vars.ts` (emits `--vx-*` under each
scheme selector) → `tokens.ts` (`VX.*` = thin `var(--vx-*)` strings) → consumed identically in
components **and** non-component files, because resolution is pure CSS. The Mantine chrome
(`theme.ts`) is reskinned from the _same_ `BP` data, so chrome and charts share one identity.

## Colors

### The identity palette (Argo instantiation)

Blue-anchored, professional, calm. DESIGN.md governs the **roles** and the **available hues**;
`palette.ts` maps each metric to one of them. The accent families (Blueprint v6, dark-shade shown
— light is one step deeper, see palette.ts):

| Role                  | BP family                          | dark      | Used for (system-level)                                             |
| --------------------- | ---------------------------------- | --------- | ------------------------------------------------------------------- |
| **Primary**           | blue                               | `#4c90f0` | Default identity — most lines, links, focus, a page's anchor metric |
| **Aerobic**           | cerulean                           | `#3fa6da` | Deep second-blue, to distinguish a sibling from primary (sparingly) |
| **Cardio**            | red                                | `#e76a6e` | Heart-rate / exertion family                                        |
| **Energy**            | orange                             | `#ec9a3c` | Calorie / output family                                             |
| **Highlight**         | gold                               | `#f0b726` | Load, amber emphasis, the "look here" accent                        |
| **Effort-low / good** | forest                             | `#43bf4d` | Low end of an escalation ramp; positive trend                       |
| **Effort-high**       | vermilion                          | `#eb6847` | High end of an escalation ramp                                      |
| _Forbidden_           | turquoise · violet · indigo · rose | —         | In `BP`, **not** in the identity                                    |

> **Individual metric colors are not a design guideline.** Which metric gets which role (HRV→blue,
> bench→blue, deadlift→vermilion, gym→red) is detail — it lives in `palette.ts`. Don't enumerate it
> here. The Mantine accent names `teal`/`violet`/`grape`/`indigo`/`pink` resolve to the forbidden
> hues (turquoise/violet/rose) and are now **rejected by the guard** — use blue/gray or a status hue
> (red/green/orange/yellow), or a VX series token, instead.

### When a hue is earned

Spend a color only for one of these. Otherwise the mark is `{colors.data-neutral}` (`VX.line`).

| Reason                     | Example                                            | Treatment                                                                   |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| **Trend**                  | Hero card up/down, momentum arrow                  | `{colors.trend-up}` up / `{colors.trend-down}` down (direction, not metric) |
| **Signal / status**        | Zone bands, thresholds, good/warn/bad              | `{colors.semantic-good}` / `{colors.status-warn}` …                         |
| **Categorical separation** | Sleep stages, intensity ramp, multi-toggle (2+)    | per-series accent (assigned in palette.ts)                                  |
| _none of the above_        | Single sparkline, one stat tile, single-metric bar | **neutral** `{colors.data-neutral}`                                         |

Worked rule from the codebase: a multi-toggle bar chart colors bars `isMulti ? VX.series.x :
VX.line` — neutral when one metric is selected, distinct colors only when 2+ are compared. Copy it.

### Light / dark tuning & opacity

Same hue, different shade — never the same hex in both. On dark, step **one shade lighter** (less
glow); on light, **one shade deeper** (contrast). Encoded as the `{light,dark}` pair via
`p(fam, light=2, dark=3)` in `palette.ts`. Opacity is always `alpha(token, a)` =
`color-mix(in srgb, token a%, transparent)` — never `rgba()`.

## Typography

System-sans, carried by **size + weight** (no display/body family split). Numbers render in
`{typography.number}` (mono, tabular) — a Coinbase pattern that keeps metric columns aligned.

> The `typography` tokens are the **current Mantine v9 inheritance**, snapshotted so the linter
> validates. A deliberate type ladder + heading rhythm is a **next-session hardening target**.

## Layout

Density is the point: this is a terminal, not a marketing page — sections separate by surface
change and hairlines, not by large air. Card interior padding defaults to `{spacing.md}` (16px).

> Spacing/radius are now **OWNED in theme.ts** (values still match v9 — a zero-pixel ownership step).
> The guard rejects raw spacing props equal to a scale step (`p={16}` → `p="md"`) and any numeric
> `radius`, while leaving sub-scale micro-gaps (`gap={2/4/6}`) alone — those have no token and are
> legitimate. **Ready follow-up:** flip the scale to a strict 4px grid (xs 10→8, lg 20→24) + tighter
> large radii in theme.ts and re-validate density. A full type ladder is the remaining hardening.

## Elevation & Depth

Depth comes from **surface change + 1px hairlines**, not drop shadows (Linear/Carbon discipline).

| Level        | Treatment                                      | Use                                |
| ------------ | ---------------------------------------------- | ---------------------------------- |
| 0 (flat)     | No border, no shadow                           | Body text, page background         |
| 1 (surface)  | `{colors.surface-1}` on `{colors.canvas}`      | Cards, panels                      |
| 2 (elevated) | `{colors.surface-2}` + 1px `{colors.hairline}` | Chart area, tooltips, lifted cards |
| 3 (focus)    | 2px `{colors.primary}` outline                 | Focused input / control            |

`VX.shadowCard` exists for the one soft card shadow. **Next-session hardening:** a deliberate
shadow scale tied to the surface tiers.

## Shapes

Radius on the Mantine scale. Argo leans **tight** — small radii read as precise/technical (Linear),
not soft/consumer. _Current reality:_ v9's default radius is `{rounded.md}` (8px) and `theme.ts`
doesn't override it. _Intent:_ default `{rounded.sm}` (4px), cards `{rounded.md}` (8px),
pills/badges `{rounded.pill}` — set `defaultRadius` deliberately in the chrome retheme.
**Next-session hardening:** pin the radius language + a border-width token.

## Components

The `components:` front matter inventories Argo's load-bearing UI (page, link, button, card,
divider, inputs, chart-card/line/legend, tooltip, delta-up/down, status badges, zone bands), each
bound to system tokens. Beyond it:

- Mantine v9, reskinned in `theme.ts`: every accent (`blue`/`red`/`teal`/…) is overridden with a
  Blueprint family via `ramp10()`, so `color="blue"`-style props are on-palette with zero
  call-site changes. `primaryColor: blue`; `primaryShade { light: 6, dark: 4 }`;
  `autoContrast: true`.
- **Mantine accent name map:** `blue`→blue, `cyan`→cerulean, `teal`→turquoise, `green`→forest,
  `yellow`/`lime`→gold/lime, `orange`→orange, `red`→red, `pink`→rose, `grape`/`violet`→violet,
  `indigo`→indigo. Mantine has **no** `gold`/`vermilion` name — use `yellow` (→gold), `red`,
  `orange`, `green` (→forest), `blue`, `gray`. Don't use `teal`/`violet`/`indigo` for identity.

**Chrome ↔ charts share one surface system.** `theme.ts` runs a `cssVariablesResolver` that binds
Mantine's surface variables to the same `--vx-*` the charts use — so cards, borders and muted text
draw from one scheme-reactive source (in particular, light mode now uses the lightGray surface ramp
instead of the muddy mid-gray default):

| Mantine variable                 | ← bound to              | Role                     |
| -------------------------------- | ----------------------- | ------------------------ |
| `--mantine-color-body`           | `--vx-surface-bg`       | page background          |
| `--mantine-color-default`        | `--vx-surface-panel`    | cards / default controls |
| `--mantine-color-default-hover`  | `--vx-surface-elevated` | hover surface            |
| `--mantine-color-default-border` | `--vx-surface-border`   | the hairline             |
| `--mantine-color-dimmed`         | `--vx-neutral`          | secondary / muted text   |

**Realized chrome (ShadCN / Carbon / Linear feel):**

- **Tight radii** — `defaultRadius: 'sm'` (4px) for controls; cards at `md` (8px).
- **Hairline elevation** — `Card`/`Paper` default `withBorder: true`, no shadow (depth = surface +
  hairline, per Elevation).
- **App shell** (`components/app-shell/`, `AppShell layout="alt"`): a full-height **grouped sidebar**
  (muted uppercase section labels Health / Work / System; brand pinned top-left) + a slim
  **breadcrumb top bar** (`Section / Page`, hairline-separated).
- **Top-bar slots own the page header.** The bar has two zones, not one. A **page slot**: the active
  route portals its full control row (window/range selectors, tabs, filters) into the bar via
  `<PageActions>`, so pages drop their in-body `<Title>` H1 — the breadcrumb names the page and the
  controls move up, reclaiming vertical density. A shell-owned **global slot** (`GlobalActions`):
  the running-timer pill + soft refresh today, the documented home for notifications / today's tasks
  / incident + server health next. On mobile the bar wraps to two rows (lead + global on row 1, a
  single horizontally-scrollable page-action row on row 2).
- **Neutral nav active state** — _ink earns its color applied to chrome:_ a nav selection is UI
  state, not a data signal, so the active item is a quiet neutral fill (a scheme-adaptive
  `color-mix` of `--vx-neutral`, `--nl-color` forced to text color), **never** the identity blue.
- **Collapsible sidebar (desktop icon-rail).** A persisted `useUiStore.sidebarCollapsed` drives the
  navbar to a 72px rail (responsive `width: { base: 240, sm: collapsed ? 72 : 240 }` so mobile stays a
  full drawer); rail styling — hide labels/section-headers/brand-text, center icons, tooltip each
  item — is **CSS gated behind `min-width: sm`**, so the persisted flag never collapses the mobile
  drawer. Toggle via the header chevron or **`Cmd/Ctrl+B`** (`useHotkeys`, the first global shortcut).
- **Sidebar header + footer.** Header = brand + a `visibleFrom="sm"` collapse chevron. Footer = a
  **theme select** `Menu` (System / Light / Dark via `setColorScheme`, active-checked, + the app
  version) — replacing the old standalone theme toggle. On mobile a close (✕) sits **inline with the
  theme control** in the footer row (`hiddenFrom="sm"`), so the drawer header stays just the brand.
- **Mobile bottom nav** (`app-mobile-nav.tsx`, an `AppShell.Footer` with `height {base:56,sm:0}` +
  `hiddenFrom="sm"`): a **curated** set of primaries (Garmin / Strength / Walk / Calendar) as
  icon+short-label tabs with a neutral active fill, plus a trailing **Menu** tab that opens the full
  grouped drawer (which carries everything, incl. M365 + Usage). There is no top burger on mobile; the
  drawer dismisses via the footer ✕ or by navigating. The DEV `DevDock` FAB lifts above the bottom-nav
  on mobile (`useMatches`) so it never covers a tab.
- **Nav count badges.** A count is a data _signal_, so "ink earns its color" lets it carry the **one
  spot of identity blue** in the otherwise-neutral nav (the active state stays neutral): a
  `Badge size="sm" variant="light" color="blue"` in the NavLink right-section, rendered only when
  `> 0` and auto-hidden in the collapsed rail (the right-section is `display:none` there). Counts come
  from `use-sidebar-badges.ts` — always-on, read-only queries that degrade to 0 on error (under
  `bun dev` the Google/M365 upstreams 503 → no badge): **Calendar** = events starting _today_ from
  Google + M365 (`days=1`; TickTick excluded — its N+1 projects→tasks fetch is disproportionate for a
  sidebar number), **M365 Explorer** = important messages received _today_ across labeled sources.

> **Method:** `docs/MANTINE-THEMING.md` (the chrome-side sibling of the visx-charts rule). The guard
> now also rejects off-identity accent names. Still open: a deliberate spacing/type/radius scale (then
> a magic-number guard on top of it), and an optional shadcn `variantColorResolver`.

## Data visualization

Argo's signature surface — the visx primitives in `@argo/charts`. Full contract:
`packages/charts/CLAUDE.md` + `~/.claude/rules/visx-charts.md`. The design rules:

- **Restraint over decoration.** Neutral structure (hairline grids ~6–8% neutral, thin
  crosshairs, restrained tooltips), colored data. Structure-first chart selection (FT Visual
  Vocabulary): pick the chart for the data relationship, then apply the minimum color.
- **Primitive contract** (every non-sparkline chart): `ChartCard`, `ChartLegend`, `ChartTooltip`
  family, `AxisLeftNumeric`/`AxisBottomDate`, `HoverOverlay` + `useHoverSync`. Sparklines are
  exempt from the card/legend/tooltip contract but still use `VX` tokens.
- **Kinds vs bespoke** (Rule of Three): reuse `ZonedLine`/`Bars`/`StackedArea`/`Donut`; extract a
  kind on the second instance of a new shape; bespoke only when genuinely unique. _If a chart
  doesn't fit the primitives, add a kind — don't loosen the primitives._
- **Area gradients.** Soft single-hue vertical gradient under a line (`AreaGradient`,
  `--vx-area-top`/`--vx-area-bottom`). Opt-in; default off when zones/thresholds already fill the
  plot (avoid double-fill haze). Stacked-area bands stay opaque.
- **Signal-only color, mono numbers** (Coinbase): up/down deltas are text color only, never a
  fill; metric values render in `{typography.number}`.

## Do's and Don'ts

### Do

- Default to neutral; spend a hue only for trend, signal, or categorical separation.
- Pull every color from a token (`VX.*` / `BP` / Mantine reskinned accent).
- Add new colors as `{light,dark}` pairs in `palette.ts` → wire `theme-vars.ts` → expose in
  `tokens.ts`. Never inline. Use `alpha(token, a)` for opacity.
- Render numeric values in `{typography.number}` (mono, tabular).
- Compose the chart primitives; add a kind on the third repeat.

### Don't

- Don't inline hex/`rgb()`/`hsl()`/`rgba()` in component or chart source (the guard fails).
- Don't reach for turquoise/violet/indigo/rose, or the `teal`/`violet`/`indigo` Mantine accent
  names, for identity.
- Don't color a single-series chart or a lone stat "to make it pop."
- Don't spend the identity hue on UI selection state (active nav item, selected tab) — that's not a
  data signal; keep it a neutral fill.
- Don't branch on color scheme in JS or read the theme from `localStorage`.
- Don't carry depth with drop shadows; use surface change + hairlines.
- Don't enumerate per-metric colors in this file — that's palette.ts's job.

## Enforcement

The teeth, today:

- **`scripts/check-theme.mjs`** (`bun run lint`) — fails on (1) any raw `hex`/`rgb()`/`hsl()` and
  (2) off-identity Mantine accent props (`color`/`c`/`bg`/`backgroundColor` set to
  `teal`/`violet`/`grape`/`indigo`/`pink`) in `apps/dashboard/src` + `packages/charts/src`. Exempts
  the token-definition files; escape hatch is a `theme-allow` line comment.
- **`bun run check:design`** — `npx @google/design.md lint DESIGN.md` (pinned `@0.2.0`), opt-in
  (out of the default `lint` because it's a network `npx` wanting Node 22). Validates this file's
  structure, token references, and **WCAG contrast** on the dark snapshot.
- **oxlint** — `no-restricted-imports` bans `@visx/tooltip` in chart files.

Known gaps (next-session): named CSS colors (e.g. `red`, `rebeccapurple`) still slip past the hex
guard; the spacing/radius guard is deliberately narrow (only token-equal values; sub-scale micro-gaps
are allowed by design); a full type ladder is unenforced; `palette.ts` ↔ `DESIGN.md` drift (fix:
codegen the snapshot from palette.ts, or `design.md export --format dtcg`).

## Promotion path

Argo proves the system; then it travels:

1. **Global** — lift Overview, Token architecture, Do's/Don'ts, and the data-viz doctrine into the
   global config / `~/.claude/rules` and the `/dataviz` skill (already project-agnostic). Argo's
   concrete palette/tokens stay here.
2. **basalt-ui** — re-instantiate the token tiers and primitives as the published design system;
   consumer apps inherit identity without re-deciding it.

Keep the universal/instantiation seam intact so that lift stays mechanical.
