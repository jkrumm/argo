/**
 * window-stores.ts — every page's search-param store, in a LEAF module.
 *
 * One `createSearchStore` per page (basalt-ui 1.26.0): typed fields over the URL, mirrored in
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
 * loader keeps its shape. `field.<name>.toWindow(v)` is the projection into query params; where the
 * API accepts fewer presets than the picker offers (garmin's `3m`/`1y`, strength's `3m`/`6m`/`1y`/
 * `ytd`, walking's `6m`/`1y`) the feature keeps a small `resolveWindow` that turns those into
 * `from`/`to` — `toWindow` cannot know which presets the backend refuses.
 */
import { createSearchStore, field } from 'basalt-ui/router-tanstack'

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
    window: field.range({ presets: GARMIN_WINDOW_VALUES, fallback: '30d', custom: true }),
  },
}).labels({
  window: { '7d': '7D', '30d': '30D', '3m': '3M', '1y': '1Y', all: 'All' },
})

export const strengthStore = createSearchStore({
  key: 'strength-tracker:window',
  fields: {
    window: field.range({ presets: STRENGTH_WINDOW_VALUES, fallback: 'all', custom: true }),
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
    window: field.range({ presets: WALKING_WINDOW_VALUES, fallback: '30d' }),
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
    // A STRING enum, not a number: there is no numeric filter control, and the three values are a
    // closed set. The query reads `Number(nights)`.
    nights: field.enum(['5', '10', '14'], '10'),
    // `field.string`, because the site catalogue is fetched (`astroQueries.sites()`) and its labels
    // carry live mag/drive figures — a closed enum cannot express either. `SelectFilter` takes the
    // runtime `options` catalogue for exactly this shape.
    site: field.string({ fallback: 'alpenvorland' }),
  },
}).labels({
  tab: { tonight: 'Tonight', map: 'Map', forecast: 'Forecast' },
  nights: { '5': '5N', '10': '10N', '14': '14N' },
})

export const calendarStore = createSearchStore({
  key: 'calendar',
  fields: { view: field.enum(['week', 'month'], 'week') },
}).labels({ view: { week: 'Week', month: 'Month' } })
