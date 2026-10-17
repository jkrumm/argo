import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Stack, Text } from '@mantine/core'
import { DeltaBadge, Meter } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import {
  dailyMetricsQueries,
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../../lib/queries/daily-metrics'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_OPTIMAL_TO,
  FITNESS_DAYS,
  VO2_DAYS,
  lastDaysRange,
  RECOVERY_PUSH_FROM,
  RECOVERY_REST_BELOW,
  contributorItems,
  firstToLast,
  fmtNum,
  mean,
  signed,
} from './model'
import { SignalRow, StatStrip, StripCell } from './stat-strip'
import type { SummaryParams } from './types'
import { applyVisibilityFilter } from './visibility'

/** Thin one-per-row meters: the label and its points sit under the track, the number leads. */
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
  if (rows.length === 0) return <Meter label={label} emptyText="No contributors measured" />
  return (
    <Stack gap="xs" role="group" aria-label={label}>
      {rows.map((r) => (
        <Meter
          key={r.key}
          label={`${r.label} points`}
          value={r.value}
          min={0}
          max={r.weight}
          startCaption={r.label}
          endCaption={`${r.value.toFixed(1)} ${r.secondary}`}
        />
      ))}
    </Stack>
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
  if (load.length === 0)
    return <Meter label="Acute and chronic load" emptyText="No load measured" />
  // One shared scale with headroom, so the two bars compare and neither fills its track.
  const max = Math.max(...load.map((l) => l.value), 1) * 1.15
  return (
    <Stack gap="xs" role="group" aria-label="Acute and chronic load in MET-min per day">
      {load.map((l) => (
        <Meter
          key={l.label}
          label={`${l.label} load`}
          value={l.value}
          min={0}
          max={max}
          startCaption={l.label}
          endCaption={`${l.value.toFixed(0)} MET-min/day`}
        />
      ))}
    </Stack>
  )
}

function RecoveryCell({ params }: { params: SummaryParams }) {
  const summary = useQuery(recoveryQueries.summary(params))
  const series = useQuery(recoveryQueries.series(params))

  const window = useMemo(() => {
    const values = applyVisibilityFilter(series.data?.points ?? [], (p) => p.date).map(
      (p) => p.recovery,
    )
    return { mean: mean(values), days: values.filter((v) => v !== null).length }
  }, [series.data])

  const data = summary.data
  const score = data?.recovery ?? null
  return (
    <StripCell
      shot="strip-recovery"
      caption="Recovery"
      qualifier={
        window.mean === null ? 'today' : `today · ${window.days} d mean ${fmtNum(window.mean)}`
      }
      value={fmtNum(score)}
      unit="/100"
      loading={summary.isPending}
      stale={summary.isPlaceholderData}
    >
      <Meter
        label="Recovery score"
        value={score}
        min={0}
        max={100}
        zones={[
          { from: 0, to: RECOVERY_REST_BELOW, label: 'Rest', color: VX.bad },
          { from: RECOVERY_REST_BELOW, to: RECOVERY_PUSH_FROM, label: 'Normal', color: VX.warn },
          { from: RECOVERY_PUSH_FROM, to: 100, label: 'Push', color: VX.good },
        ]}
        startCaption={`rest < ${RECOVERY_REST_BELOW} · push ≥ ${RECOVERY_PUSH_FROM}`}
        endCaption="100"
        loading={summary.isPending}
        emptyText="No recovery score"
      />
      <ContributorRows
        label="Recovery contributors, points of their weight"
        rows={contributorItems(data?.components ?? { hrv: null, sleep: null, rhr: null })}
        loading={summary.isPending}
      />
    </StripCell>
  )
}

function LoadCell({ params }: { params: SummaryParams }) {
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

  return (
    <StripCell
      shot="strip-load"
      caption="Training load"
      qualifier="acute ÷ chronic EWMA"
      value={fmtNum(acwr, 2)}
      unit="ACWR"
      loading={query.isPending}
      stale={isPlaceholderData}
      footer={`under < ${ACWR_FLOOR} · optimal ${ACWR_FLOOR}–${ACWR_OPTIMAL_TO} · caution ${ACWR_OPTIMAL_TO}–${ACWR_CAUTION_TO} · danger > ${ACWR_CAUTION_TO}`}
    >
      <Meter
        label="Acute to chronic workload ratio"
        value={acwr}
        min={0}
        max={ACWR_METER_MAX}
        format={(v) => v.toFixed(2)}
        zones={[
          { from: 0, to: ACWR_FLOOR, label: 'Under', color: VX.warn },
          { from: ACWR_FLOOR, to: ACWR_OPTIMAL_TO, label: 'Optimal', color: VX.good },
          { from: ACWR_OPTIMAL_TO, to: ACWR_CAUTION_TO, label: 'Caution', color: VX.warn },
          { from: ACWR_CAUTION_TO, to: ACWR_METER_MAX, label: 'Danger', color: VX.bad },
        ]}
        startCaption="0"
        endCaption={ACWR_METER_MAX.toFixed(1)}
        loading={query.isPending}
        emptyText="No training load"
      />
      <LoadRows load={load} loading={query.isPending} />
    </StripCell>
  )
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
  /** The span the sparkline and delta cover, e.g. "14 d". */
  period: string
  /** The hero already shows the reading, so the value column names the span instead. */
  hideValue?: boolean
  /** The API's 14 d delta when it has one, else last minus first of the same window. */
  delta: number | null
  /** Dims the row while its data refetches. */
  stale?: boolean
}

