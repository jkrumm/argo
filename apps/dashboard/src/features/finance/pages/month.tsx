import { SimpleGrid, Stack } from '@mantine/core'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { BarList, EmptyState, Meter, PageSummary } from 'basalt-ui'
import type { MeterSegment } from 'basalt-ui'
import { date } from 'basalt-ui/format'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import { useMemo } from 'react'
import { useMeta, useMonth } from '../api/queries'
import type { EventTotal, MonthDetail } from '../api/types'
import { CategoryTable } from '../components/category-table'
import { FinanceBar } from '../components/finance-bar'
import { EventLink } from '../components/event-link'
import { NoDataState } from '../components/no-data-state'
import { QueryCard } from '../components/query-card'
import { SignedAmount } from '../components/signed-amount'
import { merchantLabel } from '../lib/categories'
import { eur, gainTone, signedEur } from '../lib/format'
import { isMonth, monthName, monthTick, shiftMonth } from '../lib/months'
import { FINANCE_SPLIT } from '../../../lib/series'
import { finStore } from '../../../lib/window-stores'

const LARGEST_SHOWN = 8

/** The `$month` the nav links to. */
const LATEST = 'latest'

/** `5 Jun` from `2026-06-05`. */
const dayMonth = (iso: string): string =>
  `${Number(iso.slice(8, 10))} ${monthTick(iso.slice(0, 7)).split(' ')[0]}`

/** What the month's income went to; spending beyond it shows as a track longer than the income tick. */
function incomeSplit(detail: MonthDetail): {
  segments: MeterSegment[]
  income: number
  max: number
} {
  const c = detail.cashflow
  // regular_net = income without an event + fixed + variable (both negative), so this is the routine income.
  const income = c.regular_net_cents - c.fixed_cents - c.variable_cents
  const fixed = Math.abs(c.fixed_cents)
  const variable = Math.abs(c.variable_cents)
  const oneOff = Math.max(0, -c.one_off_cents)
  const left = Math.max(0, c.net_cents)
  // A one-off that netted positive is already inside `net`, so only a net cost gets a segment of its own.
  const segments = [
    { value: fixed, label: 'Fixed', color: FINANCE_SPLIT.fixed },
    { value: variable, label: 'Variable', color: FINANCE_SPLIT.variable },
    { value: oneOff, label: 'One-offs', color: FINANCE_SPLIT.oneoff },
    { value: left, label: 'Left over', color: FINANCE_SPLIT.leftover },
  ].filter((s) => s.value > 0)
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  return { segments, income, max: Math.max(income, total, 1) }
}

const eventCol = createColumnHelper<EventTotal>()

const eventColumns = [
  eventCol.accessor('label', {
    header: 'Event',
    cell: (c) => <EventLink eventId={c.row.original.event_id}>{c.getValue()}</EventLink>,
  }),
  eventCol.accessor('first_day', {
    header: 'From',
    cell: (c) => date(c.getValue()),
  }),
  eventCol.accessor('paid_cents', {
    header: 'Paid',
    meta: { align: 'right' },
    cell: (c) => eur(Math.abs(c.getValue())),
  }),
  eventCol.accessor('reimbursed_cents', {
    header: 'Reimbursed',
    meta: { align: 'right' },
    cell: (c) => eur(c.getValue()),
  }),
  eventCol.accessor('net_cents', {
    header: 'Net',
    meta: { align: 'right' },
    cell: (c) => <SignedAmount cents={c.getValue()} />,
  }),
]

