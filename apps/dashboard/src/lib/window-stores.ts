/**
 * window-stores.ts — every page's search-param store, in a LEAF module.
 *
 * One `createSearchStore` per page (basalt-ui 1.27.0): typed fields over the URL, mirrored in
 * localStorage under `basalt:<key>`, resolved URL ⊳ localStorage ⊳ fallback. The route passes
 * `store.validateSearch` straight to `createFileRoute`, the controls take `store.field.<name>`, and
 * `lib/nav.tsx` hands the router `store.linkSearch` BY REFERENCE — so a page's default lives in
 * exactly one place and the nav link cannot disagree with the route.
 *
 * They live HERE, not in the feature, because `lib/nav.tsx` needs them too and is a leaf by
 * contract (no feature imports). The value tuples below are the single source for the type, the
 * control's options, the route's validator and the store's accepted set — a feature's `constants.ts`
 * re-exports them rather than restating them.
 *
 * A `field.range` owns THREE URL params (`window` + `from` + `to`), so every existing deep link and
 * loader keeps its shape. `field.<name>.toWindow(v)` is the projection into query params, and the
 * `window:` resolver map below is what makes it TOTAL: a preset the API's `WindowQuerySchema` does
 * not accept (garmin's `3m`/`1y`, strength's `3m`/`6m`/`1y`/`ytd`, walking's `6m`/`1y`) resolves to
 * explicit `from`/`to` dates at call time and is dropped from `toWindow`'s `{ window }` branch, so
 * the result assigns to the API param type with no cast. That retired the four per-feature
 * `resolveWindow` helpers.
 */
import { format, startOfYear, subMonths, subYears } from 'date-fns'
import { createSearchStore, field, type RangeWindow } from 'basalt-ui/router-tanstack'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/**
 * The date math the deleted `resolveWindow` helpers used to carry, now declared once per preset and
 * evaluated at `toWindow()` time — so a `3m` bookmark opened tomorrow means the last three months
 * from tomorrow, and the derived window never leaves the store.
 */
const monthsBack =
  (months: number): RangeWindow =>
  (now) => ({ from: iso(subMonths(now, months)), to: iso(now) })

const yearsBack =
  (years: number): RangeWindow =>
  (now) => ({ from: iso(subYears(now, years)), to: iso(now) })

const yearToDate: RangeWindow = (now) => ({ from: iso(startOfYear(now)), to: iso(now) })

/**
 * The ONE guard 1.27.0 leaves behind on a `custom: true` range.
 *
 * `toWindow` keeps `'custom'` in its `{ window }` branch by construction — a dateless `'custom'`
 * resolves there — and the API's window union has no such member. It cannot actually happen: the
 * range codec rejects `'custom'` without two ISO dates, so the field falls back before a page ever
 * reads it. This maps the unreachable branch onto the API's own default instead of writing a cast.
 */
export function toApiWindow<W extends string, F extends string>(
  resolved: { window: W | 'custom' } | { from: string; to: string },
  fallback: F,
): { window?: W | F; from?: string; to?: string } {
  if ('from' in resolved) return { from: resolved.from, to: resolved.to }
  return { window: resolved.window === 'custom' ? fallback : resolved.window }
}

export const GARMIN_WINDOW_VALUES = ['7d', '30d', '3m', '1y', 'all'] as const
export const STRENGTH_WINDOW_VALUES = ['7d', '30d', '3m', '6m', '1y', 'ytd', 'all'] as const
export const BODY_COMP_WINDOW_VALUES = ['7d', '30d', '90d', 'all'] as const
export const WALKING_WINDOW_VALUES = ['7d', '30d', '90d', '6m', '1y', 'all'] as const

/** Declared here rather than in the feature: `strengthStore` needs them and the feature's
 * `constants.ts` already imports this module, so stating them there would close a cycle. */
export const EXERCISE_KEYS = ['bench_press', 'deadlift', 'squat', 'pull_ups'] as const
export const WALKING_METRIC_KEYS = ['distance', 'duration', 'steps'] as const

export const garminStore = createSearchStore({
  key: 'garmin-health:window',
  fields: {
    window: field.range({
      presets: GARMIN_WINDOW_VALUES,
      fallback: '30d',
      custom: true,
      // The API accepts 7d / 30d / 90d / all; these two resolve to explicit dates.
      window: { '3m': monthsBack(3), '1y': yearsBack(1) },
    }),
  },
}).labels({
  window: { '7d': '7D', '30d': '30D', '3m': '3M', '1y': '1Y', all: 'All' },
})