function SignalLine({ spec }: { spec: SignalSpec }) {
  const present = spec.values.filter((v): v is number => v !== null)
  const current = present.at(-1) ?? null
  // A null day is NaN, which the sparkline draws as a gap instead of bridging it.
  const trace = spec.values.map((v) => v ?? Number.NaN)
  return (
    <SignalRow
      stale={spec.stale === true}
      label={spec.label}
      value={
        spec.hideValue === true
          ? ''
          : current === null
            ? '—'
            : `${current.toFixed(spec.digits)} ${spec.unit}`
      }
      sparkline={
        present.length > 1 && new Set(present).size > 1 ? (
          <Sparkline
            data={trace}
            height={28}
            color={VX.line}
            emphasizeLast
            ariaLabel={`${spec.label} over ${spec.period}, now ${current === null ? 'unknown' : current.toFixed(spec.digits)} ${spec.unit}`}
          />
        ) : (
          <Text size="xs" c="dimmed">
            {present.length > 1 ? 'unchanged' : '—'}
          </Text>
        )
      }
      delta={
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
            period={`vs ${spec.period}`}
          />
        )
      }
    />
  )
}

function FitnessCell() {
  // Fixed windows keep the copy true ("14 d regression") whatever the page's selector says.
  const fitnessRange = lastDaysRange(FITNESS_DAYS)
  const direction = useQuery(fitnessDirectionQueries.summary(fitnessRange))
  const series = useQuery(dailyMetricsQueries.series(fitnessRange))
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
    return { values: read.map((p) => p.vo2Max), spanDays }
  }, [history.data])

  const rows = useMemo(() => {
    // Sleep-derived readings lock in overnight, so today is kept (as the regression's window does).
    const last = applyVisibilityFilter(series.data?.points ?? [], (p) => p.date, {
      hideToday: false,
    })
    return {
      rhr: last.map((p) => p.restingHr),
      hrv: last.map((p) => p.hrv),
    }
  }, [series.data])

  const d = direction.data
  return (
    <StripCell
      shot="strip-fitness"
      caption="Fitness"
      qualifier={`${d?.label || '—'} · ${FITNESS_DAYS} d regression`}
      value={fmtNum(d?.vo2max, 1)}
      unit="VO2max ml/kg/min"
      loading={direction.isPending}
      stale={direction.isFetching}
    >
      <SignalLine
        spec={{
          label: 'RHR',
          unit: 'bpm',
          deltaUnit: 'bpm',
          digits: 0,
          polarity: 'up-bad',
          period: `${FITNESS_DAYS} d`,
          values: rows.rhr,
          delta: d?.rhrDelta ?? null,
          stale: series.isFetching,
        }}
      />
      <SignalLine
        spec={{
          label: 'HRV',
          unit: 'ms',
          deltaUnit: 'ms',
          digits: 0,
          polarity: 'up-good',
          period: `${FITNESS_DAYS} d`,
          values: rows.hrv,
          delta: d?.hrvDelta ?? null,
          stale: series.isFetching,
        }}
      />
      <SignalLine
        spec={{
          label: 'VO2max',
          unit: 'ml/kg/min',
          deltaUnit: 'ml/kg/min',
          digits: 1,
          polarity: 'up-good',
          period: `${vo2.spanDays} d`,
          hideValue: true,
          values: vo2.values,
          delta: firstToLast(vo2.values),
          stale: history.isFetching,
        }}
      />
    </StripCell>
  )
}

export function StatStripRow({ params }: { params: SummaryParams }) {
  return (
    <StatStrip>
      <RecoveryCell params={params} />
      <LoadCell params={params} />
      <FitnessCell />
    </StatStrip>
  )
}
