import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import { BarList, DeltaBadge, Meter } from 'basalt-ui'
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

const FITNESS_DAYS = 14

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
      caption="Recovery"
      qualifier={
        window.mean === null ? 'today' : `today · ${window.days} d mean ${fmtNum(window.mean)}`
      }
      value={fmtNum(score)}
      unit="/100"
      loading={data === undefined}
    >
      <Meter
        label="Recovery score"
        value={score}
        min={0}
        max={100}
        zones={[
          { from: 0, to: RECOVERY_REST_BELOW, label: 'Rest' },
          { from: RECOVERY_REST_BELOW, to: RECOVERY_PUSH_FROM, label: 'Normal' },
          { from: RECOVERY_PUSH_FROM, to: 100, label: 'Push' },
        ]}
        startCaption={`rest < ${RECOVERY_REST_BELOW} · push ≥ ${RECOVERY_PUSH_FROM}`}
        endCaption="100"
        loading={data === undefined}
        emptyText="No recovery score"
      />
      <BarList
        label="Recovery contributors, points of their weight"
        items={contributorItems(data?.components ?? { hrv: null, sleep: null, rhr: null })}
        format={(v) => v.toFixed(1)}
        max={40}
        loading={data === undefined}
        loadingRows={3}
        emptyText="No contributors measured"
      />
    </StripCell>
  )
}

function LoadCell({ params }: { params: SummaryParams }) {
  const { data } = useQuery(trainingLoadQueries.summary(params))
  // Same visibility rule as the ACWR chart below, so the two never show different "latest" days.
  const latest =
    applyVisibilityFilter(data?.points ?? [], (p) => p.date).findLast((p) => p.acwr !== null) ??
    null
  const acwr = latest?.acwr ?? null
  const load =
    latest?.acute != null && latest.chronic != null
      ? [
          { label: 'Acute', value: latest.acute, secondary: 'MET-min/day', key: 'acute' },
          { label: 'Chronic', value: latest.chronic, secondary: 'MET-min/day', key: 'chronic' },
        ]
      : []

  return (
    <StripCell
      caption="Training load"
      qualifier="acute ÷ chronic EWMA"
      value={fmtNum(acwr, 2)}
      unit="ACWR"
      loading={data === undefined}
    >
      <Meter
        label="Acute to chronic workload ratio"
        value={acwr}
        min={0}
        max={ACWR_METER_MAX}
        format={(v) => v.toFixed(2)}
        zones={[
          { from: 0, to: ACWR_FLOOR, label: 'Under' },
          { from: ACWR_FLOOR, to: ACWR_OPTIMAL_TO, label: 'Optimal' },
          { from: ACWR_OPTIMAL_TO, to: ACWR_CAUTION_TO, label: 'Caution' },
          { from: ACWR_CAUTION_TO, to: ACWR_METER_MAX, label: 'Danger' },
        ]}
        startCaption={`optimal ${ACWR_FLOOR}–${ACWR_OPTIMAL_TO}`}
        endCaption={ACWR_METER_MAX.toFixed(1)}
        loading={data === undefined}
        emptyText="No training load"
      />
      <BarList
        label="Acute and chronic load in MET-min per day"
        items={load}
        format={(v) => v.toFixed(0)}
        loading={data === undefined}
        loadingRows={2}
        emptyText="No load measured"
      />
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
  /** The API's 14 d delta when it has one, else last minus first of the same window. */
  delta: number | null
}

function SignalLine({ spec }: { spec: SignalSpec }) {
  const present = spec.values.filter((v): v is number => v !== null)
  const current = present.at(-1) ?? null
  return (
    <SignalRow
      label={spec.label}
      value={current === null ? '—' : `${current.toFixed(spec.digits)} ${spec.unit}`}
      sparkline={
        present.length > 1 && new Set(present).size > 1 ? (
          <Sparkline
            data={present}
            height={20}
            color={VX.line}
            emphasizeLast
            ariaLabel={`${spec.label} over the last ${FITNESS_DAYS} days`}
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
            withGlyph={false}
          />
        )
      }
    />
  )
}

function FitnessCell({ params }: { params: SummaryParams }) {
  const direction = useQuery(fitnessDirectionQueries.summary(params))
  const series = useQuery(dailyMetricsQueries.series(params))

  const rows = useMemo(() => {
    // Sleep-derived readings lock in overnight, so today is kept (as the regression's window does).
    const last = applyVisibilityFilter(series.data?.points ?? [], (p) => p.date, {
      hideToday: false,
    }).slice(-FITNESS_DAYS)
    return {
      rhr: last.map((p) => p.restingHr),
      hrv: last.map((p) => p.hrv),
      // VO2max moves slowly, so its sparkline spans the whole window rather than the last 14 d.
      vo2: applyVisibilityFilter(series.data?.points ?? [], (p) => p.date, {
        hideToday: false,
      }).map((p) => p.vo2Max),
    }
  }, [series.data])

  const d = direction.data
  return (
    <StripCell
      caption="Fitness"
      qualifier={`${FITNESS_DAYS} d regression`}
      value={d === undefined ? '—' : d.label || '—'}
      loading={d === undefined}
    >
      <SignalLine
        spec={{
          label: 'RHR',
          unit: 'bpm',
          deltaUnit: 'bpm',
          digits: 0,
          polarity: 'up-bad',
          values: rows.rhr,
          delta: d?.rhrDelta ?? null,
        }}
      />
      <SignalLine
        spec={{
          label: 'HRV',
          unit: 'ms',
          deltaUnit: 'ms',
          digits: 0,
          polarity: 'up-good',
          values: rows.hrv,
          delta: d?.hrvDelta ?? null,
        }}
      />
      <SignalLine
        spec={{
          label: 'VO2max',
          unit: 'ml/kg/min',
          deltaUnit: '',
          digits: 1,
          polarity: 'up-good',
          values: rows.vo2,
          delta: firstToLast(rows.vo2.slice(-FITNESS_DAYS)),
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
      <FitnessCell params={params} />
    </StatStrip>
  )
}
