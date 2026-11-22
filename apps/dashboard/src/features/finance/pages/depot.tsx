import { ActionIcon, Box, Group, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconPointer, IconRulerMeasure, IconTrash, IconMinus } from '@tabler/icons-react'
import { EmptyState, Section, StatGroup } from 'basalt-ui'
import type { StatStripCell } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, SelectFilter, ViewTabs } from 'basalt-ui/controls'
import { date } from 'basalt-ui/format'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { useRef, useState } from 'react'
import { reportWriteError, useOrderWrites } from '../api/mutations'
import {
  useCandles,
  useDepotTrades,
  useDrawings,
  useOpenOrders,
  usePositions,
  useWatchlist,
} from '../api/queries'
import type { DepotOrder, DepotTrade, WatchlistEntry } from '../api/types'
import { DepotChart } from '../components/depot-chart'
import type { DepotChartHandle, DrawTool } from '../components/depot-chart'
import { FinanceBar } from '../components/finance-bar'
import { NoDataState } from '../components/no-data-state'
import { OrderModal } from '../components/order-modal'
import classes from '../components/depot.module.css'
import {
  candleWindow,
  costLine,
  depotInterval,
  orderLine,
  pickInstrument,
  priceText,
  signedPercent,
} from '../lib/depot-chart'
import type { PriceLine } from '../lib/depot-chart'
import { deltaEur, eur, eurExact, signedEur, toneProp } from '../lib/format'
import { isoDay } from '../lib/time'
import { useDrawingsSaver } from '../lib/use-drawings-saver'
import { useField } from '../../../lib/use-field'
import { useNow } from '../../../lib/use-now'
import { finStore } from '../../../lib/window-stores'

const tradeCol = createColumnHelper<DepotTrade>()
const orderCol = createColumnHelper<DepotOrder>()

/** Quantities are fractional for savings plans; four places is the finest the depot keeps. */
const quantityText = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 4 })

export function DepotPage() {
  const watchlist = useWatchlist()
  const positions = usePositions()
  const [requested, setRequested] = useField(finStore.field.isin)
  const [interval] = useField(finStore.field.ivl)
  const [range] = useField(finStore.field.rng)
  const [adding, setAdding] = useState(false)
  const today = isoDay(new Date(useNow()))

  const entries = watchlist.data ?? []
  const held = new Set(
    (positions.data?.positions ?? []).filter((p) => p.quantity > 0).map((p) => p.isin),
  )
  const isin = pickInstrument(requested, entries, held)
  const entry = entries.find((e) => e.isin === isin)
  const position = positions.data?.positions.find((p) => p.isin === isin)

  const candles = useCandles(
    isin === null ? null : { isin, interval, ...candleWindow(range, interval, today) },
  )
  const trades = useDepotTrades(isin)
  const orders = useOpenOrders(isin)
  const drawings = useDrawings(isin)

  if (watchlist.isSuccess && entries.length === 0) return <NoDataState />

  const bars = candles.data?.candles ?? []
  const euro =
    candles.data === undefined || candles.data.currency === null || candles.data.currency === 'EUR'
  const lines: PriceLine[] = euro
    ? [...(orders.data ?? []).map(orderLine), costLine(position)].filter((l) => l !== null)
    : []

  const cells: StatStripCell[] = [
    {
      key: 'quantity',
      caption: 'Position',
      qualifier: 'units held',
      value: position === undefined ? 'Not held' : quantityText(position.quantity),
      ...(entry?.name != null && { footer: entry.name }),
      loading: positions.isPending,
    },
    {
      key: 'value',
      caption: 'Value',
      qualifier: position?.price_on == null ? '' : `as of ${date(position.price_on)}`,
      value: position?.value_cents == null ? null : eur(position.value_cents),
      loading: positions.isPending,
    },
    {
      key: 'cost',
      caption: 'Cost',
      qualifier: 'FIFO',
      value: position === undefined ? null : eur(position.cost_fifo_cents),
      ...(position !== undefined &&
        position.quantity > 0 && {
          footer: `${priceText(position.cost_average_cents / 100 / position.quantity)} per unit on average`,
        }),
      loading: positions.isPending,
    },
    {
      key: 'gain',
      caption: 'Gain',
      qualifier: 'unrealised, FIFO',
      value:
        position?.unrealised_fifo_cents == null ? null : deltaEur(position.unrealised_fifo_cents),
      ...(position?.unrealised_fifo_cents != null && {
        ...toneProp(position.unrealised_fifo_cents),
        footer: signedPercent(position.unrealised_fifo_pct),
      }),
      loading: positions.isPending,
    },
  ]

  return (
    <Box className={classes.page}>
      <FinanceBar
        filters={
          <FilterSet>
            <SelectFilter field={finStore.field.rng} label="Range" />
          </FilterSet>
        }
      />
      <Box className={classes.layout}>
        <Watchlist
          entries={entries}
          held={held}
          active={isin}
          pending={watchlist.isPending}
          error={watchlist.error}
          onPick={setRequested}
        />
        {isin !== null && entry !== undefined && (
          <Stack key={isin} className={classes.main} gap="sm">
            <ChartPanel
              name={entry.name ?? isin}
              isin={isin}
              interval={interval}
              bars={bars}
              trades={trades.data ?? []}
              lines={lines}
              candles={candles}
              drawings={drawings}
            />
            <Box data-shot="depot-position">
              <StatGroup variant="strip" label="The position at a glance" cols={4} cells={cells} />
            </Box>
            <Box data-shot="depot-trades">
              <TradesTable trades={trades.data ?? []} query={trades} />
            </Box>
            <OrdersSection
              isin={isin}
              orders={orders.data ?? []}
              query={orders}
              onAdd={() => setAdding(true)}
            />
          </Stack>
        )}
      </Box>
      {adding && isin !== null && <OrderModal isin={isin} onClose={() => setAdding(false)} />}
    </Box>
  )
}

