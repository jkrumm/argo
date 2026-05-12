# packages/charts — @argo/charts

Theme-agnostic visx chart primitives, kinds, sparklines, and hooks. Consumed by `apps/dashboard` via the `@argo/charts` workspace alias.

## Architecture Constraint

This package imports **no Mantine** and reads **no browser APIs** for color scheme. It is fully decoupled from `apps/*`. The dashboard's `src/charts-bridge.tsx` (`VxBridge`) is the only bridge between Mantine's color scheme and `VxThemeProvider` — the only file allowed to import both.

## Directory Structure

```
src/
├── tokens.ts           — VX palette: semantic fills, per-metric series colors, sizing
├── theme.tsx           — VxThemeProvider + useVxTheme (resolved neutrals per colorScheme)
├── hover-context.ts    — HoverContext for cross-chart hover sync
├── primitives/         — Low-level building blocks
│   ├── ChartCard       — Title + subtitle + header-extra slot + border
│   ├── ChartLegend     — Line/bar/split legend shapes + optional highlight state
│   ├── ChartTooltip    — TooltipHeader + TooltipRow + TooltipBody + useTooltipStyles
│   ├── Axes            — AxisLeftNumeric, AxisRightNumeric, AxisBottomDate
│   ├── HoverOverlay    — Mouse capture rect for hover events
│   └── ZoneRects       — Horizontal zone band fills
├── kinds/              — Reusable high-level chart shapes
│   ├── ZonedLine       — Line chart with zone fills, ref lines, thresholds
│   └── Bars            — Grouped/stacked bar chart with optional line overlay
├── sparklines/         — LineSparkline, BarSparkline (exempt from ChartCard/Tooltip contract)
├── hooks/
│   ├── useChartTooltip — Tooltip open/close + position state
│   └── useHoverSync    — Cross-chart crosshair synchronisation via HoverContext
└── utils/
    ├── format          — fmtAxisDate, fmtTooltipDate
    └── ticks           — smartTicks (auto tick count from pixel width)
```

## Token Layers

| Layer                   | Location              | Usage                                                             |
| ----------------------- | --------------------- | ----------------------------------------------------------------- |
| Semantic palette        | `VX.*` in `tokens.ts` | `VX.good`, `VX.bad`, `VX.goodSolid`, `VX.grid`, `VX.crosshair`, … |
| Per-metric series       | `VX.series.*`         | `VX.series.hrv`, `VX.series.restingHr`, `VX.series.benchPress`, … |
| Theme-resolved neutrals | `useVxTheme()`        | `theme.line`, `theme.axis`, `theme.tooltipBg`, …                  |

Never use raw hex literals in chart files. Use `VX.*` for values that do not change with the color scheme; use `useVxTheme()` for values that do.

## VxThemeProvider

`VxThemeProvider` accepts `colorScheme: 'light' | 'dark'` as a prop. The dashboard's `VxBridge` reads this from Mantine and passes it down. Inside any chart component:

```ts
import { useVxTheme } from '@argo/charts'

function MyChart() {
  const theme = useVxTheme()
  // theme.line, theme.axis, theme.tooltipBg, etc.
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
- **New semantic color or size?** Add to `tokens.ts`, not inline.

## Typecheck

```bash
bun run --cwd packages/charts typecheck
```
