import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import {
  BarList,
  DeltaBadge,
  Meter,
  StatGroup,
  type StatStripCell,
  type StatStripRow,
} from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import {
  dailyMetricsQueries,
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../../lib/queries/daily-metrics'
import { acwrMeterZones } from './formulas'
import { recoveryMeterProps } from './recovery-meter'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_OPTIMAL_TO,
  FITNESS_DAYS,
  VO2_DAYS,
  fitnessRange,
  lastDaysRange,
  vo2Hero,
  contributorItems,
  firstToLast,
  fitnessRowDelta,
  moveDelta,
  recoveryBasis,
  type RowDelta,
  lastScored,
  missingInputs,
  recoveryGap,
  recoveryQualifier,
  loadGap,
  loadCellBranch,
  loadMeterEmptyText,
  recoveryCellBranch,
  fitnessGap,
  gapLine,
  windowCopyDays,
  fmtNum,
  shortDate,
  signed,
} from './model'
import { withUnit } from '../../lib/format'
import { GAP_ORDER, useGapForm } from './gap-ledger'
import { shotState } from '../../lib/shot-state'
import { VISIBLE_DATE_MIN } from './constants'
import type { SummaryParams } from './types'
import { applyVisibilityFilter } from './visibility'

/** One thin bar per contributor, each on its own scale: "32.0 / 40 pts". */
function ContributorRows({
  label,
  rows,
  basis,
  loading,
}: {
  label: string
  rows: ReturnType<typeof contributorItems>
  basis: string | null
  loading: boolean
}) {
  if (loading) return <Meter label={label} loading />
  return (
    <>
      <BarList
        label={label}
        variant="thin"
        items={rows}
        format={(v, part) => (part === 'max' ? `${v} pts` : v.toFixed(1))}
        emptyText="No contributors measured"
      />
      {basis !== null && (
        <Text size="xs" c="dimmed">
          {basis}
        </Text>
      )}
    </>
  )
}

function LoadRows({
  load,
  loading,
}: {
  load: { label: string; value: number }[]
  loading: boolean
}) {
  if (loading) return <Meter label="Acute and chronic load" loading />
  // One shared scale with headroom, so the two bars compare and neither fills its track.
  const max = Math.max(...load.map((l) => l.value), 1) * 1.15
  return (
    <BarList
      label="Acute and chronic load in MET-min per day"
      variant="thin"
      items={load.map((l) => ({ ...l, key: l.label }))}
      max={max}
      format={(v) => `${v.toFixed(0)} MET-min/day`}
    />
  )
}

const NO_COMPONENTS = { hrv: null, sleep: null, rhr: null }

function useRecoveryCell(params: SummaryParams): StatStripCell {
  const summary = useQuery(recoveryQueries.summary(params))
  const series = useQuery(recoveryQueries.series(params))
  // `basalt-ui shot`'s `empty` state renders the cell's own no-score branch.
  const empty = shotState() === 'empty'
  const seriesData = empty ? undefined : series.data

  const last = useMemo(
    () => lastScored(applyVisibilityFilter(seriesData?.points ?? [], (p) => p.date)),
    [seriesData],
  )

  const data = empty ? undefined : summary.data
  const score = data?.recovery ?? null
  // The score's own date: today reads "today", a sync gap reads its date.
  const when = recoveryQualifier(data?.date)
  // A fact about the window, so it waits for both reads to settle on the window itself.
  const settled =
    summary.isSuccess && !summary.isPlaceholderData && series.isSuccess && !series.isPlaceholderData
  const gap = recoveryGap({
    date: data?.date,
    status: summary.isError || series.isError ? 'error' : 'success',
    settled,
    last,
    windowDays: windowCopyDays(params, VISIBLE_DATE_MIN),
    // No payload or no date is a sentinel, not a day that failed to score: it names nothing.
    missing: data?.date ? missingInputs(data.components) : [],
  }).line
  // The cell shows its line only without a score and once the summary has settled.
  const showsGap = score === null && !summary.isPending
  const form = useGapForm(GAP_ORDER.recovery, showsGap ? gap : null)
  return {
    key: 'recovery',
    caption: 'Recovery',
    ...(when !== undefined && { qualifier: when }),
    value: score === null ? null : fmtNum(score),
    ...(score !== null && { unit: '/100' }),
    loading: summary.isPending,
    stale: summary.isPlaceholderData,
    ...(recoveryCellBranch({ showsGap, gap }) === 'empty' && gap !== null
      ? { state: { kind: 'empty', reason: gapLine(gap, form) } as const }
      : {
          visual: (
            <>
              <Meter
                {...recoveryMeterProps(score)}
                value={score === null ? null : Math.round(score)}
                loading={summary.isPending}
              />
              <ContributorRows
                label="Recovery contributors, points of their weight"
                rows={contributorItems(data?.components ?? NO_COMPONENTS)}
                basis={score === null || !data ? null : recoveryBasis(data.components)}
                loading={summary.isPending}
              />
            </>
          ),
        }),
  }
}

