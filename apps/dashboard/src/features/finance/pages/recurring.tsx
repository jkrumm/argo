import { Box, Stack, Text } from '@mantine/core'
import { BarList, Section, StatGroup } from 'basalt-ui'
import type { StatStripCell } from 'basalt-ui'
import { date } from 'basalt-ui/format'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { useState } from 'react'
import { useMeta, useRecurring } from '../api/queries'
import type { RecurringRow } from '../api/types'
import { FinanceBar } from '../components/finance-bar'
import { NoDataState } from '../components/no-data-state'
import { QueryCard } from '../components/query-card'
import { RecurringModal } from '../components/recurring-modal'
import { categoryLabel } from '../lib/categories'
import { eur } from '../lib/format'
import {
  CADENCE_LABEL,
  chargeCents,
  isExcluded,
  isLive,
  monthlyCents,
  recurringTotals,
  seatLabel,
  upcoming,
} from '../lib/recurring'
import { addDays, isoDay } from '../lib/time'
import { useNow } from '../../../lib/use-now'
import classes from '../components/finance.module.css'

const col = createColumnHelper<RecurringRow>()
const WINDOW_DAYS = 30
const UPCOMING_SHOWN = 10

const rowId = (r: RecurringRow) => `${r.merchant}#${r.series}`

