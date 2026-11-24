/**
 * PINNED CONTRACT — copied verbatim from the finances repo, `src/api/types.ts` @ 670e8dd
 * (~/SourceRoot/finances, `fin serve`; the file last changed in a68675a). The API is
 * `/api/finance/*` here and `/api/*` on the service. Re-copy when that file changes; do not edit the
 * types below by hand. Service status/sync types live in `./status.ts` (from the service contract,
 * finances `docs/service.md`).
 */
/**
 * The API contract of `fin serve` (docs/dashboard.md, docs/service.md, docs/data-model.md §3). Rows are the view rows
 * as the server selects them, so column names stay snake_case. Amounts are integer cents, months
 * `YYYY-MM`; income is positive, spending negative, as booked. The server imports these types.
 *
 * Every `month` of an aggregate (cashflow, category, merchant, report, forecast, month detail, `from`/`to`) is a BUDGET month: the
 * calendar month, except that a salary booked on the 20th or later (`income/salary`) counts for the next one. A booking's own
 * `booked_on` and `TxRow.month` stay the calendar values. The write types at the end are `fin serve` only.
 */

/** `YYYY-MM`. */
export type Month = string

export type CategoryKind = 'income' | 'expense' | 'transfer' | 'saving'

export type AccountKind = 'giro' | 'savings' | 'depot' | 'loan' | 'broker' | 'wallet' | 'other'

/** `accounts` without the IBAN. */
export type Account = {
  id: string
  institution: string
  kind: AccountKind
  name: string
  currency: string
}

export type Category = {
  /** `food/groceries`; the parent is the text before the last `/`. */
  id: string
  label: string
  kind: CategoryKind
}

/** `GET /api/meta` */
export type Meta = {
  first_month: Month | null
  last_month: Month | null
  accounts: Account[]
  categories: Category[]
}

/** `v_tx` */
export type TxRow = {
  id: string
  account_id: string
  /** `YYYY-MM-DD`, the day the bank booked it. */
  booked_on: string
  /** Calendar month of `booked_on`. */
  month: Month
  /** Month the booking counts for: `month`, except a salary booked on the 20th or later, which counts for the next month. */
  budget_month: Month
  amount_cents: number
  counterparty: string | null
  purpose: string | null
  merchant: string | null
  /** NULL when uncategorized. */
  category: string | null
  /** Where the category came from: a rule, a tax tag, a PayPal pair, or someone (`manual`, `llm`). NULL when uncategorized. */
  category_source: 'rule' | 'manual' | 'llm' | 'tag' | 'pair' | null
  /** NULL when uncategorized. */
  category_kind: CategoryKind | null
  top_category: string | null
  tax_tag: string | null
  /** NULL when untagged. */
  tag_source: 'rule' | 'manual' | 'llm' | null
  /** The tag's note (why it is business, ...). */
  note: string | null
  /** NULL when the booking belongs to no event (trip, shared cost). */
  event_id: string | null
  event_label: string | null
  /** 1 when the category is a committed monthly cost; 0 otherwise or uncategorized. */
  fixed: 0 | 1
  /** The other leg of a transfer (PayPal funding and its bank row); NULL when unpaired. */
  pair_id: string | null
  pair_account_id: string | null
}

/** `v_cashflow_monthly` */
export type CashflowMonth = {
  month: Month
  income_cents: number
  /** Negative: kind expense or uncategorized, refunds net out. */
  expense_cents: number
  net_cents: number
  invested_cents: number
  transfer_cents: number
  /** `net / income`; NULL when the month has no income. */
  savings_rate: number | null
}

/** `v_category_monthly` */
export type CategoryMonth = {
  month: Month
  /** NULL for the uncategorized group of the month. */
  category: string | null
  top_category: string | null
  kind: CategoryKind
  amount_cents: number
  n: number
}

