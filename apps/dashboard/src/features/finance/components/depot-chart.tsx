import { Box, Stack, Text } from '@mantine/core'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
} from 'lightweight-charts'
import type {
  IChartApi,
  IPriceLine,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import { VX } from 'basalt-ui/tokens'
import { DrawingManager } from 'lightweight-charts-drawing'
import type { Drawing, DrawingKind } from 'lightweight-charts-drawing'
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import type { ChartBar, DepotTrade } from '../api/types'
import { readPalette } from '../lib/chart-colors'
import type { ChartPalette } from '../lib/chart-colors'
import {
  buildDrawingsDocument,
  changeOf,
  isIntraday,
  marksByBar,
  priceText,
  signedPercent,
  storedEntries,
  tradeMarks,
  unreadEntries,
} from '../lib/depot-chart'
import type { DepotInterval, DrawingsDocument, PriceLine, TradeMark } from '../lib/depot-chart'
import { eurExact } from '../lib/format'
import classes from './depot-chart.module.css'

/**
 * The depot chart: candles, the turnover histogram, the owner's trades as markers, open orders and the
 * average cost as price lines, and two drawing tools. This file is the ONLY importer of
 * `lightweight-charts` and `lightweight-charts-drawing` (DESIGN.md, "App deviations"): the page talks
 * to props and callbacks. The chart is created once per mount (the page keys it by instrument) and
 * removed on unmount; colours are read from the theme's tokens and re-read when the scheme changes.
 */

/** The two tools of this row; the package has 86. */
export type DrawTool = Extract<DrawingKind, 'horizontal-line' | 'price-range'>

export type DepotChartHandle = {
  /** Deletes the selected drawings. */
  removeSelected(): void
}

export type DepotChartProps = {
  bars: readonly ChartBar[]
  interval: DepotInterval
  trades: readonly DepotTrade[]
  lines: readonly PriceLine[]
  /** The stored drawing document once loaded; `undefined` while it loads (nothing is drawn or saved before). */
  storedDrawings: unknown
  loadedDrawings: boolean
  tool: DrawTool | null
  onToolChange(tool: DrawTool | null): void
  onSelectionChange(count: number): void
  /** Every change of the drawings, with the library's export and the entries it could not read. */
  onDrawingsChange(document: DrawingsDocument): void
  ref?: Ref<DepotChartHandle>
}

const BERLIN = 'Europe/Berlin'
const berlin = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: BERLIN, ...options })
const intradayTime = berlin({ hour: '2-digit', minute: '2-digit', hour12: false })
const intradayDay = berlin({ day: '2-digit', month: 'short' })
const intradayFull = berlin({
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const dayFull = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const asDate = (time: number) => new Date(time * 1000)

/** A bar's time as the readout and the crosshair label write it. */
const barLabel = (time: number, interval: DepotInterval): string =>
  isIntraday(interval) ? intradayFull.format(asDate(time)) : dayFull.format(asDate(time))

type Engine = {
  setBars(bars: readonly ChartBar[], interval: DepotInterval, viewKey: string): void
  setMarks(marks: readonly TradeMark[]): void
  setLines(lines: readonly PriceLine[]): void
  setTool(tool: DrawTool | null): void
  loadDrawings(stored: unknown): void
  removeSelected(): void
  destroy(): void
}

type Callbacks = {
  onCrosshair(time: number | null): void
  onToolChange(tool: DrawTool | null): void
  onSelectionChange(count: number): void
  onDrawingsChange(document: DrawingsDocument): void
}

function createEngine(host: HTMLElement, callbacks: Callbacks): Engine {
  let palette = readPalette(host)
  let interval: DepotInterval = '1d'
  let viewKey = ''
  let marks: readonly TradeMark[] = []
  let lines: readonly PriceLine[] = []
  let foreign: unknown[] = []
  let ready = false
  let quiet = false

  const chart: IChartApi = createChart(host, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: palette.clear },
      textColor: palette.text,
      fontFamily: palette.fontFamily,
      fontSize: VX.text.micro,
      panes: { separatorColor: palette.grid, enableResize: false },
    },
    grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: palette.grid },
    timeScale: { borderColor: palette.grid, rightOffset: 4 },
    handleScale: { axisPressedMouseMove: true },
  })
  const candles: ISeriesApi<'Candlestick'> = chart.addSeries(
    CandlestickSeries,
    { priceLineVisible: false, lastValueVisible: true },
    0,
  )
  const volume: ISeriesApi<'Histogram'> = chart.addSeries(
    HistogramSeries,
    { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
    1,
  )
  chart.panes()[0]?.setStretchFactor(4)
  chart.panes()[1]?.setStretchFactor(1)
  const markers: ISeriesMarkersPluginApi<Time> = createSeriesMarkers(candles, [])
  let priceLines: IPriceLine[] = []
  let barList: readonly ChartBar[] = []

  const manager = new DrawingManager(chart, candles, {
    fontFamily: palette.sansFamily,
    // The range's third figure is its number of bars; say so.
    formatLabel: (label) => {
      if (label.id === 'bars-range') return `${label.bars} bars`
      if (label.id !== 'price-range' && label.id !== 'stats-row') return undefined
      // "4.10 (3.33%) 410": the closing figure is the number of bars.
      return label.text.replace(/(\)\s+)(\d[\d,.]*)$/, '$1$2 bars')
    },
    keyboard: false,
    dragToPlace: true,
    clampToPane: true,
    touchHitTolerance: 22,
    timeInfo: () => ({
      timeZone: isIntraday(interval) ? BERLIN : 'UTC',
      intraday: isIntraday(interval),
    }),
  })

  const emitDrawings = () => {
    if (!ready || quiet) return
    callbacks.onDrawingsChange(buildDrawingsDocument(manager.exportJSON(), foreign))
  }
  const offs = [
    manager.on('change', emitDrawings),
    manager.on('selection', (ids) => callbacks.onSelectionChange(ids.length)),
    manager.on('tool', (kind) =>
      callbacks.onToolChange(kind === 'horizontal-line' || kind === 'price-range' ? kind : null),
    ),
  ]

  chart.subscribeCrosshairMove((param) => {
    callbacks.onCrosshair(typeof param.time === 'number' ? param.time : null)
  })

  const onKey = (event: KeyboardEvent) => {
    const target = event.target
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    ) {
      return
    }
    if (event.key === 'Escape') {
      manager.cancelPending()
      manager.setTool(null)
      manager.select([])
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      removeSelected()
    }
  }
  window.addEventListener('keydown', onKey)

  function removeSelected() {
    for (const id of manager.selection().slice()) manager.remove(id)
  }

  /** Drawings are stored with the colour they were drawn in; the theme paints them again. */
  function retheme(list: readonly Drawing[]) {
    quiet = true
    try {
      for (const drawing of list) {
        const label = drawing.kind === 'price-range'
        manager.update({
          ...drawing,
          style: {
            ...drawing.style,
            color: palette.accent,
            backgroundColor: palette.accent,
            textColor: label ? palette.onAccent : palette.accent,
            labelBackgroundColor: palette.accentFill,
          },
        })
      }
    } finally {
      quiet = false
    }
  }

  function paintOverlays() {
    for (const line of priceLines) candles.removePriceLine(line)
    priceLines = lines.map((line) =>
      candles.createPriceLine({
        price: line.price,
        title: line.title,
        color:
          line.kind === 'order-buy'
            ? palette.buy
            : line.kind === 'order-sell'
              ? palette.sell
              : palette.ink,
        lineWidth: 1,
        lineStyle: line.kind === 'cost' ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
      }),
    )
    markers.setMarkers(
      marks.map((mark) => {
        const buy = mark.side === 'buy'
        return {
          time: mark.time as UTCTimestamp,
          position: buy ? 'belowBar' : 'aboveBar',
          color: buy ? palette.buy : palette.sell,
          shape: mark.estimated ? 'circle' : buy ? 'arrowUp' : 'arrowDown',
          size: 1.2,
        }
      }),
    )
  }

  function paintData() {
    candles.setData(
      barList.map((bar) => ({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    )
    volume.setData(
      barList.map((bar) => ({
        time: bar.time as UTCTimestamp,
        value: bar.turnover ?? 0,
        color: bar.close >= bar.open ? palette.upFaint : palette.downFaint,
      })),
    )
  }

  function applyTheme() {
    palette = readPalette(host)
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: palette.clear },
        textColor: palette.text,
        fontFamily: palette.fontFamily,
        panes: { separatorColor: palette.grid },
      },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.grid },
      timeScale: { borderColor: palette.grid },
    })
    candles.applyOptions(candleColors(palette))
    paintData()
    paintOverlays()
    retheme(manager.drawings())
    manager.redraw()
  }
  candles.applyOptions(candleColors(palette))

  // The theme switches by an attribute on the root; this reads the new tokens once it has.
  const observer = new MutationObserver(applyTheme)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-mantine-color-scheme', 'class'],
  })

  return {
    setBars(next, nextInterval, nextViewKey) {
      barList = next
      interval = nextInterval
      const intraday = isIntraday(nextInterval)
      chart.applyOptions({
        localization: { timeFormatter: (time: Time) => barLabel(Number(time), nextInterval) },
        timeScale: {
          timeVisible: intraday,
          tickMarkFormatter: intraday
            ? (time: Time, type: number) =>
                type >= 3
                  ? intradayTime.format(asDate(Number(time)))
                  : intradayDay.format(asDate(Number(time)))
            : () => null,
        },
      })
      paintData()
      if (viewKey !== nextViewKey) {
        viewKey = nextViewKey
        chart.timeScale().fitContent()
      }
    },
    setMarks(next) {
      marks = next
      paintOverlays()
    },
    setLines(next) {
      lines = next
      paintOverlays()
    },
    setTool(tool) {
      if (manager.tool() !== tool) manager.setTool(tool)
    },
    loadDrawings(stored) {
      const entries = storedEntries(stored)
      quiet = true
      try {
        manager.importJSON(entries)
        const held = new Set(manager.drawings().map((d) => d.id))
        foreign = unreadEntries(entries, held)
        retheme(manager.drawings())
      } finally {
        quiet = false
      }
      ready = true
    },
    removeSelected,
    destroy() {
      observer.disconnect()
      window.removeEventListener('keydown', onKey)
      for (const off of offs) off()
      manager.destroy()
      chart.remove()
    },
  }
}

