/**
 * PINNED CONTRACT — copied verbatim from the finances repo, `ui/src/api/types.ts` @ fbdd1c2
 * (~/SourceRoot/finances, `fin serve`; the file last changed in 0a49d44). The API is
 * `/api/finance/*` here and `/api/*` on the service. Re-copy when that file changes; do not edit the
 * types below by hand. Service status/sync types live in `./status.ts` (from the service contract,
 * finances `docs/service.md`).
 */
/**
 * The API contract of `fin ui` (docs/dashboard.md, docs/data-model.md §3). Rows are the view rows
 * as the server selects them, so column names stay snake_case. Amounts are integer cents, months
 * `YYYY-MM`; income is positive, spending negative, as booked. The server imports these types.
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
  /** `YYYY-MM-DD`. */
  booked_on: string
  month: Month
  amount_cents: number
  counterparty: string | null
  purpose: string | null
  merchant: string | null
  /** NULL when uncategorized. */
  category: string | null
  /** NULL when uncategorized. */
  category_kind: CategoryKind | null
  top_category: string | null
  tax_tag: string | null
  /** NULL when the booking belongs to no event (trip, shared cost). */
  event_id: string | null
  /** 1 when the category is a committed monthly cost; 0 otherwise or uncategorized. */
  fixed: 0 | 1
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

/** `v_recurring` */
export type RecurringRow = {
  merchant: string
  category: string | null
  months_active: number
  first_month: Month
  last_month: Month
  avg_cents: number
  min_cents: number
  max_cents: number
  cadence: Cadence
  /** Normalized to a month, negative like the booking. */
  monthly_cents: number
  /** Seen in the last 2 months of data; SQLite booleans arrive as 0 | 1. */
  active: boolean | 0 | 1
}

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

/** `GET /api/net-worth` */
export type NetWorth = {
  net_worth: NetWorthMonth[]
  balances: BalanceMonth[]
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

/** `GET /api/transactions` */
export type TxQuery = RangeQuery & {
  category?: string
  merchant?: string
  search?: string
  /** An event id; the server keeps that event's bookings. */
  event?: string
  limit?: number
}

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