/** `v_merchant_monthly` summed over a range. */
export type MerchantTotal = {
  merchant: string
  /** NULL when the merchant's bookings are uncategorized. */
  top_category: string | null
  amount_cents: number
  n: number
}

export type Cadence = 'monthly' | 'quarterly' | 'yearly'

export type RecurringKind = 'subscription' | 'bill'

export type RecurringStatus = 'active' | 'cancelled'

export type RecurringMode = 'include' | 'exclude'

/** A manual say on the detection (`recurring_overrides`). */
export type RecurringOverride = {
  merchant: string
  mode: RecurringMode
  /** Only with `include`: the cadence to assume; NULL = the detected one, else monthly. */
  cadence: Cadence | null
  note: string | null
  /** ISO timestamp. */
  updated_at: string
}

/**
 * One recurring charge series (`GET /api/recurring`, `fin tx recurring list`), detected per booking, not per month. A merchant that
 * is charged twice on the same days for similar amounts (two seats of one service) is TWO rows: `series` 1..`series_count`.
 * Money is negative, like the bookings.
 */
export type RecurringRow = {
  merchant: string
  /** Category of the latest charge. */
  category: string | null
  /** 1-based number of this series among the merchant's parallel series. */
  series: number
  series_count: number
  cadence: Cadence
  /** Median days between consecutive charges (the nominal 30 / 91 / 365 when forced by an override or too few charges). */
  cadence_days: number
  /** `subscription`: the amount stays put (steps allowed, one per six charges or so); `bill`: it varies (electricity, telecom). */
  kind: RecurringKind
  /** `active` while today is at most 10 (monthly), 21 (quarterly) or 45 (yearly) days past `next_expected_on`, else `cancelled`. */
  status: RecurringStatus
  /** Regular charges in the series (settlements and extras not counted). */
  count: number
  /** `YYYY-MM-DD` of the first and the latest regular charge. */
  first_on: string
  last_on: string
  /** Latest regular charge. */
  current_cents: number
  /** Mean of the regular charges within 12 months before `last_on`. */
  avg_cents: number
  min_cents: number
  max_cents: number
  /** Monthly estimate: current_cents (subscription) or avg_cents (bill), times 1 / 1/3 / 1/12 by cadence. Settlements are not in it. */
  monthly_cents: number
  /** `YYYY-MM-DD`; last_on plus one cadence step (1 / 3 / 12 months). NULL when cancelled. */
  next_expected_on: string | null
  /** Charges above 3x the instalment's median (a yearly electricity settlement), listed apart and left out of every number above. */
  settlements: { booked_on: string; amount_cents: number }[]
  /** Other charges of the merchant off the instalment's day of the month (irregular top-ups), listed apart and left out of every number. */
  extras: { booked_on: string; amount_cents: number }[]
  /** The override applied, if any. */
  override: Pick<RecurringOverride, 'mode' | 'cadence' | 'note'> | null
}

/** `GET /api/recurring/overrides` */
export type RecurringOverrides = RecurringOverride[]

/** `v_net_worth_monthly` */
export type NetWorthMonth = {
  month: Month
  cash_cents: number
  /** NULL without `holdings`. */
  depot_cents: number | null
  total_cents: number
  /** 1 when a cash account's balance this month is statement + later bookings (may miss bookings not imported yet). */
  extrapolated: 0 | 1
}

/** `v_balance_monthly` */
export type BalanceMonth = {
  month: Month
  account_id: string
  /** Month-end balance: the nearest statement plus (or minus, before the first one) the bookings in between. */
  balance_cents: number
  /** Date of the statement the balance is anchored on. */
  last_statement_on: string
  /** 1 when the month end is after the account's latest statement. */
  extrapolated: 0 | 1
}

/** `GET /api/overview?from&to` */
export type OverviewTotals = {
  income: number
  expense: number
  net: number
  invested: number
  /** `net / income` over the range; NULL when the range has no income. */
  savings_rate: number | null
}

