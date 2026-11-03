import { Stack, Text } from '@mantine/core'
import { date } from 'basalt-ui/format'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import { useEvents, useMerchants, useTransactions } from '../api/queries'
import type { TxRow } from '../api/types'
import { NoDataState } from '../components/no-data-state'
import { TransactionsBar } from '../components/transactions-bar'
import { NONE, UNKNOWN_MERCHANT, categoryLabel } from '../lib/categories'
import { eurExact, signedEur } from '../lib/format'
import { finStore } from '../../../lib/window-stores'
import { useRange } from '../lib/use-range'

/** The newest bookings the page asks for; a filtered range stays well below it. */
const ROW_LIMIT = 2000
const MERCHANT_OPTIONS = 100

const col = createColumnHelper<TxRow>()

export function TransactionsPage() {
  const { range, noData, meta } = useRange()
  const [category] = finStore.field.category.use()
  const [merchant] = finStore.field.merchant.use()
  const [search, setSearch] = finStore.field.search.use()
  const [event, setEvent] = finStore.field.event.use()
  const events = useEvents()
  const eventLabel = events.data?.find((e) => e.event_id === event)?.label ?? event
  const { first_month: first, last_month: last } = meta.data ?? {}
  // An event is a fact about its bookings, wherever they fall: it is not cut to the range.
  const queryRange =
    event === '' ? range : first == null || last == null ? null : { from: first, to: last }
  const transactions = useTransactions(
    queryRange === null
      ? null
      : {
          ...queryRange,
          ...(event !== '' && { event }),
          ...(category !== '' && { category }),
          ...(merchant !== '' && { merchant }),
          ...(search !== '' && { search }),
          limit: ROW_LIMIT,
        },
  )
  const merchants = useMerchants(range)
  const categories = meta.data?.categories

  const columns = [
    col.accessor('booked_on', {
      header: 'Date',
      sortFn: 'basic',
      cell: (c) => date(c.getValue()),
    }),
    col.accessor((r) => r.merchant ?? r.counterparty ?? '', {
      id: 'merchant',
      header: 'Merchant',
    }),
    col.accessor('purpose', { header: 'Purpose', meta: { priority: 2 } }),
    col.accessor('category', {
      header: 'Category',
      cell: (c) => categoryLabel(categories, c.getValue()),
    }),
    col.accessor('amount_cents', {
      header: 'Amount (EUR)',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) =>
        c.getValue() > 0 ? (
          <Text span c={VX.status.good}>
            {eurExact(c.getValue())}
          </Text>
        ) : (
          eurExact(c.getValue())
        ),
    }),
  ]

  const merchantOptions = [
    { value: NONE, label: 'Unknown merchant' },
    ...[
      ...new Set([
        ...(merchants.data ?? [])
          .slice(0, MERCHANT_OPTIONS)
          .map((m) => m.merchant)
          .filter((name) => name !== UNKNOWN_MERCHANT),
        ...(merchant !== '' && merchant !== NONE ? [merchant] : []),
      ]),
    ]
      .toSorted()
      .map((m) => ({ value: m, label: m })),
  ]
  const categoryOptions = [
    { value: NONE, label: 'Uncategorized' },
    ...(categories ?? []).map((c) => ({ value: c.id, label: c.label })),
  ]

  if (noData) return <NoDataState />

  const rows = transactions.data ?? []
  const truncated = rows.length >= ROW_LIMIT

  return (
    <Stack gap="sm">
      <TransactionsBar categories={categoryOptions} merchants={merchantOptions} />
      <BasaltDataTable
        title="Transactions"
        {...(event !== '' && {
          actions: [
            {
              key: 'clear-event',
              label: `Event: ${eventLabel} (clear)`,
              onClick: () => setEvent(''),
            },
          ],
        })}
        subtitle={
          truncated
            ? `Newest ${ROW_LIMIT} bookings. Narrow the range or the filters to see older ones.`
            : `${event === '' ? '' : `Event ${eventLabel}: `}${rows.length} bookings, ${signedEur(rows.reduce((sum, r) => sum + r.amount_cents, 0))} together`
        }
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        query={transactions}
        enableGlobalFilter
        globalFilterPlaceholder="Search bookings"
        initialGlobalFilter={search}
        onGlobalFilterChange={setSearch}
        manualFiltering
        initialSorting={[{ id: 'booked_on', desc: true }]}
        enablePagination
        emptyState="No bookings match the filters."
      />
    </Stack>
  )
}
