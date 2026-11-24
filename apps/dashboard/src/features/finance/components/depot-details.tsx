import { Group, Stack, Text } from '@mantine/core'
import { EmptyState, Section, StatGroup } from 'basalt-ui'
import type { StatStripCell } from 'basalt-ui'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { reportWriteError, useOrderWrites } from '../api/mutations'
import type { useDepotStats, useDepotTrades, useOpenOrders } from '../api/queries'
import { FinanceApiError } from '../api/client'
import type { DepotOrder, DepotPosition, DepotStats, DepotTrade } from '../api/types'
import { priceText, signedPercent } from '../lib/depot-chart'
import {
  deltaEurDe,
  eurDe,
  isoDayDe,
  percentDe,
  priceDe,
  quantityDe,
  signedEurDe,
} from '../lib/depot-number'
import { toneProp } from '../lib/format'

const tradeCol = createColumnHelper<DepotTrade>()
const orderCol = createColumnHelper<DepotOrder>()

/** Quantities are fractional for savings plans; four places is the finest the depot keeps. */
const quantityText = quantityDe

const FIFO_NOTE =
  'The gain the tax return counts: each sale is matched with the oldest units you still held (first in, first out), after fees and tax.'

type StatsQuery = ReturnType<typeof useDepotStats>

/** The position of the instrument at a glance: units, value, what a unit cost on average, and the gain against that. */
function positionCells(position: DepotPosition | undefined, pending: boolean): StatStripCell[] {
  const perUnit =
    position !== undefined && position.quantity > 0
      ? priceText(position.cost_average_cents / 100 / position.quantity)
      : null
  const gain = position?.unrealised_average_cents ?? null
  return [
    {
      key: 'quantity',
      caption: 'Units held',
      value: position === undefined ? 'Not held' : quantityText(position.quantity),
      loading: pending,
    },
    {
      key: 'value',
      caption: 'Value',
      qualifier: position?.price_on == null ? '' : `as of ${isoDayDe(position.price_on)}`,
      value: position?.value_cents == null ? null : eurDe(position.value_cents),
      loading: pending,
    },
    {
      key: 'cost',
      caption: 'Average cost',
      qualifier: 'per unit',
      value: perUnit === null ? null : `${perUnit} €`,
      ...(position !== undefined && {
        footer: `${eurDe(position.cost_average_cents)} paid in total`,
      }),
      loading: pending,
    },
    {
      key: 'gain',
      caption: 'Gain',
      qualifier: 'against the average cost',
      value: gain === null ? null : deltaEurDe(gain),
      ...(gain !== null && {
        ...toneProp(gain),
        ...(position !== undefined &&
          position.cost_average_cents > 0 && {
            footer: signedPercent(gain / position.cost_average_cents),
          }),
      }),
      loading: pending,
    },
  ]
}

const money = (cents: number | null): string | null => (cents === null ? null : eurDe(cents))

/** What the instrument has made over the whole time the depot held it. */
function statsCells(
  stats: DepotStats | undefined,
  pending: boolean,
): [StatStripCell[], StatStripCell[]] {
  const total = stats?.total_gain_cents ?? null
  const realised = stats?.realised_gain_cents ?? null
  const high = stats?.all_time_high ?? null
  const peak = stats?.peak_quantity ?? null
  return [
    [
      {
        key: 'total',
        caption: 'Gain with this instrument',
        qualifier: 'all time',
        value: total === null ? null : deltaEurDe(total),
        ...(total !== null && toneProp(total)),
        footer: 'sold plus value minus invested',
        loading: pending,
      },
      {
        key: 'invested',
        caption: 'Invested',
        value: money(stats?.invested_cents ?? null),
        ...(stats !== undefined && { footer: `${eurDe(stats.sold_cents)} taken out by sales` }),
        loading: pending,
      },
      {
        key: 'realised',
        caption: 'Realised gain',
        qualifier: 'for tax',
        info: FIFO_NOTE,
        value: realised === null ? null : deltaEurDe(realised),
        ...(realised !== null && toneProp(realised)),
        ...(stats?.unrealised_gain_cents != null && {
          footer: `${deltaEurDe(stats.unrealised_gain_cents)} still unrealised`,
        }),
        loading: pending,
      },
      {
        key: 'fees',
        caption: 'Fees and tax',
        value: stats === undefined ? null : eurDe(stats.fees_cents + stats.tax_cents),
        ...(stats !== undefined && {
          footer: `${eurDe(stats.fees_cents)} fees, ${eurDe(stats.tax_cents)} tax`,
        }),
        loading: pending,
      },
    ],
    [
      {
        key: 'since',
        caption: stats?.closed_on == null ? 'Held since' : 'Held from',
        value: stats?.first_buy == null ? null : isoDayDe(stats.first_buy),
        ...(stats?.holding_days != null && {
          footer: `${stats.holding_days.toLocaleString('de-DE')} days${
            stats.closed_on === null ? '' : `, sold out ${isoDayDe(stats.closed_on)}`
          }`,
        }),
        loading: pending,
      },
      {
        key: 'peak',
        caption: 'Largest holding',
        qualifier: 'units',
        value: peak === null ? null : quantityText(peak),
        ...(stats?.peak_on != null && { footer: `first reached ${isoDayDe(stats.peak_on)}` }),
        loading: pending,
      },
      {
        key: 'high',
        caption: 'All-time high',
        value:
          high === null ? null : `${priceDe(high.value)} ${high.currency === 'USD' ? '$' : '€'}`,
        ...(high !== null && { footer: isoDayDe(high.day) }),
        loading: pending,
      },
      {
        key: 'distance',
        caption: 'From the high',
        qualifier: 'last close',
        value: high === null ? null : percentDe(high.pct_from_high, true),
        ...(high !== null && toneProp(high.pct_from_high)),
        loading: pending,
      },
    ],
  ]
}

