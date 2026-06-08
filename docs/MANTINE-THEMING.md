# Mantine Theming — Argo Engineering Reference

> **Role.** This is the **method** for the Mantine _chrome_ layer (the app shell: shell, sidebar,
> cards, inputs, buttons, badges, navigation). It is subordinate to **`DESIGN.md`** — the _law_.
> Where this doc and `DESIGN.md` disagree, `DESIGN.md` wins. It is the chrome-side sibling of
> `~/.claude/rules/visx-charts.md` (the method for the charts layer). Both layers must resolve to
> **one** identity, and this doc explains the wiring that makes that true.
>
> Target: **Mantine 9.2.x** (`@mantine/core` `^9.2.1`), React 19, the `@mantine/*` v9 family.
> Source of truth for the live theme is `apps/dashboard/src/theme.ts`.

---

## 0. The one big idea

Mantine v9 is a **CSS-variable theming system**, not a runtime style engine. `createTheme()` is
mostly a _generator of CSS custom properties_ (`--mantine-*`). Components read those variables in
their own CSS modules. So theming is: **decide the variables, let CSS resolve them per scheme.**

Argo already runs a parallel CSS-variable system for charts: `--vx-*` (Blueprint palette →
`theme-vars.ts` → `tokens.ts`). The whole game of this retheme is to **make the two variable
systems agree** — bind Mantine's surface/border/text variables to the _same_ `--vx-*` values the
charts use, so chrome and charts are literally drawing from one set of variables, scheme-reactive
in pure CSS with zero JS branching.

```
              palette.ts  (BP + {light,dark} pairs — the single source)
                   │
        ┌──────────┴───────────┐
   theme-vars.ts            theme.ts
   emits --vx-*            createTheme() + cssVariablesResolver
   (charts)                emits/overrides --mantine-*  ←──binds to──  --vx-*
        │                       │
   @argo/charts            Mantine components
        └──────────┬───────────┘
              one identity, one set of surfaces
```

This is the same architecture mantinehub/shadcn uses to make Mantine "look like shadcn"; the
difference is Argo binds to its _own_ `--vx-*` tokens instead of inventing shadcn `--background`
/`--foreground` names.

---

## 1. Mental model: CSS variables, not props

- Every theme token becomes a CSS variable: `--mantine-color-blue-6`, `--mantine-spacing-md`,
  `--mantine-radius-md`, `--mantine-font-size-sm`, etc. Components consume them.
- **Color scheme** is an attribute on `<html>`: `data-mantine-color-scheme="dark|light"`. Any
  variable that differs by scheme is redeclared under that selector. **Never branch on scheme in
  JS** — emit two values and let CSS choose. (Same rule as the charts; see DESIGN.md principle 5.)
- The handful of variables that carry the _surface system_ are the ones that define "the look":

| Variable                         | Meaning                               | Mantine default (light / dark) |
| -------------------------------- | ------------------------------------- | ------------------------------ |
| `--mantine-color-body`           | page background                       | `#fff` / `dark-7`              |
| `--mantine-color-text`           | primary text                          | `#000`-ish / `dark-0`          |
| `--mantine-color-dimmed`         | secondary/muted text                  | `gray-6` / `dark-2`            |
| `--mantine-color-default`        | default control/surface bg            | `#fff` / `dark-6`              |
| `--mantine-color-default-hover`  | default hover bg                      | `gray-0` / `dark-5`            |
| `--mantine-color-default-border` | **the hairline** — borders/dividers   | `gray-4` / `dark-4`            |
| `--mantine-color-default-color`  | text on default surface               | `#000` / `#fff`                |
| `--mantine-color-dark-*`         | the `dark` tuple (drives dark chrome) | Argo overrides → `bpDark`      |

> **Argo today:** in **dark** mode the surfaces look right only because the `bpDark` tuple is
> hand-aligned so `dark-7/6/4/0` = `canvas/panel/hairline/ink`. In **light** mode Mantine derives
> surfaces from the `gray` tuple (`ramp10(BP.gray)` — _mid_ grays), which does **not** match the
> `lightGray` ramp the charts use for `SURFACE`. The `cssVariablesResolver` below fixes this for
> both schemes and removes the reliance on the `bpDark` coincidence.

