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
  Logical,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import { VX } from 'basalt-ui/tokens'
import {
  DrawingManager,
  factoryStyleFor,
  setDefaultStyleOverride,
} from 'lightweight-charts-drawing'
import type { Drawing, DrawingKind, DrawingStyle } from 'lightweight-charts-drawing'
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import type { ChartBar, DepotTrade } from '../api/types'
import { readPalette } from '../lib/chart-colors'
import type { ChartPalette } from '../lib/chart-colors'
import {
  buildDrawingsDocument,
  changeOf,
  markGroups,
  marksByBar,
  priceText,
  signedPercent,
  storedEntries,
  tradeMarks,
  tradeReadout,
  unreadEntries,
} from '../lib/depot-chart'
import type { DepotInterval, DrawingsDocument, PriceLine, TradeMark } from '../lib/depot-chart'
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

/** What is selected on the chart: how many drawings, and the one horizontal line when that is all there is. */
export type DepotSelection = { count: number; line: { id: string; price: number } | null }

export type DepotChartHandle = {
  /** Deletes the selected drawings. */
  removeSelected(): void
  /** Moves a horizontal line to an exact price. */
  setLinePrice(id: string, price: number): void
}

/**
 * The distance between two bars, in px, at every interval: a week or a month is drawn as wide as a day,
 * the view starts at the newest bar, and the owner zooms out for more. Fitting the range instead squeezed
 * a long history into hairlines.
 */
const BAR_SPACING = 7
/** Empty bars right of the newest one. */
const RIGHT_OFFSET = 4

export type DepotChartProps = {
  bars: readonly ChartBar[]
  interval: DepotInterval
  /** The currency of the bars; USD adds the dollar price to the trades in the readout. */
  currency: string | null
  trades: readonly DepotTrade[]
  lines: readonly PriceLine[]
  /** The stored drawing document once loaded; `undefined` while it loads (nothing is drawn or saved before). */
  storedDrawings: unknown
  loadedDrawings: boolean
  tool: DrawTool | null
  onToolChange(tool: DrawTool | null): void
  onSelectionChange(selection: DepotSelection): void
  /** Every change of the drawings, with the library's export and the entries it could not read. */
  onDrawingsChange(document: DrawingsDocument): void
  ref?: Ref<DepotChartHandle>
}

const dayFull = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const asDate = (time: number) => new Date(time * 1000)

/** A bar's time as the readout and the crosshair label write it. */
const barLabel = (time: number): string => dayFull.format(asDate(time))

/** The accent look of a drawing: the preview while it is placed, the drawing once it is, and again after a scheme change. */
function accentStyle(kind: string, palette: ChartPalette): Partial<DrawingStyle> {
  return {
    color: palette.accent,
    backgroundColor: palette.accent,
    textColor: kind === 'price-range' ? palette.onAccent : palette.accent,
    labelBackgroundColor: palette.accentFill,
  }
}

const DRAWN = new Set<string>(['horizontal-line', 'price-range'])

/** What is selected now, as the page needs it. */
function selectionOf(manager: DrawingManager): DepotSelection {
  const ids = manager.selection()
  const only = ids.length === 1 ? manager.get(ids[0] ?? '') : undefined
  const point = only?.kind === 'horizontal-line' ? only.points[0] : undefined
  return {
    count: ids.length,
    line: only === undefined || point === undefined ? null : { id: only.id, price: point.price },
  }
}

type Engine = {
  setBars(bars: readonly ChartBar[], viewKey: string): void
  setMarks(marks: readonly TradeMark[]): void
  setLines(lines: readonly PriceLine[]): void
  setTool(tool: DrawTool | null): void
  loadDrawings(stored: unknown): void
  removeSelected(): void
  setLinePrice(id: string, price: number): void
  destroy(): void
}

type Callbacks = {
  onCrosshair(time: number | null): void
  onToolChange(tool: DrawTool | null): void
  onSelectionChange(selection: DepotSelection): void
  onDrawingsChange(document: DrawingsDocument): void
}