/**
 * The second view of an instrument: what is held and what it has made, then every trade and the open orders.
 * An index or a series has no position and says so.
 */
export function DepotDetails({
  name,
  tradable,
  position,
  positionPending,
  stats,
  trades,
  orders,
  orderIsin,
  onAddOrder,
}: {
  name: string
  /** False for an index or a series: nothing to hold. */
  tradable: boolean
  position: DepotPosition | undefined
  positionPending: boolean
  stats: StatsQuery
  trades: ReturnType<typeof useDepotTrades>
  orders: ReturnType<typeof useOpenOrders>
  orderIsin: string
  onAddOrder: () => void
}) {
  if (!tradable) {
    return (
      <EmptyState
        tier="section"
        title={`${name} is not something you can hold`}
        description="An index or a series has no position, trades or orders. The chart and the board show its price history."
      />
    )
  }
  const noTrades = stats.error instanceof FinanceApiError && stats.error.status === 404
  const [made, history] = statsCells(stats.data, stats.isPending)
  return (
    <Stack gap="sm">
      <div data-shot="depot-position">
        <StatGroup
          variant="strip"
          label="The position at a glance"
          cols={4}
          cells={positionCells(position, positionPending)}
        />
      </div>
      {noTrades ? (
        <Text size="sm" c="dimmed" data-shot="depot-stats">
          No trade of this instrument is booked, so there is nothing to total yet.
        </Text>
      ) : stats.error !== null ? (
        <EmptyState
          tier="section"
          title="The statistics did not load"
          description={stats.error.message}
        />
      ) : (
        <Stack gap="sm" data-shot="depot-stats">
          <StatGroup variant="strip" label="What it has made over all time" cols={4} cells={made} />
          <StatGroup
            variant="strip"
            label="Holding history and the high"
            cols={4}
            cells={history}
          />
        </Stack>
      )}
      <div data-shot="depot-trades">
        <TradesTable trades={trades.data ?? []} query={trades} />
      </div>
      <OrdersSection
        isin={orderIsin}
        orders={orders.data ?? []}
        query={orders}
        onAdd={onAddOrder}
      />
    </Stack>
  )
}