---

## 2. The theme object (`createTheme`)

What Argo sets, and why. Full surface: <https://mantine.dev/theming/theme-object>.

| Field                                 | Argo value                                         | Rationale                                                       |
| ------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `primaryColor`                        | `'blue'`                                           | the one earned identity hue (DESIGN.md)                         |
| `primaryShade`                        | `{ light: 6, dark: 4 }`                            | deeper on light, lighter on dark (no glow)                      |
| `autoContrast` + `luminanceThreshold` | `true`, `0.45`                                     | auto black/white text on filled accents                         |
| `colors`                              | every Mantine accent overridden via `ramp10(BP.*)` | `color="teal"` etc. become on-palette with zero call-site edits |
| `white` / `black`                     | `#ffffff` / `#111418`                              | match the palette endpoints                                     |
| `defaultRadius`                       | **decide deliberately** (see §8)                   | v9 default changed `sm`→`md`; Argo leans tight (Linear)         |
| `fontFamilyMonospace`                 | mono stack                                         | numbers render mono (DESIGN.md `typography.number`)             |
| `focusRing`                           | `'auto'` (keyboard-only)                           | restrained, accessible focus                                    |
| `fontWeights`                         | new in v9                                          | name the weight ladder once                                     |
| `components`                          | `Component.extend({...})`                          | centralised default props + Styles API                          |
| `other`                               | escape hatch                                       | typed bag for non-standard tokens (`theme.other.*`)             |

**`MantineColorsTuple`** is always **10 shades, light→dark** (index 0 lightest, 9 darkest).
Blueprint families are 5 stops dark→light, so `ramp10()` interpolates them up to 10. `dark` is a
special tuple: Mantine reads `dark-7`=body, `dark-6`=surface, `dark-4`=border, `dark-0`=text — Argo
hand-tunes `bpDark` to those slots.

Helpers worth knowing (v9): `virtualColor({name, light, dark})` (a color that _is_ a different
real color per scheme — useful for a `primary` alias), `colorsTuple('#hex')` (expand one hex to a
tuple), `darken()/lighten()/alpha()` from `@mantine/core`.

---

## 3. The CSS-variable system in detail

### Variant variables

For each color `name` and variant, Mantine emits a fixed set. These are what components actually
paint with:

```
--mantine-color-{name}-filled            --mantine-color-{name}-light
--mantine-color-{name}-filled-hover      --mantine-color-{name}-light-hover
--mantine-color-{name}-outline           --mantine-color-{name}-light-color
--mantine-color-{name}-outline-hover     --mantine-color-{name}-text
--mantine-primary-color-{filled,light,...}   // alias to the primaryColor's set
--mantine-primary-color-contrast          // text color on a filled primary
```

> **v9 change:** the `light` variant is now a **solid** color (v8 was translucent). If a surface
> looked translucent-tinted before, that's why. `v8CssVariablesResolver` exists only as a
> migration shim — don't adopt it.

### Scheme resolution

`light-dark(a, b)` CSS function and the `[data-mantine-color-scheme]` selectors do the work. A
variable that differs by scheme is declared twice; CSS picks based on the `<html>` attribute. This
is identical in spirit to `PALETTE_CSS` in `theme-vars.ts`, which declares `--vx-*` under the same
attribute — which is _why_ the two systems compose cleanly.

---

## 4. `cssVariablesResolver` — the lever (Argo's core binding)

`cssVariablesResolver(theme) => { variables, light, dark }` injects/overrides CSS variables.
`variables` is scheme-independent (lands on `:root`); `light`/`dark` are auto-scoped under the
`[data-mantine-color-scheme]` selector. This is the single most important hook for the retheme:
**bind Mantine's surface system to `--vx-*`.**

> **Specificity gotcha (verified the hard way).** The bindings **must go in `light`/`dark`, not
> `variables`.** Mantine declares the surface vars (`--mantine-color-body`, `-default`,
> `-default-border`, …) under the `[data-mantine-color-scheme]` selector. A `variables` binding
> lands on `:root`, which that selector **outranks** — so your binding silently loses to Mantine's
> per-scheme default. The `light`/`dark` blocks inject under the _same_ scheme selector, at matching
> specificity, after Mantine's — so they win. (The `--vx-*` refs are themselves scheme-resolved, so
> the same ref works in both blocks; the per-scheme hex fallbacks just cover the brief window before
> `PALETTE_CSS` injects.)