export type Overview = {
  months: CashflowMonth[]
  totals: OverviewTotals
  latest_net_worth: NetWorthMonth | null
}

/** One account's month-end values, oldest first: bank balances for cash accounts, the depot value (`holdings`) for a depot. */
export type AccountSeries = {
  account_id: string
  name: string
  kind: AccountKind
  series: { month: Month; balance_cents: number; extrapolated: 0 | 1 }[]
}

/** `GET /api/net-worth` (calendar months: a month end is a month end). */
export type NetWorth = {
  net_worth: NetWorthMonth[]
  /** Cash accounts only, as `v_balance_monthly`. */
  balances: BalanceMonth[]
  /** Every account with data, cash and depot, for a per-account chart. */
  accounts: AccountSeries[]
}

/** A depot position as of the account's latest import. */
export type Holding = {
  account_id: string
  as_of: string
  isin: string
  name: string | null
  /** Decimal string: units can be fractional. */
  quantity: string
  price_cents: number | null
  value_cents: number | null
  currency: string
}

/** `GET /api/holdings` */
export type Holdings = {
  /** Latest `as_of` over all depots; NULL without holdings. */
  as_of: string | null
  /** Largest value first. */
  positions: Holding[]
  /** Total depot value per import day, oldest first. */
  history: { as_of: string; value_cents: number }[]
}

/** `GET /api/tax-year?year`: one row per tax tag (NULL = untagged) and month of that year. */
export type TaxYearRow = {
  tax_tag: string | null
  month: Month
  amount_cents: number
  n: number
}

/** Query of the range endpoints. */
export type RangeQuery = { from: Month; to: Month }

export type TxSort = 'booked_on' | 'amount' | 'merchant'

/** `GET /api/transactions` query; every field optional. `category`/`merchant`/`event` also take `__none__` (the NULL rows). */
export type TxQuery = {
  /** Budget months, inclusive. */
  from?: Month
  to?: Month
  account?: string
  /** A category id also selects its children. */
  category?: string
  tag?: string
  merchant?: string
  /** Case-insensitive substring of counterparty, purpose or merchant. */
  search?: string
  /** An event id; the server keeps that event's bookings. */
  event?: string
  /** Signed cents, inclusive (spending is negative). */
  min?: number
  max?: number
  /** `1`: only bookings without a category / without a tax tag. */
  uncategorized?: 1
  untagged?: 1
  /** Default `booked_on`. */
  sort?: TxSort
  /** Default `desc`. */
  dir?: 'asc' | 'desc'
  offset?: number
  /** 1..500, default 100. */
  limit?: number
}

/** `GET /api/transactions`: `total` counts all matches, `rows` is the requested page. */
export type TxList = { rows: TxRow[]; total: number }

/** `GET /api/merchants` */
export type MerchantQuery = RangeQuery & { category?: string }

// ---- Insights v2 (docs/insights.md) ----

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

/** One sentence of the report; `link` points at the evidence (route + search params). */
export type ReportSentence = {
  id: string
  tone: Tone
  text: string
  link: { to: string; search?: Record<string, string> } | null
}

export type PeriodFacts = {
  from: Month
  to: Month
  income_cents: number
  expense_cents: number
  net_cents: number
  regular_net_cents: number
  one_off_cents: number
  savings_rate: number | null
  months: number
  loss_months: number
}

export type FixedCost = {
  category: string
  label: string
  /** Current monthly value (negative). */
  monthly_cents: number
}

export type FixedFacts = {
  items: FixedCost[]
  total_cents: number
  typical_income_cents: number
  /** total / typical income, 0..1 */
  share_of_income: number | null
  /** typical income + total fixed (fixed is negative). */
  free_budget_cents: number
  typical_variable_cents: number
}

export type CategoryDelta = {
  top_category: string | null
  amount_cents: number
  typical_cents: number
  delta_cents: number
  /** Last 12 months of this category, oldest first, for a sparkline. */
  trend: { month: Month; amount_cents: number }[]
}