function createEngine(host: HTMLElement, callbacks: Callbacks): Engine {
  let palette = readPalette(host)
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
    timeScale: { borderColor: palette.grid, rightOffset: RIGHT_OFFSET, barSpacing: BAR_SPACING },
    localization: { timeFormatter: (time: Time) => barLabel(Number(time)) },
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
    timeInfo: () => ({ timeZone: 'UTC', intraday: false }),
  })
  // The package draws a placement in its own blue until the drawing exists: give both the accent.
  setDefaultStyleOverride((kind) =>
    DRAWN.has(kind)
      ? { ...factoryStyleFor(kind as DrawingKind), ...accentStyle(kind, palette) }
      : undefined,
  )

  let lastSelection = ''
  const emitSelection = () => {
    const selection = selectionOf(manager)
    const key = `${selection.count}:${selection.line?.id ?? ''}:${selection.line?.price ?? ''}`
    if (key === lastSelection) return
    lastSelection = key
    callbacks.onSelectionChange(selection)
  }

  const emitDrawings = () => {
    if (!ready || quiet) return
    callbacks.onDrawingsChange(buildDrawingsDocument(manager.exportJSON(), foreign))
  }
  const offs = [
    manager.on('change', () => {
      emitDrawings()
      if (!quiet) emitSelection()
    }),
    manager.on('selection', emitSelection),
    manager.on('tool', (kind) =>
      callbacks.onToolChange(kind === 'horizontal-line' || kind === 'price-range' ? kind : null),
    ),
  ]

  // The design shot reads the distance between two bars off the host: it is the same at every interval.
  const reportSpacing = () => {
    const scale = chart.timeScale()
    const first = scale.logicalToCoordinate(0 as Logical)
    const second = scale.logicalToCoordinate(1 as Logical)
    if (first !== null && second !== null) host.dataset['barSpacing'] = (second - first).toFixed(2)
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange(reportSpacing)

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
        manager.update({
          ...drawing,
          style: { ...drawing.style, ...accentStyle(drawing.kind, palette) },
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
    // One marker per bar and side: the count says how many trades it holds.
    markers.setMarkers(
      markGroups(marks).map((group) => {
        const buy = group.side === 'buy'
        return {
          time: group.time as UTCTimestamp,
          position: buy ? 'belowBar' : 'aboveBar',
          color: buy ? palette.buy : palette.sell,
          shape: group.estimated ? 'circle' : buy ? 'arrowUp' : 'arrowDown',
          size: 1.2,
          ...(group.count > 1 && { text: String(group.count) }),
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
    setBars(next, nextViewKey) {
      barList = next
      paintData()
      if (viewKey !== nextViewKey) {
        viewKey = nextViewKey
        chart.timeScale().applyOptions({ barSpacing: BAR_SPACING, rightOffset: RIGHT_OFFSET })
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
    setLinePrice(id, price) {
      const drawing = manager.get(id)
      if (drawing?.kind !== 'horizontal-line') return
      manager.update({ ...drawing, points: [{ ...drawing.points[0], price }] })
    },
    destroy() {
      setDefaultStyleOverride(() => undefined)
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
  const { bars, interval, currency, trades, lines, storedDrawings, loadedDrawings, tool } = props
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

  // The view returns to the newest bars when they are another series: another interval, or a range that starts elsewhere.
  const viewKey = `${interval}:${bars[0]?.time ?? ''}`
  const marks = tradeMarks(trades, bars, interval)
  useEffect(() => engineRef.current?.setBars(bars, viewKey), [bars, viewKey])
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
    () => ({
      removeSelected: () => engineRef.current?.removeSelected(),
      setLinePrice: (id, price) => engineRef.current?.setLinePrice(id, price),
    }),
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
            {barLabel(shown.time)}
          </Text>
          <Text size="xs" className={classes.mono}>
            O {priceText(shown.open)} H {priceText(shown.high)} L {priceText(shown.low)} C{' '}
            {priceText(shown.close)}
            <ChangeText change={changeOf(bars, index)} />
          </Text>
          {tradeReadout(byBar.get(shown.time) ?? [], currency === 'USD').map((line) => (
            <Text key={line} size="xs" className={classes.mono}>
              {line}
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