```ts
// apps/dashboard/src/theme.ts
import type { CSSVariablesResolver } from '@mantine/core'

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  // Surfaces + hairline: chrome draws from the SAME vars as the charts. In BOTH blocks (specificity).
  light: {
    '--mantine-color-body': 'var(--vx-surface-bg, #f6f7f9)', // page background
    '--mantine-color-default': 'var(--vx-surface-panel, #ffffff)', // cards / default controls
    '--mantine-color-default-hover': 'var(--vx-surface-elevated, #ffffff)',
    '--mantine-color-default-border': 'var(--vx-surface-border, #dce0e5)', // the hairline
    '--mantine-color-dimmed': 'var(--vx-neutral, #5f6b7c)', // secondary/muted text
  },
  dark: {
    '--mantine-color-body': 'var(--vx-surface-bg, #1c2127)',
    '--mantine-color-default': 'var(--vx-surface-panel, #252a31)',
    '--mantine-color-default-hover': 'var(--vx-surface-elevated, #2f343c)',
    '--mantine-color-default-border': 'var(--vx-surface-border, #383e47)',
    '--mantine-color-dimmed': 'var(--vx-neutral, #8f99a8)',
  },
  // --mantine-color-text left to Mantine (near-black/near-white already correct); do NOT bind it
  // to --vx-line (that's a mid-gray chart stroke, too weak for body copy).
})
```

Wire it into the provider alongside the theme:

```tsx
<MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="dark">
```

> **Ordering caveat.** `--vx-*` are injected by `VxBridge` via `<style>{PALETTE_CSS}</style>`
> _inside_ the React tree; Mantine injects its variables at the provider root. Both target the
> document, both key off `[data-mantine-color-scheme]`, and CSS `var()` resolves lazily at paint —
> so the reference works regardless of injection order. If a binding ever resolves empty, provide a
> fallback: `var(--vx-surface-bg, #1c2127)`.

This binding is the "wire everything up nicely" win: one edit, and **light-mode chrome stops using
the muddy mid-gray ramp** and adopts the lightGray surface ramp the charts already use.

---

## 5. `variantColorResolver` — shadcn-flavoured variants (optional, §8 decision)

`variantColorResolver({ color, variant, gradient, theme }) => { background, hover, color, border, hoverColor? }`
customises how _every_ variant paints. The shadcn move is: a filled primary always uses a crisp
contrast text, and `default`/`subtle` lean on the neutral surface+hairline rather than a tinted
accent. Compose on top of the default resolver so only the deltas are specified:

```ts
import { defaultVariantColorsResolver, type VariantColorsResolver } from '@mantine/core'

export const variantColorResolver: VariantColorsResolver = (input) => {
  const out = defaultVariantColorsResolver(input)
  if (input.variant === 'filled') {
    return { ...out, color: 'var(--mantine-color-white)', hoverColor: 'var(--mantine-color-white)' }
  }
  return out
}
```

Argo's `autoContrast` already handles most filled-text contrast, so a custom resolver is a
_refinement_, not a requirement — adopt only if specific variants need shadcn-exact treatment
(decided in §8). mantinehub instead routes contrast through per-component `vars` (see §7).

---

## 6. Component theming — default props, Styles API, data attributes

Three escalating levers, cheapest first. **Always prefer the cheapest that does the job.**

1. **Default props** — set a prop once, globally:
   ```ts
   Card: Card.extend({ defaultProps: { withBorder: true, radius: 'md', shadow: undefined } }),
   Paper: Paper.extend({ defaultProps: { withBorder: true } }),
   Badge: Badge.extend({ defaultProps: { radius: 'sm', variant: 'light' } }),
   NavLink: NavLink.extend({ defaultProps: { variant: 'light' } }),
   ```
2. **`vars`** — compute CSS variables from `(theme, props)`; the mantinehub technique for routing a
   component's fill/text to `*-filled`/`*-contrast` per `color` prop (see §7). Surgical, no CSS file.