export function MonthPage({ month }: { month: string }) {
  const filters = finStore.useValues()
  const navigate = useNavigate()
  const meta = useMeta()
  const valid = isMonth(month)
  const query = useMonth(valid ? month : null)
  const detail = query.data
  const categories = meta.data?.categories
  const { first_month: first, last_month: last } = meta.data ?? {}

  const largest = useMemo(
    () =>
      (detail?.largest ?? []).slice(0, LARGEST_SHOWN).map((t) => ({
        key: t.id,
        label: merchantLabel(t.merchant ?? t.counterparty ?? ''),
        value: Math.abs(t.amount_cents),
        secondary: `${dayMonth(t.booked_on)}${t.amount_cents > 0 ? ' · income' : ''}`,
      })),
    [detail],
  )

  // The nav entry points at `latest`: resolve it to the newest month with data.
  if (month === LATEST) {
    return last == null ? (
      <NoDataState />
    ) : (
      <Navigate to="/finance/month/$month" params={{ month: last }} search={filters} replace />
    )
  }
  if (!valid) return <NoDataState />

  const go = (target: string): void =>
    void navigate({ to: '/finance/month/$month', params: { month: target }, search: filters })
  const split = detail === undefined ? undefined : incomeSplit(detail)
  const c = detail?.cashflow
  const name = monthName(month)

  const pageBar = (
    <FinanceBar
      filtersEnd={[
        {
          key: 'previous',
          label: 'Previous month',
          group: true,
          disabled: first == null || month <= first,
          onClick: () => go(shiftMonth(month, -1)),
        },
        {
          key: 'next',
          label: 'Next month',
          group: true,
          disabled: last == null || month >= last,
          onClick: () => go(shiftMonth(month, 1)),
        },
      ]}
    />
  )
  const empty =
    detail !== undefined &&
    c !== undefined &&
    c.income_cents === 0 &&
    c.expense_cents === 0 &&
    c.one_off_cents === 0 &&
    detail.largest.length === 0
  if (empty) {
    return (
      <Stack gap="sm">
        {pageBar}
        <EmptyState
          tier="page"
          title={`No bookings in ${name}`}
          description="Nothing was booked this month. Use the buttons above to step to a month with data."
        />
      </Stack>
    )
  }

  return (
    <Stack gap="sm">
      {pageBar}
      {detail === undefined ? (
        <PageSummary loading />
      ) : (
        <PageSummary
          sentence={detail.cause}
          facts={[
            name,
            c && `income ${eur(c.income_cents)}`,
            c && `spending ${eur(Math.abs(c.expense_cents))}`,
            c && `net ${signedEur(c.net_cents)}`,
          ]}
        />
      )}
      <QueryCard
        title="Where did the money go?"
        info="The month's regular income split into fixed costs, variable spending, one-offs and what was left. The tick marks the regular income; a bar running past it is an overspend."
        query={query}
        empty={false}
        content
        facts={
          c === undefined
            ? undefined
            : [
                {
                  value: signedEur(c.net_cents),
                  unit: 'net',
                  period: name,
                  tone: gainTone(c.net_cents) ?? 'muted',
                },
                {
                  value: signedEur(c.one_off_cents),
                  unit: 'one-offs',
                  tone: c.one_off_cents < 0 ? 'warn' : 'muted',
                },
              ]
        }
      >
        {split === undefined ? (
          <Meter label="Income split" max={1} segments={[{ value: 0, label: 'Fixed' }]} loading />
        ) : (
          <Meter
            label={`Where the income of ${name} went`}
            max={split.max}
            format={eur}
            startCaption={null}
            segments={split.segments}
            ticks={split.income > 0 ? [{ at: split.income, label: 'Income' }] : []}
          />
        )}
      </QueryCard>
      <CategoryTable
        title="Compared to a typical month"
        subtitle={`Spending per top category in ${name} against the median of the twelve months before. Largest overshoot first.`}
        currentHeader={monthName(month)}
        rows={detail?.categories ?? []}
        categories={categories}
        query={query}
        initialSort="delta"
      />
      <SimpleGrid
        type="container"
        cols={{ base: 1, [CONTAINER_KEYS.wide]: detail?.events.length ? 2 : 1 }}
      >
        <QueryCard
          title="Which bookings weighed most?"
          info={`The ${LARGEST_SHOWN} largest bookings of the month by amount, income included.`}
          query={query}
          empty={largest.length === 0 ? 'No bookings in this month.' : false}
          content
        >
          <BarList
            label={`Largest bookings in ${name}, in euros`}
            items={largest}
            format={eur}
            loading={query.isPending}
            loadingRows={LARGEST_SHOWN}
          />
        </QueryCard>
        {detail?.events.length ? (
          <BasaltDataTable
            title="Which trips and shared costs fell in it?"
            data={detail.events}
            columns={eventColumns}
            getRowId={(e) => e.event_id}
          />
        ) : null}
      </SimpleGrid>
    </Stack>
  )
}