function Watchlist({
  entries,
  held,
  active,
  pending,
  error,
  onPick,
}: {
  entries: readonly WatchlistEntry[]
  held: ReadonlySet<string>
  active: string | null
  pending: boolean
  error: Error | null
  onPick: (isin: string) => void
}) {
  if (error !== null) {
    return (
      <EmptyState tier="section" title="The watchlist did not load" description={error.message} />
    )
  }
  return (
    <ScrollArea
      data-shot="depot-watchlist"
      type="auto"
      scrollbars="y"
      className={classes.watchScroll}
      aria-label="Watchlist: last close and change on the day"
    >
      <Box className={classes.watch}>
        {pending && (
          <Text size="sm" c="dimmed">
            Loading…
          </Text>
        )}
        {entries.map((e) => (
          <UnstyledButton
            key={e.isin}
            className={classes.watchItem}
            data-active={e.isin === active}
            aria-pressed={e.isin === active}
            onClick={() => onPick(e.isin)}
          >
            <Box className={classes.watchHead}>
              <Text size="sm" fw={500} className={classes.watchName}>
                {e.name ?? e.isin}
              </Text>
              {held.has(e.isin) && (
                <Text span size="xs" c="dimmed">
                  held
                </Text>
              )}
            </Box>
            <Box className={classes.watchFigures}>
              <Text span size="xs" c="dimmed">
                {e.last_close === null ? '—' : priceText(e.last_close)}
              </Text>
              <Text
                span
                size="xs"
                {...(e.day_change_pct !== null && { c: e.day_change_pct >= 0 ? 'green' : 'red' })}
              >
                {signedPercent(e.day_change_pct)}
              </Text>
            </Box>
          </UnstyledButton>
        ))}
      </Box>
    </ScrollArea>
  )
}

