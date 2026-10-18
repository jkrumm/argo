import { BandStrip, Sparkline } from 'basalt-ui/charts'
import type { BandSpan } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { errorDayState, shortDay } from './model'

const SPARK_HEIGHT = 36

export type Daily = { date: Date; value: number | null }

export function Trend({
  label,
  days,
  loading,
  format,
  reference,
}: {
  label: string
  days: readonly Daily[]
  loading: boolean
  /** The readout's value with its unit (`$12.40`, `3.2M tokens`, `1.8 s`). */
  format: (value: number) => string
  /** A dashed line at a target or a limit, in the series' own unit. */
  reference?: number | undefined
}) {
  const present = days.filter((d): d is Daily & { value: number } => d.value !== null)
  const data = present.map((d) => d.value)
  return (
    <Sparkline
      ariaLabel={label}
      data={data}
      format={format}
      labels={present.map((d) => shortDay.format(d.date))}
      height={SPARK_HEIGHT}
      emphasizeLast
      reference={reference}
      state={loading ? { pending: true } : { empty: data.length < 2 }}
    />
  )
}

const BAND_STATES = [
  { key: 'ok', label: 'ok', color: alpha(VX.muted, 0.2) },
  { key: 'warn', label: 'warn', color: VX.warnSolid },
  { key: 'bad', label: 'bad', color: VX.badSolid },
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
      tooltip={{ formatHeader: (x) => shortDay.format(x) }}
      height={28}
    />
  )
}