const candleColors = (palette: ChartPalette) => ({
  upColor: palette.up,
  downColor: palette.down,
  borderUpColor: palette.up,
  borderDownColor: palette.down,
  wickUpColor: palette.up,
  wickDownColor: palette.down,
})

export function DepotChart(props: DepotChartProps) {
  const { bars, interval, trades, lines, storedDrawings, loadedDrawings, tool } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const callbacksRef = useRef<Callbacks | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  // The engine calls the latest callbacks of the page, not the ones of the render it was created in.
  const { onToolChange, onSelectionChange, onDrawingsChange } = props
  useEffect(() => {
    callbacksRef.current = {
      onCrosshair: setHover,
      onToolChange,
      onSelectionChange,
      onDrawingsChange,
    }
  }, [onToolChange, onSelectionChange, onDrawingsChange])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const engine = createEngine(host, {
      onCrosshair: (time) => callbacksRef.current?.onCrosshair(time),
      onToolChange: (next) => callbacksRef.current?.onToolChange(next),
      onSelectionChange: (count) => callbacksRef.current?.onSelectionChange(count),
      onDrawingsChange: (document) => callbacksRef.current?.onDrawingsChange(document),
    })
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  // The view fits again when the bars are another series: another interval, or a range that starts elsewhere.
  const viewKey = `${interval}:${bars[0]?.time ?? ''}`
  const marks = tradeMarks(trades, bars, interval)
  useEffect(() => engineRef.current?.setBars(bars, interval, viewKey), [bars, interval, viewKey])
  useEffect(() => engineRef.current?.setMarks(marks), [marks])
  useEffect(() => engineRef.current?.setLines(lines), [lines])
  useEffect(() => engineRef.current?.setTool(tool), [tool])
  useEffect(() => {
    if (loadedDrawings) engineRef.current?.loadDrawings(storedDrawings)
    // The document is read once per mount: after that the chart owns it and the page only stores it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedDrawings])
  useImperativeHandle(
    props.ref,
    () => ({ removeSelected: () => engineRef.current?.removeSelected() }),
    [],
  )

  const byBar = marksByBar(marks)
  const index = bars.findIndex((bar) => bar.time === (hover ?? bars.at(-1)?.time))
  const shown = bars[index]

  return (
    <Box className={classes.frame}>
      <Box
        ref={hostRef}
        className={classes.host}
        role="img"
        aria-label="Candlestick chart of the selected instrument"
      />
      {shown !== undefined && (
        <Stack className={classes.readout} gap={0}>
          <Text size="xs" c="dimmed" className={classes.mono}>
            {barLabel(shown.time, interval)}
          </Text>
          <Text size="xs" className={classes.mono}>
            O {priceText(shown.open)} H {priceText(shown.high)} L {priceText(shown.low)} C{' '}
            {priceText(shown.close)}
            <ChangeText change={changeOf(bars, index)} />
          </Text>
          {(byBar.get(shown.time) ?? []).map((mark) => (
            <Text key={mark.trade.id} size="xs" className={classes.mono}>
              {tradeText(mark)}
            </Text>
          ))}
        </Stack>
      )}
    </Box>
  )
}

function ChangeText({ change }: { change: number | null }) {
  if (change === null) return null
  return (
    <Text span inherit c={change >= 0 ? 'green' : 'red'}>
      {' '}
      {signedPercent(change)}
    </Text>
  )
}

/** One trade as the readout writes it: side, quantity (a guess says so) and what it moved. */
function tradeText(mark: TradeMark): string {
  const { trade } = mark
  const side = trade.side === 'buy' ? 'Bought' : 'Sold'
  const quantity =
    trade.quantity === null
      ? 'quantity unknown'
      : `${mark.estimated ? '≈ ' : ''}${trade.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
  return `${side} ${quantity} · ${eurExact(trade.amount_cents)}${mark.estimated ? ' · estimated quantity' : ''}`
}
