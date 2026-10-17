/** Meter's internal pieces: bar, ring, empty and loading. `meter.tsx` dispatches between them. */
import { Skeleton, VisuallyHidden } from '@mantine/core'
import { useId } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { cx } from './props'
import { ariaValues, modelBar, ringFraction, zoneBand } from './meter-model'
import type { MeterSegment, MeterZone, Part } from './meter-model'
import classes from './meter.module.css'
import { toPct } from './scale'

export type Shell = { className: string | undefined; style: CSSProperties | undefined }

const RING_VIEWBOX = 36
const RING_STROKE = 4
const RING_RADIUS = (RING_VIEWBOX - RING_STROKE) / 2
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
const RING_CENTER = RING_VIEWBOX / 2

/** The one ring drawing: a track and, when there is a reading, its arc (a fraction of the circle). */
function RingSvg({ fraction, color }: { fraction?: number; color?: string | undefined }) {
  return (
    <svg className={classes.ring} viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`} aria-hidden>
      <circle
        className={classes.ringTrack}
        cx={RING_CENTER}
        cy={RING_CENTER}
        r={RING_RADIUS}
        strokeWidth={RING_STROKE}
      />
      {fraction !== undefined && (
        <circle
          className={classes.ringArc}
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          strokeWidth={RING_STROKE}
          strokeDasharray={`${fraction * RING_LENGTH} ${RING_LENGTH}`}
          {...(color !== undefined && { style: { stroke: color } })}
        />
      )}
    </svg>
  )
}

export function MeterLoading({
  label,
  ring,
  shell,
}: {
  label: string
  ring: boolean
  shell: Shell
}) {
  return (
    <div className={cx(classes.root, shell.className)} style={shell.style} aria-busy="true">
      <VisuallyHidden>{`Loading ${label}`}</VisuallyHidden>
      {ring ? (
        <Skeleton className={classes.skeletonRing} circle />
      ) : (
        <>
          <Skeleton className={classes.skeletonTrack} />
          <Skeleton className={classes.skeletonCaption} radius="sm" />
        </>
      )}
    </div>
  )
}

export function MeterEmpty(props: { label: string; text: string; ring: boolean; shell: Shell }) {
  const { label, text, ring, shell } = props
  return (
    <output className={cx(classes.root, shell.className)} style={shell.style} aria-label={label}>
      {ring ? (
        <span className={classes.ringBox}>
          <RingSvg />
        </span>
      ) : (
        <div className={classes.trackBox}>
          <div className={classes.track} data-meter-track />
        </div>
      )}
      <span className={classes.empty}>{text}</span>
    </output>
  )
}

export function MeterRing(props: {
  label: string
  reading: number
  min: number
  max: number
  color: string | undefined
  format: (value: number) => string
  shell: Shell
}) {
  const { label, reading, min, max, color, format, shell } = props
  return (
    <div className={cx(classes.root, shell.className)} style={shell.style}>
      <span
        className={classes.ringBox}
        aria-label={label}
        {...ariaValues(reading, min, max, format)}
      >
        <RingSvg fraction={ringFraction(reading, min, max)} color={color} />
        <span className={classes.ringValue}>{format(reading)}</span>
      </span>
    </div>
  )
}

function fillStyle(p: Part): CSSProperties {
  return { width: `${toPct(p.size)}%`, ...(p.color !== undefined && { background: p.color }) }
}

/** Uncoloured zones step from `MIN` to `MIN + STEP` percent of the neutral, so order reads without hue. */
const ZONE_STRENGTH_MIN = 15
const ZONE_STRENGTH_STEP = 45
const ZONE_STRENGTH_SOLO = 40
/** Every band after the first gives up its leading pixel, so a boundary never relies on fill strength. */
const ZONE_GAP = '1px'

function zoneStyle(zone: MeterZone, index: number, count: number, min: number, span: number) {
  const band = zoneBand(zone, min, span)
  const gap = index > 0
  const strength =
    count > 1 ? ZONE_STRENGTH_MIN + (index / (count - 1)) * ZONE_STRENGTH_STEP : ZONE_STRENGTH_SOLO
  return {
    insetInlineStart: gap ? `calc(${band.start}% + ${ZONE_GAP})` : `${band.start}%`,
    width: gap ? `calc(${band.width}% - ${ZONE_GAP})` : `${band.width}%`,
    background: zone.color ?? `color-mix(in srgb, var(--vx-line) ${strength}%, transparent)`,
  } satisfies CSSProperties
}

export function MeterBar(props: {
  label: string
  reading: number
  min: number
  max: number
  format: (value: number) => string
  color: string | undefined
  segments: readonly MeterSegment[] | undefined
  zones: readonly MeterZone[] | undefined
  target: number | undefined
  forecastCaption: string | undefined
  startCaption: ReactNode
  endCaption: ReactNode
  shell: Shell
}) {
  const { label, reading, min, max, format, zones, shell } = props
  const describedId = useId()
  const model = modelBar(props)
  const start = props.startCaption === undefined ? model.startText : props.startCaption
  const end = props.endCaption === undefined ? model.endText : props.endCaption
  const hasCaptions = start !== null || end !== null || model.forecastText !== null
  const describedBy =
    model.describedByText === null ? {} : ({ 'aria-describedby': describedId } as const)

  return (
    <div className={cx(classes.root, shell.className)} style={shell.style}>
      <div
        className={classes.trackBox}
        aria-label={label}
        {...ariaValues(reading, min, max, format)}
        {...describedBy}
      >
        <div className={classes.track} data-meter-track>
          {model.markerPct !== undefined &&
            zones?.map((z, i) => (
              <div
                key={i}
                className={classes.zone}
                data-meter-zone={z.label}
                style={zoneStyle(z, i, zones.length, min, model.span)}
              />
            ))}
          {model.parts.map((p, i) => (
            <div
              key={i}
              className={cx(classes.fill, p.forecast && classes.forecastFill)}
              data-meter-fill={p.forecast ? 'forecast' : 'committed'}
              style={fillStyle(p)}
            />
          ))}
        </div>
        <Tick kind="marker" className={classes.marker} pct={model.markerPct} />
        <Tick kind="boundary" className={classes.boundaryTick} pct={model.boundaryPct} />
        <Tick kind="target" className={classes.tick} pct={model.targetPct} />
      </div>
      {model.describedByText !== null && (
        <VisuallyHidden id={describedId}>{model.describedByText}</VisuallyHidden>
      )}
      {hasCaptions && (
        <div className={classes.captions} data-meter-captions>
          {start !== null && <span className={classes.caption}>{start}</span>}
          {model.forecastText !== null && (
            <span className={classes.caption}>{model.forecastText}</span>
          )}
          {end !== null && <span className={classes.captionEnd}>{end}</span>}
        </div>
      )}
    </div>
  )
}

function Tick({
  kind,
  className,
  pct,
}: {
  kind: 'marker' | 'boundary' | 'target'
  className: string
  pct: number | undefined
}) {
  if (pct === undefined) return null
  return (
    <div
      className={className}
      data-meter-tick={kind}
      style={{ insetInlineStart: `${pct}%` }}
      aria-hidden
    />
  )
}