export function RecurringPage() {
  const meta = useMeta()
  const recurring = useRecurring(true)
  const now = useNow()
  const [open, setOpen] = useState<RecurringRow | null>(null)
  const categories = meta.data?.categories

  if (meta.isSuccess && meta.data.last_month === null) return <NoDataState />

  const rows = recurring.data ?? []
  const today = isoDay(new Date(now))
  const until = addDays(today, WINDOW_DAYS)
  const totals = recurringTotals(rows)
  const soon = upcoming(rows, today, until)
  const soonTotal = soon.reduce((sum, r) => sum + chargeCents(r), 0)
  const subscriptions = rows
    .filter((r) => isLive(r) && r.kind === 'subscription')
    .toSorted((a, b) => b.monthly_cents * -1 - a.monthly_cents * -1)
  const bills = rows
    .filter((r) => isLive(r) && r.kind === 'bill')
    .toSorted((a, b) => monthlyCents(b) - monthlyCents(a))
  const apart = rows
    .filter((r) => !isLive(r))
    .toSorted((a, b) => b.last_on.localeCompare(a.last_on))

  const loading = recurring.isPending
  const failed =
    recurring.error === null
      ? {}
      : {
          state: {
            kind: 'error' as const,
            error: recurring.error,
            onRetry: () => void recurring.refetch(),
          },
        }
  const cells: StatStripCell[] = [
    {
      key: 'subs',
      caption: 'Subscriptions',
      qualifier: 'per month',
      value: eur(totals.subscriptionsMonthly),
      footer: `${totals.subscriptionCount} running`,
      loading,
      ...failed,
    },
    {
      key: 'year',
      caption: 'Subscriptions',
      qualifier: 'per year',
      value: eur(totals.subscriptionsYearly),
      loading,
      ...failed,
    },
    {
      key: 'bills',
      caption: 'Bills',
      qualifier: 'per month, average',
      info: 'Charges that vary from one bill to the next (electricity, telecom), at their average over the last 12 months.',
      value: eur(totals.billsMonthly),
      footer: `${totals.billCount} running`,
      loading,
      ...failed,
    },
    {
      key: 'next',
      caption: 'Next charge',
      qualifier: soon[0]?.next_expected_on == null ? '' : date(soon[0].next_expected_on),
      value: soon[0] === undefined ? null : eur(chargeCents(soon[0])),
      footer: soon[0]?.merchant,
      loading,
      ...failed,
    },
  ]

  const columns = [
    col.accessor('merchant', {
      header: 'Payee',
      cell: (c) => {
        const r = c.row.original
        const seat = seatLabel(r)
        return (
          <Stack gap={0}>
            <Text size="sm" fw={500} lineClamp={1}>
              {r.merchant}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {[seat, categoryLabel(categories, r.category)].filter(Boolean).join(' · ')}
            </Text>
          </Stack>
        )
      },
    }),
    col.accessor('cadence', {
      header: 'Paid',
      meta: { priority: 3 },
      cell: (c) => CADENCE_LABEL[c.getValue()],
    }),
    col.accessor((r) => chargeCents(r), {
      id: 'charge',
      header: 'Per charge',
      sortFn: 'basic',
      meta: { align: 'right', priority: 2 },
      cell: (c) => eur(c.getValue()),
    }),
    col.accessor((r) => monthlyCents(r), {
      id: 'monthly',
      header: 'Per month',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => eur(c.getValue()),
    }),
    col.accessor('next_expected_on', {
      header: 'Next',
      meta: { priority: 1 },
      cell: (c) => {
        const v = c.getValue()
        return v === null ? '—' : date(v)
      },
    }),
  ]

  const apartColumns = [
    columns[0],
    col.display({
      id: 'state',
      header: 'State',
      cell: (c) => {
        const r = c.row.original
        return isExcluded(r) ? 'Left out' : `Stopped ${date(r.last_on)}`
      },
    }),
    columns[3],
  ].filter((c) => c !== undefined)

  const card = (r: RecurringRow) => (
    <Stack gap={2}>
      <Box className={classes.booking}>
        <Text size="sm" fw={500} className={classes.merchant}>
          {r.merchant}
        </Text>
        <Text size="sm" className={classes.amount}>
          {eur(monthlyCents(r))}
        </Text>
        <Text size="xs" c="dimmed" className={classes.meta}>
          {[
            seatLabel(r),
            `${eur(chargeCents(r))} ${CADENCE_LABEL[r.cadence].toLowerCase()}`,
            r.next_expected_on === null ? null : `next ${date(r.next_expected_on)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Box>
    </Stack>
  )

  const upcomingItems = soon.slice(0, UPCOMING_SHOWN).map((r) => ({
    key: rowId(r),
    label: seatLabel(r) === null ? r.merchant : `${r.merchant} (${seatLabel(r)})`,
    value: chargeCents(r),
    secondary: r.next_expected_on === null ? '' : date(r.next_expected_on),
  }))

  return (
    <Box className={classes.page}>
      <FinanceBar />
      <StatGroup variant="strip" label="Recurring costs at a glance" cols={4} cells={cells} />
      <Box className={`${classes.split} ${classes.splitWide}`}>
        <Stack gap="sm">
          <BasaltDataTable
            title="Subscriptions"
            subtitle="Select a row to correct the detection."
            data={subscriptions}
            columns={columns}
            getRowId={rowId}
            query={recurring}
            skeletonRows={6}
            emptyState="No running subscriptions."
            initialSorting={[{ id: 'monthly', desc: true }]}
            onRowActivate={setOpen}
            renderCard={card}
          />
        </Stack>
        <Stack gap="sm">
          <QueryCard
            title="Due in the next 30 days"
            info="Running series with their next expected charge inside the window, at the latest (subscription) or average (bill) amount."
            query={recurring}
            empty={soon.length === 0 ? 'Nothing is expected in the next 30 days.' : false}
            content
            facts={
              soon.length === 0
                ? undefined
                : {
                    value: eur(soonTotal),
                    unit: `in ${soon.length} charges`,
                    period: `until ${date(until)}`,
                  }
            }
          >
            <BarList
              label="Charges due in the next 30 days, in euros"
              items={upcomingItems}
              format={eur}
              loading={recurring.isPending}
              loadingRows={5}
            />
            {soon.length > UPCOMING_SHOWN && (
              <Text size="xs" c="dimmed">
                {soon.length - UPCOMING_SHOWN} more,{' '}
                {eur(soon.slice(UPCOMING_SHOWN).reduce((sum, r) => sum + chargeCents(r), 0))}
              </Text>
            )}
          </QueryCard>
          <BasaltDataTable
            title="Bills"
            subtitle="Amounts vary; the figures are 12-month averages."
            data={bills}
            columns={columns}
            getRowId={rowId}
            query={recurring}
            skeletonRows={3}
            emptyState="No running bills."
            initialSorting={[{ id: 'monthly', desc: true }]}
            onRowActivate={setOpen}
            renderCard={card}
          />
        </Stack>
      </Box>
      <Section
        title="Stopped and left out"
        subtitle={`${apart.length} ${apart.length === 1 ? 'series' : 'series'}`}
        collapsible
        defaultOpen={false}
      >
        <BasaltDataTable
          data={apart}
          columns={apartColumns}
          getRowId={rowId}
          query={recurring}
          emptyState="Nothing stopped and nothing left out."
          onRowActivate={setOpen}
          renderCard={card}
        />
      </Section>
      {open !== null && <RecurringModal row={open} onClose={() => setOpen(null)} />}
    </Box>
  )
}
