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
import { ACWR_ZONE_NAME } from './formulas'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_OPTIMAL_TO,
  FITNESS_DAYS,
  VO2_DAYS,
  dayLabel,
  fitnessRange,
  lastDaysRange,
  vo2Hero,
  RECOVERY_PUSH_FROM,
  RECOVERY_REST_BELOW,
  contributorItems,
  firstToLast,
  lastScored,
  missingInputs,
  recoveryGap,
  loadFooter,
  windowDayCount,
  fmtNum,
  shortDate,
  signed,
} from './model'
import { withUnit } from '../../lib/format'
import { activitiesRange } from '../../lib/queries/activities-window'
import { VISIBLE_DATE_MIN } from './constants'
import type { SummaryParams } from './types'
import { applyVisibilityFilter } from './visibility'

/** One thin bar per contributor, each on its own scale: "32.0 / 40 pts". */
function ContributorRows({
  label,
  rows,
  loading,
}: {
  label: string
  rows: ReturnType<typeof contributorItems>
  loading: boolean
}) {
  if (loading) return <Meter label={label} loading />
  return (
    <BarList
      label={label}
      variant="thin"
      items={rows}
      format={(v, part) => (part === 'max' ? `${v} pts` : v.toFixed(1))}
      emptyText="No contributors measured"
    />
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
      emptyText="No load measured"
    />
  )
}

function useRecoveryCell(params: SummaryParams): StatStripCell {
  const summary = useQuery(recoveryQueries.summary(params))
  const series = useQuery(recoveryQueries.series(params))

  const last = useMemo(
    () => lastScored(applyVisibilityFilter(series.data?.points ?? [], (p) => p.date)),
    [series.data],
  )

  const data = summary.data
  const score = data?.recovery ?? null
  // The score's own date: today reads "today", a sync gap reads its date.
  const when = dayLabel(data?.date)
  // A fact about the window, so it waits for both reads to settle on the window itself.
  const settled =
    summary.isSuccess && !summary.isPlaceholderData && series.isSuccess && !series.isPlaceholderData
  const gapLine = recoveryGap({
    date: data?.date,
    status: summary.isError || series.isError ? 'error' : 'success',
    settled,
    last,
    windowDays: windowDayCount(activitiesRange(params), VISIBLE_DATE_MIN),
    // No payload or no date is a sentinel, not a day that failed to score: it names nothing.
    missing: data?.date ? missingInputs(data.components) : [],
  }).line
  return {
    key: 'recovery',
    caption: 'Recovery',
    qualifier: when,
    value: score === null ? null : fmtNum(score),
    ...(score !== null && { unit: '/100' }),
    loading: summary.isPending,
    stale: summary.isPlaceholderData,
    visual:
      score === null && !summary.isPending ? (
        gapLine !== null && (
          <Text size="xs" c="dimmed">
            {gapLine}
          </Text>
        )
      ) : (
        <>
          <Meter
            label="Recovery score"
            value={score}
            min={0}
            max={100}
            zones={[
              { from: 0, to: RECOVERY_REST_BELOW, label: 'Rest', color: VX.bad },
              {
                from: RECOVERY_REST_BELOW,
                to: RECOVERY_PUSH_FROM,
                label: 'Normal',
                color: VX.warn,
              },
              { from: RECOVERY_PUSH_FROM, to: 100, label: 'Push', color: VX.good },
            ]}
            startCaption={`rest < ${RECOVERY_REST_BELOW} · push ≥ ${RECOVERY_PUSH_FROM}`}
            endCaption="100"
            loading={summary.isPending}
          />
          <ContributorRows
            label="Recovery contributors, points of their weight"
            rows={contributorItems(data?.components ?? { hrv: null, sleep: null, rhr: null })}
            loading={summary.isPending}
          />
        </>
      ),
  }
}

function useLoadCell(params: SummaryParams): StatStripCell {
  const query = useQuery(trainingLoadQueries.summary(params))
  const { data, isPlaceholderData } = query
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

  return {
    key: 'load',
    caption: 'Training load',
    qualifier: 'recent ÷ long-run load',
    value: fmtNum(acwr, 2),
    unit: 'ACWR',
    loading: query.isPending,
    stale: isPlaceholderData,
    footer: loadFooter({ acwr, status: query.status, placeholder: isPlaceholderData }),
    visual: (
      <>
        <Meter
          label="Acute to chronic workload ratio"
          value={acwr}
          min={0}
          max={ACWR_METER_MAX}
          format={(v) => v.toFixed(2)}
          zones={[
            { from: 0, to: ACWR_FLOOR, label: ACWR_ZONE_NAME.undertrained, color: VX.warn },
            {
              from: ACWR_FLOOR,
              to: ACWR_OPTIMAL_TO,
              label: ACWR_ZONE_NAME.optimal,
              color: VX.good,
            },
            {
              from: ACWR_OPTIMAL_TO,
              to: ACWR_CAUTION_TO,
              label: ACWR_ZONE_NAME.caution,
              short: 'Caut.',
              color: VX.warn,
            },
            {
              from: ACWR_CAUTION_TO,
              to: ACWR_METER_MAX,
              label: ACWR_ZONE_NAME.danger,
              color: VX.bad,
            },
          ]}
          startCaption="0"
          endCaption={ACWR_METER_MAX.toFixed(1)}
          loading={query.isPending}
          emptyText="No training load"
        />
        <LoadRows load={load} loading={query.isPending} />
      </>
    ),
  }
}

