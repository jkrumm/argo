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
import { createSearchStore, field, type RangeWindow } from 'basalt-ui/state'
// The one feature import: the usage registry is a dependency-free leaf (as `series.ts` also reads it).
import {
  ACCOUNT_IDS,
  IU_KEYS,
  IU_KEY_IDS,
  PAYER_LABELS,
  USAGE_ACCOUNTS,
} from '../features/usage-tracking/accounts'

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

/**
 * The page tabs. `iu-sub` / `me-sub` are the retired per-subscription tabs: still accepted from an
 * old URL or stored value so they never read as unknown, then folded into `claude` with that account
 * selected by `migrateUsageSearch`. They are not offered as tabs.
 */
export const USAGE_VIEW_VALUES = ['overview', 'claude', 'iu-api', 'iu-sub', 'me-sub'] as const
/** The tabs a visitor can pick, in display order. */
export const USAGE_TAB_VALUES = ['overview', 'claude', 'iu-api'] as const
/** The measure: dollars at API prices (list value for the subs, spend for the API) or fresh tokens. */
export const USAGE_LENS_VALUES = ['cost', 'tokens'] as const
/** `payer` is the Claude Max tab's "by subscription"; the IU API tab, one wallet, never offers it. */
export const USAGE_GROUP_BY_VALUES = ['sub_tool', 'model_norm', 'project', 'payer'] as const
/** The Account control of the Claude Max tab: `all`, or one account id from the registry. */
export const USAGE_ACCOUNT_VALUES = ['all', ...ACCOUNT_IDS] as const
/** The IU API tab's Key control: `all` (one meter per key, never summed), or one key id from the registry. */
export const USAGE_IU_KEY_VALUES = ['all', ...IU_KEY_IDS] as const
/** The Routing section's own range: how many days of picker decisions it reads, independent of the page Range. */
export const USAGE_ROUTING_RANGE_VALUES = ['1d', '3d', '7d', '14d', '21d'] as const
export type UsageView = (typeof USAGE_VIEW_VALUES)[number]
export type UsageLens = (typeof USAGE_LENS_VALUES)[number]
export type UsageGroupBy = (typeof USAGE_GROUP_BY_VALUES)[number]
export type UsageAccount = (typeof USAGE_ACCOUNT_VALUES)[number]
export type UsageIuKey = (typeof USAGE_IU_KEY_VALUES)[number]
export type UsageRoutingRange = (typeof USAGE_ROUTING_RANGE_VALUES)[number]

export const usageStore = createSearchStore({
  key: 'usage-tracking',
  fields: {
    // The page tab: the combined overview, the Claude Max subscriptions together, or the IU API.
    view: field.enum(USAGE_VIEW_VALUES, 'overview'),
    // Scopes the whole Claude Max tab to one subscription; `all` compares and sums them.
    account: field.enum(USAGE_ACCOUNT_VALUES, 'all'),
    // Scopes the whole IU API tab to one API key; `all` shows every key side by side.
    iuKey: field.enum(USAGE_IU_KEY_VALUES, 'all'),
    // `field.enum`, not `field.range`: the API takes `range` verbatim and there is no custom
    // window here, so three params would be two more than the page can use.
    range: field.enum(['7d', '30d', '90d', 'all'], '30d'),
    grain: field.enum(['hour', 'day', 'week'], 'day'),
    workspace: field.multi(['work', 'private'], []),
    lens: field.enum(USAGE_LENS_VALUES, 'cost'),
    groupBy: field.enum(USAGE_GROUP_BY_VALUES, 'sub_tool'),
    // The Claude Max tab's Routing section: picker decisions over 1–21 days, apart from `range`.
    routingRange: field.enum(USAGE_ROUTING_RANGE_VALUES, '7d'),
  },
}).labels({
  view: {
    overview: 'Overview',
    claude: 'Claude Max',
    'iu-api': 'IU API',
    'iu-sub': 'Claude Max',
    'me-sub': 'Claude Max',
  },
  account: {
    all: 'All',
    ...Object.fromEntries(USAGE_ACCOUNTS.map((a) => [a.id, PAYER_LABELS[a.payer]] as const)),
  },
  iuKey: {
    all: 'All',
    ...Object.fromEntries(IU_KEYS.map((k) => [k.id, k.label] as const)),
  },
  range: { '7d': '7d', '30d': '30d', '90d': '90d', all: 'All' },
  grain: { hour: 'Hour', day: 'Day', week: 'Week' },
  workspace: { work: 'Work', private: 'Private' },
  lens: { cost: '$', tokens: 'Tokens' },
  groupBy: { sub_tool: 'Tool', model_norm: 'Model', project: 'Project', payer: 'Subscription' },
  routingRange: { '1d': '1d', '3d': '3d', '7d': '7d', '14d': '14d', '21d': '21d' },
})

/** The retired tabs and the account each one scoped to. */
const LEGACY_VIEW_ACCOUNT: Partial<Record<UsageView, UsageAccount>> = {
  'iu-sub': 'iu',
  'me-sub': 'me',
}

/**
 * Folds a retired per-subscription tab into the Claude Max tab with that account selected; every
 * other search passes through. A leftover account the registry no longer lists reads as `all`
 * already (the enum drops it).
 */
export function migrateUsageSearch<S extends { view: UsageView; account: UsageAccount }>(
  search: S,
): S {
  const account = LEGACY_VIEW_ACCOUNT[search.view]
  return account === undefined ? search : { ...search, view: 'claude', account }
}

/** The route's `validateSearch`: the store's, then the old tab values migrated. */
export const validateUsageSearch = (raw: Record<string, unknown>) =>
  migrateUsageSearch(usageStore.validateSearch(raw))

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
  fields: { view: field.enum(['agenda', 'week', 'month'], 'agenda') },
}).labels({ view: { agenda: 'Agenda', week: 'Week', month: 'Month' } })
