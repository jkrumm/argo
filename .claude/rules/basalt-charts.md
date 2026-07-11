---
source: basalt-ui
description: visx chart conventions — compose basalt-ui primitives/kinds, stay Mantine-free, and keep all color in `--vx-*` tokens. Enforced by the oxlint `@visx` ban.
paths:
  - 'src/**/charts/**'
  - 'apps/**/charts/**'
  - 'packages/**/charts/**'
---

# Basalt Charts — visx Conventions

basalt-ui owns the chart doctrine. Charts are built from low-level [visx](https://airbnb.io/visx)
primitives so we can build exactly the chart we want; the trade-off is that every chart duplicates
structure unless we compose shared building blocks. **The primitives + a small kind set are the
contract, not optional polish.**

## The boundary (lint-enforced)

The shipped oxlint preset (`basalt-ui/configs/oxlint.json`) enforces two hard rules — they hold in
downstream apps too:

- **`@visx/*` may only be imported inside a `**/charts/**` directory.** Everywhere else, compose
  basalt-ui chart primitives/kinds. If you need a raw visx primitive for a bespoke chart, import it
  from `basalt-ui/charts` (it re-exports `Group`, `LinePath`, `Bar`, `AreaClosed`, `scaleLinear`,
  `curveMonotoneX`, …) — keep the dependency declared in one place.
- **`@visx/tooltip` is banned everywhere.** Use `ChartTooltip` + `TooltipHeader`/`TooltipRow`/
  `TooltipBody` from `basalt-ui/charts`.
- **The `src/charts/` tree must be Mantine-free** — no `@mantine/*` imports. Bridge the Mantine
  color scheme to charts in exactly one file (see basalt-mantine.md, the VxBridge pattern); route
  components import chart primitives directly from `basalt-ui/charts`, never from the bridge file.

## Every chart has

1. **ChartCard** wrapper — gives title + info-tooltip + extra slot, consistent margin.
2. **ChartLegend** — never hand-rolled legend markup. Supports `line | bar | split | splitLine`
   shapes and optional highlight state.
3. **ChartTooltip** + `TooltipHeader` + `TooltipRow` + `TooltipBody` — never `@visx/tooltip` directly.
4. **AxisLeftNumeric** / **AxisRightNumeric** + **AxisBottomDate** — never raw `<AxisLeft>`/`<AxisBottom>`/`<AxisRight>`
   (they miss theme tokens + smart ticks). Enforced by `basalt check-theme` (`raw-visx-axis` guard
   fails the build on a raw axis in a `/charts/` file; escape via `theme-allow`), not just convention.
5. **HoverOverlay** for mouse capture, **HoverContext** for cross-chart crosshair sync,
   **useChartTooltip** for tip state, **useHoverSync** for the shared cursor. Wrap a group of
   date-aligned charts in **ChartHoverSync** (from `basalt-ui/charts`) to activate cross-chart sync —
   hovering one chart casts a ghost crosshair on all siblings; without it `useHoverSync` runs
   per-chart only and logs a dev warning:

   ```tsx
   <ChartHoverSync>
     <ChartCard>…</ChartCard>
     <ChartCard>…</ChartCard>
   </ChartHoverSync>
   ```

6. **Theme-aware colors** via `VX.*` tokens + `alpha()`. **Never** a raw hex literal in a chart file.
   **Never** `localStorage.getItem('theme')` — the scheme resolves via CSS vars (see Dark/light below).

**Exemption:** sparklines (`LineSparkline`, `BarSparkline` — tiny inline charts with no legend/tooltip)
don't have to compose ChartCard/ChartLegend/ChartTooltip — but still use `VX.*` tokens.

## Kinds — the recurring shapes

basalt-ui ships these kinds (declarative props, generic over your point type via `getX`/`getY`):

- **`ZonedLine`** — a line with zone bands, thresholds, and reference lines.
- **`Bars`** — bars with optional overlaid line, zones, ref lines, dual-axis config.
- **`StackedArea`** — opaque stacked bands.
- **`Donut`** — proportional donut.
- **`MultiLine`** — N series on a shared y-axis: legend-hover dimming, per-series synced dots,
  dashed companion (MA) lines, per-point markers (PR stars / status dots), zones + refLines, fixed
  or auto domain (covers z-score/σ via a fixed symmetric domain + zero refLine).
- **`DualPanel`** — top line-pane + bottom signed-histogram pane sharing one x-scale and one cursor;
  optional fill-between two top lines, zones, refLines.
- **`Heatmap`** — category×category intensity grid (`color-mix` alpha), per-cell tooltip, optional
  gradient legend strip.

How to add a chart:

1. **Fits an existing kind?** Use it. Pass `data`, `width`, `height`, `chartId`, accessors, and the
   declarative zones/thresholds/refLines arrays.
2. **Second instance of a new recurring shape?** Extract a kind and migrate both call sites
   (Rule of Three: don't extract on the first, don't wait past the third). Bespoke escape hatches
   (`renderExtraTooltipRows`, etc.) are fine but must not grow into god-object configs.
3. **Genuinely unique (e.g. a dual-panel MACD)?** Stay bespoke — compose the primitives + the raw
   visx re-exports directly. Keep it in the page's chart file, not in a shared kind.

**Anti-pattern:** a single `<Chart type="..." config={...} />` that switches by kind. Prefer N small kinds.

## Series color

App-specific series colors are _your_ domain data, not framework data. Declare them once:

```ts
import { defineSeries, groupTokens } from 'basalt-ui/tokens'

const SERIES = defineSeries({
  load: { light: '#…', dark: '#…' },
  recovery: { light: '#…', dark: '#…' },
})
const tokens = groupTokens('series', SERIES) // → { load: 'var(--vx-series-load)', ... }
```

Emit the CSS via `buildPaletteCss({ groups: { 'series-': SERIES } })`. A hue keeps its identity but
shifts shade across schemes — that's why each entry is a `{ light, dark }` pair, not a single value.
**Adding a new color** means adding a pair to your series map and rebuilding the palette CSS — never
inline a hex in a chart.

## Dark/light mode

Theme reactivity is **pure CSS**: the `--vx-*` variables are redeclared under the light/dark color
scheme, so toggling the scheme restyles every chart with no React re-render. Charts read `VX.*` (var
refs) directly. Don't branch on color scheme in JS; never read `localStorage.getItem('theme')`.

## Area gradients

Use the `AreaGradient` primitive (a vertical `<linearGradient>` of `color-mix` stops over a `--vx-*`
color) with the global strength knobs (`--vx-area-top` / `--vx-area-bottom`). Default the fill **on**
for plain metric lines, **off** when the chart already carries zone/threshold fills (avoid double-fill
clutter). Keep stacked-area bands opaque — fading them leaks lower bands.

## Responsive sizing

Use `ResponsiveChart` (render-prop container) or `useChartSize` (hook) from `basalt-ui/charts` —
both are backed by `@visx/responsive`'s `useParentSize` and keep the `@visx/*` import inside
`src/charts/**` per the boundary rule. Never reach for `@visx/responsive` directly or
`useElementSize` from `@mantine/hooks` in a chart file.

```tsx
import { ResponsiveChart, Bars } from 'basalt-ui/charts'

// Preferred: render prop, renders nothing until the first measurement
<ResponsiveChart height={320}>
  {({ width, height }) => (
    <Bars width={width} height={height} data={data} chartId="load" getX={…} getY={…} />
  )}
</ResponsiveChart>

// aspectRatio variant: height = width / ratio
<ResponsiveChart aspectRatio={16 / 9}>
  {({ width, height }) => <MyChart width={width} height={height} />}
</ResponsiveChart>
```

Use `useChartSize` directly when you need the `ref` on a custom container:

```ts
import { useChartSize } from 'basalt-ui/charts'

const { ref, width, height } = useChartSize()
// attach ref to your container div; width/height update via ResizeObserver
```

`ResponsiveChartProps`: `height` (default 240), `aspectRatio`, `debounceMs` (default 0), `children`.
`UseChartSizeResult`: `{ ref, width, height }`.

## Rule of thumb

> If the new chart doesn't fit the primitives, add a kind — don't loosen the primitives.