type SignalSpec = {
  label: string
  unit: string
  /** Unit printed after the delta; empty when the value's unit is too long to repeat. */
  deltaUnit: string
  digits: number
  /** Which way is good: RHR falling is good, HRV and VO2max rising are. */
  polarity: 'up-good' | 'up-bad'
  values: readonly (number | null)[]
  /** ISO day per value, index-aligned; dates the sparkline's focus readout. */
  dates: readonly string[]
  /** The span the sparkline and delta cover, e.g. "slope · 14 d". */
  period: string
  /** The hero already shows the reading, so the value column names the span instead. */
  hideValue?: boolean
  /** The API's 14 d delta when it has one, else last minus first of the same window. */
  delta: number | null
}

/** One reading with its unit kept together; a missing day (null or the sparkline's NaN gap) is `—`. */
function reading(spec: Pick<SignalSpec, 'digits' | 'unit'>, v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : withUnit(v.toFixed(spec.digits), spec.unit)
}

function signalRow(spec: SignalSpec): StatStripRow {
  const present = spec.values.filter((v): v is number => v !== null)
  const current = present.at(-1) ?? null
  // A null day is NaN, which the sparkline draws as a gap instead of bridging it.
  const trace = spec.values.map((v) => v ?? Number.NaN)
  return {
    key: spec.label,
    label: spec.label,
    value: spec.hideValue === true ? '' : current === null ? null : reading(spec, current),
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
    delta:
      spec.delta === null || spec.delta === 0 ? (
        <Text size="xs" c="dimmed">
          {spec.delta === 0 ? 'unchanged' : '—'}
        </Text>
      ) : (
        <DeltaBadge
          value={spec.delta}
          polarity={spec.polarity}
          format={(v) => `${signed(v, spec.digits)} ${spec.deltaUnit}`.trim()}
          withGlyph
          period={spec.period}
          periodPrefix=""
        />
      ),
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
  const vo2 = useMemo(() => {
    const read = applyVisibilityFilter(history.data?.points ?? [], (p) => p.date, {
      hideToday: false,
    }).filter((p): p is typeof p & { vo2Max: number } => p.vo2Max !== null)
    const first = read.at(0)
    const last = read.at(-1)
    const spanDays =
      first && last ? Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86_400_000) : 0
    return { values: read.map((p) => p.vo2Max), dates: read.map((p) => p.date), spanDays }
  }, [history.data])

  const rows = useMemo(() => {
    // Sleep-derived readings lock in overnight, so today is kept (as the regression's window does).
    const last = applyVisibilityFilter(series.data?.points ?? [], (p) => p.date, {
      hideToday: false,
    })
    return {
      rhr: last.map((p) => p.restingHr),
      hrv: last.map((p) => p.hrv),
      dates: last.map((p) => p.date),
    }
  }, [series.data])

  const d = direction.data
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
        polarity: 'up-bad',
        period: slope(FITNESS_DAYS),
        values: rows.rhr,
        dates: rows.dates,
        delta: d?.rhrDelta ?? null,
      }),
      signalRow({
        label: 'HRV',
        unit: 'ms',
        deltaUnit: 'ms',
        digits: 0,
        polarity: 'up-good',
        period: slope(FITNESS_DAYS),
        values: rows.hrv,
        dates: rows.dates,
        delta: d?.hrvDelta ?? null,
      }),
      signalRow({
        label: 'VO2max',
        unit: 'ml/kg/min',
        deltaUnit: 'ml/kg/min',
        digits: 1,
        polarity: 'up-good',
        period: slope(vo2.spanDays),
        hideValue: true,
        values: vo2.values,
        dates: vo2.dates,
        delta: firstToLast(vo2.values),
      }),
    ],
  }
}

export function GarminStrip({ params }: { params: SummaryParams }) {
  const cells = [useRecoveryCell(params), useLoadCell(params), useFitnessCell()]
  return <StatGroup variant="strip" label="Recovery, training load and fitness" cells={cells} />
}
