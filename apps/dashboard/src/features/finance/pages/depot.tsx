import { Box, Stack } from '@mantine/core'
import { EmptyState } from 'basalt-ui'
import { useState } from 'react'
import { useLists } from '../api/lists'
import {
  useCandles,
  useDepotStats,
  useDepotTrades,
  useDrawings,
  useIndexSeries,
  useOpenOrders,
  usePositions,
  useSeriesCatalog,
  useWatchlist,
} from '../api/queries'
import { CbbiPanel } from '../components/cbbi-panel'
import { ChartPanel } from '../components/depot-chart-panel'
import { DepotBackfillPanel } from '../components/depot-backfill-panel'
import { DepotBoard } from '../components/depot-board'
import { DepotDetails } from '../components/depot-details'
import { DepotSidebarPanel } from '../components/depot-sidebar-panel'
import { DepotTabsPanel } from '../components/depot-tabs-panel'
import { DepotBar } from '../components/depot-bar'
import { NoDataState } from '../components/no-data-state'
import { OrderModal } from '../components/order-modal'
import classes from '../components/depot.module.css'
import {
  allTimeHigh,
  costLine,
  costLineUsd,
  daysBefore,
  heldRows,
  instrumentsOf,
  mergedPosition,
  orderLine,
} from '../lib/depot-chart'
import type { PriceLine } from '../lib/depot-chart'
import {
  awaitsHistory,
  closeOnlyDaily,
  defaultTabId,
  DEPOT_TAB,
  hiddenTabs,
  navTabs,
  pickSymbol,
  resolveTab,
  splicedHistory,
  tabHolding,
  tabItems,
  viewAfterPick,
} from '../lib/depot-nav'
import { useHiddenTabs } from '../lib/depot-prefs'
import { INDEX_IDS, INDEX_SERIES } from '../lib/index-series'
import { isoDay } from '../lib/time'
import { useField } from '../../../lib/use-field'
import { useNow } from '../../../lib/use-now'
import { finStore } from '../../../lib/window-stores'

const BITCOIN = 'BTC-USD'

