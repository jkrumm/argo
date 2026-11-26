import { VX } from 'basalt-ui/tokens'

/**
 * The chart libraries draw on a canvas and parse colours themselves: neither reads `var(--vx-…)`.
 * A token is resolved here, at runtime, to the concrete colour the active scheme gives it, so the
 * chart follows the theme without a literal colour in the source. Re-read after a scheme change.
 */
let probe: CanvasRenderingContext2D | null = null

const hex = (n: number | undefined): string => (n ?? 0).toString(16).padStart(2, '0')

/** The colour a CSS value (a token, a `color-mix()`, a keyword) paints in `host`, as `#rrggbb` or `#rrggbbaa`. */
function resolveColor(value: string, host: HTMLElement): string {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (probe === null) return value
  const el = document.createElement('span')
  el.style.color = value
  el.style.display = 'none'
  host.append(el)
  const computed = getComputedStyle(el).color
  el.remove()
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = computed
  probe.fillRect(0, 0, 1, 1)
  const pixel = probe.getImageData(0, 0, 1, 1).data
  const alpha = pixel[3] === 255 ? '' : hex(pixel[3])
  return `#${hex(pixel[0])}${hex(pixel[1])}${hex(pixel[2])}${alpha}`
}

/** `token` at `percent` opacity over nothing: the translucent form of a token (volume bars, a range fill). */
const faded = (token: string, percent: number): string =>
  `color-mix(in srgb, ${token} ${percent}%, transparent)`

export type ChartPalette = {
  /** Axis and legend text. */
  text: string
  grid: string
  crosshair: string
  /** The chart's own background: none, the card shows through. */
  clear: string
  up: string
  down: string
  upFaint: string
  downFaint: string
  /** The index before the launch: the candles' hues, readable but plainly not the instrument's own. */
  upMuted: string
  downMuted: string
  /** The chart card's surface: a halo that keeps a line label legible over candles. */
  panel: string
  /** The average-cost line: data, so neutral ink. */
  ink: string
  /** The drawings: annotations, so the accent. */
  accent: string
  /** A filled label on the accent, and the ink on it. */
  accentFill: string
  onAccent: string
  /** An open order's line and a buy or sell level: the side's colour. */
  buy: string
  sell: string
  /** A filled label in the side's colour (the ink on it is `onAccent`). */
  buyFill: string
  sellFill: string
  fontFamily: string
  /** The body font, for the drawings' labels. */
  sansFamily: string
}

/** Every colour the chart uses, read from the tokens as the theme paints them now. */
export function readPalette(host: HTMLElement): ChartPalette {
  const at = (value: string) => resolveColor(value, host)
  return {
    text: at(VX.muted),
    grid: at(VX.grid),
    crosshair: at(VX.crosshair),
    clear: at('transparent'),
    up: at(VX.status.good),
    down: at(VX.status.bad),
    upFaint: at(faded(VX.status.good, 45)),
    downFaint: at(faded(VX.status.bad, 45)),
    upMuted: at(faded(VX.status.good, 65)),
    downMuted: at(faded(VX.status.bad, 65)),
    panel: at(VX.surface.panel),
    ink: at(VX.ink),
    accent: at(VX.accent),
    accentFill: at(VX.accentFill),
    onAccent: at(VX.onAccent),
    buy: at(VX.status.good),
    sell: at(VX.status.bad),
    buyFill: at(VX.goodSolid),
    sellFill: at(VX.badSolid),
    fontFamily: getComputedStyle(host).getPropertyValue('--basalt-font-mono').trim(),
    sansFamily: getComputedStyle(host).fontFamily,
  }
}
