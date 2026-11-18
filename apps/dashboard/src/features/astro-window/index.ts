import { lazy } from 'react'

export { CHART_HEIGHT, PANORAMA_HEIGHT, MAP_FULL_BLEED_HEIGHT } from './constants'

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
  headlineFirstDate,
  headlineNight,
  markedNightOf,
  pageSummary,
  forecastView,
} from './formulas'

export {
  BASE_LAYER_IDS,
  DEFAULT_LP_YEAR,
  formatLpParam,
  formatTerrainParam,
  formatWeatherParam,
  parseLpParam,
  parseTerrainParam,
  parseWeatherParam,
  SCHEME_DEFAULT_BASE,
  type BaseLayerId,
  type LpYear,
  type MapLayerState,
  type TerrainSelection,
  type WeatherLayerId,
  type WeatherSelection,
} from './map-layers'

export { VerdictCard } from './components/verdict-card'
export { TonightTop } from './components/tonight-top'
export { NightStrip } from './components/night-strip'
export { NightAnatomy } from './components/night-anatomy'
export { ScoreCard } from './components/score-card'
export { UnknownSiteCard } from './components/unknown-site-card'
export { SourcesFooter } from './components/sources-footer'

// Lazy-loaded: maplibre-gl is ~253kB gzipped and this is the only page that uses it, so the
// bundle should only pay for it when this page is actually opened. The route wraps this in
// <Suspense fallback={<Center><Loader /></Center>}>.
export const SiteMap = lazy(() => import('./components/site-map'))

export { default as NightTimelineChart } from './charts/night-timeline-chart'
export { default as CloudLayersChart } from './charts/cloud-layers-chart'
export { default as SkyPanorama } from './charts/sky-panorama'
export { default as MonthlyBudgetChart } from './charts/monthly-budget-chart'