export type LossMonth = {
  month: Month
  net_cents: number
  regular_net_cents: number
  one_off_cents: number
  cause: string
}

export type Lever = {
  top_category: string
  typical_monthly_cents: number
  top_merchants: { merchant: string; monthly_cents: number }[]
  /** Yearly effect of a 20 % cut, positive. */
  cut20_yearly_cents: number
}

export type ForecastMonth = {
  month: Month
  low_cents: number
  mid_cents: number
  high_cents: number
}

export type Forecast = {
  months: ForecastMonth[]
  income_cents: number
  fixed_cents: number
  variable_low_cents: number
  variable_mid_cents: number
  variable_high_cents: number
  latest_balance_cents: number
  year_end: { month: Month; low_cents: number; mid_cents: number; high_cents: number }
}

/** `GET /api/report?from&to` */
export type Report = {
  period: PeriodFacts
  months: CashflowMonthV2[]
  fixed: FixedFacts
  categories: CategoryDelta[]
  loss_months: LossMonth[]
  levers: Lever[]
  cash_share: number | null
  subscriptions_monthly_cents: number
  forecast: Forecast
  sentences: ReportSentence[]
}

/** `v_cashflow_monthly` v6 columns. */
export type CashflowMonthV2 = CashflowMonth & {
  fixed_cents: number
  variable_cents: number
  one_off_cents: number
  regular_net_cents: number
}

export type EventTotal = {
  event_id: string
  label: string
  first_day: string
  last_day: string
  paid_cents: number
  reimbursed_cents: number
  net_cents: number
  n: number
}

/** `GET /api/month?month` */
export type MonthDetail = {
  month: Month
  cashflow: CashflowMonthV2
  categories: CategoryDelta[]
  largest: TxRow[]
  events: EventTotal[]
  cause: string
}

// ---- Month status (docs/insights.md §Month status) ----

/** `GET /api/month-status?month` */
export type MonthStatus = {
  /** The budget month. Default: today's calendar month, or the next one once its salary is booked (from the 20th). */
  month: Month
  /** `YYYY-MM-DD`, the server's local day. */
  today: string
  days_total: number
  /** Days from today (inclusive) to the month end; 0 once the month is over, `days_total` before it starts. */
  days_left: number
  /** Income booked so far in this budget month (positive). */
  income_cents: number
  /** Expenses booked so far, events included (negative). */
  spent_cents: number
  /** Active recurring charges not yet booked this month whose expected day falls in it, nothing for a past month. */
  fixed_due: { merchant: string; expected_on: string; amount_cents: number }[]
  /** Sum of `fixed_due` (negative). */
  fixed_due_cents: number
  /** Average daily variable spend of the last 3 complete budget months (negative) times `days_left`. */
  variable_projection_cents: number
  /** income + spent + fixed_due + variable projection. */
  projected_end_cents: number
  /** What can still be spent per day (today included) to end at 0 or more, floored at 0; NULL while no income is in or no day is left. */
  daily_budget_cents: number | null
  /** Expenses booked in the previous budget month up to the same day of the month (negative). */
  last_month_same_day: { spent_cents: number }
}

// ---- Writes: `fin serve` only (docs/service.md) ----

/** `pattern` is stored normalized (lowercase tokens); `changed` = bookings whose merchant, category or source changed. */
export type AddMerchantRuleResponse = { pattern: string; changed: number }

// ---- Chart page: market, depot, drawings (docs/service.md, docs/market.md) ----

/** Daily, weekly and monthly bars only: intraday candles are not kept. */
export type MarketInterval = '1d' | '1w' | '1mo'

/**
 * `GET /api/market/watchlist`. Answers while the service is locked. The USD coin listing (`BTC-USD`) follows the watchlist once it has bars or an
 * instrument is charted as it; `BTC-EUR` is not listed. An instrument charted as a coin (`fin market watch add <ISIN> --chart-as BTC-USD`) has no row
 * of its own: it is listed in `instruments` of the coin's row.
 */
