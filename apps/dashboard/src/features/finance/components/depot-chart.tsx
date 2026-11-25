import { Box, Paper, Stack, Text } from '@mantine/core'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
} from 'lightweight-charts'
import type {
  AutoscaleInfo,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  Logical,
  SeriesMarker,
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
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import type { ChartBar, DepotTrade } from '../api/types'
import { readPalette } from '../lib/chart-colors'
import type { ChartPalette } from '../lib/chart-colors'
import {
  activeTimeframe,
  buildDrawingsDocument,
  CARD_LIMIT,
  changeOf,
  defaultViewStart,
  firstBarFrom,
  launchTime,
  markGroups,
  marksByBar,
  changeFrom,
  priceText,
  signedPercent,
  splitSpliced,
  storedEntries,
  storedRoles,
  timeframeStart,
  tradeCards,
  tradeMarks,
  unreadEntries,
} from '../lib/depot-chart'
import type {
  ColorRole,
  DepotInterval,
  DrawingsDocument,
  LevelPoint,
  PriceLine,
  RangeChange,
  Timeframe,
  TradeMark,
} from '../lib/depot-chart'
import { compactDe, dayDe, percentDe, priceDe, priceDigits } from '../lib/depot-number'
import classes from './depot-chart.module.css'

/**
 * The depot chart: candles, an optional turnover histogram, the spliced index history as muted candles, the
 * owner's trades as markers, open orders and the average cost as price lines, and the drawing tools. This
 * file is the ONLY importer of `lightweight-charts` and `lightweight-charts-drawing` (DESIGN.md, "App
 * deviations"): the page talks to props and callbacks. The chart is created once per mount (the page keys
 * it by instrument) and removed on unmount; colours are read from the theme's tokens and re-read when the
 * scheme changes.
 */

/** The tools of this chart; the package has 86. */
export type DrawTool = Extract<DrawingKind, 'horizontal-line' | 'vertical-line' | 'price-range'>

/** The kinds that take a colour of their own and a label; a price range stays the accent. */
type LineKind = 'horizontal-line' | 'vertical-line'
const LINE_KINDS = new Set<string>(['horizontal-line', 'vertical-line'])
const DRAWN = new Set<string>(['horizontal-line', 'vertical-line', 'price-range'])

/** What is selected on the chart. */
export type DepotSelection = {
  count: number
  /** The one horizontal line when that is all there is (it has a price to type). */
  line: { id: string; price: number } | null
  /** The one line (horizontal or vertical) when that is all there is: its colour and label. */
  single: { id: string; kind: LineKind; role: ColorRole; label: string } | null
}

export type DepotChartHandle = {
  /** Deletes the selected drawings. */
  removeSelected(): void
  /** Moves a horizontal line to an exact price. */
  setLinePrice(id: string, price: number): void
  /** Shows the last stretch of the history a timeframe names. */
  setTimeframe(timeframe: Timeframe): void
  /** Paints the selected line in a colour. */
  setSelectionRole(role: ColorRole): void
  /** Sets the label of the selected line; empty clears it. */
  setSelectionLabel(label: string): void
}

/** Empty bars right of the newest one. */
const RIGHT_OFFSET = 4
/** Marker size on the candles (the library's default is 1): readable at day and week width. */
const MARKER_SIZE = 2
/** The line under the chart and in the readout says what the muted candles before the launch are. */
export const SPLICE_LABEL = 'Index, scaled to the ETF price'

/** Where the pointer is on the chart, and the marker under it when there is one. */
export type ChartPointer = {
  time: number
  x: number
  y: number
  width: number
  marker: string | null
}

export type DepotChartProps = {
  bars: readonly ChartBar[]
  interval: DepotInterval
  /** The currency of the bars; USD adds the dollar price to the trade cards. */
  currency: string | null
  trades: readonly DepotTrade[]
  lines: readonly PriceLine[]
  /** The stored drawing document once loaded; `undefined` while it loads (nothing is drawn or saved before). */
  storedDrawings: unknown
  loadedDrawings: boolean
  tool: DrawTool | null
  /** The colour new lines are drawn in. */
  role: ColorRole
  logScale: boolean
  showVolume: boolean
  /** The bars are the close of a daily series: one line, no candles. */
  line?: boolean
  /** An index drawn as a line on the same price scale: the scale turns to percent and both start at 0 % at the left edge. */
  compare: CompareLine | null
  onToolChange(tool: DrawTool | null): void
  onSelectionChange(selection: DepotSelection): void
  /** Every change of the drawings, with the library's export and the entries it could not read. */
  onDrawingsChange(document: DrawingsDocument): void
  /** The timeframe the visible range matches, or null after a zoom to something else. */
  onTimeframeChange(timeframe: Timeframe | null): void
  /** How the instrument and the compared index changed over the visible range; null without a comparison. */
  onRangeChange(change: RangeChange | null): void
  ref?: Ref<DepotChartHandle>
}

/** The compared index: its name and its levels on the chart's bar times. */
export type CompareLine = { name: string; points: readonly LevelPoint[] }

/** A bar's time as the readout and the crosshair label write it. */
const barLabel = dayDe

/** The smallest step of the price axis for a price: its own precision. */
const minMoveOf = (price: number): number => 10 ** -priceDigits(price)

/** The price axis and crosshair write prices by magnitude, German style. */
const priceFormat = (minMove: number) =>
  ({ type: 'custom', formatter: (price: number) => priceDe(price), minMove }) as const

const solid = (role: ColorRole, palette: ChartPalette) =>
  role === 'buy'
    ? { ink: palette.buy, fill: palette.buyFill }
    : role === 'sell'
      ? { ink: palette.sell, fill: palette.sellFill }
      : { ink: palette.accent, fill: palette.accentFill }

/** The look of a drawing in a colour role: the preview while it is placed, the drawing once it is, and again after a scheme change. */
function roleStyle(kind: string, role: ColorRole, palette: ChartPalette): Partial<DrawingStyle> {
  const { ink, fill } = solid(LINE_KINDS.has(kind) ? role : 'accent', palette)
  return {
    color: ink,
    backgroundColor: ink,
    textColor: kind === 'price-range' ? palette.onAccent : ink,
    labelBackgroundColor: fill,
  }
}

/** What is selected now, as the page needs it. */
function selectionOf(
  manager: DrawingManager,
  roles: ReadonlyMap<string, ColorRole>,
): DepotSelection {
  const ids = manager.selection()
  const only = ids.length === 1 ? manager.get(ids[0] ?? '') : undefined
  const point = only?.kind === 'horizontal-line' ? only.points[0] : undefined
  return {
    count: ids.length,
    line: only === undefined || point === undefined ? null : { id: only.id, price: point.price },
    single:
      only !== undefined && LINE_KINDS.has(only.kind)
        ? {
            id: only.id,
            kind: only.kind as LineKind,
            role: roles.get(only.id) ?? 'accent',
            label: only.style.text ?? '',
          }
        : null,
  }
}

type Engine = {
  /** `asLine`: the bars are closes only (a daily series), so they are drawn as one line and there are no candles. */
  setBars(
    bars: readonly ChartBar[],
    viewKey: string,
    interval: DepotInterval,
    asLine: boolean,
  ): void
  setMarks(marks: readonly TradeMark[]): void
  setLines(lines: readonly PriceLine[]): void
  setTool(tool: DrawTool | null): void
  setRole(role: ColorRole): void
  setLog(on: boolean): void
  setCompare(compare: CompareLine | null): void
  setVolume(on: boolean): void
  setTimeframe(timeframe: Timeframe): void
  loadDrawings(stored: unknown): void
  removeSelected(): void
  setLinePrice(id: string, price: number): void
  setSelectionRole(role: ColorRole): void
  setSelectionLabel(label: string): void
  destroy(): void
}

type Callbacks = {
  onCrosshair(pointer: ChartPointer | null): void
  onClick(pointer: ChartPointer | null): void
  onToolChange(tool: DrawTool | null): void
  onSelectionChange(selection: DepotSelection): void
  onDrawingsChange(document: DrawingsDocument): void
  onTimeframeChange(timeframe: Timeframe | null): void
  onRangeChange(change: RangeChange | null): void
}

function createEngine(host: HTMLElement, callbacks: Callbacks): Engine {
  let palette = readPalette(host)
  let viewKey = ''
  let marks: readonly TradeMark[] = []
  let lines: readonly PriceLine[] = []
  let foreign: unknown[] = []
  let ready = false
  let quiet = false
  let defaultRole: ColorRole = 'accent'
  let alive = true
  let logOn = false
  let compare: CompareLine | null = null
  let other: ISeriesApi<'Line'> | null = null
  let lastChange = ''
  const roles = new Map<string, ColorRole>()

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
    // A history of thousands of bars still fits on Max: the library's default minimum (half a pixel) stops short of it.
    timeScale: { borderColor: palette.grid, rightOffset: RIGHT_OFFSET, minBarSpacing: 0.01 },
    localization: {
      timeFormatter: (time: Time) => barLabel(Number(time)),
      // The scale in percent mode (a comparison) reads `+12,3 %`.
      percentageFormatter: (value: number) => percentDe(value / 100, true),
    },
    handleScale: { axisPressedMouseMove: true },
  })
  const candles: ISeriesApi<'Candlestick'> = chart.addSeries(
    CandlestickSeries,
    { priceLineVisible: false, lastValueVisible: true, priceFormat: priceFormat(0.01) },
    0,
  )
  // The tracked index before the instrument's own history: the same candles in the same hues, faded.
  const spliceCandles: ISeriesApi<'Candlestick'> = chart.addSeries(
    CandlestickSeries,
    {
      ...mutedColors(palette),
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: priceFormat(0.01),
    },
    0,
  )
  // A series that sends closes only (a daily series) has no candles: one line of its closes.
  const splice: ISeriesApi<'Line'> = chart.addSeries(
    LineSeries,
    {
      color: palette.text,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: priceFormat(0.01),
    },
    0,
  )
  let volume: ISeriesApi<'Histogram'> | null = null
  const markers: ISeriesMarkersPluginApi<Time> = createSeriesMarkers(candles, [])
  let priceLines: IPriceLine[] = []
  /** Every bar the time scale knows: the spliced index bars and the instrument's own, ascending. */
  let allBars: readonly ChartBar[] = []
  let own: readonly ChartBar[] = []
  let spliced: readonly ChartBar[] = []
  let launch: number | null = null
  /** The bars are the closes of a daily series: drawn as the line, there are no candles. */
  let lineOnly = false
  /** The instrument's closes, a spliced index's included, as a line's points: its change over the visible range, over the span the index line covers. */
  let closes: readonly LevelPoint[] = []

  /** An open order within reach of the price stays on screen: the scale stretches to hold its line. */
  const withOrders = (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
    const base = original()
    const last = own.at(-1)?.close
    if (base === null || base.priceRange === null || last === undefined) return base
    const prices = lines
      .filter((line) => line.kind !== 'cost' && line.price > last / 2 && line.price < last * 2)
      .map((line) => line.price)
    if (prices.length === 0) return base
    return {
      ...base,
      priceRange: {
        minValue: Math.min(base.priceRange.minValue, ...prices),
        maxValue: Math.max(base.priceRange.maxValue, ...prices),
      },
    }
  }
  candles.applyOptions({ autoscaleInfoProvider: withOrders })

  const manager = new DrawingManager(chart, candles, {
    fontFamily: palette.sansFamily,
    // German numbers on the drawings; the range's closing figure is its number of bars.
    formatLabel: (label) => {
      if (label.id === 'bars-range') return `${label.bars} bars`
      if (label.id === 'price') return priceDe(label.price)
      if (label.id !== 'price-range') return undefined
      // "4.10 (3.33%) 410": the closing figure is the number of bars.
      const bars = /(\d+)$/.exec(label.text)?.[1]
      const change = `${label.change > 0 ? '+' : ''}${priceDe(label.change)}`
      const percent = label.percent === null ? '' : ` (${percentDe(label.percent / 100, true)})`
      return `${change}${percent}${bars === undefined ? '' : ` ${bars} bars`}`
    },
    keyboard: false,
    dragToPlace: true,
    clampToPane: true,
    touchHitTolerance: 22,
    timeInfo: () => ({ timeZone: 'UTC', intraday: false }),
  })
  // The package draws a placement in its own blue until the drawing exists: give both the chosen colour.
  setDefaultStyleOverride((kind) =>
    DRAWN.has(kind)
      ? { ...factoryStyleFor(kind as DrawingKind), ...roleStyle(kind, defaultRole, palette) }
      : undefined,
  )

  let lastSelection = ''
  const emitSelection = () => {
    const selection = selectionOf(manager, roles)
    const key = [
      selection.count,
      selection.line?.id ?? '',
      selection.line?.price ?? '',
      selection.single?.role ?? '',
      selection.single?.label ?? '',
    ].join(':')
    if (key === lastSelection) return
    lastSelection = key
    callbacks.onSelectionChange(selection)
  }

  const emitDrawings = () => {
    if (!ready || quiet) return
    callbacks.onDrawingsChange(
      buildDrawingsDocument(manager.exportJSON(), foreign, Object.fromEntries(roles)),
    )
  }
  const offs = [
    manager.on('change', () => {
      if (!quiet) {
        // A drawing the owner just placed takes the colour that was chosen for new ones.
        for (const drawing of manager.drawings()) {
          if (!roles.has(drawing.id)) roles.set(drawing.id, defaultRole)
        }
      }
      emitDrawings()
      if (!quiet) emitSelection()
    }),
    manager.on('selection', emitSelection),
    // One drawing, then the pointer: the next click selects instead of placing another line.
    manager.on('add', () => {
      if (!quiet && manager.tool() !== null) manager.setTool(null)
    }),
    manager.on('tool', (kind) =>
      callbacks.onToolChange(
        kind === 'horizontal-line' || kind === 'vertical-line' || kind === 'price-range'
          ? kind
          : null,
      ),
    ),
  ]

  const pointerOf = (param: {
    time?: Time
    point?: { x: number; y: number }
    hoveredObjectId?: unknown
  }): ChartPointer | null =>
    typeof param.time === 'number' && param.point !== undefined
      ? {
          time: param.time,
          x: param.point.x,
          y: param.point.y,
          width: host.clientWidth,
          marker: typeof param.hoveredObjectId === 'string' ? param.hoveredObjectId : null,
        }
      : null

  chart.subscribeCrosshairMove((param) => callbacks.onCrosshair(pointerOf(param)))
  chart.subscribeClick((param) => callbacks.onClick(pointerOf(param)))

  /** The change of both lines over the visible range (each from its first visible bar): what the comparison chip says. */
  function reportChange(from: number) {
    const change: RangeChange | null =
      compare === null
        ? null
        : { own: changeFrom(closes, from), other: changeFrom(compare.points, from) }
    const key = change === null ? '' : `${change.own?.toFixed(4)}:${change.other?.toFixed(4)}`
    if (key === lastChange) return
    lastChange = key
    host.dataset['rangeChange'] = key
    callbacks.onRangeChange(change)
  }

  // The design shot reads the distance between two bars off the host; the page reads the timeframe off the range.
  let lastFrame: Timeframe | null | undefined
  const reportView = () => {
    const scale = chart.timeScale()
    const first = scale.logicalToCoordinate(0 as Logical)
    const second = scale.logicalToCoordinate(1 as Logical)
    if (first !== null && second !== null) host.dataset['barSpacing'] = (second - first).toFixed(2)
    const range = scale.getVisibleLogicalRange()
    const firstBar = allBars[0]
    const lastBar = allBars.at(-1)
    if (range === null || firstBar === undefined || lastBar === undefined) return
    const index = Math.min(allBars.length - 1, Math.max(0, Math.ceil(range.from)))
    const frame = activeTimeframe(
      // Within a couple of bars of the first is the whole history (the library rounds the edge).
      range.from <= 2 ? null : (allBars[index]?.time ?? null),
      lastBar.time,
      firstBar.time,
    )
    reportChange(allBars[index]?.time ?? firstBar.time)
    host.dataset['timeframe'] = frame ?? ''
    host.dataset['bars'] = String(allBars.length)
    host.dataset['logicalFrom'] = range.from.toFixed(1)
    host.dataset['firstDay'] = new Date(firstBar.time * 1000).toISOString().slice(0, 10)
    host.dataset['spliced'] = String(spliced.length)
    host.dataset['spliceShape'] = lineOnly ? 'line' : 'candles'
    if (frame !== lastFrame) {
      lastFrame = frame
      callbacks.onTimeframeChange(frame)
    }
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange(reportView)

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

  /** Drawings are stored with their colour role; the theme paints them again. */
  function retheme(list: readonly Drawing[]) {
    quiet = true
    try {
      for (const drawing of list) {
        manager.update({
          ...drawing,
          style: {
            ...drawing.style,
            ...roleStyle(drawing.kind, roles.get(drawing.id) ?? 'accent', palette),
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
    // The scale follows the lines that count: stretch it again for the new set.
    candles.applyOptions({ autoscaleInfoProvider: withOrders })
    // The design shot finds the drawn lines by their titles.
    host.dataset['lines'] = lines.map((line) => line.title).join('|')
    // One marker per bar and side: the count says how many trades it holds. The id lets the pointer name it.
    const trades: SeriesMarker<Time>[] = markGroups(marks).map((group) => {
      const buy = group.side === 'buy'
      return {
        id: `${group.time}:${group.side}`,
        time: group.time as UTCTimestamp,
        position: buy ? 'belowBar' : 'aboveBar',
        color: buy ? palette.buy : palette.sell,
        shape: group.estimated ? 'circle' : buy ? 'arrowUp' : 'arrowDown',
        size: MARKER_SIZE,
        ...(group.count > 1 && { text: String(group.count) }),
      }
    })
    const launched: SeriesMarker<Time>[] =
      launch === null
        ? []
        : [
            {
              id: 'launch',
              time: launch as UTCTimestamp,
              position: 'aboveBar',
              color: palette.text,
              shape: 'square',
              size: 1,
              text: 'ETF launch',
            },
          ]
    markers.setMarkers([...trades, ...launched].toSorted((a, b) => Number(a.time) - Number(b.time)))
    // The design shot finds a trade's bar on screen: where the first few trades sit, in px from the left.
    host.dataset['markX'] = markGroups(marks)
      .slice(-6)
      .map((group) => chart.timeScale().timeToCoordinate(group.time as UTCTimestamp))
      .filter((x) => x !== null)
      .map((x) => Math.round(x))
      .join(',')
  }

  function paintData() {
    candles.setData(
      own.map((bar) => ({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    )
    splice.setData(
      lineOnly ? spliced.map((bar) => ({ time: bar.time as UTCTimestamp, value: bar.close })) : [],
    )
    spliceCandles.setData(
      lineOnly
        ? []
        : spliced.map((bar) => ({
            time: bar.time as UTCTimestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          })),
    )
    volume?.setData(
      own.map((bar) => ({
        time: bar.time as UTCTimestamp,
        value: bar.turnover ?? 0,
        color: bar.close >= bar.open ? palette.upFaint : palette.downFaint,
      })),
    )
  }

  /** The visible range from the bar at `start` (the first bar for null) to the newest, with the empty bars to its right. */
  function showFrom(start: number | null) {
    const count = allBars.length
    if (count === 0) return
    const from = Math.min(firstBarFrom(allBars, start), count - 1)
    const apply = () =>
      chart.timeScale().setVisibleLogicalRange({
        from: (from - 0.5) as Logical,
        to: (count - 1 + RIGHT_OFFSET) as Logical,
      })
    apply()
    // The price axis changes its width with the new range (its labels get longer or shorter) and takes plot width
    // with it: once more on the next frame, so the range still holds after the layout settled.
    requestAnimationFrame(() => {
      if (alive) apply()
    })
  }

  /** A comparison turns the price scale to percent (each line starts at 0 % at the left edge); else linear or log. */
  function applyScaleMode() {
    const mode =
      compare !== null
        ? PriceScaleMode.Percentage
        : logOn
          ? PriceScaleMode.Logarithmic
          : PriceScaleMode.Normal
    chart.priceScale('right', 0).applyOptions({ mode })
    // The design shot reads the scale off the host.
    host.dataset['scale'] = compare !== null ? 'percent' : logOn ? 'log' : 'linear'
  }

  /** The compared index as a line on the candles' own price scale; removed when the comparison ends. */
  function paintCompare() {
    if (compare === null) {
      if (other !== null) chart.removeSeries(other)
      other = null
      return
    }
    other ??= chart.addSeries(
      LineSeries,
      { color: palette.ink, lineWidth: 2, priceLineVisible: false, lastValueVisible: true },
      0,
    )
    other.applyOptions({ title: compare.name })
    other.setData(
      compare.points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })),
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
    spliceCandles.applyOptions(mutedColors(palette))
    splice.applyOptions({ color: palette.text })
    other?.applyOptions({ color: palette.ink })
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
    setBars(next, nextViewKey, interval, asLine) {
      const parts = asLine ? { own: [], spliced: [...next] } : splitSpliced(next)
      lineOnly = asLine
      own = parts.own
      spliced = parts.spliced
      allBars = next
      launch = asLine ? null : launchTime(next)
      closes = next.map((bar) => ({ time: bar.time, value: bar.close }))
      const last = next.at(-1)
      if (last !== undefined) {
        const format = { priceFormat: priceFormat(minMoveOf(last.close)) }
        candles.applyOptions(format)
        spliceCandles.applyOptions(format)
        splice.applyOptions(format)
      }
      paintData()
      paintOverlays()
      paintCompare()
      if (viewKey !== nextViewKey) {
        viewKey = nextViewKey
        showFrom(defaultViewStart(next, interval))
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
    setRole(role) {
      defaultRole = role
    },
    setLog(on) {
      logOn = on
      applyScaleMode()
    },
    setCompare(next) {
      compare = next
      paintCompare()
      applyScaleMode()
      lastChange = ''
      reportView()
    },
    setVolume(on) {
      if (on && volume === null) {
        volume = chart.addSeries(
          HistogramSeries,
          {
            priceFormat: {
              type: 'custom',
              formatter: (value: number) => compactDe(value),
              minMove: 1,
            },
            priceLineVisible: false,
            lastValueVisible: false,
          },
          1,
        )
        // A new pane starts from the chart's own scale options, which a comparison may have turned to percent.
        chart.priceScale('right', 1).applyOptions({ mode: PriceScaleMode.Normal })
        chart.panes()[0]?.setStretchFactor(4)
        chart.panes()[1]?.setStretchFactor(1)
        paintData()
      } else if (!on && volume !== null) {
        chart.removeSeries(volume)
        volume = null
        if (chart.panes().length > 1) chart.removePane(1)
      }
    },
    setTimeframe(timeframe) {
      const last = allBars.at(-1)
      if (last === undefined) return
      showFrom(timeframeStart(timeframe, last.time))
    },
    loadDrawings(stored) {
      const entries = storedEntries(stored)
      quiet = true
      try {
        roles.clear()
        for (const [id, role] of Object.entries(storedRoles(stored))) roles.set(id, role)
        manager.importJSON(entries)
        const held = new Set(manager.drawings().map((d) => d.id))
        foreign = unreadEntries(entries, held)
        for (const id of held) if (!roles.has(id)) roles.set(id, 'accent')
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
    setSelectionRole(role) {
      for (const id of manager.selection().slice()) {
        const drawing = manager.get(id)
        if (drawing === undefined || !LINE_KINDS.has(drawing.kind)) continue
        roles.set(id, role)
        manager.update({
          ...drawing,
          style: { ...drawing.style, ...roleStyle(drawing.kind, role, palette) },
        })
      }
    },
    setSelectionLabel(label) {
      const [id] = manager.selection()
      const drawing = id === undefined ? undefined : manager.get(id)
      if (drawing === undefined || !LINE_KINDS.has(drawing.kind)) return
      manager.update({ ...drawing, style: { ...drawing.style, text: label } })
    },
    destroy() {
      alive = false
      setDefaultStyleOverride(() => undefined)
      observer.disconnect()
      window.removeEventListener('keydown', onKey)
      for (const off of offs) off()
      manager.destroy()
      chart.remove()
    },
  }
}

/** The index before the launch: the candles' hues at the volume bars' opacity, no outline over the fill. */
const mutedColors = (palette: ChartPalette) => ({
  upColor: palette.upFaint,
  downColor: palette.downFaint,
  borderVisible: false,
  wickUpColor: palette.upFaint,
  wickDownColor: palette.downFaint,
})

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
  const { role, logScale, showVolume, compare } = props
  const asLine = props.line === true
  const hostRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const callbacksRef = useRef<Callbacks | null>(null)
  const [hover, setHover] = useState<ChartPointer | null>(null)
  const [pinned, setPinned] = useState<ChartPointer | null>(null)

  // The view returns to the newest bars when they are another series: another interval, or a history that starts elsewhere.
  const viewKey = `${interval}:${bars[0]?.time ?? ''}`
  const marks = tradeMarks(trades, bars, interval)
  const byBar = marksByBar(marks)

  // The engine calls the latest callbacks of the page, not the ones of the render it was created in.
  const { onToolChange, onSelectionChange, onDrawingsChange, onTimeframeChange, onRangeChange } =
    props
  useEffect(() => {
    callbacksRef.current = {
      onCrosshair: setHover,
      onClick: (pointer) =>
        setPinned((current) =>
          pointer === null || !byBar.has(pointer.time) || current?.time === pointer.time
            ? null
            : pointer,
        ),
      onToolChange,
      onSelectionChange,
      onDrawingsChange,
      onTimeframeChange,
      onRangeChange,
    }
  }, [byBar, onToolChange, onSelectionChange, onDrawingsChange, onTimeframeChange, onRangeChange])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const engine = createEngine(host, {
      onCrosshair: (pointer) => callbacksRef.current?.onCrosshair(pointer),
      onClick: (pointer) => callbacksRef.current?.onClick(pointer),
      onToolChange: (next) => callbacksRef.current?.onToolChange(next),
      onSelectionChange: (selection) => callbacksRef.current?.onSelectionChange(selection),
      onDrawingsChange: (document) => callbacksRef.current?.onDrawingsChange(document),
      onTimeframeChange: (frame) => callbacksRef.current?.onTimeframeChange(frame),
      onRangeChange: (change) => callbacksRef.current?.onRangeChange(change),
    })
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(
    () => engineRef.current?.setBars(bars, viewKey, interval, asLine),
    [bars, viewKey, interval, asLine],
  )
  useEffect(() => engineRef.current?.setMarks(marks), [marks])
  useEffect(() => engineRef.current?.setLines(lines), [lines])
  useEffect(() => engineRef.current?.setTool(tool), [tool])
  useEffect(() => engineRef.current?.setRole(role), [role])
  useEffect(() => engineRef.current?.setLog(logScale), [logScale])
  // After the bars: the comparison's points sit on the bars' times. The page builds the line on every render, so the
  // effect follows what identifies it, not the object: a new identity per render would repaint and report forever.
  const compareKey =
    compare === null
      ? ''
      : `${compare.name}:${compare.points.length}:${compare.points.at(0)?.time}:${compare.points.at(-1)?.time}:${bars.length}`
  useEffect(
    () => engineRef.current?.setCompare(compare),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [compareKey],
  )
  useEffect(() => engineRef.current?.setVolume(showVolume), [showVolume])
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
      setTimeframe: (timeframe) => engineRef.current?.setTimeframe(timeframe),
      setSelectionRole: (next) => engineRef.current?.setSelectionRole(next),
      setSelectionLabel: (label) => engineRef.current?.setSelectionLabel(label),
    }),
    [],
  )

  const index = bars.findIndex((bar) => bar.time === (hover?.time ?? bars.at(-1)?.time))
  const shown = bars[index]
  const spliced = !asLine && bars.some((bar) => bar.source === 'index')

  // The card of a bar's trades: under the pointer while it is on a marker, and where a tap or click pinned it.
  const cardAt =
    pinned !== null && byBar.has(pinned.time) ? pinned : hover?.marker != null ? hover : null
  const cardMarks = cardAt === null ? [] : (byBar.get(cardAt.time) ?? [])
  const cards = tradeCards(cardMarks.slice(0, CARD_LIMIT), currency === 'USD')
  const hidden = cardMarks.length - cards.length

  // The card sits beside the pointer, on the side with room. Its position is a pair of CSS variables.
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (tip === null || cardAt === null) return
    const frame = tip.parentElement
    const room = 4
    // Right of the pointer, else left of it, else pinned inside the chart (a phone is narrower than the card).
    let left = cardAt.x + 16
    if (left + tip.offsetWidth > cardAt.width - room) left = cardAt.x - 16 - tip.offsetWidth
    left = Math.max(room, Math.min(left, cardAt.width - tip.offsetWidth - room))
    const top = Math.min(
      Math.max(8, cardAt.y - 24),
      Math.max(8, (frame?.clientHeight ?? 0) - tip.offsetHeight - room),
    )
    tip.style.setProperty('--tip-x', `${left}px`)
    tip.style.setProperty('--tip-y', `${top}px`)
  })

  return (
    <Box className={classes.frame} data-depot-frame="">
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
            {asLine ? (
              <>Close {priceText(shown.close)}</>
            ) : shown.source === 'index' ? (
              <>
                Index O {priceText(shown.open)} H {priceText(shown.high)} L {priceText(shown.low)} C{' '}
                {priceText(shown.close)}
              </>
            ) : (
              <>
                O {priceText(shown.open)} H {priceText(shown.high)} L {priceText(shown.low)} C{' '}
                {priceText(shown.close)}
                <ChangeText change={changeOf(bars, index)} />
              </>
            )}
          </Text>
          {spliced && (
            <Text size="xs" c="dimmed" className={classes.mono}>
              {SPLICE_LABEL}
            </Text>
          )}
        </Stack>
      )}
      {cardAt !== null && cards.length > 0 && (
        <Paper ref={tipRef} className={classes.tip} data-shot="depot-trade-card" role="status">
          <Stack gap="xs">
            {cards.map((card) => (
              <Stack key={card.id} gap={2}>
                <Text size="xs" fw={600} c={card.side === 'buy' ? 'green' : 'red'}>
                  {card.title}
                </Text>
                {card.rows.map((row) => (
                  <Box key={row.label} className={classes.tipRow}>
                    <Text size="xs" c="dimmed">
                      {row.label}
                    </Text>
                    <Text
                      size="xs"
                      className={classes.mono}
                      {...(row.tone !== undefined && { c: row.tone === 'good' ? 'green' : 'red' })}
                    >
                      {row.value}
                    </Text>
                  </Box>
                ))}
              </Stack>
            ))}
            {hidden > 0 && (
              <Text size="xs" c="dimmed">
                + {hidden} more
              </Text>
            )}
          </Stack>
        </Paper>
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
