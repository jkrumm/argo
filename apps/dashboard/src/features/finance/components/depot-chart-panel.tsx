import { Box, Button, Group, Text, Tooltip } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { ViewTabs } from 'basalt-ui/controls'
import { useRef, useState } from 'react'
import { useCandles, useDrawings, useIndexSeries } from '../api/queries'
import type { DepotTrade } from '../api/types'
import { ComparePopover } from './compare-popover'
import { DepotChart, SPLICE_LABEL } from './depot-chart'
import type { CompareLine, DepotChartHandle, DepotSelection, DrawTool } from './depot-chart'
import { DrawToolbar } from './draw-toolbar'
import { DrawingEditor } from './drawing-editor'
import classes from './depot.module.css'
import {
  depotInterval,
  distanceFromHigh,
  hasTurnover,
  levelsAtBars,
  logByDefault,
  TIMEFRAMES,
  timeframeFits,
  volumeByDefault,
} from '../lib/depot-chart'
import type {
  AllTimeHigh,
  ColorRole,
  DepotInterval,
  PriceLine,
  RangeChange,
  Timeframe,
} from '../lib/depot-chart'
import { dayDe, percentDe, priceDe } from '../lib/depot-number'
import type { IndexSeries } from '../lib/index-series'
import { useDrawingsSaver } from '../lib/use-drawings-saver'
import { useViewPrefs } from '../lib/view-prefs'
import { finStore } from '../../../lib/window-stores'

export function ChartPanel({
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
  indices,
  compareId,
  onCompare,
  high,
  lastClose,
  today,
  line: asLine,
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
  indices: readonly IndexSeries[]
  compareId: string
  onCompare: (id: string) => void
  high: AllTimeHigh | null
  lastClose: number | null
  today: string
  /** The bars are the close of a daily series: drawn as one line. */
  line: boolean
}) {
  const [tool, setTool] = useState<DrawTool | null>(null)
  const [role, setRole] = useState<ColorRole>('accent')
  const [selection, setSelection] = useState<DepotSelection>({ count: 0, line: null, single: null })
  const [timeframe, setTimeframe] = useState<Timeframe | null>(null)
  const [change, setChange] = useState<RangeChange | null>(null)
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
  const spliced = !asLine && bars.some((bar) => bar.source === 'index')

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

  // A line is coloured from the toolbar: the colour of the next one drawn, or the selected line's own.
  const pick = (next: ColorRole) => {
    setRole(next)
    if (tool === null) chart.current?.setSelectionRole(next)
  }
  const currentRole = tool === null ? (selection.single?.role ?? role) : role
  const symbol = currency === 'USD' ? 'USD' : 'EUR'
  const distance =
    high === null || lastClose === null ? null : distanceFromHigh(lastClose, high.price)

  return (
    <ChartCard
      data-shot="depot-chart"
      title={candles.data?.currency == null ? name : `${name} · ${candles.data.currency}`}
      {...(high !== null && {
        facts: [
          {
            value: priceDe(high.price),
            unit: symbol === 'USD' ? '$' : '€',
            period: ['All-time high', dayDe(high.time)],
          },
          ...(distance === null
            ? []
            : [
                {
                  // A node keeps the real minus sign (a text comparison would take a direction glyph instead).
                  value: <>{percentDe(distance, true)}</>,
                  unit: 'last close vs. high',
                },
              ]),
        ],
      })}
      info={`${asLine ? 'This series sends one close a day, so the daily chart is a line; the week and month intervals show candles built from the closes. ' : ''}Daily candles over the whole stored history in the instrument's currency (Bitcoin and US stocks in dollars); the buttons under the chart only set the visible range, drag and scroll to move and zoom. The all-time high is the highest daily high stored and the percentage is the last close's distance from it. An arrow marks the trades of a day, week or month with their count, a circle those whose quantity is an estimate; hover or tap one for its card. Dashed lines are your open orders at their limit or stop, a US stock's in dollars at the latest ECB rate. ${spliced ? `${SPLICE_LABEL}: before the ETF's first bar the grey line is the index it tracks, converted to the ETF's currency and scaled to meet its first close; it carries no dividends. ` : ''}Lines you draw are saved per instrument.`}
      state={{
        pending: candles.isPending,
        error: candles.error ?? undefined,
        empty:
          bars.length === 0 ? notes.join(' ') || 'No bars stored for this instrument yet.' : false,
      }}
      onRetry={() => void candles.refetch()}
      actions={
        <Box className={classes.tools}>
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
          line={asLine}
          compare={compare}
          onToolChange={setTool}
          onSelectionChange={setSelection}
          onDrawingsChange={save}
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
        </Group>
      </Box>
    </ChartCard>
  )
}