export type WatchlistEntry = {
  /** An ISIN, or a coin symbol. */
  isin: string
  name: string | null
  kind: string | null
  currency: string | null
  last_close: number | null
  /** The day of `last_close`, `YYYY-MM-DD`. */
  last_day: string | null
  first_day: string | null
  /** `last_close` minus the close of the bar before it; null with fewer than two bars. */
  day_change: number | null
  /** `day_change` as a fraction of the previous close (0.012 = +1.2 %). */
  day_change_pct: number | null
  /** MIC of the stored US listing (USD), which `candles` reads with `mic=`; null when there is none. */
  us_mic: string | null
  /** The watchlist ISINs whose trades belong on this chart: the row's own ISIN, or the ISINs charted as this coin (a Bitcoin ETP); empty for a coin nothing is charted as. Held or not follows from `/api/depot/positions`. */
  instruments: string[]
  /** The coin symbol this instrument is charted as (a Bitcoin ETP on `BTC-USD`), or null. */
  chart_as: string | null
  /** The series id of the index an ETF tracks (`ftse-global-all-cap-usd`): `candles?splice=index` puts its history before the ETF's first bar. Null for anything else. */
  index: string | null
}

/** One entry of a list. `symbol` is an ISIN, a coin symbol (`BTC-USD`) or a series id; `quote` is its row as `/api/market/watchlist` gives it (a series: `kind: 'index'`, the last two levels). */
export type WatchListEntry = {
  symbol: string
  /** The name the user gave this entry in this list, or null. */
  display_name: string | null
  /** 0-based, contiguous. */
  position: number
  added_at: string
  quote: WatchlistEntry
}

/** `GET /api/market/lists` and the answer of every list write. Answers while the service is locked. */
export type WatchList = {
  id: number
  name: string
  /** 0-based, contiguous. */
  position: number
  /** `fin market watch add` puts an ISIN on it; it cannot be deleted. */
  is_default: boolean
  entries: WatchListEntry[]
}

/** `GET /api/market/search?q=&limit=`: instruments, coins and stored series that match, exact matches first. The store only: no outbound request. */
export type SearchHit = {
  kind: 'instrument' | 'coin' | 'series'
  /** What a list entry is keyed by. */
  symbol: string
  name: string | null
  wkn: string | null
  /** Ticker of the US listing. */
  ticker: string | null
  detail: string | null
}

/** One bar. `time` is epoch seconds, UTC: midnight of the day for 1d, the first day of the week or month for 1w and 1mo. */
export type ChartBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  units: number | null
  turnover: number | null
  /** `'index'` on a bar that comes from the tracked index (flat: open = high = low = close), absent on the instrument's own bars. */
  source?: 'index'
}

/**
 * `GET /api/market/candles?isin=&interval=&from=&to=&limit=&splice=index&sys=&mic=`. `from` and `to` are days (`YYYY-MM-DD`). With no `limit` every stored bar of
 * the range comes back, up to 20,000 (`400` above). `limit` gives the newest bars of the range, ascending; page older ones with `to` = the day before the first.
 */
export type CandlesResponse = {
  isin: string
  interval: MarketInterval
  currency: string | null
  /** Set for a US listing. */
  mic: string | null
  candles: ChartBar[]
  /** Only with `limit`: bars older than the first one returned are stored; ask again with `to` = the day before it. */
  more: boolean
  /** The series id of the index spliced in (`splice=index`), or null. */
  index: string | null
  /** Why the answer is short or partly from another source, in words. */
  notes: string[]
}

/** `GET /api/market/series` without `id`: every series with what the store holds. */
export type SeriesInfo = {
  id: string
  title: string
  unit: string
  frequency: 'daily' | 'monthly'
  first_day: string | null
  last_day: string | null
  points: number
}