function useLoadCell(params: SummaryParams): StatStripCell {
  const query = useQuery(trainingLoadQueries.summary(params))
  const { isPlaceholderData } = query
  const data = shotState() === 'empty' ? undefined : query.data
  // Same visibility rule as the ACWR chart below, so the two never show different "latest" days.
  const latest =
    applyVisibilityFilter(data?.points ?? [], (p) => p.date).findLast((p) => p.acwr !== null) ??
    null
  const acwr = latest?.acwr ?? null
  const load =
    latest?.acute != null && latest.chronic != null
      ? [
          { label: 'Acute', value: latest.acute },
          { label: 'Chronic', value: latest.chronic },
        ]
      : []

  const gap = loadGap({
    acwr,
    status: query.status,
    placeholder: isPlaceholderData,
    windowDays: windowCopyDays(params, VISIBLE_DATE_MIN),
  })
  const form = useGapForm(GAP_ORDER.load, gap ?? null)

  return {
    key: 'load',
    caption: 'Training load',
    qualifier: 'recent ÷ long-run load',
    value: fmtNum(acwr, 2),
    unit: 'ACWR',
    loading: query.isPending,
    stale: isPlaceholderData,
    ...(gap !== undefined && loadCellBranch({ gap, loadRows: load.length }) === 'empty'
      ? { state: { kind: 'empty', reason: gapLine(gap, form) } as const }
      : {
          visual: (
            <>
              <Meter
                label="Acute to chronic workload ratio"
                value={acwr}
                min={0}
                max={ACWR_METER_MAX}
                format={(v) => v.toFixed(2)}
                zones={acwrMeterZones({
                  floor: ACWR_FLOOR,
                  optimalTo: ACWR_OPTIMAL_TO,
                  cautionTo: ACWR_CAUTION_TO,
                  max: ACWR_METER_MAX,
                })}
                startCaption="0"
                endCaption={ACWR_METER_MAX.toFixed(1)}
                loading={query.isPending}
                emptyText={loadMeterEmptyText(gap, (g) => gapLine(g, form))}
              />
              {load.length > 0 || query.isPending ? (
                <LoadRows load={load} loading={query.isPending} />
              ) : null}
            </>
          ),
        }),
  }
}

type SignalSpec = {
  label: string
  unit: string
  /** Unit printed after the delta; empty when the value's unit is too long to repeat. */
  deltaUnit: string
  digits: number
  /** Decimals of the delta column: a fitted change under 0.5 must not print as `0`. */
  deltaDigits: number
  /** Which way is good: RHR falling is good, HRV and VO2max rising are. */
  polarity: 'up-good' | 'up-bad'
  values: readonly (number | null)[]
  /** ISO day per value, index-aligned; dates the sparkline's focus readout. */
  dates: readonly string[]
  /** The span the sparkline and delta cover, e.g. "slope · 14 d". */
  period: string
  /** The hero already shows the reading, so the value column names the span instead. */
  hideValue?: boolean
  /** What the delta column prints; built by `fitnessRowDelta` / `moveDelta`. */
  delta: RowDelta
}

/** One reading with its unit kept together; a missing day (null or the sparkline's NaN gap) is `—`. */
function reading(spec: Pick<SignalSpec, 'digits' | 'unit'>, v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : withUnit(v.toFixed(spec.digits), spec.unit)
}

function deltaCell(spec: SignalSpec): StatStripRow['delta'] {
  const { delta } = spec
  const change = (v: number): string => `${signed(v, spec.deltaDigits)} ${spec.deltaUnit}`.trim()
  switch (delta.kind) {
    case 'move':
      return (
        <DeltaBadge
          value={delta.value}
          polarity={spec.polarity}
          format={change}
          withGlyph
          period={spec.period}
          periodPrefix=""
        />
      )
    case 'none':
      return <DimText>—</DimText>
    case 'unchanged':
      return <DimText>unchanged</DimText>
    case 'flat':
      return <DimText>{`flat · ${change(delta.value)}`}</DimText>
    case 'plain':
      return <DimText>{change(delta.value)}</DimText>
    default:
      return delta satisfies never
  }
}

function DimText({ children }: { children: string }) {
  return (
    <Text size="xs" c="dimmed">
      {children}
    </Text>
  )
}

function signalRow(spec: SignalSpec): StatStripRow {
  const present = spec.values.filter((v): v is number => v !== null)
  const current = present.at(-1) ?? null
  // A null day is NaN, which the sparkline draws as a gap instead of bridging it.
  const trace = spec.values.map((v) => v ?? Number.NaN)
  return {
    key: spec.label,
    label: spec.label,
    value: current === null ? null : reading(spec, current),
    ...(spec.hideValue === true && { hideValue: true }),
    visual:
      present.length > 1 && new Set(present).size > 1 ? (
        <Sparkline
          data={trace}
          height={28}
          color={VX.line}
          emphasizeLast
          format={(v) => reading(spec, v)}
          labels={spec.dates.map((d) => shortDate(d))}
          ariaLabel={`${spec.label}, ${spec.period}, now ${current === null ? 'unknown' : reading(spec, current)}`}
        />
      ) : (
        <Text size="xs" c="dimmed">
          {present.length > 1 ? 'unchanged' : '—'}
        </Text>
      ),
    delta: deltaCell(spec),
  }
}

