/**
 * Meter — one bounded quantity on a track: progress to a target, a committed/forecast split, a
 * part-of-a-whole strip (`segments`), or a single headline ratio as a `ring`. Choose it for "how far
 * along is this against a limit"; choose `BarList` for a ranking and a chart for a trend. An HTML/CSS
 * primitive, not a chart kind (no scale, axis or tooltip).
 *
 * Colour law: the fill is neutral (`VX.line`). `color` is for a VERDICT only (over budget, below
 * target) and is a status colour the consumer passes; categorical `segments` take the consumer's
 * series colours. Committed vs forecast is the same neutral at two strengths — never colour alone: a
 * tick marks the boundary and a caption names the forecast. A value past `max` clamps the fill at the
 * track end; the caption still states the real value.
 *
 * `zones` (bar only) draws the track as contiguous bands (neutral at stepped strengths unless a zone
 * passes a status colour) and the reading becomes a MARKER on the track, not a fill; the caption names
 * the zone that holds the value (`from` inclusive). Use it for a reading judged against ranges.
 *
 * @example
 * import { Meter } from 'basalt-ui'
 *
 * // Spend against a budget: past the target the end caption states the overage.
 * <Meter label="Monthly spend" value={512} max={600} target={450} color="var(--vx-status-bad)" format={usd} />
 * // Training load as a zone band with a marker: caption reads "Optimal · 612".
 * <Meter
 *   label="Training load"
 *   max={1000}
 *   value={612}
 *   zones={[
 *     { from: 0, to: 300, label: 'Low' },
 *     { from: 300, to: 750, label: 'Optimal' },
 *     { from: 750, to: 1000, label: 'High' },
 *   ]}
 * />
 * // A readiness score on its 0–100 scale (its contributors: <BarList max={100} … secondary="Good" />).
 * <Meter label="Recovery" value={72} max={100} />
 * <Meter
 *   label="Course progress"
 *   max={120}
 *   segments={[{ value: 70, label: 'Done' }, { value: 25, label: 'Planned', forecast: true }]}
 * />
 * <Meter shape="ring" label="Cache hit rate" value={87} max={100} format={(v) => `${v}%`} />
 */
import type { ReactNode } from 'react'
import type { BasaltProps } from './props'
import { isReading, normalizeSegments, segmentReading, spanOf } from './meter-model'
import type { MeterSegment, MeterZone } from './meter-model'
import { MeterBar, MeterEmpty, MeterLoading, MeterRing } from './meter-parts'
import { asText } from './scale'

type Common = BasaltProps & {
  /** Accessible name (`aria-label`). Required: a meter without one is announced as a bare number. */
  label: string
  /** Track start. Default 0. */
  min?: number
  /** Track end. Default 100. */
  max?: number
  /** Formats values in captions and the accessible text. Default: the number as written. */
  format?: (value: number) => string
  /** Renders a skeleton with the meter's footprint. */
  loading?: boolean
  /** Muted line shown when there is no reading. The track stays so the footprint holds. */
  emptyText?: string
}

type BarCommon = Common & {
  shape?: 'bar'
  /** Target position; draws a tick and states it in the end caption (with the overage past it). */
  target?: number
  /** Start caption (default: the formatted reading, or `Zone · reading`). `null` drops it. */
  startCaption?: ReactNode
  /** End caption (default: `Target <target>`). `null` drops it. */
  endCaption?: ReactNode
}

/**
 * One of four forms; mixing them is a compile error.
 * - Bar `value` (+ `target`, `color`): one reading on a neutral track.
 * - Bar `segments`: ordered parts that sum to the reading (committed/forecast, part of a whole).
 * - Bar `value` + `zones`: the reading is a marker against contiguous bands.
 * - Ring (`shape: 'ring'`) `value` (+ `color`): one headline ratio; no target, captions, segments or zones.
 */
export type MeterProps =
  | (BarCommon & {
      /** The reading. `null`/`undefined` (or non-finite) renders the empty state. */
      value?: number | null | undefined
      /** A status colour, for a verdict only. Omit for the neutral fill. */
      color?: string
      segments?: never
      zones?: never
    })
  | (BarCommon & {
      /** Ordered parts, accumulated from `min`; their sum is the reading. `forecast` parts render lighter. */
      segments: readonly MeterSegment[]
      /** Names the forecast beside the boundary tick (default: `Forecast: <labels>`). */
      forecastCaption?: string
      value?: never
      color?: never
      zones?: never
    })
  | (BarCommon & {
      value?: number | null | undefined
      /**
       * Contiguous bands drawn as the track, positioned from each `from`. The reading becomes a marker
       * and the caption names the band that holds it.
       */
      zones: readonly MeterZone[]
      segments?: never
      color?: never
    })
  | (Common & {
      shape: 'ring'
      value?: number | null | undefined
      /** A status colour, for a verdict only. */
      color?: string
      segments?: never
      zones?: never
      target?: never
      startCaption?: never
      endCaption?: never
    })

let warnedTrack = false
/** One dev warning per page load for a track that ends at or before its start. */
function warnInvalidTrack(min: number, max: number) {
  if (warnedTrack || spanOf(min, max).valid || import.meta.env.PROD) return
  warnedTrack = true
  console.warn(
    `[basalt] Meter: max (${max}) must be greater than min (${min}); drawing an empty track`,
  )
}

export function Meter(props: MeterProps) {
  const { label, min = 0, max = 100, format = asText, className, style } = props
  const shell = { className, style }
  const ring = props.shape === 'ring'
  warnInvalidTrack(min, max)

  if (props.loading === true) return <MeterLoading label={label} ring={ring} shell={shell} />

  const segments = props.segments === undefined ? undefined : normalizeSegments(props.segments)
  const reading = segments === undefined ? props.value : segmentReading(segments, min)
  if (!isReading(reading) || segments?.length === 0) {
    return (
      <MeterEmpty label={label} text={props.emptyText ?? 'No data'} ring={ring} shell={shell} />
    )
  }

  if (props.shape === 'ring') {
    return <MeterRing {...{ label, reading, min, max, format, shell }} color={props.color} />
  }
  return (
    <MeterBar
      {...{ label, reading, min, max, format, shell }}
      color={props.color}
      segments={segments}
      zones={props.zones}
      target={isReading(props.target) ? props.target : undefined}
      forecastCaption={props.segments === undefined ? undefined : props.forecastCaption}
      startCaption={props.startCaption}
      endCaption={props.endCaption}
    />
  )
}