export function DepotPage() {
  const watchlist = useWatchlist()
  const lists = useLists()
  const catalog = useSeriesCatalog()
  const positions = usePositions()
  const [requested, setRequested] = useField(finStore.field.isin)
  const [requestedTab, setTab] = useField(finStore.field.tab)
  const [view, setView] = useField(finStore.field.view)
  const [interval] = useField(finStore.field.ivl)
  const [compare, setCompare] = useField(finStore.field.cmp)
  const [hiddenIds, setHidden] = useHiddenTabs()
  const [adding, setAdding] = useState(false)
  const today = isoDay(new Date(useNow()))

  const entries = watchlist.data ?? []
  const userLists = lists.data ?? []
  const allPositions = positions.data?.positions ?? []
  const held = heldRows(entries, allPositions)

  // The tab, its rows as the sidebar lists them, and the one the main area shows.
  const tabs = navTabs(userLists, hiddenIds)
  const preferred = resolveTab(tabs, requestedTab, defaultTabId(tabs, held.size > 0))
  // A link that names an instrument and no tab opens on the first tab that lists it.
  const holding =
    requestedTab === '' && requested !== ''
      ? tabHolding(
          [...tabs.filter((t) => t.id === preferred), ...tabs.filter((t) => t.id !== preferred)],
          requested,
          userLists,
          entries,
          allPositions,
        )
      : null
  const tabId = holding ?? preferred
  const tab = tabs.find((t) => t.id === tabId)
  const items = tabItems(tab, userLists, entries, allPositions)
  const symbol = pickSymbol(requested, items, tabId === DEPOT_TAB)
  const entry = items.find((item) => item.symbol === symbol)?.quote
  const isin = entry === undefined ? null : symbol
  // An index or a series is a price history only: it has no position, trades or orders.
  const tradable = entry !== undefined && entry.kind !== 'index' && entry.kind !== 'series'
  const awaiting = entry !== undefined && awaitsHistory(entry)
  const indices = INDEX_SERIES.filter((s) =>
    (catalog.data ?? []).some((info) => info.id === s.id && info.points > 0),
  )

  // A row may stand for instruments charted as it (a Bitcoin ETP on `BTC-USD`): the depot is theirs.
  const instruments = entry === undefined || !tradable ? [] : instrumentsOf(entry)
  const owned = allPositions.filter((p) => instruments.includes(p.isin))
  const position = mergedPosition(owned)
  // Orders are kept per ISIN: those of the held instrument, else the first charted as this row.
  const orderIsin = tradable
    ? (owned.find((p) => p.quantity > 0)?.isin ?? instruments[0] ?? isin)
    : null

  const charting = view === 'chart' && !awaiting
  // Every stored daily bar at once (the timeframes only move the view); an ETF with a tracked index
  // comes with that index in front of its first bar.
  const candles = useCandles(
    isin === null || !charting
      ? null
      : {
          isin,
          interval,
          // A US stock is charted on its US listing, in dollars.
          mic: entry?.us_mic ?? undefined,
          splice: splicedHistory(entry) ? 'index' : undefined,
        },
  )
  const trades = useDepotTrades(tradable && view !== 'board' ? isin : null)
  const orders = useOpenOrders(view === 'board' ? null : orderIsin)
  const drawings = useDrawings(charting ? isin : null)
  const stats = useDepotStats(tradable && view === 'details' ? isin : null)

  const bars = candles.data?.candles ?? []
  const currency = candles.data?.currency ?? null
  const euro = currency === null || currency === 'EUR'
  const asLine = closeOnlyDaily(bars, interval)
  // An order has a euro price. A US stock charted in dollars shows it at the latest ECB rate, labelled in both
  // currencies; a coin's order belongs to a product whose price is not the coin's, so it has no line there.
  const stockInDollars = !euro && entry?.us_mic != null
  const rate = useIndexSeries(stockInDollars && charting ? 'eur-usd' : null, {
    from: daysBefore(today, 14),
    to: today,
  })
  const usdPerEur = rate.data?.points.at(-1)?.value ?? null
  // A locked vault answers the orders with 423: no data, so no line and no error on the chart.
  const open = orders.data ?? []
  const lines: PriceLine[] = (
    euro
      ? [...open.map((order) => orderLine(order)), costLine(position)]
      : [
          ...(stockInDollars && usdPerEur !== null
            ? open.map((order) => orderLine(order, usdPerEur))
            : []),
          owned.length === 1 ? costLineUsd(position, trades.data ?? []) : null,
        ]
  ).filter((l) => l !== null)
  const comparable =
    entry !== undefined && tradable && entry.kind !== 'coin' && entry.us_mic === null

  // The all-time high comes from the full daily history: the chart's own bars at day, one more request at week and month.
  const daily = useCandles(
    isin === null || !charting || interval === '1d'
      ? null
      : { isin, interval: '1d', mic: entry?.us_mic ?? undefined },
  )
  const dailyBars = interval === '1d' ? bars : daily.data?.candles
  const dailyReady = interval === '1d' ? !candles.isPlaceholderData : !daily.isPlaceholderData
  const high = dailyReady && dailyBars !== undefined ? allTimeHigh(dailyBars) : null
  const lastClose = dailyBars?.findLast((bar) => bar.source !== 'index')?.close ?? null

  if (
    watchlist.isSuccess &&
    entries.length === 0 &&
    userLists.every((l) => l.entries.length === 0)
  ) {
    return <NoDataState />
  }

  const name = entry?.name ?? isin ?? ''
  const openChart = (next: string) => {
    setRequested(next)
    setView('chart')
  }
  // A pick in the sidebar keeps Chart or Details; a Board row and a newly added instrument open the chart.
  const pick = (next: string) => {
    setRequested(next)
    setView(viewAfterPick(view))
  }

  const main = (() => {
    if (view === 'board' && tab !== undefined) {
      return <DepotBoard tab={tab} lists={userLists} items={items} onOpen={openChart} />
    }
    if (isin === null || entry === undefined) {
      return (
        <EmptyState
          tier="section"
          title="Nothing to show on this tab"
          description="Press / and search to add an instrument to a list."
        />
      )
    }
    if (view === 'details') {
      return (
        <DepotDetails
          name={name}
          tradable={tradable}
          position={position}
          positionPending={positions.isPending}
          stats={stats}
          trades={trades}
          orders={orders}
          orderIsin={orderIsin ?? isin}
          onAddOrder={() => setAdding(true)}
        />
      )
    }
    if (awaiting) return <DepotBackfillPanel symbol={isin} name={name} lists={userLists} />
    return (
      <>
        <ChartPanel
          name={name}
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
          indices={indices}
          compareId={compare}
          onCompare={(id) => setCompare(INDEX_IDS.find((known) => known === id) ?? '')}
          high={high}
          lastClose={lastClose}
          today={today}
          line={asLine}
        />
        {isin === BITCOIN && (
          <Box className={classes.below}>
            <CbbiPanel today={today} />
          </Box>
        )}
      </>
    )
  })()

  // The chart fills the viewport height below the page bar on a wide page; the other views take their own height.
  const fill = charting && isin !== null
  return (
    <Box className={classes.page}>
      <Box className={classes.body} data-fill={fill}>
        <DepotBar />
        <DepotTabsPanel
          tabs={tabs}
          active={tabId}
          lists={userLists}
          hidden={hiddenTabs(hiddenIds)}
          onSelect={setTab}
          onHide={(id) => {
            setHidden(id, true)
            if (id === tabId) setTab('')
          }}
          onShow={(id) => {
            setHidden(id, false)
            setTab(id)
          }}
        />
        <Box className={classes.layout}>
          {tab !== undefined && (
            <DepotSidebarPanel
              tab={tab}
              lists={userLists}
              items={items}
              active={isin}
              pending={watchlist.isPending}
              error={watchlist.error}
              listsError={lists.error}
              onPick={pick}
              onBoard={(next) => {
                setRequested(next)
                setView('board')
              }}
              onAdded={(next, nextTab) => {
                setTab(nextTab)
                openChart(next)
              }}
            />
          )}
          <Stack key={`${view}:${isin}`} className={classes.main} gap="sm">
            {main}
          </Stack>
        </Box>
      </Box>
      {adding && orderIsin !== null && (
        <OrderModal isin={orderIsin} onClose={() => setAdding(false)} />
      )}
    </Box>
  )
}