3. **`classNames` + CSS modules** — when structure/state styling is needed. Style by **data
   attributes**, never by deep selectors: `data-active`, `data-variant`, `data-disabled`,
   `data-hovered`, `data-checked`, … e.g. an active sidebar item is `&[data-active] { … }`.

Compound components drop the dot in the `components` key: `Menu.Item` → `MenuItem`.
`styles`/`classNames` may be **functions** receiving `(theme, props)`.

> **v9 gotchas:** `Text`/`Anchor` use `c` (not `color`) for text color. `defaultRadius` default is
> now `md` (8px), not `sm`. `ColorSchemeScript`'s `defaultColorScheme` **must** match the
> provider's, or you get a flash of the wrong theme (FART) on load.

---

## 7. The mantinehub / shadcn technique, distilled

Source studied: `RubixCube-Innovations/mantine-theme-builder` (mantinehub.com). What it actually
does — and what Argo adopts vs rejects:

**The mechanism** (two moves, no per-component CSS files):

1. A **`cssVariablesResolver`** that redefines the _surface system_ — `--mantine-color-body`,
   `--mantine-color-default`, `--mantine-color-default-border`, `--mantine-color-dimmed`,
   `--mantine-color-text`, a neutral `secondary` ramp — to a chosen neutral palette (Zinc/Slate).
   This is 90% of why it "looks shadcn." **Argo adopts this verbatim** (§4), binding to `--vx-*`.
2. Per-component **`vars`** that route fills/text to `--mantine-color-{color}-contrast` and
   `-filled`, so a filled control always gets crisp foreground text regardless of accent. Argo gets
   most of this free via `autoContrast`; adopt the `vars` pattern only where a component misbehaves.

**Other settings it ships:** `focusRing: "never"` (Argo keeps `'auto'` — accessibility), custom
`radius`/`spacing`/`fontSizes`/`lineHeights` scales, `primaryShade {light:9,dark:0}` for a
_neutral_ (near-black/near-white) primary, `Geist` font, soft shadow scale, `Card` `withBorder`.

**Adopt:** the surface-variable resolver; deliberate radius/spacing/type scales; `Card`/`Paper`
`withBorder` defaults; the `vars`-routing trick as needed.
**Reject:** their neutral-as-primary (`primaryShade {dark:0}`) — Argo's primary is _blue_, not a
neutral; `focusRing:"never"`; importing their Zinc/Slate ramps — Argo's neutral is the Blueprint
gray/lightGray/darkGray ramps, already defined.

---

## 8. Argo wiring — the integration plan

The retheme advances three things in lockstep so they never drift: **theme.ts**, the
**chrome implementation** (shell/sidebar/breadcrumb), and **DESIGN.md**.

### 8.1 Unified token graph (theme.ts)

- Add the `cssVariablesResolver` of §4 (surfaces/border/dimmed ← `--vx-*`). _Highest-value, lowest-
  risk step — do first._
- Decide `defaultRadius`. DESIGN.md's "default = sm (4px)" is **stale** (v9 default is `md`/8px and
  theme.ts doesn't override it, so the app currently runs 8px). Argo leans tight/precise (Linear) →
  recommend **`defaultRadius: 'sm'` (4px)** with cards at `md` (8px), and update DESIGN.md to match
  reality + intent.
- Add `fontFamilyMonospace`, `fontWeights`, and `Card`/`Paper` `withBorder: true` + drop card
  shadow on dark (depth = surface + hairline, not shadow — DESIGN.md Elevation).
- `variantColorResolver` (§5): **optional**, defer until a variant visibly needs it.

### 8.2 Chrome: sidebar + breadcrumb shell

**Status:** built and validated (dark + light + mobile). Lives in
`apps/dashboard/src/components/app-shell/` (`app-sidebar.tsx`, `app-sidebar.module.css`,
`app-breadcrumbs.tsx`); the shell is assembled in `routes/__root.tsx` with `AppShell layout="alt"`
(full-height sidebar, breadcrumb header scoped to the main area). Route coupling (typed navigation +
active detection) stays in `__root.tsx`, which feeds resolved `sections` into the presentational
`AppSidebar`. The active state is neutral (DESIGN.md): a `color-mix(--vx-neutral)` fill with
`--nl-color` forced to text — **not** the identity blue. **Still open:** count badges (need real
counts), spacing/type hardening, guard extensions.