/** The one wording for the fitness windows: the method and the span it covers. */
const slope = (days: number): string => `slope · ${withUnit(days, 'd')}`

function useFitnessCell(): StatStripCell {
  // Fixed windows keep the copy true ("slope · 14 d") whatever the page's selector says.
  const range = fitnessRange()
  const direction = useQuery(fitnessDirectionQueries.summary(range))
  const series = useQuery(dailyMetricsQueries.series(range))
  // VO2max moves over months: a bounded 180 d trace, not the page window and not all history.
  const history = useQuery(dailyMetricsQueries.series(lastDaysRange(VO2_DAYS)))
  // `basalt-ui shot`'s `empty` state: no reading in any of the fitness reads.
  const empty = shotState() === 'empty'
  const historyData = empty ? undefined : history.data
  const seriesData = empty ? undefined : series.data
  const vo2 = useMemo(() => {
    const read = applyVisibilityFilter(historyData?.points ?? [], (p) => p.date, {
      hideToday: false,
    }).filter((p): p is typeof p & { vo2Max: number } => p.vo2Max !== null)
    const first = read.at(0)
    const last = read.at(-1)
    const spanDays =
      first && last ? Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86_400_000) : 0
    return { values: read.map((p) => p.vo2Max), dates: read.map((p) => p.date), spanDays }
  }, [historyData])

  const rows = useMemo(() => {
    // Sleep-derived readings lock in overnight, so today is kept (as the regression's window does).
    const last = applyVisibilityFilter(seriesData?.points ?? [], (p) => p.date, {
      hideToday: false,
    })
    return {
      rhr: last.map((p) => p.restingHr),
      hrv: last.map((p) => p.hrv),
      dates: last.map((p) => p.date),
    }
  }, [seriesData])

  const d = empty ? undefined : direction.data
  // No reading in any read: one line with cause and next step (the neighbours' wording), not a hero,
  // a qualifier and three rows of dashes. A pending or placeholder read is not a gap.
  const reads = [direction, series, history]
  const gap = fitnessGap({
    status: reads.some((q) => q.isError)
      ? 'error'
      : reads.some((q) => q.isPending)
        ? 'pending'
        : 'success',
    placeholder: reads.some((q) => q.isPlaceholderData),
    hasReading:
      vo2Hero(vo2.values, d?.vo2max) !== null ||
      rows.rhr.some((v) => v !== null) ||
      rows.hrv.some((v) => v !== null),
  })
  const form = useGapForm(GAP_ORDER.fitness, gap ?? null)
  if (gap !== undefined) {
    return {
      key: 'fitness',
      caption: 'Fitness',
      state: { kind: 'empty', reason: gapLine(gap, form) },
    }
  }
  return {
    key: 'fitness',
    caption: 'Fitness',
    qualifier: `${d?.label || '—'} · ${slope(FITNESS_DAYS)}`,
    value: fmtNum(vo2Hero(vo2.values, d?.vo2max), 1),
    unit: 'VO2max ml/kg/min',
    loading: direction.isPending,
    stale: direction.isPlaceholderData || series.isPlaceholderData || history.isPlaceholderData,
    rows: [
      signalRow({
        label: 'RHR',
        unit: 'bpm',
        deltaUnit: 'bpm',
        digits: 0,
        deltaDigits: 1,
        polarity: 'up-bad',
        period: slope(FITNESS_DAYS),
        values: rows.rhr,
        dates: rows.dates,
        delta: fitnessRowDelta({
          change: d?.rhrChange ?? null,
          flat: d?.rhrFlat ?? null,
          delta: d?.rhrDelta ?? null,
        }),
      }),
      signalRow({
        label: 'HRV',
        unit: 'ms',
        deltaUnit: 'ms',
        digits: 0,
        deltaDigits: 1,
        polarity: 'up-good',
        period: slope(FITNESS_DAYS),
        values: rows.hrv,
        dates: rows.dates,
        delta: fitnessRowDelta({
          change: d?.hrvChange ?? null,
          flat: d?.hrvFlat ?? null,
          delta: d?.hrvDelta ?? null,
        }),
      }),
      signalRow({
        label: 'VO2max',
        unit: 'ml/kg/min',
        deltaUnit: 'ml/kg/min',
        digits: 1,
        deltaDigits: 1,
        polarity: 'up-good',
        period: slope(vo2.spanDays),
        hideValue: true,
        values: vo2.values,
        dates: vo2.dates,
        delta: moveDelta(firstToLast(vo2.values)),
      }),
    ],
  }
}

export function GarminStrip({ params }: { params: SummaryParams }) {
  const cells = [useRecoveryCell(params), useLoadCell(params), useFitnessCell()]
  return <StatGroup variant="strip" label="Recovery, training load and fitness" cells={cells} />
}
