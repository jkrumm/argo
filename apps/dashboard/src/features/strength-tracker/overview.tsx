/**
 * The top of the Charts tab: one summary sentence, today's call (readiness and ACWR against their
 * zone bands) and a joined strip with a cell per lift. Every figure comes from `model.ts`.
 */
import { Box, Stack, Text } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { DeltaBadge, Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { useNow } from '../../lib/use-now'
import { DecisionCard } from '../../components/upstream/decision-card'
import { PageSummary } from '../../components/upstream/page-summary'
import { strengthQueries, type StrengthQueryParams } from '../../lib/queries/strength'
import { workoutsQueries } from '../../lib/queries/workouts'
import { exerciseLabel } from './formulas'
import {
  ACWR_CAUTION_TO,
  DELTA_DAYS,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_METHOD,
  ACWR_OPTIMAL_TO,
  EM_DASH,
  READINESS_PUSH_FROM,
  READINESS_REST_BELOW,
  dayLabel,
  shortDate,
  deloadLine,
  lastSessionDate,
  readinessHeader,
  recentDeload,
  liftDelta,
  lastSession,
  latestE1rm,
  acwrReading,
  readinessReading,
  sessionCount,
  summaryParts,
  todaysCall,
  type Point,
} from './model'
import classes from './overview.module.css'

/** `MeterZone` has no tone, and `Meter`'s default zone fill is near-white in dark mode. */
const MUTED_FILL = alpha(VX.muted, 0.35)
const SPARK_POINTS = 20
const VERDICT_WINDOW = '30d'

type Params = { params: StrengthQueryParams; exercises: readonly string[] }

/** Everything the three blocks share, derived once per render from cached queries. */
function useOverview({ params, exercises }: Params) {
  // The verdict inputs read fixed recent windows, never the page's: a past or custom range filters
  // the charts below, not "today". The history behind ACWR's EWMAs is the full record.
  const { data: heroes } = useSuspenseQuery(
    strengthQueries.heroes({ window: '90d', exercises: params.exercises }),
  )
  const { data: readinessSeries } = useSuspenseQuery(
    strengthQueries.readiness({ window: VERDICT_WINDOW }),
  )
  const { data: deload } = useSuspenseQuery(
    strengthQueries.deloadSignal({ exercises: exercises.join(',') }),
  )
  const { data: load } = useSuspenseQuery(
    strengthQueries.trainingLoad({ window: 'all', exercises: params.exercises }),
  )
  const { data: series } = useSuspenseQuery(
    strengthQueries.seriesDetailed({ window: 'all', exercises: exercises.join(',') }),
  )
  const { data: summary } = useSuspenseQuery(workoutsQueries.summaryStrength({ window: 'all' }))

  const now = useNow()
  const readiness = readinessReading(readinessSeries.points)
  const lastDate = lastSessionDate(series.byExercise)
  const deloadNow = recentDeload(deload, lastDate, now)
  const call = todaysCall(readiness, deloadNow, now)
  const { acwr, week: acwrWeek } = acwrReading(load.byExercise, now)
  const leader =
    exercises.find((e) => e === heroes.strengthDirection.leaderExercise) ?? exercises[0] ?? null
  const leaderPoints = series.byExercise.find((l) => l.exercise_id === leader)?.points ?? []
  const summaryLine = summaryParts({
    leader,
    e1rm: latestE1rm(leaderPoints),
    delta: liftDelta(leaderPoints, now),
    acwr,
    call,
    score: readiness?.score ?? null,
  })
  return {
    readiness,
    deload: deloadNow,
    lastDate,
    series,
    summary,
    call,
    acwr,
    acwrWeek,
    summaryLine,
    now,
  }
}

export function SummaryLine(props: Params) {
  const { summaryLine } = useOverview(props)
  return <PageSummary {...summaryLine} />
}

export function TodaysCall(props: Params) {
  const { readiness, deload, lastDate, series, call, acwr, acwrWeek } = useOverview(props)
  const score = readiness?.score ?? null
  const session = lastSession(series.byExercise)

  const facts = [
    call.title,
    ...(readiness?.driver ? [`driver ${readiness.driver}`] : []),
    ...(session === null
      ? []
      : [
          `last session ${exerciseLabel(session.exercise_id)} INOL ${session.inol.toFixed(2)}, ${dayLabel(session.date)}`,
        ]),
  ]
  const meta = [
    deloadLine(deload, lastDate),
    call.verdict !== call.readinessVerdict && readiness !== null && score !== null
      ? `readiness alone reads ${readinessHeader(readiness)?.text} · ${readiness.verdict}`
      : null,
  ]
    .filter((v) => v !== null)
    .join(' · ')

  return (
    <Box data-shot="strength-call">
      <DecisionCard
        question="Readiness"
        facts={facts}
        evidence={
          <Stack gap="md">
            <Box className={classes.meterBlock}>
              <Text size="xs" fw={600}>
                Score {readinessHeader(readiness)?.text ?? EM_DASH}
              </Text>
              {score === null ? (
                <Text size="xs" c="dimmed">
                  Readiness needs 7 days of Garmin metrics
                </Text>
              ) : (
                <Meter
                  label="Readiness score with its Rest and Push thresholds"
                  value={score}
                  min={0}
                  max={100}
                  format={(v) => String(Math.round(v))}
                  zones={[
                    { from: 0, to: READINESS_REST_BELOW, label: 'Rest', color: VX.warn },
                    {
                      from: READINESS_REST_BELOW,
                      to: READINESS_PUSH_FROM,
                      label: 'Normal',
                      color: MUTED_FILL,
                    },
                    { from: READINESS_PUSH_FROM, to: 100, label: 'Push', color: VX.good },
                  ]}
                  startCaption={null}
                  endCaption={null}
                />
              )}
              <Text className={classes.method}>
                Rest below {READINESS_REST_BELOW} · Push from {READINESS_PUSH_FROM}
              </Text>
            </Box>
            <Box className={classes.meterBlock}>
              <Text size="xs" fw={600}>
                ACWR {acwr === null ? EM_DASH : acwr.toFixed(2)}
              </Text>
              {acwr === null ? null : (
                <Meter
                  label="Acute to chronic workload ratio"
                  value={acwr}
                  min={0}
                  max={ACWR_METER_MAX}
                  format={(v) => v.toFixed(2)}
                  zones={[
                    { from: 0, to: ACWR_FLOOR, label: 'Under', color: VX.warn },
                    { from: ACWR_FLOOR, to: ACWR_OPTIMAL_TO, label: 'Optimal', color: VX.good },
                    {
                      from: ACWR_OPTIMAL_TO,
                      to: ACWR_CAUTION_TO,
                      label: 'Caution',
                      color: VX.warn,
                    },
                    { from: ACWR_CAUTION_TO, to: ACWR_METER_MAX, label: 'Danger', color: VX.bad },
                  ]}
                  startCaption={null}
                  endCaption={null}
                />
              )}
              <Text className={classes.method}>
                optimal {ACWR_FLOOR}–{ACWR_OPTIMAL_TO} ·{' '}
                {acwr === null && acwrWeek !== null
                  ? `no training week in the last 28 d, last was the week of ${shortDate(acwrWeek)}`
                  : ACWR_METHOD}
              </Text>
            </Box>
          </Stack>
        }
        meta={meta}
      />
    </Box>
  )
}

type LiftPr = ReturnType<typeof useOverview>['summary']['byExercise'][number]

/** One lift's strip cell: latest e1RM, its 28 d delta, the recent line against the PR. */
function liftCell({
  id,
  points,
  pr,
  now,
}: {
  id: string
  points: readonly Point[]
  pr: LiftPr | undefined
  now: number
}): StatStripCell {
  const e1rm = latestE1rm(points)
  const { delta, phrase } = liftDelta(points, now)
  const plotted = points.filter((p) => p.e1rm !== null).slice(-SPARK_POINTS)
  const spark = plotted.map((p) => p.e1rm as number)
  const sparkFrom = plotted[0]?.date ?? ''
  const sparkTo = plotted.at(-1)?.date ?? ''
  const sessions = pr?.sessionCountWindow ?? sessionCount(points)
  return {
    key: id,
    caption: exerciseLabel(id),
    value: e1rm === null ? null : e1rm.toFixed(1),
    unit: 'kg e1RM',
    ...(delta !== null && {
      delta: (
        <DeltaBadge
          value={delta}
          polarity="up-good"
          format={(v) => `${Math.abs(v).toFixed(1)} kg`}
          period={`in ${DELTA_DAYS} d`}
          periodPrefix=""
        />
      ),
    }),
    ...(spark.length > 1 && {
      visual: (
        <Sparkline
          ariaLabel={`${exerciseLabel(id)} e1RM, last ${spark.length} sessions`}
          data={spark}
          height={28}
          color={VX.line}
          format={(v) => `${v.toFixed(1)} kg`}
          labels={plotted.map((p) => shortDate(p.date))}
          {...(pr?.bestE1RM != null && { reference: pr.bestE1RM })}
          emphasizeLast
        />
      ),
    }),
    footer: (
      <>
        {delta === null ? (
          <>
            {phrase}
            <br />
          </>
        ) : null}
        {spark.length > 1
          ? `line: last ${spark.length} sessions, ${shortDate(sparkFrom)}–${shortDate(sparkTo)}${pr?.bestE1RM == null ? '' : ', dashed: PR'}`
          : null}
        {spark.length > 1 ? <br /> : null}
        PR {pr?.bestE1RM == null ? '' : `${pr.bestE1RM.toFixed(1)} kg · `}
        {pr?.prDate ? shortDate(pr.prDate) : EM_DASH} · {sessions}{' '}
        {sessions === 1 ? 'session' : 'sessions'}, all time
      </>
    ),
  }
}

/** Strip columns by lift count: at least two, at most six. */
const liftCols = (n: number) => Math.min(Math.max(n, 2), 6) as 2 | 3 | 4 | 5 | 6

export function LiftStrip(props: Params) {
  const { series, summary, now } = useOverview(props)
  const prs = new Map(summary.byExercise.map((s) => [s.exercise_id, s]))
  const cells = props.exercises.map((id) =>
    liftCell({
      id,
      points: series.byExercise.find((l) => l.exercise_id === id)?.points ?? [],
      pr: prs.get(id),
      now,
    }),
  )

  return (
    <StatGroup
      variant="strip"
      label="Estimated 1RM per lift"
      cols={liftCols(cells.length)}
      cells={cells}
    />
  )
}

export function OverviewStack(props: Params) {
  return (
    <Stack gap="md">
      <SummaryLine {...props} />
      <TodaysCall {...props} />
      <LiftStrip {...props} />
    </Stack>
  )
}
