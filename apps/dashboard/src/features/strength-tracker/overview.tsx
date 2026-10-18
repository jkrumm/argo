/**
 * The top of the Charts tab: one summary sentence, today's call (readiness and ACWR against their
 * zone bands) and a joined strip with a cell per lift. Every figure comes from `model.ts`.
 */
import { ActionIcon, Card, Group, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { DeltaBadge, Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { alpha, CONTAINER_KEYS as CQ, VX } from 'basalt-ui/tokens'
import { useNow } from '../../lib/use-now'
import { PageSummary } from '../../components/upstream/page-summary'
import { strengthQueries, type StrengthQueryParams } from '../../lib/queries/strength'
import { workoutsQueries } from '../../lib/queries/workouts'
import { TERM_DEFINITIONS } from './constants'
import { exerciseLabel } from './formulas'
import {
  DELTA_DAYS,
  EM_DASH,
  shortDate,
  deloadLine,
  lastSessionDate,
  staleNote,
  ACWR_LABEL,
  readinessHeader,
  recentDeload,
  liftDelta,
  callFacts,
  lastSession,
  liftFooter,
  latestE1rm,
  acwrReading,
  readinessReading,
  summaryParts,
  todaysCall,
  type LiftDelta,
  type Point,
} from './model'
import {
  ACWR_CAUTION_TO,
  ACWR_FLOOR,
  ACWR_METER_MAX,
  ACWR_OPTIMAL_TO,
  READINESS_PUSH_FROM,
  READINESS_REST_BELOW,
} from './bands'
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
  const summaryLine = summaryParts(
    exercises.map((id) => ({
      delta: liftDelta(series.byExercise.find((l) => l.exercise_id === id)?.points ?? [], now),
    })),
  )
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

function SummaryLine(props: Params) {
  const { summaryLine } = useOverview(props)
  return summaryLine === null ? null : <PageSummary sentence={summaryLine.sentence} />
}

/** A term of art with its plain-word definition behind an info icon. */
function Term({ name, label, definition }: { name: string; label: ReactNode; definition: string }) {
  return (
    <Group component="span" gap={4} wrap="nowrap" align="center">
      {label}
      <Tooltip
        label={definition}
        multiline
        maw={300}
        withArrow
        events={{ hover: true, focus: true, touch: true }}
      >
        <ActionIcon variant="transparent" color="gray" size="xs" aria-label={`About ${name}`}>
          <IconInfoCircle size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}

function TodaysCall(props: Params) {
  const { readiness, deload, lastDate, series, call, acwr, acwrWeek } = useOverview(props)
  const score = readiness?.score ?? null
  const session = lastSession(series.byExercise)

  const facts = callFacts({ asOf: call.asOf, driver: readiness?.driver ?? null, session })
  const meta = [
    deloadLine(deload, { lastSessionShown: session !== null, lastDate }),
    // An override already shows as the title; only a cap needs the meter's own verdict named.
    call.monitor !== null && call.verdict !== call.readinessVerdict
      ? `score alone reads ${call.readinessVerdict}`
      : null,
  ]
    .filter((v) => v !== null)
    .join(' · ')

  return (
    <Card data-shot="strength-call">
      <Stack gap="sm">
        <Text component="h3" m={0} fw={600} size="md" lh={1.35}>
          {readinessTitle(call)}
        </Text>
        {facts.text === '' ? null : (
          <Group gap={4} wrap="wrap" align="center">
            <Text size="xs" c="dimmed">
              {facts.text}
            </Text>
            {facts.inol === null ? null : (
              <Term
                name="INOL"
                label={
                  <Text size="xs" c="dimmed">
                    · {facts.inol}
                  </Text>
                }
                definition={TERM_DEFINITIONS.inol}
              />
            )}
          </Group>
        )}
        <SimpleGrid type="container" cols={{ base: 1, [CQ.wide]: 2 }} spacing="md">
          <Stack gap="xs" miw={0}>
            <Term
              name="the readiness score"
              label={
                <Text size="xs" fw={600}>
                  Score {readinessHeader(readiness)?.text ?? EM_DASH}
                </Text>
              }
              definition={TERM_DEFINITIONS.readiness}
            />
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
          </Stack>
          <Stack gap="xs" miw={0}>
            <Term
              name={ACWR_LABEL}
              label={
                <Text size="xs" fw={600}>
                  Recent vs usual load, {ACWR_LABEL} {acwr === null ? EM_DASH : acwr.toFixed(2)}
                </Text>
              }
              definition={TERM_DEFINITIONS.acwr}
            />
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
                  { from: ACWR_OPTIMAL_TO, to: ACWR_CAUTION_TO, label: 'Caution', color: VX.warn },
                  { from: ACWR_CAUTION_TO, to: ACWR_METER_MAX, label: 'Danger', color: VX.bad },
                ]}
                startCaption={null}
                endCaption={null}
              />
            )}
            {acwr === null && acwrWeek !== null ? (
              <Text className={classes.method}>
                no training week in the last 28 d, last was the week of {shortDate(acwrWeek)}
              </Text>
            ) : null}
          </Stack>
        </SimpleGrid>
        {meta === '' ? null : (
          <Text size="xs" c="dimmed">
            {meta}
          </Text>
        )}
      </Stack>
    </Card>
  )
}

