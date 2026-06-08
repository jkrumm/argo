# packages/charts — @argo/charts

Theme-agnostic visx chart primitives, kinds, sparklines, and hooks. Consumed by `apps/dashboard` via the `@argo/charts` workspace alias.

## Architecture Constraint

This package imports **no Mantine** and reads **no browser APIs** for color scheme. It is fully decoupled from `apps/*`. The dashboard's `src/charts-bridge.tsx` (`VxBridge`) is the only bridge between Mantine's color scheme and `VxThemeProvider` — the only file allowed to import both.

## Color System — Blueprint palette via CSS variables

All color lives in one place: `palette.ts` (`BP` = the Blueprint v6 hex palette + the per-metric `SERIES`/`STATUS`/`NEUTRAL`/`SURFACE` maps). Every entry is a per-theme `{ light, dark }` **pair** — series colors are NOT theme-agnostic; a hue keeps its identity but shifts shade (lighter on dark to avoid glow, deeper on light). `theme-vars.ts` emits those pairs as `--vx-*` CSS custom properties (`PALETTE_CSS`), which `VxBridge` injects once. Resolution is pure CSS off Mantine's `[data-mantine-color-scheme]`, so `VX.*` tokens work identically in components AND non-component files (`constants.ts`, `formulas.ts`).

Consequences:

- `VX.series.hrv` etc. are `var(--vx-*)` strings — use them everywhere; never branch on color scheme yourself.
- The dashboard Mantine theme (`apps/dashboard/src/theme.ts`) is reskinned from the same `BP` data, so chrome and charts share one identity.
- Off-palette colors are **enforced**: `scripts/check-theme.mjs` (wired into `bun run lint`) fails on any raw hex / `rgb()` / `hsl()` in chart or dashboard source. Apply opacity with `alpha(token, a)`, never `rgba()`. The only escape hatch is a `theme-allow` line comment.
- A DEV-only theme lab (`apps/dashboard/src/components/theme-lab-panel.tsx`) live-overrides `--vx-*` on `<html>` for visual tuning; "Copy JSON" exports values to bake back into `palette.ts`.

## Directory Structure

```
src/
├── palette.ts          — Blueprint palette (BP) + SERIES/STATUS/NEUTRAL/SURFACE {light,dark} pairs (source of truth)
├── theme-vars.ts       — emits PALETTE_CSS: the --vx-* custom properties per color scheme
├── tokens.ts           — VX tokens: var(--vx-*) refs for colors + non-color sizing constants
├── theme.tsx           — VxThemeProvider + useVxTheme (static var refs)
├── utils/color.ts      — alpha(token, a): theme-aware opacity via color-mix
├── hover-context.ts    — HoverContext for cross-chart hover sync
├── primitives/         — Low-level building blocks
│   ├── ChartCard       — Title + subtitle + header-extra slot + border
│   ├── ChartLegend     — Line/bar/split legend shapes + optional highlight state
│   ├── ChartTooltip    — TooltipHeader + TooltipRow + TooltipBody + useTooltipStyles
│   ├── Axes            — AxisLeftNumeric, AxisRightNumeric, AxisBottomDate
│   ├── HoverOverlay    — Mouse capture rect for hover events
│   ├── ZoneRects       — Horizontal zone band fills
│   └── AreaGradient    — Soft single-hue area fill (--vx-area-top/bottom knobs)
├── kinds/              — Reusable high-level chart shapes
│   ├── ZonedLine       — Line chart with optional gradient area, zone fills, ref lines, thresholds
│   ├── StackedArea     — Stacked area chart
│   ├── Bars            — Grouped/stacked bar chart with optional line overlay
│   └── Donut           — Donut / pie
├── sparklines/         — LineSparkline, BarSparkline (exempt from ChartCard/Tooltip contract)
├── hooks/
│   ├── useChartTooltip — Tooltip open/close + position state
│   └── useHoverSync    — Cross-chart crosshair synchronisation via HoverContext
└── utils/
    ├── format          — fmtAxisDate, fmtTooltipDate
    └── ticks           — smartTicks (auto tick count from pixel width)
```

