import { BandStrip, Sparkline } from 'basalt-ui/charts'
import type { BandSpan } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { CACHE_HIT_TARGET, errorDayState, fmtPct } from './model'
import classes from './usage.module.css'

/** The ring's progress arc: not a verdict, and `VX.line` is near-white in dark mode. */
const MUTED_FILL = alpha(VX.muted, 0.35)
const SPARK_HEIGHT = 36
const RING_SIZE = 56
const RING_STROKE = 6

export type Daily = { date: Date; value: number | null }

export function Trend({
  label,
  days,
  loading,
}: {
  label: string
  days: readonly Daily[]
  loading: boolean
}) {
  const data = days.flatMap((d) => (d.value === null ? [] : [d.value]))
  return (
    <Sparkline
      ariaLabel={label}
      data={data}
      height={SPARK_HEIGHT}
      emphasizeLast
      state={loading ? { pending: true } : { empty: data.length < 2 }}
    />
  )
}

const BAND_STATES = [
  { key: 'ok', label: 'ok', color: alpha(VX.muted, 0.2) },
  { key: 'warn', label: 'warn', color: VX.warn },
  { key: 'bad', label: 'bad', color: VX.bad },
  { key: 'none', label: 'no calls', color: alpha(VX.muted, 0.06) },
] as const

export function ErrorBand({ days }: { days: readonly Daily[] }) {
  return (
    <BandStrip
      ariaLabel="Error rate per day over the last 30 days"
      data={days}
      x={(d) => d.date}
      states={BAND_STATES}
      getBand={(d): BandSpan => ({ state: errorDayState(d.value) })}
      legend={false}
      height={28}
    />
  )
}

/** Hand-drawn ring: basalt's `Meter shape="ring"` takes no target, and this one needs the 60 % tick. */
export function CacheRing({ ratio }: { ratio: number }) {
  const c = RING_SIZE / 2
  const r = (RING_SIZE - RING_STROKE) / 2
  const circumference = 2 * Math.PI * r
  const angle = CACHE_HIT_TARGET * 2 * Math.PI
  const at = (radius: number) => ({
    x: c + radius * Math.sin(angle),
    y: c - radius * Math.cos(angle),
  })
  const inner = at(r - RING_STROKE)
  const outer = at(r + RING_STROKE)
  return (
    <svg
      className={classes.ring}
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      role="img"
      aria-label={`Cache hit ${fmtPct(ratio)} against a ${fmtPct(CACHE_HIT_TARGET, 0)} target`}
    >
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={alpha(VX.muted, 0.08)}
        strokeWidth={RING_STROKE}
      />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={ratio < CACHE_HIT_TARGET ? VX.warn : MUTED_FILL}
        strokeWidth={RING_STROKE}
        strokeDasharray={`${circumference * Math.min(1, ratio)} ${circumference}`}
        transform={`rotate(-90 ${c} ${c})`}
      />
      <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={VX.ink} strokeWidth={2} />
    </svg>
  )
}
