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
import { PAYER_LABELS, USAGE_PAYERS, type IuKeyId } from '../features/usage-tracking/accounts'
import { legacyNode, type LegacyView } from '../features/usage-tracking/flow-node'
// Dependency-free month helpers (a type-only import of the pinned finance contract).
import { MONTH_UNIVERSE, YEAR_UNIVERSE, monthLabel } from '../features/finance/lib/months'
// Pure, import-free of the app but for the pinned contract types: the models page's value sets.
import { CATALOG_SORT_KEYS, CREATOR_LABELS, CREATOR_VALUES } from '../features/models/model'

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
 * The page tabs, Flow (the default) and Explore. The rest are the v6 tab values: still accepted from an
 * old URL or stored value so they never read as unknown, then folded into Flow by `migrateUsageSearch`
 * (the subscription and key tabs select their node, Credits the IU pool). They are not offered as tabs.
 */
export const USAGE_VIEW_VALUES = [
  'flow',
  'explore',
  'overview',
  'claude',
  'iu-api',
  'credits',
  'iu-sub',
  'me-sub',
] as const
/** The tabs a visitor can pick, in display order. */
export const USAGE_TAB_VALUES = ['flow', 'explore'] as const
/** The measure: dollars at API prices (list value for the subs, spend for the API) or fresh tokens. */
export const USAGE_LENS_VALUES = ['cost', 'tokens'] as const
/** `payer` is Explore's "by payer"; the single-wallet views never offer it. */
export const USAGE_GROUP_BY_VALUES = ['sub_tool', 'model_norm', 'project', 'payer'] as const
/** Explore's Payer control: every payer the API derives, Athena team included (off by default, never in an "all"). */
export const USAGE_PAYER_VALUES = [...USAGE_PAYERS.map((p) => p.id), 'unknown'] as const
/** The subscription detail's Routing section's own range: how many days of picker decisions it reads, independent of the page Range. */
export const USAGE_ROUTING_RANGE_VALUES = ['1d', '3d', '7d', '14d', '21d'] as const
export type UsageView = (typeof USAGE_VIEW_VALUES)[number]
export type UsageLens = (typeof USAGE_LENS_VALUES)[number]
export type UsageGroupBy = (typeof USAGE_GROUP_BY_VALUES)[number]
/** An IU API key id: the shared scope helpers still name it so. */
export type UsageIuKey = IuKeyId
export type UsageRoutingRange = (typeof USAGE_ROUTING_RANGE_VALUES)[number]

export const usageStore = createSearchStore({
  key: 'usage-tracking',
  fields: {
    // The page tab: the money flow (default) or the analytics.
    view: field.enum(USAGE_VIEW_VALUES, 'flow'),
    // The Flow tab's selected node (`pool:iu`, `sub:me`, `key:personal`, `router`, `demand:review`);
    // empty is none. A string, not an enum: workflow names come from the data.
    node: field.string({ fallback: '' }),
    // `field.enum`, not `field.range`: the API takes `range` verbatim and there is no custom
    // window here, so three params would be two more than the page can use.
    range: field.enum(['7d', '30d', '90d', 'all'], '7d'),
    grain: field.enum(['hour', 'day', 'week'], 'day'),
    workspace: field.multi(['work', 'private'], []),
    // Explore only; empty = every payer except Athena team.
    payer: field.multi(USAGE_PAYER_VALUES, []),
    lens: field.enum(USAGE_LENS_VALUES, 'cost'),
    groupBy: field.enum(USAGE_GROUP_BY_VALUES, 'sub_tool'),
    // The subscription detail's Routing section: picker decisions over 1–21 days, apart from `range`.
    routingRange: field.enum(USAGE_ROUTING_RANGE_VALUES, '7d'),
  },
}).labels({
  view: {
    flow: 'Flow',
    explore: 'Explore',
    overview: 'Flow',
    claude: 'Flow',
    'iu-api': 'Flow',
    credits: 'Flow',
    'iu-sub': 'Flow',
    'me-sub': 'Flow',
  },
  range: { '7d': '7d', '30d': '30d', '90d': '90d', all: 'All' },
  grain: { hour: 'Hour', day: 'Day', week: 'Week' },
  workspace: { work: 'Work', private: 'Private' },
  payer: PAYER_LABELS,
  lens: { cost: '$', tokens: 'Tokens' },
  groupBy: { sub_tool: 'Tool', model_norm: 'Model', project: 'Project', payer: 'Payer' },
  routingRange: { '1d': '1d', '3d': '3d', '7d': '7d', '14d': '14d', '21d': '21d' },
})

const LEGACY_VIEWS: readonly LegacyView[] = [
  'overview',
  'claude',
  'iu-api',
  'credits',
  'iu-sub',
  'me-sub',
]

/**
 * Folds a v6 tab into Flow: the tab becomes `flow` and, when no node is chosen yet, selects the node
 * the tab stood for (`legacy` carries the old `account` / `iuKey` URL params, which the store no longer
 * declares). Every other search passes through.
 */