## Token Layers

| Layer                   | Location                | Usage                                                             |
| ----------------------- | ----------------------- | ----------------------------------------------------------------- |
| Semantic palette        | `VX.*` in `tokens.ts`   | `VX.good`, `VX.bad`, `VX.goodSolid`, `VX.grid`, `VX.crosshair`, … |
| Per-metric series       | `VX.series.*`           | `VX.series.hrv`, `VX.series.restingHr`, `VX.series.benchPress`, … |
| Status scale            | `VX.status.*`           | `VX.status.excellent / good / warn / bad / neutral`               |
| Theme-resolved neutrals | `VX.*` / `useVxTheme()` | `VX.line`/`theme.line`, `VX.axis`, `VX.tooltipBg`, …              |

Every `VX.*` color is a `var(--vx-*)` string that resolves per color scheme in pure CSS — there is no manual light/dark branching. Never use raw hex / `rgba()` literals (the lint guard fails on them); apply opacity with `alpha(token, a)`. `useVxTheme()` is kept for the handful of charts that destructure `line`, but `VX.line` is equivalent.

## VxThemeProvider

`VxThemeProvider` accepts `colorScheme: 'light' | 'dark'` as a prop (kept for back-compat). The dashboard's `VxBridge` reads this from Mantine and passes it down. `useVxTheme()` now returns **static `var(--vx-*)` refs** — the actual light/dark value is resolved by CSS, not by this hook — so most charts can just read `VX.*` directly:

```ts
import { useVxTheme } from '@argo/charts'

function MyChart() {
  const theme = useVxTheme()
  // theme.line === VX.line === 'var(--vx-line)' — resolves per color scheme in CSS
}
```

## HoverContext — Cross-Chart Sync

Wrap the page in `<HoverContext.Provider value={...}>` and use `useHoverSync` in every chart to broadcast and receive the hover date:

```ts
import { HoverContext, DEFAULT_NO_OP_SET_HOVER, type HoverCtx } from '@argo/charts'

// In the page component:
const [hover, setHover] = useState<HoverCtx>({ date: null, setHover: null })
<HoverContext.Provider value={{ ...hover, setHover }}>
  <ChartA />
  <ChartB />
</HoverContext.Provider>
```

See `garmin-health.tsx` for the realized pattern.

## Primitive Contract (every non-sparkline chart)

1. **ChartCard** wrapper — never a raw HTML div. Provides `title`, optional `subtitle`, optional `headerExtra` slot.
2. **ChartLegend** — never hand-rolled legend markup.
3. **ChartTooltip** + `TooltipHeader` + `TooltipRow` + `TooltipBody` — never implement tooltip state or markup inline.
4. **AxisLeftNumeric** / **AxisBottomDate** — never raw visx `<AxisLeft>`/`<AxisBottom>`.
5. **HoverOverlay** for mouse capture + **useHoverSync** for cross-chart sync.

Sparklines (under `sparklines/`) are exempt from ChartCard/ChartLegend/ChartTooltip — but still must use `VX` tokens and `useVxTheme`.

## Adding a New Chart

- **Same shape as an existing kind?** Reuse `ZonedLine` or `Bars` with different props.
- **Second instance of a new shape?** Extract a kind under `src/kinds/` and migrate both sites (Rule of Three).
- **Genuinely unique?** Build bespoke from primitives directly in the route file.
- **New color (series / status / semantic)?** Add a `{light,dark}` pair to `palette.ts`, wire the var in `theme-vars.ts`, expose the token in `tokens.ts` — never inline a hex.
- **New non-color size/constant?** Add to `tokens.ts`.
- **Want a soft fill under a line?** Pass `areaFill` to `ZonedLine` (or compose `AreaGradient` + `AreaClosed`); it defaults on for plain metric lines, off when zones/thresholds already fill the plot.

## Typecheck

```bash
bun run --cwd packages/charts typecheck
```
