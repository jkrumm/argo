---
paths:
  - apps/dashboard/**
---

# Charts — Argo Deltas

Delta over `.claude/rules/basalt-charts.md`.

Every chart is a default-exported `({ params })` component reading `useSuspenseQuery` from a
factory in `src/lib/queries/<resource>.ts`, mounted by the route inside `<Suspense fallback={<ChartCard state={{ pending: true }}
placeholderHeight={N} />}>`. Empty state goes on `ChartCard`'s `state`
prop (`state={{ empty: … }}`); `chartId` matches the file name. Series colours are registered in
`src/lib/series.ts` (`SERIES`), copy lives in each feature's `constants.ts` (`METRIC_TOOLTIPS`),
math in its `formulas.ts`. The one argo-specific `hand-rolled-plot` waiver (beyond basalt's own
DualPanel/MirroredBars/BandStrip exceptions) is `features/astro-window/charts/sky-panorama.tsx`
(continuous azimuth x) — a new waiver needs the same file-scoped justification.

## Query inventory

- `src/lib/queries/daily-metrics.ts`: `dailyMetricsQueries.{series,recovery,recoverySeries,
fitnessDirection,trainingLoad}(params)`, `activitiesQueries.list(params)` (workouts stacked bar).
- `src/lib/queries/strength.ts`: `strengthQueries.{heroes,seriesDetailed,weeklyVolume,
trainingLoad,records,relativeProgression,sparklines,readiness,alignment,deloadSignal}(params)`,
  `strengthQueries.composite({ exercise_id, window?, from?, to? })`.
