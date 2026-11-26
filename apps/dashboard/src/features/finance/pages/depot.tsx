import { Box, Stack } from '@mantine/core'
import { EmptyState } from 'basalt-ui'
import { useState } from 'react'
import { useLists } from '../api/lists'
import {
  useAllOpenOrders,
  useAllTrades,
  useDailyBars,
  useDepotStats,
  useDepotTrades,
  useDrawings,
  useOpenOrders,
  usePositions,
  useQuotes,
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
import type { DepotTrade } from '../api/types'
import {
  allTimeHigh,
  costLine,
  costLineUsd,
  heldRows,
  instrumentsOf,
  mergedPosition,
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
  tabHolding,
  tabItems,
  viewAfterPick,
} from '../lib/depot-nav'
import { EUR_LINE_MIC, orderLine, quoteLines } from '../lib/depot-live'
import { useHiddenTabs } from '../lib/depot-prefs'
import { INDEX_IDS, INDEX_SERIES } from '../lib/index-series'
import { isoDay } from '../lib/time'
import { atIndexLevel, indexFactor, trackersOf } from '../lib/depot-tracking'
import { tradesDirect, useDepotSeries } from '../lib/use-depot-series'
import { useViewPrefs } from '../lib/view-prefs'
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
  const orderIsinOf = (charted: readonly string[]): string | undefined =>
    allPositions.find((p) => p.quantity > 0 && charted.includes(p.isin))?.isin ?? charted[0]
  const orderIsin = tradable ? (orderIsinOf(instruments) ?? isin) : null

  // An index or a series has nothing of its own to hold: it shows the ETFs that track it.
  // The held ones first: the order form preselects the first.
  const trackers = (
    entry !== undefined && !tradable && isin !== null ? trackersOf(entries, isin) : []
  ).toSorted((a, b) => Number(held.has(b.isin)) - Number(held.has(a.isin)))
  const tracking = trackers.length > 0
  const trackedIsins = trackers.flatMap((t) => instrumentsOf(t))
  const trackerOf = (instrument: string) =>
    trackers.find((t) => instrumentsOf(t).includes(instrument))
  // What an order can be added for: the instrument itself, or each ETF that tracks the index.
  const choices = tracking
    ? trackers.map((t) => ({
        isin: orderIsinOf(instrumentsOf(t)) ?? t.isin,
        name: t.name ?? t.isin,
      }))
    : orderIsin === null
      ? []
      : [{ isin: orderIsin, name: entry?.name ?? orderIsin }]

  const charting = view === 'chart' && !awaiting
  // The charted listing's own quote: a US stock's chart is its US listing, anything else the euro line.
  const [prefs] = useViewPrefs(isin ?? '')
  const direct = prefs.venue === 'direct' && tradesDirect(entry)
  const chartMic = entry?.us_mic != null && !direct ? undefined : EUR_LINE_MIC
  const chartQuotes = useQuotes(charting && isin !== null ? [isin] : [], chartMic)
  const chartQuote = isin === null ? undefined : chartQuotes.quotes.get(isin)
  // The rows of the sidebar and the Board, as euro lines like their stored closes.
  const rowQuotes = useQuotes(
    items.map((item) => item.symbol),
    EUR_LINE_MIC,
  )
  const series = useDepotSeries({
    entry,
    isin,
    interval,
    charting,
    today,
    every: chartQuotes.every,
  })
  const { bars, currency, dailyBars } = series
  const trades = useDepotTrades(tradable && view !== 'board' ? isin : null)
  const orders = useOpenOrders(view === 'board' ? null : orderIsin)
  const allTrades = useAllTrades(tracking && view !== 'board')
  const allOrders = useAllOpenOrders(tracking && view !== 'board')
  const trackedTrades = (allTrades.data ?? []).filter((t) => trackedIsins.includes(t.isin))
  // A locked vault answers the orders with 423: no data, so no line and no error on the chart.
  const trackedOrders = (allOrders.data ?? []).filter((o) => trackedIsins.includes(o.isin))
  const trackerBars = useDailyBars(
    charting ? trackers.map((t) => ({ isin: t.isin, interval: '1d' })) : [],
  )
  const drawings = useDrawings(charting ? isin : null)
  // The all-time statistics belong to one instrument: this one, or the only ETF of an index.
  const statsIsin = tradable ? isin : trackers.length === 1 ? (trackers[0]?.isin ?? null) : null
  const stats = useDepotStats(view === 'details' ? statsIsin : null)

  const asLine = closeOnlyDaily(bars, series.interval)

  /** What one euro of a tracking ETF's price is on this index chart. */
  const factorOf = (instrument: string): number | null => {
    const tracker = trackerOf(instrument)
    return tracker === undefined
      ? null
      : indexFactor(dailyBars ?? [], trackerBars.bars.get(tracker.isin) ?? [])
  }
  const markLevel = tracking
    ? (trade: DepotTrade): number | undefined => {
        const factor = factorOf(trade.isin)
        return trade.price === null || factor === null ? undefined : trade.price * factor
      }
    : undefined
  // ING Direkthandel's bid and ask of what an order can be for: the lines, the order labels and the order form.
  const orderQuotes = useQuotes(
    view === 'board'
      ? []
      : [
          ...choices.map((c) => c.isin),
          ...(orders.data ?? []).map((o) => o.isin),
          ...trackedOrders.map((o) => o.isin),
        ],
    EUR_LINE_MIC,
  ).quotes
  const trackedLines = trackedOrders.flatMap((order) => {
    const line = orderLine(order, null, orderQuotes.get(order.isin))
    const factor = factorOf(order.isin)
    const name = trackers.length > 1 ? (trackerOf(order.isin)?.name ?? order.isin) : undefined
    return line === null || factor === null ? [] : [atIndexLevel(line, factor, name)]
  })

  // An order has a euro price. A US stock charted in dollars shows it at the latest ECB rate, labelled in both
  // currencies; a coin's order belongs to a product whose price is not the coin's, so it has no line there.
  const euro = currency === null || currency === 'EUR'
  const stockInDollars = !euro && entry?.us_mic != null
  const open = orders.data ?? []
  const usdPerEur = series.rate?.usdPerEur ?? null
  const ownLines = (): (PriceLine | null)[] => {
    if (series.converting && entry?.kind === 'coin') {
      // Only a coin held directly has a cost in the coin's own price; an ETP's does not belong on this chart.
      return [owned.length === 1 && instruments.includes(isin ?? '') ? costLine(position) : null]
    }
    // A coin has no bid and ask of its own here: its ETP's price is not the coin's.
    const spread = tradable && entry?.kind !== 'coin' && isin !== null ? isin : null
    const quoted = spread === null ? undefined : orderQuotes.get(spread)
    if (euro) {
      return [
        ...open.map((order) => orderLine(order, null, orderQuotes.get(order.isin))),
        costLine(position),
        ...quoteLines(quoted),
      ]
    }
    return [
      ...(stockInDollars && usdPerEur !== null
        ? [
            ...open.map((order) => orderLine(order, usdPerEur, orderQuotes.get(order.isin))),
            ...quoteLines(quoted, usdPerEur),
          ]
        : []),
      owned.length === 1 ? costLineUsd(position, trades.data ?? []) : null,
    ]
  }
  const lines: PriceLine[] = tracking ? trackedLines : ownLines().filter((l) => l !== null)
  const comparable =
    entry !== undefined && tradable && entry.kind !== 'coin' && entry.us_mic === null

  const high = dailyBars === undefined ? null : allTimeHigh(dailyBars)
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
      return (
        <DepotBoard
          tab={tab}
          lists={userLists}
          items={items}
          quotes={rowQuotes.quotes}
          onOpen={openChart}
        />
      )
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
          holdings={
            tracking
              ? trackers.map((t) => ({
                  isin: t.isin,
                  name: t.name ?? t.isin,
                  position: mergedPosition(
                    allPositions.filter((p) => instrumentsOf(t).includes(p.isin)),
                  ),
                }))
              : tradable
                ? [{ isin, name, position }]
                : []
          }
          tracking={tracking}
          ordersSubject={
            tracking ? trackers.map((t) => t.name ?? t.isin).join(', ') : (orderIsin ?? name)
          }
          positionPending={positions.isPending}
          stats={statsIsin === null ? null : stats}
          trades={tracking ? trackedTrades : (trades.data ?? [])}
          tradesQuery={tracking ? allTrades : trades}
          orders={tracking ? trackedOrders : open}
          ordersQuery={tracking ? allOrders : orders}
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
          series={series}
          trades={tracking ? trackedTrades : (trades.data ?? [])}
          markLevel={markLevel}
          tracked={trackers.map((t) => t.name ?? t.isin)}
          lines={lines}
          drawings={drawings}
          comparable={comparable}
          indices={indices}
          compareId={compare}
          onCompare={(id) => setCompare(INDEX_IDS.find((known) => known === id) ?? '')}
          high={high}
          lastClose={lastClose}
          today={today}
          line={asLine}
          quote={chartQuote}
          venues={tradable && tradesDirect(entry) ? { usMic: entry.us_mic } : null}
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
              quotes={rowQuotes.quotes}
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
      {adding && choices.length > 0 && (
        <OrderModal
          choices={choices}
          choose={tracking}
          rate={series.rate}
          quotes={orderQuotes}
          onClose={() => setAdding(false)}
        />
      )}
    </Box>
  )
}