export function migrateUsageSearch<S extends { view: UsageView; node: string }>(
  search: S,
  legacy: { account?: unknown; iuKey?: unknown } = {},
): S {
  const old = LEGACY_VIEWS.find((v) => v === search.view)
  if (old === undefined) return search
  return {
    ...search,
    view: 'flow',
    node: search.node === '' ? legacyNode(old, legacy) : search.node,
  }
}

/** The route's `validateSearch`: the store's, then the old tab values migrated. */
export const validateUsageSearch = (raw: Record<string, unknown>) =>
  migrateUsageSearch(usageStore.validateSearch(raw), raw)

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

const monthLabels = Object.fromEntries(MONTH_UNIVERSE.map((m) => [m, monthLabel(m)]))
const yearLabels = Object.fromEntries(YEAR_UNIVERSE.map((y) => [y, y]))

/** The amount filter of the transactions page: spending and income in bands, each a closed range of cents. */
export const AMOUNT_BANDS = {
  '': 'Any amount',
  'out-100': 'Spent 100 € or more',
  'out-20': 'Spent 20 € to 100 €',
  'out-small': 'Spent under 20 €',
  in: 'Income and refunds',
} as const

/**
 * Every filter of the finance pages, one store so each route validates the same search shape and the
 * nav links carry it by reference. URL only (`persist: false`): the vault's numbers never go to
 * localStorage, not even a filter that hints at them. Only `month`, `from`, `to` and `year` ever show
 * in the address bar (`private-history.ts`); every other field lives in history state.
 *
 * - `month`: the budget month of the This-month page; `''` is the current one (the service decides).
 * - `from` / `to`: the month range. `''` is "unset": `from` then reads as the last 12 months of data
 *   and `to` as the latest month, both resolved from `/finance/api/meta` (`resolveRange`).
 * - `category` / `merchant` / `search` / `account` / `tag` / `amount` / `uncategorized` / `untagged`:
 *   the transaction filters; drill-downs link there with one set.
 * - `sort` / `dir` / `page` / `size`: the ledger's server-side order and page.
 * - `year`: the tax year, `''` reading as the year of the latest month.
 * - `focus`: the category row selected on the spending page; page-local.
 */
export const finStore = createSearchStore({
  key: 'finance',
  fields: {
    month: field.enum(['', ...MONTH_UNIVERSE], '', { persist: false }),
    from: field.enum(['', ...MONTH_UNIVERSE], '', { persist: false }),
    to: field.enum(['', ...MONTH_UNIVERSE], '', { persist: false }),
    category: field.string({ max: 120 }, { persist: false }),
    merchant: field.string({ max: 120 }, { persist: false }),
    search: field.string({ max: 120 }, { persist: false }),
    account: field.string({ max: 120 }, { persist: false }),
    tag: field.string({ max: 40 }, { persist: false }),
    amount: field.enum(['', 'out-100', 'out-20', 'out-small', 'in'], '', { persist: false }),
    uncategorized: field.boolean(false, { persist: false }),
    untagged: field.boolean(false, { persist: false }),
    sort: field.enum(['booked_on', 'amount', 'merchant'], 'booked_on', { persist: false }),
    dir: field.enum(['desc', 'asc'], 'desc', { persist: false }),
    page: field.number({ fallback: 0, min: 0, int: true }, { persist: false }),
    size: field.enum(['25', '50', '100'], '50', { persist: false }),
    year: field.enum(['', ...YEAR_UNIVERSE], '', { persist: false }),
    focus: field.string({ max: 120 }, { persist: false }),
  },
}).labels({
  month: { '': 'Current month', ...monthLabels },
  from: { '': 'Last 12 months', ...monthLabels },
  to: { '': 'Latest month', ...monthLabels },
  year: { '': 'Latest year', ...yearLabels },
  amount: AMOUNT_BANDS,
})

export type FinanceFilters = ReturnType<typeof finStore.useValues>

/** Every finance filter unset: the base an evidence link or a drill-down starts from. */
export const FILTERS_CLEARED: FinanceFilters = {
  month: '',
  from: '',
  to: '',
  category: '',
  merchant: '',
  search: '',
  account: '',
  tag: '',
  amount: '',
  uncategorized: false,
  untagged: false,
  sort: 'booked_on',
  dir: 'desc',
  page: 0,
  size: '50',
  year: '',
  focus: '',
}

/**
 * The models page. `callable` and `superseded` are the visibility filters (the defaults are the
 * uncluttered view: what the IU endpoint can call, without the models a newer one replaced); `creators`
 * narrows the field, empty meaning all. `pick` is the highlighted lineage, URL only so a link carries it.
 * `sort` / `dir` order the catalog.
 */
export const modelsStore = createSearchStore({
  key: 'models',
  fields: {
    callable: field.boolean(true),
    superseded: field.boolean(false),
    creators: field.multi(CREATOR_VALUES, []),
    pick: field.string({ max: 80 }, { persist: false }),
    sort: field.enum(CATALOG_SORT_KEYS, 'intelligence'),
    dir: field.enum(['asc', 'desc'], 'desc'),
  },
}).labels({
  creators: CREATOR_LABELS,
})