function TradesTable({
  trades,
  query,
}: {
  trades: readonly DepotTrade[]
  query: ReturnType<typeof useDepotTrades>
}) {
  const columns = [
    tradeCol.accessor('booked_on', { header: 'Booked', cell: (c) => isoDayDe(c.getValue()) }),
    tradeCol.accessor('side', {
      header: 'Side',
      cell: (c) => (
        <Text span inherit c={c.getValue() === 'buy' ? 'green' : 'red'}>
          {c.getValue() === 'buy' ? 'Buy' : 'Sell'}
        </Text>
      ),
    }),
    tradeCol.accessor((t) => t.quantity ?? 0, {
      id: 'quantity',
      header: 'Units',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => {
        const t = c.row.original
        if (t.quantity === null) return '—'
        return `${t.quantity_source === 'estimated' ? '≈ ' : ''}${quantityText(t.quantity)}`
      },
    }),
    tradeCol.accessor((t) => t.price ?? 0, {
      id: 'price',
      header: 'Price',
      sortFn: 'basic',
      meta: { align: 'right', priority: 2 },
      cell: (c) => (c.row.original.price === null ? '—' : priceText(c.getValue())),
    }),
    ...(trades.some((t) => t.price_usd !== null)
      ? [
          tradeCol.accessor((t) => t.price_usd ?? 0, {
            id: 'price_usd',
            header: 'Price (USD)',
            sortFn: 'basic',
            meta: { align: 'right', priority: 3 },
            cell: (c) => (c.row.original.price_usd === null ? '—' : priceText(c.getValue())),
          }),
        ]
      : []),
    tradeCol.accessor('amount_cents', {
      header: 'Amount',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => eurDe(c.getValue(), true),
    }),
    tradeCol.accessor((t) => t.realised_fifo_cents ?? 0, {
      id: 'realised',
      header: 'Realised',
      sortFn: 'basic',
      meta: { align: 'right', priority: 3 },
      cell: (c) =>
        c.row.original.realised_fifo_cents === null ? (
          '—'
        ) : (
          <Text span inherit c={c.getValue() >= 0 ? 'green' : 'red'}>
            {signedEurDe(c.getValue())}
          </Text>
        ),
    }),
  ]
  return (
    <BasaltDataTable
      title="Trades"
      subtitle="Read from the settlement documents; ≈ marks a quantity that is an estimate."
      data={[...trades]}
      columns={columns}
      getRowId={(t) => String(t.id)}
      query={query}
      skeletonRows={3}
      emptyState="No trades in this instrument."
      initialSorting={[{ id: 'booked_on', desc: true }]}
      renderCard={(t) => (
        <Stack gap={2}>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text size="sm" fw={500}>
              {isoDayDe(t.booked_on)} · {t.side === 'buy' ? 'Buy' : 'Sell'}
            </Text>
            <Text size="sm">{eurDe(t.amount_cents, true)}</Text>
          </Group>
          <Text size="xs" c="dimmed">
            {t.quantity === null
              ? 'quantity unknown'
              : `${t.quantity_source === 'estimated' ? '≈ ' : ''}${quantityText(t.quantity)} units`}
            {t.price === null ? '' : ` at ${priceText(t.price)}`}
            {t.price_usd === null ? '' : ` (${priceText(t.price_usd)} $)`}
          </Text>
        </Stack>
      )}
    />
  )
}

function OrdersSection({
  isin,
  orders,
  query,
  onAdd,
}: {
  isin: string
  orders: readonly DepotOrder[]
  query: ReturnType<typeof useOpenOrders>
  onAdd: () => void
}) {
  const writes = useOrderWrites()
  const close = (order: DepotOrder, as: 'executed' | 'cancelled' | 'expired') =>
    writes.close(order.id, { as }).catch(reportWriteError)
  const columns = [
    orderCol.accessor('side', {
      header: 'Order',
      cell: (c) => {
        const o = c.row.original
        return `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.type}`
      },
    }),
    orderCol.accessor('quantity', {
      header: 'Units',
      meta: { align: 'right' },
      cell: (c) => quantityText(c.getValue()),
    }),
    orderCol.accessor((o) => (o.type === 'stop' ? o.stop_price : o.limit_price) ?? 0, {
      id: 'price',
      header: 'Price',
      meta: { align: 'right' },
      cell: (c) => (c.getValue() === 0 ? 'Market' : priceText(c.getValue())),
    }),
    orderCol.accessor((o) => o.valid_until ?? '', {
      id: 'valid',
      header: 'Valid until',
      meta: { priority: 2 },
      cell: (c) => {
        const o = c.row.original
        if (o.valid_until === null) return '—'
        return o.overdue ? `${isoDayDe(o.valid_until)} · past, close it` : isoDayDe(o.valid_until)
      },
    }),
  ]
  return (
    <Section
      title="Open orders"
      subtitle="Kept by hand: ING has no interface for orders. Nothing here reaches the bank."
      actions={[{ key: 'add', label: 'Add order', onClick: onAdd, mobile: 'bar' }]}
    >
      <BasaltDataTable
        data={[...orders]}
        columns={columns}
        getRowId={(o) => String(o.id)}
        query={query}
        skeletonRows={2}
        emptyState={`No open orders in ${isin}.`}
        rowLabel={(o) => `${o.side} ${o.type} order`}
        renderCard={(o) => (
          <Stack gap={2}>
            <Text size="sm" fw={500}>
              {o.side === 'buy' ? 'Buy' : 'Sell'} {o.type}
              {o.type === 'market'
                ? ''
                : ` at ${priceText((o.type === 'stop' ? o.stop_price : o.limit_price) ?? 0)}`}
            </Text>
            <Text size="xs" c="dimmed">
              {quantityText(o.quantity)} units
              {o.valid_until === null
                ? ''
                : ` · until ${isoDayDe(o.valid_until)}${o.overdue ? ', past: close it' : ''}`}
            </Text>
          </Stack>
        )}
        rowActions={[
          {
            key: 'executed',
            label: 'Close as executed',
            onClick: (o) => void close(o, 'executed'),
          },
          {
            key: 'cancelled',
            label: 'Close as cancelled',
            onClick: (o) => void close(o, 'cancelled'),
          },
          { key: 'expired', label: 'Close as expired', onClick: (o) => void close(o, 'expired') },
        ]}
      />
    </Section>
  )
}