#### Page-header slots (built and validated, all 6 pages)

The slim top bar **owns the page header** — pages no longer render an in-body `<Title>` H1
(the breadcrumb already names the page; dropping it reclaims vertical density). The bar has two
zones:

- **Page slot** — `page-header.tsx`: a `PageHeaderProvider` (wraps `AppShell`) holds the outlet
  element in context; `PageActionsOutlet` (a `<div ref>` in `AppShell.Header`) registers it; each
  page renders `<PageActions>…controls…</PageActions>`, which `createPortal`s its control row into
  the outlet. **Why a portal, not route `staticData`:** the controls are live — they close over the
  page's search-param handlers, query data, and local state — so they must render inside the page's
  React subtree while _appearing_ in the bar. A page contributes only its actions; the breadcrumb
  is still nav-derived in `__root.tsx`.
- **Global slot** — `global-actions.tsx` (`GlobalActions`): shell-owned, persistent across routes.
  Timer pill + soft refresh today; the single insertion point for future app-level widgets
  (notifications, today's tasks, incident / server health).

Layout (`app-header.module.css`): `[burger? · breadcrumb] ···· [page actions] | [global]`.
On mobile the bar **wraps to two rows** (responsive `header.height` `{ base, sm }`): lead + global
on row 1, a single horizontally-scrollable page-action row on row 2. Gotcha: nested Mantine
`Group`s default to `flex-wrap: wrap` and stack/clip in the slim bar — force descendant
`.mantine-Group-root { flex-wrap: nowrap }` (scoped to the outlet) so the row stays one scrollable
line. Special cases: **calendar** moved its nav cluster + date label + view toggle into the slot
(legend relocated to the body top, "jump to today" badge dropped as redundant with the Today
button); **m365** moved its action buttons up and kept the descriptive subtitle as a body intro.

#### Sidebar collapse, header/footer + mobile bottom-nav (built and validated)

- **Desktop icon-rail collapse.** The persisted `useUiStore.sidebarCollapsed` (no second store; a
  `toggleSidebar` action was added) drives a responsive navbar width
  `navbar={{ width: { base: 240, sm: collapsed ? 72 : 240 } }}` — `base` (mobile) stays the full
  240px drawer, only `sm`+ collapses to a 72px rail. The rail presentation lives entirely in CSS
  **gated behind `@media (min-width: 48em)`** (`app-sidebar.module.css`, keyed off a
  `data-collapsed` attr on the sidebar root): hide brand text / section labels / `NavLink` labels +
  the right `rightSection`, center the left icon (`.mantine-NavLink-body { display: none }` +
  `justify-content: center`). **This gate is load-bearing:** it's why the persisted flag never
  collapses the _mobile_ drawer — verified by forcing the flag on at 390px and confirming all 9
  labels still render.
- **Toggle paths.** A `visibleFrom="sm"` chevron in the sidebar header
  (`IconLayoutSidebarLeft{Collapse,Expand}`), and **`Cmd/Ctrl+B`** via
  `useHotkeys([['mod+B', toggleSidebar]])` in `__root.tsx` — the first global hotkey in the app
  (`mod` = ⌘ on mac / Ctrl elsewhere; `useHotkeys` ignores input/textarea focus by default).
- **Header / footer.** Header = brand (logo + "Argo") + the collapse chevron only. Footer = a **theme
  select** `Menu` (`position="top-start"`) replacing the old standalone theme button: a `Menu.Target`
  showing the current scheme (icon + "System/Light/Dark"), three items wired to
  `setColorScheme('auto'|'light'|'dark')` with the active one `IconCheck`-marked, and a `Menu.Label`
  for `Argo v{__APP_VERSION__}`. On mobile the footer row also carries `[RefreshButton][✕ close]`
  (wrapped in a `hiddenFrom="sm"` Group) — the close is the drawer's primary dismiss (the drawer is
  full-width on mobile, so there's no backdrop to tap), placed inline with the theme to keep the
  drawer header brand-only. `clearToken()`/sign-out was **dropped** with the account menu (rarely used
  under dev auto-auth; re-add as a menu item if needed). When collapsed the footer theme button
  centers to its icon (CSS; the refresh/close are desktop-hidden).
- **Mobile bottom-nav** (`app-mobile-nav.tsx` + `.module.css`): a fixed bottom tab bar mounted in an
  `AppShell.Footer` with `footer={{ height: { base: 56, sm: 0 } }}` + `hiddenFrom="sm"` — so it
  reserves space and shows only below the navbar breakpoint, and AppShell auto-pads `Main` to clear
  it. Renders a **curated** set of primaries (`mobile: true` on the item — Garmin / Strength / Walk /
  Calendar) as icon + short-label tabs reusing each item's typed `onClick`, **plus a trailing "Menu"
  tab** (a plain button, no `href`) that opens the full grouped drawer (which still carries
  everything, incl. M365 + Usage + disabled System stubs). Active tab = neutral `color-mix(--vx-neutral)`
  fill + text color (identity, not blue). There is **no top burger** on mobile — the drawer opens from
  the Menu tab and dismisses via the footer ✕ or by navigating. The DEV `DevDock` `Affix` lifts to
  `bottom: 72` on mobile (`useMatches({ base: 72, sm: 20 })`) so its FAB never sits on the Menu tab or
  the footer close.
- **Nav count badges** (`use-sidebar-badges.ts`): the `SidebarItem.badge` slot (`NavLink.rightSection`)
  is fed by a small always-on hook running read-only TanStack queries. A count is a data **signal**, so
  "ink earns its color" permits the badge to be the **one spot of identity blue** in the neutral nav —
  a `Badge size="sm" variant="light" color="blue"` (the active state stays neutral, so the badge never
  competes with it). Rendered only when `> 0`; the rail CSS already `display:none`s the right-section,
  so it auto-hides when collapsed. Both queries `retry: false`-degrade to 0 on 503 (no badge under
  `bun dev`, where Google/M365 lack local tokens; they resolve under `bun dev:prod-api` / prod).
  **Calendar** = events starting _today_ from Google + M365 (`days=1` window → effectively still-to-come
  today; **TickTick deliberately excluded** — counting tasks-due-today needs an N+1 projects→tasks fetch,
  disproportionate for a sidebar number). **M365 Explorer** = important messages received _today_ across
  labeled sources (`GET /m365/important`, filtered by `message.createdAt`). Validated dark + light +
  collapsed-rail (hidden) + mobile drawer; counts matched the API-computed expectations.

Target aesthetic (the inspiration board + ShadCN sidebar, mapped to Mantine):

- **Workspace header** — brand/logo + (later) workspace switcher; a collapse toggle.
- **Grouped nav** — muted uppercase **section labels** ("General", etc.), `NavLink` items with
  left icon, optional right **count badge** (`NavLink.rightSection` + `Badge`), active item with a
  subtle filled surface (`variant="light"` / `data-active`).
- **Footer** — theme toggle + the timer/refresh widgets, pinned to the bottom.
- **Collapsible** — desktop collapses to an **icon rail** (Mantine `AppShell` `collapsed` +
  icon-only `NavLink`s in a `Tooltip`); mobile is a **drawer** (current `AppShell.Navbar`
  `collapsed.mobile` pattern, already in `__root.tsx`).
- **Breadcrumb top bar** — in the main area, a hairline-separated bar (`Breadcrumbs` +
  `AppShell.Header` on desktop, not just mobile) showing `Section / Page`.

ShadCN sidebar anatomy → Mantine mapping (for reference, _not_ a 1:1 port):

| ShadCN                               | Mantine realization                                         |
| ------------------------------------ | ----------------------------------------------------------- |
| `SidebarProvider` / `useSidebar`     | `AppShell` + Zustand collapse store (already present)       |
| `Sidebar` / `SidebarContent`         | `AppShell.Navbar` + scroll area                             |
| `SidebarHeader` / `SidebarFooter`    | top `Group` / bottom-pinned `Group` (flex spacer)           |
| `SidebarGroup` + `SidebarGroupLabel` | `Stack` + a muted `Text` (uppercase caption)                |
| `SidebarMenuButton` (+ `isActive`)   | `NavLink` (+ `active` / `data-active`)                      |
| `SidebarMenuBadge`                   | `NavLink.rightSection` → `Badge`                            |
| `collapsible="icon"`                 | `AppShell` navbar width swap + icon-only items in `Tooltip` |
| mobile sheet                         | `AppShell.Navbar` `collapsed={{ mobile }}` (offcanvas)      |
| `Cmd/Ctrl+B` toggle                  | `@mantine/hooks` `useHotkeys([['mod+B', toggle]])`          |

Extract the inline nav in `__root.tsx` into composable pieces:
`components/app-shell/{AppSidebar,SidebarSection,SidebarItem,SidebarFooter,Breadcrumbs}.tsx`.
A small `nav-config.ts` (route, label, icon, badge) drives the list so items aren't hand-written.

### 8.3 Enforcement & DESIGN.md sync

- Extend `scripts/check-theme.mjs` to also flag **forbidden Mantine accent names** for identity
  (`teal`/`violet`/`indigo`) and (later) raw spacing/radius magic numbers — closes the known gap.
- Advance DESIGN.md's **Components / Shapes / Elevation** sections to describe the realized chrome
  (radius decision, `withBorder` elevation, the surface-var binding), and add the
  Mantine↔`--vx-*` binding table. Keep the front-matter snapshot honest (fix the radius note).
- Keep the universal/instantiation seam: the _technique_ (bind chrome vars to your token system)
  is promotable; the concrete `--vx-*` names are Argo's instantiation.

---

## 9. Iteration loop

The dev theme lab (`components/theme-lab-panel.tsx`) already live-overrides `--vx-*` on `<html>`;
because chrome now binds to those vars, the lab retunes **chrome and charts together**. Tune by eye
in the running app → "Copy JSON" → bake into `palette.ts`.

Visual validation runs in **both schemes** via the chrome-devtools MCP against the local dev server
(the user runs `bun dev`; never start it from here): navigate `https://argo.test`, toggle
dark/light, screenshot the sidebar (expanded + icon rail), a content page, and a mobile viewport.
Diff against this doc's targets; iterate.

---

## 10. Pitfalls

- **FART (flash of wrong theme):** `ColorSchemeScript defaultColorScheme` must equal the provider's
  (`index.html` inline script handles this — keep them in sync).
- **`light` variant is solid in v9** — don't expect translucency; if you want a tint, use `alpha()`.
- **`c` not `color`** for `Text`/`Anchor` text color in v9.
- **Don't bind `--mantine-color-text` to `--vx-line`** — that's a mid-gray chart stroke, too weak
  for body copy. Surfaces/borders/dimmed: bind. Primary text: leave to Mantine.
- **Surface bindings go in `light`/`dark`, never `variables`** (§4 specificity gotcha) — a `:root`
  binding loses to Mantine's `[data-mantine-color-scheme]` default and silently no-ops.
- **Don't branch on color scheme in JS** and **don't read `localStorage` theme** — emit two values,
  let CSS resolve (DESIGN.md principle 5).
- **No raw hex/`rgb()`/`rgba()`** in chrome source either — the `check-theme.mjs` guard fails on it;
  use Mantine tokens / `--vx-*` / `alpha(token, a)`.

---

## References

- Mantine theme object — <https://mantine.dev/theming/theme-object>
- CSS variables + list — <https://mantine.dev/styles/css-variables> · <https://mantine.dev/styles/css-variables-list>
- Colors + `variantColorResolver` — <https://mantine.dev/theming/colors>
- Default props / Styles API / data attributes — <https://mantine.dev/theming/default-props> · <https://mantine.dev/styles/styles-api> · <https://mantine.dev/styles/data-attributes>
- Color schemes / provider — <https://mantine.dev/theming/color-schemes> · <https://mantine.dev/theming/mantine-provider>
- v8→v9 migration — <https://mantine.dev/guides/8x-to-9x>
- mantinehub (shadcn-for-Mantine) — <https://mantinehub.com> · `github.com/RubixCube-Innovations/mantine-theme-builder`
- ShadCN sidebar anatomy — <https://ui.shadcn.com/docs/components/base/sidebar>
- Argo law + layers — `DESIGN.md` · `packages/charts/CLAUDE.md` · `~/.claude/rules/visx-charts.md`
