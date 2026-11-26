import { Box, Button, Group, Text, Tooltip } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { ViewTabs } from 'basalt-ui/controls'
import { useRef, useState } from 'react'
import { useDrawings, useIndexSeries } from '../api/queries'
import type { DepotTrade, MarketQuote } from '../api/types'
import { ComparePopover } from './compare-popover'
import { DepotChart, SPLICE_LABEL } from './depot-chart'
import type { CompareLine, DepotChartHandle, DepotSelection, DrawTool } from './depot-chart'
import { DrawToolbar } from './draw-toolbar'
import { DrawingEditor } from './drawing-editor'
import { QuoteState } from './quote-line'
import classes from './depot.module.css'
import {
  distanceFromHigh,
  hasTurnover,
  levelsAtBars,
  logByDefault,
  TIMEFRAMES,
  timeframeFits,
  volumeByDefault,
} from '../lib/depot-chart'
import type { AllTimeHigh, ColorRole, PriceLine, RangeChange, Timeframe } from '../lib/depot-chart'
import { euroTitle, scaleDrawings } from '../lib/depot-currency'
import type { ChartCurrency } from '../lib/depot-currency'
import { DIRECT_VENUE } from '../lib/depot-live'
import { dayDe, percentDe, priceDe } from '../lib/depot-number'
import type { IndexSeries } from '../lib/index-series'
import { useLineLabels } from '../lib/depot-prefs'
import type { DepotSeries } from '../lib/use-depot-series'
import { useDrawingsSaver } from '../lib/use-drawings-saver'
import { useViewPrefs } from '../lib/view-prefs'
import { finStore } from '../../../lib/window-stores'

const CURRENCIES: readonly ChartCurrency[] = ['USD', 'EUR']

/** What the venue switch calls the exchange the long history comes from. */
const exchangeName = (mic: string | null): string => {
  if (mic === null) return 'Xetra'
  if (mic === 'XNAS') return 'Nasdaq'
  return mic === 'XNYS' ? 'NYSE' : mic
}

