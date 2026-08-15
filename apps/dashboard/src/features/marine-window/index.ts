import { lazy } from 'react'

export { DAYS_OPTIONS, METRIC_TOOLTIPS, CHART_HEIGHT, SIDE_PANEL_HEIGHT } from './constants'

export type {
  WindowParams,
  Verdict,
  WindKind,
  Killer,
  Factor,
  SessionWindow,
  Conditions,
  Day,
  HourlyPoint,
  Location,
  Sources,
  WindowResponse,
  MarineSpot,
} from './types'

export {
  verdictTone,
  verdictLabel,
  fmtPercent,
  fmtDegrees,
  fmtBearing,
  fmtMetres,
  fmtSeconds,
  fmtKnots,
  fmtMinutes,
  fmtWeekday,
  fmtDayLabel,
  windKindTone,
  windKindLabel,
  fmtWindLine,
  fmtSwellLine,
  fmtOffDeadOffshore,
  dataHealthLine,
  limitingFactor,
  killerTag,
} from './formulas'

export { Section } from './section'

export { SpotSelector, type SpotSelectorProps } from './components/spot-selector'
export { VerdictHero } from './components/verdict-hero'
export { DayStrip } from './components/day-strip'
export { DayFacts } from './components/day-facts'

// Lazy-loaded: maplibre-gl is ~253kB gzipped and this is the only page (besides Astro Window) that
// uses it, so the bundle should only pay for it when this page is actually opened. The route wraps
// this in <Suspense fallback={<ChartEmpty .../>}>.
export const SpotMap = lazy(() => import('./components/spot-map'))

export { default as SwellTimelineChart } from './charts/swell-timeline-chart'
export { default as WindChart } from './charts/wind-chart'
export { ChartEmpty } from './charts/empty'
