---
paths:
  - apps/dashboard/**
  - packages/charts/**
---

# Design Tokens — Color, Spacing, Radius, Type

`DESIGN.md` (repo root) is the law; this rule is the operational checklist for chrome + chart code.
Enforced mechanically by `scripts/check-theme.mjs` (wired into `bun run lint`) — a violation fails
the build. Escape hatch: a `theme-allow` line comment (diff-visible, deliberate).

## Color — never a raw literal

- **No raw `#hex` / `rgb()` / `rgba()` / `hsl()`** in `apps/dashboard/src` or `packages/charts/src`.
  Route every color through the palette: `VX.*` tokens (charts + any file — they're CSS vars),
  `useVxTheme()` (back-compat), or the Mantine theme. Opacity via `alpha(token, a)`, never `rgba()`.
- **No off-identity Mantine accents.** `color`/`c`/`bg`/`backgroundColor` must not be
  `teal`/`violet`/`grape`/`indigo`/`pink` — those resolve to the forbidden turquoise/violet/rose hues.
  Allowed accents: **`blue`** (the one earned identity hue), **`gray`** (neutral), and the status hues
  **`red`/`green`/`orange`/`yellow`**. Categorical/series color goes through `VX.series.*` tokens, never
  a Mantine accent prop. (Success-button flips use `color="green"`, not `teal`.)
- **"Ink earns its color"** (DESIGN.md): default to neutral. A hue is justified only for trend,
  signal/status, or genuine multi-series separation. A count badge is a signal → it may carry blue;
  a nav active-state is UI chrome → it stays neutral.

## Spacing & radius — prefer the scale token

- The owned scales live in `apps/dashboard/src/theme.ts` (`spacing` 10/12/16/20/32 → `xs…xl`;
  `radius` 2/4/8/16/32 → `xs…xl`). **Use the token**, not the raw number, when a value equals a step:
  `p="md"` not `p={16}`, `gap="sm"` not `gap={12}`, `radius="sm"` not `radius={4}`. The guard flags
  exact token-equals (`p={16}`, any numeric `radius`).
- **Sub-scale micro-spacing is legitimate and allowed raw** — `gap={2}`, `pl={4}`, `mt={6}` have no
  token equivalent (the scale starts at 10). Use them freely for tight clusters; don't invent
  micro-tokens or pepper `theme-allow`. One-off layout dims (`h={36}`, `w={64}`) are also fine raw.
- **Icons** size via the prop (`size={16}`), not spacing tokens — that's not spacing.

## Type

- Type is carried by Mantine's `fontSizes` + `headings` + the named `fontWeights` ladder
  (`fw="semibold"` etc.) and the mono `fontFamilyMonospace` for numbers. Don't hard-code `fontSize`
  in px on chrome; use `size`/`fz` tokens. (A deliberate type ladder is a pending hardening target —
  see DESIGN.md typography.)

## When the guard fires

Fix the source, don't silence it — reach for the right token first. Only add `theme-allow` for a
genuine, documented exception (e.g. a third-party widget needing a literal). Exempt files (the token
definitions themselves) are listed in `scripts/check-theme.mjs`.
