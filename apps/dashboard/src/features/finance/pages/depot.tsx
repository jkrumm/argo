import { ActionIcon, Box, Button, Group, Stack, Text } from '@mantine/core'
import {
  IconMinus,
  IconPointer,
  IconRulerMeasure,
  IconSeparatorVertical,
  IconTrash,
} from '@tabler/icons-react'
import { Section, StatGroup } from 'basalt-ui'
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
  useSeriesCatalog,
  useWatchlist,
} from '../api/queries'
import type { DepotOrder, DepotTrade, WatchlistEntry } from '../api/types'
import { DepotChart, SPLICE_LABEL } from '../components/depot-chart'
import type { DepotChartHandle, DepotSelection, DrawTool } from '../components/depot-chart'
import { DrawingStyleBar } from '../components/drawing-style-bar'
import { FinanceBar } from '../components/finance-bar'
import { IndexHistoryCard, IndexOverlayCard } from '../components/index-charts'
import { NoDataState } from '../components/no-data-state'
import { OrderModal } from '../components/order-modal'
import { WatchPanel } from '../components/watch-panel'
import classes from '../components/depot.module.css'
import {
  costLine,
  costLineUsd,
  depotInterval,
  hasTurnover,
  heldRows,
  instrumentsOf,
  logByDefault,
  mergedPosition,
  orderLine,
  pickInstrument,
  priceText,
  signedPercent,
  TIMEFRAMES,
  timeframeFits,
  volumeByDefault,
} from '../lib/depot-chart'
import type { ColorRole, DepotInterval, PriceLine, Timeframe } from '../lib/depot-chart'
import { deltaEur, eur, eurExact, signedEur, toneProp } from '../lib/format'
import { INDEX_SERIES, seriesOf } from '../lib/index-series'
import { isoDay } from '../lib/time'
import { useDrawingsSaver } from '../lib/use-drawings-saver'
import { useViewPrefs } from '../lib/view-prefs'
import { useField } from '../../../lib/use-field'
import { useNow } from '../../../lib/use-now'
import { finStore } from '../../../lib/window-stores'

const tradeCol = createColumnHelper<DepotTrade>()
const orderCol = createColumnHelper<DepotOrder>()

/** Quantities are fractional for savings plans; four places is the finest the depot keeps. */
const quantityText = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 4 })

/** An ETF with a tracked index and no US listing is asked for its history with the index in front of it. */
const splicedHistory = (entry: WatchlistEntry | undefined): boolean =>
  entry !== undefined && entry.index !== null && entry.us_mic === null && entry.kind !== 'coin'

