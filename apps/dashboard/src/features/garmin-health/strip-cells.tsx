import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { DeltaBadge } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { BarList, Meter } from '../../components/upstream'
import {
  dailyMetricsQueries,
  fitnessDirectionQueries,
  recoveryQueries,
  trainingLoadQueries,
} from '../../lib/queries/daily-metrics'
import { acwrZoneLabel } from './formulas'
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

const recoveryZoneName = (score: number): string =>
  score >= RECOVERY_PUSH_FROM ? 'Push' : score >= RECOVERY_REST_BELOW ? 'Normal' : 'Rest'

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
        startCaption={score === null ? null : recoveryZoneName(score)}
        endCaption={`rest < ${RECOVERY_REST_BELOW} · push ≥ ${RECOVERY_PUSH_FROM}`}
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
  const latest = data?.points.findLast((p) => p.acwr !== null) ?? null
  const acwr = latest?.acwr ?? null
  const footer =
    latest?.acute != null && latest.chronic != null
      ? `acute ${latest.acute.toFixed(0)} · chronic ${latest.chronic.toFixed(0)} MET-min/day`
      : undefined

  return (
    <StripCell
      caption="Training load"
      qualifier="acute ÷ chronic EWMA"
      value={fmtNum(acwr, 2)}
      unit="ACWR"
      {...(footer !== undefined && { footer })}
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
        startCaption={latest === null ? null : acwrZoneLabel(latest.zone)}
        endCaption={`optimal ${ACWR_FLOOR}–${ACWR_OPTIMAL_TO}`}
        loading={data === undefined}
        emptyText="No training load"
      />
    </StripCell>
  )
}

type SignalSpec = {
  label: string
  unit: string
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
        present.length > 1 ? (
          <Sparkline
            data={present}
            height={20}
            color={VX.line}
            emphasizeLast
            ariaLabel={`${spec.label} over the last ${FITNESS_DAYS} days`}
          />
        ) : (
          <Box />
        )
      }
      delta={
        spec.delta === null ? (
          '—'
        ) : (
          <DeltaBadge
            value={spec.delta}
            polarity={spec.polarity}
            format={(v) => signed(v, spec.digits)}
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
      vo2: last.map((p) => p.vo2Max),
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
          digits: 1,
          polarity: 'up-good',
          values: rows.vo2,
          delta: firstToLast(rows.vo2),
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