function ChartPanel({
  name,
  isin,
  interval,
  bars,
  trades,
  lines,
  candles,
  drawings,
}: {
  name: string
  isin: string
  interval: '15m' | '1h' | '1d' | '1w' | '1mo'
  bars: React.ComponentProps<typeof DepotChart>['bars']
  trades: readonly DepotTrade[]
  lines: readonly PriceLine[]
  candles: ReturnType<typeof useCandles>
  drawings: ReturnType<typeof useDrawings>
}) {
  const [tool, setTool] = useState<DrawTool | null>(null)
  const [selected, setSelected] = useState(0)
  const chart = useRef<DepotChartHandle>(null)
  const save = useDrawingsSaver(isin)
  const notes = candles.data?.notes ?? []
  // The bars on screen may still be the last request's while the next one loads: they say which interval they are.
  const shown = depotInterval(candles.data?.interval, interval)
  const armed = drawings.isSuccess

  return (
    <ChartCard
      data-shot="depot-chart"
      title={candles.data?.currency == null ? name : `${name} · ${candles.data.currency}`}
      info="Candles in the instrument's currency, with turnover in euros below. Day, week and month cover the range; 15 minutes and 1 hour show the last 10 and 30 days whatever the range. An arrow marks a trade on the candle of its day, a circle one whose quantity is an estimate."
      state={{
        pending: candles.isPending,
        error: candles.error ?? undefined,
        empty: bars.length === 0 ? notes.join(' ') || 'No bars for this range.' : false,
      }}
      onRetry={() => void candles.refetch()}
      actions={
        <Box className={classes.tools}>
          <ViewTabs field={finStore.field.ivl} label="Bar interval" />
          <ActionIcon
            variant={tool === null ? 'filled' : 'default'}
            color="gray"
            aria-label="Cursor"
            disabled={!armed}
            onClick={() => setTool(null)}
          >
            <IconPointer />
          </ActionIcon>
          <ActionIcon
            variant={tool === 'horizontal-line' ? 'filled' : 'default'}
            color="gray"
            aria-label="Horizontal line"
            disabled={!armed}
            onClick={() => setTool('horizontal-line')}
          >
            <IconMinus />
          </ActionIcon>
          <ActionIcon
            variant={tool === 'price-range' ? 'filled' : 'default'}
            color="gray"
            aria-label="Price range"
            disabled={!armed}
            onClick={() => setTool('price-range')}
          >
            <IconRulerMeasure />
          </ActionIcon>
          <ActionIcon
            variant="default"
            aria-label="Delete the selected drawing"
            disabled={selected === 0}
            onClick={() => chart.current?.removeSelected()}
          >
            <IconTrash />
          </ActionIcon>
        </Box>
      }
    >
      <DepotChart
        ref={chart}
        bars={bars}
        interval={shown}
        trades={trades}
        lines={lines}
        storedDrawings={drawings.data?.document}
        loadedDrawings={drawings.isSuccess}
        tool={tool}
        onToolChange={setTool}
        onSelectionChange={setSelected}
        onDrawingsChange={save}
      />
    </ChartCard>
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
    tradeCol.accessor('booked_on', { header: 'Booked', cell: (c) => date(c.getValue()) }),
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
    tradeCol.accessor('amount_cents', {
      header: 'Amount',
      sortFn: 'basic',
      meta: { align: 'right' },
      cell: (c) => eurExact(c.getValue()),
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
            {signedEur(c.getValue())}
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
              {date(t.booked_on)} · {t.side === 'buy' ? 'Buy' : 'Sell'}
            </Text>
            <Text size="sm">{eurExact(t.amount_cents)}</Text>
          </Group>
          <Text size="xs" c="dimmed">
            {t.quantity === null
              ? 'quantity unknown'
              : `${t.quantity_source === 'estimated' ? '≈ ' : ''}${quantityText(t.quantity)} units`}
            {t.price === null ? '' : ` at ${priceText(t.price)}`}
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
        return o.overdue ? `${date(o.valid_until)} · past, close it` : date(o.valid_until)
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
                : ` · until ${date(o.valid_until)}${o.overdue ? ', past: close it' : ''}`}
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