/** `GET /api/market/series?id=&from=&to=` (days). At most 20,000 points. */
export type SeriesResponse = {
  id: string
  title: string
  unit: string
  frequency: 'daily' | 'monthly'
  points: { day: string; time: number; value: number }[]
}

export type TradeSide = 'buy' | 'sell'

export type QuantitySource = 'document' | 'manual' | 'derived' | 'estimated'

/** `GET /api/depot/trades?isin=`: what `fin depot trades` prints. `isin` may be a coin symbol (`BTC-USD`): the trades of the instruments charted as it. */
export type DepotTrade = {
  id: number
  account_id: string
  isin: string
  name: string | null
  side: TradeSide
  booked_on: string
  /** Cash moved by the settlement, always positive. */
  amount_cents: number
  settlement_ref: string
  transaction_id: string | null
  quantity: number | null
  quantity_source: QuantitySource | null
  price: number | null
  fee_cents: number | null
  tax_cents: number | null
  costs_source: 'document' | 'manual' | 'implied' | null
  /** How the quantity was read from the settlement document; the shape is the depot module's. */
  reading: unknown
  note: string | null
  updated_at: string
  /** Sales only: proceeds minus the FIFO cost of the shares sold. */
  realised_fifo_cents: number | null
  /** `price` in USD at the ECB EUR/USD rate of `booked_on` (the latest earlier day for a weekend), for an instrument charted as a coin or with a US listing; null otherwise. Computed at read. */
  price_usd: number | null
}

export type DepotPosition = {
  isin: string
  name: string | null
  quantity: number
  price: number | null
  price_on: string | null
  value_cents: number | null
  cost_fifo_cents: number
  cost_average_cents: number
  unrealised_fifo_cents: number | null
  unrealised_average_cents: number | null
  unrealised_fifo_pct: number | null
  share: number | null
  quantity_source: QuantitySource | 'mixed'
  lots: { acquired_on: string; quantity: number; cost_cents: number }[]
  /** Commands that bring in the missing price, when there is none. */
  fix?: string[]
}

/** `GET /api/depot/positions` */
export type DepotPositions = {
  value_cents: number
  cost_fifo_cents: number
  unrealised_fifo_cents: number
  positions: DepotPosition[]
  /** ISINs with a trade whose quantity is unknown: left out until the depot is derived. */
  unresolved: string[]
}

export type OrderType = 'limit' | 'stop' | 'market'
export type OrderStatus = 'open' | 'executed' | 'cancelled' | 'expired'

/** `GET /api/depot/orders?status=&isin=`, and the answer of both order writes. Open orders are kept by hand. */
export type DepotOrder = {
  id: number
  account_id: string | null
  isin: string
  name: string | null
  side: TradeSide
  type: OrderType
  limit_price: number | null
  stop_price: number | null
  quantity: number
  valid_until: string | null
  status: OrderStatus
  note: string | null
  opened_at: string
  closed_at: string | null
  /** Open past its valid-until day: the bank has expired it, close it here. */
  overdue: boolean
}

/** `GET` and `POST /api/chart/drawings/<ISIN>`. `document` is the chart library's own export; `{}` and `updated_at: null` while none is stored. */
export type ChartDrawings = {
  isin: string
  document: unknown
  updated_at: string | null
}

/** `POST /api/depot/orders`. A limit order needs `limit_price`, a stop order `stop_price`, a market order neither. */
export type AddOrderRequest = {
  isin: string
  side: TradeSide
  type: OrderType
  quantity: number
  limit_price?: number
  stop_price?: number
  /** `YYYY-MM-DD` */
  valid_until?: string
  account_id?: string
  note?: string
}

/** `POST /api/depot/orders/<id>/close` */
export type CloseOrderRequest = {
  as: 'executed' | 'cancelled' | 'expired'
  note?: string
}