export function ChartPanel({
  name,
  isin,
  kind,
  series,
  trades,
  markLevel,
  tracked,
  lines,
  drawings,
  comparable,
  indices,
  compareId,
  onCompare,
  high,
  lastClose,
  today,
  line: asLine,
  quote,
  venues,
}: {
  name: string
  isin: string
  kind: string | null
  /** The bars on screen and the currency they are in. */
  series: DepotSeries
  trades: readonly DepotTrade[]
  /** Where a trade's marker sits when it is an ETF's trade on its index chart. */
  markLevel: ((trade: DepotTrade) => number | undefined) | undefined
  /** The names of the ETFs whose orders and trades an index chart shows; empty on any other chart. */
  tracked: readonly string[]
  lines: readonly PriceLine[]
  drawings: ReturnType<typeof useDrawings>
  comparable: boolean
  indices: readonly IndexSeries[]
  compareId: string
  onCompare: (id: string) => void
  high: AllTimeHigh | null
  lastClose: number | null
  today: string
  /** The bars are the close of a daily series: drawn as one line. */
  line: boolean
  /** The live quote of the charted listing. */
  quote: MarketQuote | undefined
  /** The venue switch of a share or fund: the MIC of its US listing (null: Xetra). Null where there is no switch. */
  venues: { usMic: string | null } | null
}) {
  const [tool, setTool] = useState<DrawTool | null>(null)
  const [role, setRole] = useState<ColorRole>('accent')
  const [selection, setSelection] = useState<DepotSelection>({ count: 0, line: null, single: null })
  const [timeframe, setTimeframe] = useState<Timeframe | null>(null)
  const [change, setChange] = useState<RangeChange | null>(null)
  const [prefs, setPrefs] = useViewPrefs(isin)
  const [labels, setLabels] = useLineLabels()
  const chart = useRef<DepotChartHandle>(null)
  const save = useDrawingsSaver(isin)
  const { bars, currency, notes, drawScale } = series
  // The bars on screen may still be the last request's while the next one loads: they say which interval they are.
  const shown = series.interval
  const armed = drawings.isSuccess
  const log = prefs.log ?? logByDefault(kind)
  const turnover = hasTurnover(bars)
  const volume = turnover && (prefs.volume ?? volumeByDefault(kind, bars))
  const spliced = !asLine && bars.some((bar) => bar.source === 'index')
  // A chart in another currency is another chart: its drawings and scale are read again.
  const switchCurrency = (next: ChartCurrency) => {
    setTool(null)
    setSelection({ count: 0, line: null, single: null })
    setPrefs({ currency: next })
  }

  // The compared index, as a line on the bars' own times: the chart rebases it with the candles.
  const picked = comparable ? indices.find((index) => index.id === compareId) : undefined
  const levels = useIndexSeries(picked?.id ?? null, { to: today })
  const levelLine =
    picked === undefined || levels.data === undefined || levels.data.id !== picked.id
      ? null
      : levelsAtBars(bars, levels.data.points)
  const compare: CompareLine | null =
    picked === undefined || levelLine === null || levelLine.length === 0
      ? null
      : { name: picked.name, points: levelLine }
  const comparing = compare !== null

  // A state replaces the card's body, the toolbar with it: on Direkthandel the switch then moves to the header, so a
  // venue with nothing to show can always be left.
  const blocked = series.pending || series.error !== null || bars.length === 0
  const venueSwitch =
    venues === null ? null : (
      <Group gap={4} role="group" aria-label="Venue">
        {(['exchange', 'direct'] as const).map((venue) => (
          <Button
            key={venue}
            variant={series.direct === (venue === 'direct') ? 'filled' : 'default'}
            color="gray"
            aria-pressed={series.direct === (venue === 'direct')}
            onClick={() => switchVenue(venue)}
          >
            {venue === 'direct' ? DIRECT_VENUE : exchangeName(venues.usMic)}
          </Button>
        ))}
      </Group>
    )

  // A line is coloured from the toolbar: the colour of the next one drawn, or the selected line's own.
  const pick = (next: ColorRole) => {
    setRole(next)
    if (tool === null) chart.current?.setSelectionRole(next)
  }
  const currentRole = tool === null ? (selection.single?.role ?? role) : role
  const symbol = currency === 'USD' ? 'USD' : 'EUR'
  // The live price in the chart's currency; the distance from the high is read with it while there is one.
  const live =
    quote?.last == null
      ? null
      : quote.currency === currency
        ? quote.last
        : quote.currency === 'USD' && currency === 'EUR' && series.rate !== null
          ? quote.last / series.rate.usdPerEur
          : null
  const price = live ?? lastClose
  const distance =
    high === null || price === null ? null : distanceFromHigh(price, Math.max(high.price, price))
  const newest = bars.at(-1)
  // Counted from the days: a week or month bar that holds today holds stored days too.
  const stored = (series.dailyBars ?? []).filter((bar) => bar.provisional !== true)
  // A chart on another venue is another chart: what is drawn and selected is read again.
  const switchVenue = (next: 'exchange' | 'direct') => {
    setTool(null)
    setSelection({ count: 0, line: null, single: null })
    setPrefs({ venue: next })
  }

  return (
    <ChartCard
      data-shot="depot-chart"
      className={classes.chartCard}
      classNames={{ body: classes.chartBody }}
      style={{ minHeight: 'var(--depot-chart-min, 0px)' }}
      title={
        series.direct
          ? `${name} · ${DIRECT_VENUE}`
          : series.converting
            ? euroTitle(name)
            : currency === null || name.includes(currency)
              ? name
              : `${name} · ${currency}`
      }
      {...(high !== null && {
        facts: [
          // The price now comes first: the high beside it is no price to set an order against.
          ...(live === null || quote === undefined
            ? []
            : [
                {
                  value: priceDe(live),
                  unit: symbol === 'USD' ? '$' : '€',
                  comparison: <QuoteState quote={quote} coin={kind === 'coin'} bar={newest} />,
                },
              ]),
          {
            value: priceDe(high.price),
            unit: symbol === 'USD' ? '$' : '€',
            // Direkthandel's own history is short: its high is no all-time high.
            period: [series.direct ? 'High since it is stored' : 'All-time high', dayDe(high.time)],
          },
          ...(distance === null
            ? []
            : [
                {
                  // A node keeps the real minus sign (a text comparison would take a direction glyph instead).
                  value: <>{percentDe(distance, true)}</>,
                  unit:
                    live === null || quote?.session === 'closed'
                      ? 'last close vs. high'
                      : 'now vs. high',
                },
              ]),
        ],
      })}
      info={`${asLine ? 'This series sends one close a day, so the daily chart is a line; the week and month intervals show candles built from the closes. ' : ''}The price over the chart is live while the market trades (asked every minute; ING Direkthandel's for a euro line) and the newest candle is the running day of the chosen venue, 15 minutes behind on Xetra. Direkthandel's dotted lines are its bid (Geld) and ask (Brief); an order's label says how far its price is from the side it has to meet. The venue switch picks the exchange or ING Direkthandel's own days; the two close hours apart and are never mixed. Daily candles over the whole stored history in the instrument's currency (Bitcoin, US stocks and dollar indices in dollars, or in euros with the EUR button, each day at its ECB rate); the buttons under the chart only set the visible range, drag and scroll to move and zoom. The all-time high is the highest daily high, the running day included, and the percentage is the distance of the live price (without one: the last close) from it. An arrow marks the trades of a day, week or month with their count, a circle those whose quantity is an estimate; hover or tap one for its card. Dashed lines are your open orders at their limit or stop, on a US stock's dollar chart at the latest ECB rate. ${tracked.length > 0 ? `The orders and trades are those of ${tracked.join(', ')}, which ${tracked.length > 1 ? 'track' : 'tracks'} this index: each sits as far from the index close as its price from the ETF's close on their latest common day, and is labelled with the ETF's own price. ` : ''}${spliced ? `${SPLICE_LABEL}: before the ETF's first bar the lighter candles are the index it tracks, converted to the ETF's currency and scaled to meet its first close; it carries no dividends. ` : ''}Lines you draw are saved per instrument.`}
      state={{
        pending: series.pending,
        error: series.error ?? undefined,
        empty:
          bars.length === 0 ? notes.join(' ') || 'No bars stored for this instrument yet.' : false,
      }}
      onRetry={series.refetch}
      actions={
        <Box className={classes.tools}>
          {blocked && series.direct && venueSwitch}
          <ViewTabs field={finStore.field.ivl} label="Bar interval" />
          <DrawToolbar
            tool={tool}
            armed={armed}
            role={currentRole}
            canDelete={selection.count > 0}
            onTool={setTool}
            onRole={pick}
            onDelete={() => chart.current?.removeSelected()}
          />
        </Box>
      }
    >
      <Box className={classes.stage}>
        <DepotChart
          key={`${currency}:${drawScale}:${series.direct}`}
          ref={chart}
          bars={bars}
          interval={shown}
          currency={currency}
          trades={trades}
          markLevel={markLevel}
          namedTrades={tracked.length > 1}
          lines={lines}
          storedDrawings={scaleDrawings(drawings.data?.document, drawScale)}
          loadedDrawings={drawings.isSuccess}
          tool={tool}
          role={role}
          logScale={log}
          showVolume={volume}
          showLabels={labels}
          line={asLine}
          compare={compare}
          onToolChange={setTool}
          onSelectionChange={setSelection}
          onDrawingsChange={(document) =>
            save(scaleDrawings(document, 1 / drawScale) as typeof document)
          }
          onTimeframeChange={setTimeframe}
          onRangeChange={setChange}
        />
        {tool === null && (
          <DrawingEditor
            selection={selection}
            onRole={pick}
            onLabel={(label) => chart.current?.setSelectionLabel(label)}
            onPrice={(id, price) => chart.current?.setLinePrice(id, price)}
            onDelete={() => chart.current?.removeSelected()}
          />
        )}
      </Box>
      {asLine && (
        <Text size="xs" c="dimmed" data-shot="depot-line-hint">
          Daily closes only, so the day view is a line. Week and month show candles built from the
          closes.
        </Text>
      )}
      {series.direct && !series.pending && (
        <Text size="xs" c="dimmed" data-shot="depot-direct-hint">
          {stored.length === 0
            ? `No ${DIRECT_VENUE} days are stored yet`
            : `${DIRECT_VENUE} has only ${stored.length} stored days, from ${dayDe(stored[0]?.time ?? 0)}`}
          ; the long history is {exchangeName(venues?.usMic ?? null)}.
        </Text>
      )}
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
        {!blocked && venueSwitch}
        {series.native === 'USD' && (
          <Group gap={4} role="group" aria-label="Currency">
            {CURRENCIES.map((option) => (
              <Button
                key={option}
                variant={currency === option ? 'filled' : 'default'}
                color="gray"
                aria-pressed={currency === option}
                onClick={() => switchCurrency(option)}
              >
                {option}
              </Button>
            ))}
          </Group>
        )}
        <Group gap={4} role="group" aria-label="Chart view">
          {comparable && (
            <ComparePopover
              options={indices}
              value={picked?.id ?? ''}
              name={name}
              change={comparing ? change : null}
              onPick={onCompare}
            />
          )}
          <Tooltip
            label="The scale reads in percent while comparing"
            disabled={!comparing}
            withArrow
          >
            <Box component="span">
              <Button
                variant={log && !comparing ? 'filled' : 'default'}
                color="gray"
                aria-pressed={log && !comparing}
                aria-label="Logarithmic price scale"
                disabled={comparing}
                onClick={() => setPrefs({ log: !log })}
              >
                Log
              </Button>
            </Box>
          </Tooltip>
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
          <Button
            variant={labels ? 'filled' : 'default'}
            color="gray"
            aria-pressed={labels}
            aria-label="Show the text labels of horizontal and vertical lines"
            onClick={() => setLabels(!labels)}
          >
            Beschriftung
          </Button>
        </Group>
      </Box>
    </ChartCard>
  )
}
