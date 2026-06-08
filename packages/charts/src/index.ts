export { VX } from './tokens'
export { VxThemeProvider, useVxTheme, type VxTheme } from './theme'
export { PALETTE_CSS } from './theme-vars'
export {
  BP,
  SERIES,
  ACTIVITY,
  USAGE_SOURCE,
  USAGE_BILLING,
  USAGE_OUTCOME,
  SEMANTIC,
  NEUTRAL,
  SURFACE,
  type ColorPair,
} from './palette'
export { HoverContext, DEFAULT_NO_OP_SET_HOVER, type HoverCtx } from './hover-context'

export { ChartCard } from './primitives/ChartCard'
export { ChartLegend, type LegendEntry } from './primitives/ChartLegend'
export {
  ChartTooltip,
  TooltipHeader,
  TooltipRow,
  TooltipBody,
  useTooltipStyles,
} from './primitives/ChartTooltip'
export { AxisBottomDate, AxisLeftNumeric, AxisRightNumeric } from './primitives/Axes'
export { HoverOverlay } from './primitives/HoverOverlay'
export { ZoneRects, type ZoneSpec } from './primitives/ZoneRects'
export { AreaGradient, areaFillUrl } from './primitives/AreaGradient'

export { useChartTooltip, type TooltipState } from './hooks/useChartTooltip'
export { useHoverSync } from './hooks/useHoverSync'

export { fmtAxisDate, fmtTooltipDate } from './utils/format'
export { smartTicks } from './utils/ticks'
export { alpha } from './utils/color'

export {
  ZonedLine,
  type ZonedLineProps,
  type ZonedLineZone,
  type ZonedLineThreshold,
  type ZonedLineRefLine,
  type ZonedLineTooltipLabel,
} from './kinds/ZonedLine'

export {
  Bars,
  type BarsProps,
  type BarsBar,
  type BarsLine,
  type BarsZone,
  type BarsRefLine,
  type BarsAxisConfig,
} from './kinds/Bars'

export { StackedArea, type StackedAreaProps } from './kinds/StackedArea'
export { Donut, type DonutProps, type DonutDatum } from './kinds/Donut'

export { LineSparkline, BarSparkline } from './sparklines'

// ── Re-exported visx primitives ──────────────────────────────────────────
// Bespoke charts (genuinely unique compositions per CLAUDE.md) need raw
// visx primitives. Re-exporting from @argo/charts keeps the dependency
// declared in one place and preserves the rule that the dashboard only
// imports from @argo/charts.
export { Group } from '@visx/group'
export { GridRows, GridColumns } from '@visx/grid'
export { scaleLinear, scaleBand, scalePoint, scaleTime } from '@visx/scale'
export { LinePath, Bar, AreaClosed, BarStack, BarGroup, Line } from '@visx/shape'
export { Threshold } from '@visx/threshold'
export {
  curveMonotoneX,
  curveLinear,
  curveCatmullRom,
  curveStepAfter,
  curveBasis,
} from '@visx/curve'