export const strengthStore = createSearchStore({
  key: 'strength-tracker:window',
  fields: {
    window: field.range({
      presets: STRENGTH_WINDOW_VALUES,
      fallback: 'all',
      custom: true,
      window: {
        '3m': monthsBack(3),
        '6m': monthsBack(6),
        '1y': yearsBack(1),
        ytd: yearToDate,
      },
    }),
    // URL-only: which tab you were on is a property of the link, not of the browser.
    tab: field.enum(['charts', 'train', 'history'], 'charts', { persist: false }),
    exercises: field.multi(EXERCISE_KEYS, EXERCISE_KEYS),
  },
}).labels({
  window: {
    '7d': '7D',
    '30d': '30D',
    '3m': '3M',
    '6m': '6M',
    '1y': '1Y',
    ytd: 'YTD',
    all: 'All',
  },
  tab: { charts: 'Charts', train: 'Train', history: 'History' },
  exercises: {
    bench_press: 'Bench Press',
    deadlift: 'Deadlift',
    squat: 'Squat',
    pull_ups: 'Pull-ups',
  },
})

export const bodyCompStore = createSearchStore({
  key: 'body-composition:window',
  fields: {
    window: field.range({ presets: BODY_COMP_WINDOW_VALUES, fallback: '90d', custom: true }),
  },
}).labels({
  window: { '7d': '7D', '30d': '30D', '90d': '90D', all: 'All' },
})

export const walkingStore = createSearchStore({
  key: 'walking-pad',
  fields: {
    window: field.range({
      presets: WALKING_WINDOW_VALUES,
      fallback: '30d',
      window: { '6m': monthsBack(6), '1y': yearsBack(1) },
    }),
    // Local lane (`url: false`): the metric set formats the charts, it does not select data, so it
    // never earned a query param. Replaces the standalone `createPersistedState`.
    metrics: field.multi(WALKING_METRIC_KEYS, ['distance'], { url: false }),
  },
}).labels({
  window: {
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    '6m': 'Last 6 months',
    '1y': 'Last year',
    all: 'All time',
  },
  metrics: { distance: 'Distance', duration: 'Duration', steps: 'Steps' },
})

export const usageStore = createSearchStore({
  key: 'usage-tracking',
  fields: {
    // `field.enum`, not `field.range`: the API takes `range` verbatim and there is no custom
    // window here, so three params would be two more than the page can use.
    range: field.enum(['7d', '30d', '90d', 'all'], '30d'),
    grain: field.enum(['day', 'week'], 'day'),
    billing: field.multi(['max', 'iu', 'unknown'], []),
    workspace: field.multi(['work', 'private'], []),
    costGroupBy: field.enum(['source', 'machine', 'billing'], 'source'),
    tokensGroupBy: field.enum(['sub_tool', 'model_norm', 'project', 'source'], 'sub_tool'),
  },
}).labels({
  range: { '7d': '7d', '30d': '30d', '90d': '90d', all: 'All' },
  grain: { day: 'Day', week: 'Week' },
  billing: { max: 'Max', iu: 'IU', unknown: 'Unknown' },
  workspace: { work: 'Work', private: 'Private' },
  costGroupBy: { source: 'Source', machine: 'Machine', billing: 'Billing' },
  tokensGroupBy: {
    sub_tool: 'Tool',
    model_norm: 'Model',
    project: 'Project',
    source: 'Source',
  },
})

export const astroStore = createSearchStore({
  key: 'astro-window',
  fields: {
    tab: field.enum(['tonight', 'map', 'forecast'], 'tonight'),
    // A real NUMBER (basalt-ui 1.27.0 shipped `NumberFilter`): `?nights=10` stays numeric and
    // nothing downstream parses it. `min`/`max`/`int` live on the FIELD, so the control bounds its
    // own stepper and a hand-typed URL clamps.
    nights: field.number({ fallback: 10, int: true, min: 5, max: 14 }),
    // `field.string`, because the site catalogue is fetched (`astroQueries.sites()`) and its labels
    // carry live mag/drive figures — a closed enum cannot express either. `SelectFilter` takes the
    // runtime `options` catalogue for exactly this shape.
    site: field.string({ fallback: 'alpenvorland' }),
  },
}).labels({
  tab: { tonight: 'Tonight', map: 'Map', forecast: 'Forecast' },
})

export const calendarStore = createSearchStore({
  key: 'calendar',
  fields: { view: field.enum(['week', 'month'], 'week') },
}).labels({ view: { week: 'Week', month: 'Month' } })