export function DepotPage() {
  const watchlist = useWatchlist()
  const catalog = useSeriesCatalog()
  const positions = usePositions()
  const [requested, setRequested] = useField(finStore.field.isin)
  const [interval] = useField(finStore.field.ivl)
  const [range] = useField(finStore.field.rng)
  const [compare] = useField(finStore.field.cmp)
  const [adding, setAdding] = useState(false)
  const today = isoDay(new Date(useNow()))

  const entries = watchlist.data ?? []
  const held = heldRows(entries, positions.data?.positions ?? [])
  // The URL names an index series or an instrument: an index has no position, trades or orders.
  const index = seriesOf(requested, catalog.data ?? [])
  const isin = index === undefined ? pickInstrument(requested, entries, held) : null
  const indices = INDEX_SERIES.filter((s) =>
    (catalog.data ?? []).some((info) => info.id === s.id && info.points > 0),
  )
  const entry = entries.find((e) => e.isin === isin)
  // A row may stand for instruments charted as it (a Bitcoin ETP on `BTC-USD`): the depot is theirs.
  const instruments = entry === undefined ? [] : instrumentsOf(entry)
  const owned = (positions.data?.positions ?? []).filter((p) => instruments.includes(p.isin))
  const position = mergedPosition(owned)
  // Orders are kept per ISIN: those of the held instrument, else the first charted as this row.
  const orderIsin = owned.find((p) => p.quantity > 0)?.isin ?? instruments[0] ?? isin

  // Every stored daily bar at once (the timeframes only move the view); an ETF with a tracked index
  // comes with that index in front of its first bar.
  const candles = useCandles(
    isin === null
      ? null
      : {
          isin,
          interval,
          // A US stock is charted on its US listing, in dollars.
          mic: entry?.us_mic ?? undefined,
          splice: splicedHistory(entry) ? 'index' : undefined,
        },
  )
  const trades = useDepotTrades(isin)
  const orders = useOpenOrders(orderIsin)
  const drawings = useDrawings(isin)

  if (watchlist.isSuccess && entries.length === 0) return <NoDataState />

  const bars = candles.data?.candles ?? []
  const currency = candles.data?.currency ?? null
  const euro = currency === null || currency === 'EUR'
  // Orders and the cost have euro prices: in dollars only the cost has one (from the dollar price of its buys).
  const lines: PriceLine[] = (
    euro
      ? [...(orders.data ?? []).map(orderLine), costLine(position)]
      : [owned.length === 1 ? costLineUsd(position, trades.data ?? []) : null]
  ).filter((l) => l !== null)
  const comparable = entry !== undefined && entry.kind !== 'coin' && entry.us_mic === null
  const comparing = comparable && compare !== ''

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
        // The chart zooms by timeframe; the range is only for the index card and the comparison.
        filters={
          index !== undefined || comparing ? (
            <FilterSet>
              <SelectFilter field={finStore.field.rng} label="Range" />
            </FilterSet>
          ) : undefined
        }
      />
      <Box className={classes.layout}>
        <WatchPanel
          entries={entries}
          positions={positions.data?.positions ?? []}
          indices={indices}
          catalog={catalog.data ?? []}
          active={index?.id ?? isin}
          pending={watchlist.isPending}
          error={watchlist.error}
          onPick={setRequested}
        />
        {index !== undefined && (
          <Stack key={index.id} className={classes.main} gap="sm">
            <IndexHistoryCard index={index} range={range} today={today} />
          </Stack>
        )}
        {isin !== null && entry !== undefined && (
          <Stack key={isin} className={classes.main} gap="sm">
            <ChartPanel
              name={entry.name ?? isin}
              isin={isin}
              kind={entry.kind}
              interval={interval}
              currency={currency}
              bars={bars}
              trades={trades.data ?? []}
              lines={lines}
              candles={candles}
              drawings={drawings}
              comparable={comparable}
            />
            {comparing && (
              <IndexOverlayCard isin={isin} name={entry.name ?? isin} range={range} today={today} />
            )}
            <Box data-shot="depot-position">
              <StatGroup variant="strip" label="The position at a glance" cols={4} cells={cells} />
            </Box>
            <Box data-shot="depot-trades">
              <TradesTable trades={trades.data ?? []} query={trades} />
            </Box>
            <OrdersSection
              isin={orderIsin ?? isin}
              orders={orders.data ?? []}
              query={orders}
              onAdd={() => setAdding(true)}
            />
          </Stack>
        )}
      </Box>
      {adding && orderIsin !== null && (
        <OrderModal isin={orderIsin} onClose={() => setAdding(false)} />
      )}
    </Box>
  )
}

