# Garmin Health — Chart Authoring Convention

This directory holds one chart per file. The shell (`routes/garmin-health.tsx`)
has dropped `<Placeholder label="..." />` slots that you replace with the
actual chart import. Follow this contract so the swap is a one-line diff.

## Naming

| File                        | Default export        | Slot in route               |
| --------------------------- | --------------------- | --------------------------- |
| `activities-chart.tsx`      | `ActivitiesChart`     | CHART_SLOT: activities      |
| `activity-score-chart.tsx`  | `ActivityScoreChart`  | CHART_SLOT: activity-score  |
| `fitness-trends-chart.tsx`  | `FitnessTrendsChart`  | CHART_SLOT: fitness-trends  |
| `acwr-chart.tsx`            | `AcwrChart`           | CHART_SLOT: acwr            |
| `divergence-chart.tsx`      | `DivergenceChart`     | CHART_SLOT: divergence      |
| `recovery-trend-chart.tsx`  | `RecoveryTrendChart`  | CHART_SLOT: recovery-trend  |
| `sleep-breakdown-chart.tsx` | `SleepBreakdownChart` | CHART_SLOT: sleep-breakdown |
| `body-battery-chart.tsx`    | `BodyBatteryChart`    | CHART_SLOT: body-battery    |
| `stress-chart.tsx`          | `StressChart`         | CHART_SLOT: stress          |

## Component shape

Every chart is a default export with this signature:

```tsx
import type { SummaryParams } from '../types'

export default function MyChart({ params }: { params: SummaryParams }) {
  // 1. Query — call directly; route already prefetched in loader where possible.
  const { data } = useSuspenseQuery(dailyMetricsQueries.recoverySeries(params))

  // 2. ChartCard wrapper — never a raw Mantine Card; the contract lives in
  //    @argo/charts. Title + tooltip + optional extra slot.
  return (
    <ChartCard title="Recovery Trend" tooltip={METRIC_TOOLTIPS.recoveryScore}>
      {/* 3. Use existing kinds (ZonedLine, Bars) where possible. */}
    </ChartCard>
  )
}
```

## Query usage

Queries are already defined in `apps/dashboard/src/lib/queries/daily-metrics.ts`.
You should not need to add new ones for the existing endpoints:

- `dailyMetricsQueries.series(params)`
- `dailyMetricsQueries.recovery(params)`
- `dailyMetricsQueries.recoverySeries(params)`
- `dailyMetricsQueries.fitnessDirection(params)`
- `dailyMetricsQueries.trainingLoad(params)`
- `activitiesQueries.list(params)` — for the workouts stacked bar

Use `useSuspenseQuery` so the chart respects the route's `Suspense` boundary
(the shell will wrap each section in `Suspense` if needed). If a chart can
be skipped when data is null, fall back to `useQuery` and render nothing.

## Tokens & theme

- Import semantic colors from `@argo/charts` via `VX.good`, `VX.bad`, etc.
- Import per-metric colors from `VX.series.hrv`, `VX.series.restingHr`, etc.
- Theme-resolved neutrals come from `useVxTheme()` (line, axis, tooltipBg).
- **Never** hardcode hex literals in charts. Add to `tokens.ts` if a new
  semantic color is required.

## HoverContext registration

If your chart should sync crosshairs with other charts on the page, wire it
in via `useHoverSync(chartId, getX)`. The shell already wraps the page in
`<HoverContext.Provider>`. Use a stable `chartId` matching the chart name
(e.g. `'recovery-trend'`, `'acwr'`).

## Primitive contract — required

1. `ChartCard` wrapper (title + tooltip + headerExtra slot)
2. `ChartLegend` for any legend markup — never hand-rolled
3. `ChartTooltip` + `TooltipHeader` / `TooltipRow` / `TooltipBody`
4. `AxisLeftNumeric` / `AxisBottomDate` — never raw visx axes
5. `HoverOverlay` for mouse capture
6. `useChartTooltip` for tooltip open/close state

See `packages/charts/CLAUDE.md` for the full primitive reference.

## Replacing a slot

1. Implement `<chart-name>.tsx` here.
2. In `apps/dashboard/src/routes/garmin-health.tsx`, find the matching
   `{/* CHART_SLOT: <name> */}` comment and replace the adjacent
   `<Placeholder label="..." />` with `<MyChart params={params} />`.
3. Drop the `import { Placeholder } from '@/features/garmin-health'` once
   the last placeholder is gone (TypeScript will flag the unused import).

## Sample skeleton

```tsx
// apps/dashboard/src/features/garmin-health/charts/recovery-trend-chart.tsx
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChartCard, ZonedLine, VX, useVxTheme } from '@argo/charts'
import { useElementSize } from '@mantine/hooks'
import { dailyMetricsQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'

export default function RecoveryTrendChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(dailyMetricsQueries.recoverySeries(params))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { line } = useVxTheme()

  return (
    <ChartCard title="Recovery" tooltip={METRIC_TOOLTIPS.recoveryScore}>
      <div ref={ref} style={{ height: 240, width: '100%' }}>
        {width > 0 && (
          <ZonedLine
            data={data.points}
            width={Math.max(width, 200)}
            height={240}
            chartId="recovery-trend"
            getX={(d) => d.date}
            getY={(d) => d.recovery}
            yDomain={[0, 100]}
            zones={[
              { from: 70, to: 100, fill: VX.good },
              { from: 40, to: 70, fill: VX.warn },
              { from: 0, to: 40, fill: VX.bad },
            ]}
            seriesLabel="Recovery"
            formatValue={(v) => String(Math.round(v))}
          />
        )}
      </div>
    </ChartCard>
  )
}
```
