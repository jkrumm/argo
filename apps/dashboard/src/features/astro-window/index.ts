import { lazy } from 'react'

export {
  NIGHTS_OPTIONS,
  METRIC_TOOLTIPS,
  CHART_HEIGHT,
  PANORAMA_HEIGHT,
  SIDE_PANEL_HEIGHT,
  MAP_FULL_BLEED_HEIGHT,
  MAP_MIN_HEIGHT,
} from './constants'

export type {
  WindowParams,
  Verdict,
  Killer,
  Factor,
  ShootingWindow,
  Moon,
  Weather,
  Night,
  HourlyPoint,
  Location,
  Sources,
  WindowResponse,
  Site,
} from './types'

export {
  verdictTone,
  verdictLabel,
  fmtPercent,
  fmtPercent100,
  fmtDegrees,
  fmtMinutes,
  fmtWeekday,
  fmtDayLabel,
  fmtLocalClock,
  moonPhaseLabel,
  dataHealthLine,
  limitingFactor,
  killerLabel,
} from './formulas'

export {
  BASE_LAYER_IDS,
  BASE_LAYERS,
  DEFAULT_LP_YEAR,
  formatLpParam,
  formatTerrainParam,
  formatWeatherParam,
  LP_PARAM_VALUES,
  LP_YEARS,
  normaliseLayerState,
  parseLpParam,
  parseTerrainParam,
  parseWeatherParam,
  SCHEME_DEFAULT_BASE,
  WEATHER_LAYERS,
  type BaseLayerId,
  type LpYear,
  type MapLayerState,
  type TerrainSelection,
  type WeatherLayerId,
  type WeatherSelection,
} from './map-layers'

export { Section } from './section'

export { SiteSelector, type SiteSelectorProps } from './components/site-selector'
export { ViewTabs, type AstroView } from './components/view-tabs'
export { VerdictHero } from './components/verdict-hero'
export { NightStrip } from './components/night-strip'
export { NightFacts } from './components/night-facts'

// Lazy-loaded: maplibre-gl is ~253kB gzipped and this is the only page that uses it, so the
// bundle should only pay for it when this page is actually opened. The route wraps this in
// <Suspense fallback={<ChartEmpty .../>}>.
export const SiteMap = lazy(() => import('./components/site-map'))

export { default as NightTimelineChart } from './charts/night-timeline-chart'
export { default as CloudLayersChart } from './charts/cloud-layers-chart'
export { default as SkyPanorama } from './charts/sky-panorama'
export { default as MonthlyBudgetChart } from './charts/monthly-budget-chart'
export { ChartEmpty } from './charts/empty'