/** The meter's own verdict, not the capped call (an override is named in the meta line). */
function readinessTitle(call: ReturnType<typeof useOverview>['call']): string {
  const verdict = call.overridden ? call.readinessVerdict : call.verdict
  return verdict === EM_DASH ? 'Readiness' : `Readiness: ${verdict}`
}

type LiftPr = ReturnType<typeof useOverview>['summary']['byExercise'][number]

/** One lift's strip cell: latest e1RM, its 28 d delta, the recent line against the PR. */
function liftCell({
  id,
  points,
  move,
  pr,
}: {
  id: string
  points: readonly Point[]
  move: LiftDelta
  pr: LiftPr | undefined
}): StatStripCell {
  const e1rm = latestE1rm(points)
  const plotted = points.filter((p) => p.e1rm !== null).slice(-SPARK_POINTS)
  const spark = plotted.map((p) => p.e1rm as number)
  return {
    key: id,
    caption: exerciseLabel(id),
    value: e1rm === null ? null : e1rm.toFixed(1),
    unit: 'kg e1RM',
    ...(move.delta !== null && {
      delta: (
        <DeltaBadge
          value={move.delta}
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
    footer: liftFooter({
      delta: move,
      prKg: pr?.bestE1RM ?? null,
      prDate: pr?.prDate ?? null,
    }),
  }
}

/** Strip columns by lift count: at least two, at most six. */
const liftCols = (n: number) => Math.min(Math.max(n, 2), 6) as 2 | 3 | 4 | 5 | 6

function LiftStrip(props: Params) {
  const { series, summary, now } = useOverview(props)
  const prs = new Map(summary.byExercise.map((s) => [s.exercise_id, s]))
  // Each lift's move is derived once; the cells and the stale note both read it.
  const lifts = props.exercises.map((id) => {
    const points = series.byExercise.find((l) => l.exercise_id === id)?.points ?? []
    return { id, points, delta: liftDelta(points, now) }
  })
  const cells = lifts.map(({ id, points, delta }) =>
    liftCell({ id, points, move: delta, pr: prs.get(id) }),
  )
  const note = staleNote(lifts)

  return (
    <Stack gap="xs">
      <StatGroup
        variant="strip"
        label="Estimated 1RM per lift"
        cols={liftCols(cells.length)}
        cells={cells}
      />
      {note === null ? null : (
        <Text size="xs" c="dimmed">
          {note}
        </Text>
      )}
    </Stack>
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