function ChartPanel({
  name,
  isin,
  kind,
  interval,
  currency,
  bars,
  trades,
  lines,
  candles,
  drawings,
  comparable,
}: {
  name: string
  isin: string
  kind: string | null
  interval: DepotInterval
  currency: string | null
  bars: React.ComponentProps<typeof DepotChart>['bars']
  trades: readonly DepotTrade[]
  lines: readonly PriceLine[]
  candles: ReturnType<typeof useCandles>
  drawings: ReturnType<typeof useDrawings>
  comparable: boolean
}) {
  const [tool, setTool] = useState<DrawTool | null>(null)
  const [role, setRole] = useState<ColorRole>('accent')
  const [selection, setSelection] = useState<DepotSelection>({ count: 0, line: null, single: null })
  const [timeframe, setTimeframe] = useState<Timeframe | null>(null)
  const [prefs, setPrefs] = useViewPrefs(isin)
  const chart = useRef<DepotChartHandle>(null)
  const save = useDrawingsSaver(isin)
  const notes = candles.data?.notes ?? []
  // The bars on screen may still be the last request's while the next one loads: they say which interval they are.
  const shown = depotInterval(candles.data?.interval, interval)
  const armed = drawings.isSuccess
  const log = prefs.log ?? logByDefault(kind)
  const turnover = hasTurnover(bars)
  const volume = turnover && (prefs.volume ?? volumeByDefault(kind, bars))
  const spliced = bars.some((bar) => bar.source === 'index')
  const styling =
    (tool !== null && tool !== 'price-range') || (tool === null && selection.single !== null)

  // While a tool is armed the colour is for the next line drawn and the selection is left alone; with the cursor it recolours the selected line.
  const editing: DepotSelection = tool === null ? selection : { count: 0, line: null, single: null }
  const pick = (next: ColorRole) => {
    setRole(next)
    if (tool === null) chart.current?.setSelectionRole(next)
  }
  const toolButton = (own: DrawTool, label: string, icon: React.ReactNode) => (
    <ActionIcon
      variant={tool === own ? 'filled' : 'default'}
      color="gray"
      aria-label={label}
      aria-pressed={tool === own}
      disabled={!armed}
      onClick={() => setTool(own)}
    >
      {icon}
    </ActionIcon>
  )

  return (
    <ChartCard
      data-shot="depot-chart"
      title={candles.data?.currency == null ? name : `${name} · ${candles.data.currency}`}
      info={`Daily candles over the whole stored history in the instrument's currency (Bitcoin and US stocks in dollars); the buttons under the chart only set the visible range, drag and scroll to move and zoom. An arrow marks the trades of a day, week or month with their count, a circle those whose quantity is an estimate; hover or tap one for its card. ${spliced ? `${SPLICE_LABEL}: before the ETF's first bar the grey line is the index it tracks, converted to the ETF's currency and scaled to meet its first close; it carries no dividends. ` : ''}Lines you draw are saved per instrument.`}
      state={{
        pending: candles.isPending,
        error: candles.error ?? undefined,
        empty:
          bars.length === 0 ? notes.join(' ') || 'No bars stored for this instrument yet.' : false,
      }}
      onRetry={() => void candles.refetch()}
      actions={
        <Box className={classes.tools}>
          {comparable && <SelectFilter field={finStore.field.cmp} label="Compare with…" />}
          <ViewTabs field={finStore.field.ivl} label="Bar interval" />
          <ActionIcon
            variant={tool === null ? 'filled' : 'default'}
            color="gray"
            aria-label="Cursor"
            aria-pressed={tool === null}
            disabled={!armed}
            onClick={() => setTool(null)}
          >
            <IconPointer />
          </ActionIcon>
          {toolButton('horizontal-line', 'Horizontal line', <IconMinus />)}
          {toolButton('vertical-line', 'Vertical line', <IconSeparatorVertical />)}
          {toolButton('price-range', 'Price range', <IconRulerMeasure />)}
          <ActionIcon
            variant="default"
            aria-label="Delete the selected drawing"
            disabled={selection.count === 0}
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
        currency={currency}
        trades={trades}
        lines={lines}
        storedDrawings={drawings.data?.document}
        loadedDrawings={drawings.isSuccess}
        tool={tool}
        role={role}
        logScale={log}
        showVolume={volume}
        onToolChange={setTool}
        onSelectionChange={setSelection}
        onDrawingsChange={save}
        onTimeframeChange={setTimeframe}
      />
      <Box className={classes.toolbar} data-shot="depot-toolbar">
        <Group gap={4} role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((frame) => (
            <Button
              key={frame}
              variant={timeframe === frame ? 'filled' : 'default'}
              color="gray"
              aria-pressed={timeframe === frame}
              disabled={bars.length === 0 || !timeframeFits(frame, shown)}
              onClick={() => chart.current?.setTimeframe(frame)}
            >
              {frame}
            </Button>
          ))}
        </Group>
        <Group gap={4} role="group" aria-label="Chart view">
          <Button
            variant={log ? 'filled' : 'default'}
            color="gray"
            aria-pressed={log}
            aria-label="Logarithmic price scale"
            onClick={() => setPrefs({ log: !log })}
          >
            Log
          </Button>
          <Button
            variant={volume ? 'filled' : 'default'}
            color="gray"
            aria-pressed={volume}
            aria-label="Show turnover"
            disabled={!turnover}
            onClick={() => setPrefs({ volume: !volume })}
          >
            Volume
          </Button>
        </Group>
      </Box>
      {styling && (
        <DrawingStyleBar
          role={role}
          onRole={pick}
          selection={editing}
          onLabel={(label) => chart.current?.setSelectionLabel(label)}
          onPrice={(id, price) => chart.current?.setLinePrice(id, price)}
        />
      )}
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
            {t.price_usd === null ? '' : ` ($${priceText(t.price_usd)})`}
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
