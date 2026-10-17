import { useQueries, useQuery } from '@tanstack/react-query'
import { Stack, Title } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { agentsQueries } from '../../lib/queries/agents'
import { calendarQueries } from '../../lib/queries/calendar'
import { recoveryQueries, trainingLoadQueries } from '../../lib/queries/daily-metrics'
import { wardenQueries } from '../../lib/queries/warden'
import { deriveDecisions } from '../../lib/decisions'
import { useNow } from '../../lib/use-now'
import { countUnknownAgents, fleetParts, flattenAgents } from '../agents/model'
import { derivePollers } from '../warden/page-model'
import { ActivityFeed } from './activity-feed'
import { Meetings } from './meetings'
import {
  acwrReading,
  activityStream,
  calendarEvents,
  staleFeeds,
  narrativeEvents,
  nextMeeting,
  recoveryReading,
  summarySentence,
  taskCounts,
  todayAgenda,
  wardenEvents,
  type RawCalendarEvent,
} from './model'
import { NeedsYou } from './needs-you'
import { acwrCell, agentsCell, budgetCell, meetingCell, recoveryCell } from './strip-cells'
import { TodayStrip } from './today-strip'
import classes from './home.module.css'

/** Recovery and its baselines are window-wide, so Today reads the Garmin page's default window. */
const GARMIN_WINDOW = { window: '30d' } as const
/** ACWR is an EWMA: it needs the longer history to be warm. */
const LOAD_WINDOW = { window: '90d' } as const
const RECOVERY_DAYS = 7
const HISTORY_HOURS = 24

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

const asEvents = (data: unknown): RawCalendarEvent[] | null =>
  Array.isArray(data) ? (data as RawCalendarEvent[]) : null

/**
 * Today: what needs the owner, what is next on the day, and whether body and fleet are fit to
 * work. Every figure is one read of an existing endpoint; the Needs-you count, the cards and the
 * summary sentence all come from the one `deriveDecisions` list.
 */
export function TodayPage() {
  const now = useNow()

  const agentsQuery = useQuery(agentsQueries.latest())
  const historyQuery = useQuery(agentsQueries.history(HISTORY_HOURS))
  const narrativesQuery = useQuery(agentsQueries.narratives())
  const wardenQuery = useQuery(wardenQueries.snapshot())

  const googleQuery = useQuery(calendarQueries.google(1))
  const m365Query = useQuery(calendarQueries.m365(1))
  const projectsQuery = useQuery(calendarQueries.ticktickProjects())
  const projects = ((projectsQuery.data as { data?: unknown } | undefined)?.data ?? []) as Array<{
    id: string
  }>
  const taskQueries = useQueries({
    queries: projects.map((project) => calendarQueries.ticktickProjectTasks(project.id)),
  })

  const recoveryNow = useQuery(recoveryQueries.summary(GARMIN_WINDOW))
  const recoverySeries = useQuery(recoveryQueries.series(GARMIN_WINDOW))
  const loadQuery = useQuery(trainingLoadQueries.summary(LOAD_WINDOW))

  // ── Sources ────────────────────────────────────────────────────────────────────────────────
  const agentsRecord = agentsQuery.data?.latest ?? null
  const snapshot = agentsRecord?.snapshot
  const warden = wardenQuery.data ?? null
  const wardenRaw = warden?.raw
  const unavailable = [
    ...(warden === null && !wardenQuery.isPending ? ['Warden'] : []),
    ...(agentsRecord === null && !agentsQuery.isPending ? ['Agents'] : []),
  ]

  const decisions = deriveDecisions({
    warden: wardenRaw,
    agents: snapshot,
    wardenReceivedAt: warden?.receivedAt,
    now,
  })

  // ── Fleet and loop ─────────────────────────────────────────────────────────────────────────
  const agents = flattenAgents(snapshot)
  const fleet = fleetParts(snapshot?.summary, countUnknownAgents(agents))
  const poller = derivePollers(wardenRaw?.metrics, wardenRaw?.health)[0]

  // ── Calendar ───────────────────────────────────────────────────────────────────────────────
  const google = asEvents(googleQuery.data)
  const m365 = asEvents(m365Query.data)
  const calendarLoaded = [google, m365].filter((e): e is RawCalendarEvent[] => e !== null)
  const agenda = calendarLoaded.length === 0 ? null : todayAgenda(calendarLoaded, now)
  const missing = [...(google === null ? ['Google'] : []), ...(m365 === null ? ['M365'] : [])]
  const next = agenda === null ? null : nextMeeting(agenda.meetings, now)

  const tasksLoaded =
    !projectsQuery.isError && projectsQuery.data !== undefined && taskQueries.every((q) => q.data)
  const tasks = tasksLoaded
    ? taskCounts(
        taskQueries.flatMap(
          (q) =>
            ((q.data as { data?: { tasks?: unknown } } | undefined)?.data?.tasks ??
              []) as Parameters<typeof taskCounts>[0],
        ),
        now,
      )
    : null

  // ── Body ───────────────────────────────────────────────────────────────────────────────────
  const recovery = recoveryNow.data
    ? recoveryReading(
        recoveryNow.data,
        (recoverySeries.data?.points ?? []).slice(-RECOVERY_DAYS),
        now,
      )
    : null
  const acwr = loadQuery.data ? acwrReading(loadQuery.data.points) : null

  // ── Activity ───────────────────────────────────────────────────────────────────────────────
  const stream = activityStream(
    [
      ...wardenEvents(wardenRaw),
      ...narrativeEvents(narrativesQuery.data?.data),
      ...(agenda === null ? [] : calendarEvents(agenda.meetings, now)),
    ],
    now,
  )
  const stale = staleFeeds(
    [
      ...(warden === null ? [] : [{ name: 'Warden', receivedAt: warden.receivedAt }]),
      ...(agentsRecord === null ? [] : [{ name: 'Agents', receivedAt: agentsRecord.receivedAt }]),
    ],
    now,
  )

  const summary = summarySentence({
    decisions,
    unavailable,
    fleet: fleet === null ? null : { working: snapshot?.summary?.working ?? 0, total: fleet.total },
    meetings: agenda === null ? null : { next, total: agenda.meetings.length },
    recovery: recovery?.isToday ? recovery.score : null,
    now,
  })

  return (
    <>
      <PageBar
        sync={{
          syncing: agentsQuery.isFetching || wardenQuery.isFetching,
          onSync: () => {
            void agentsQuery.refetch()
            void wardenQuery.refetch()
          },
          label: 'Refresh',
        }}
      />
      <Stack gap="md" className={classes.root}>
        <div className={classes.headline} data-shot="summary">
          <Title order={3} fw={500}>
            {summary}
          </Title>
          <span className={classes.date}>{dateFormat.format(now)}</span>
        </div>

        <TodayStrip
          cells={[
            agentsCell(snapshot?.summary, fleet?.total ?? null, historyQuery.data?.data, now),
            budgetCell(wardenRaw?.budget, poller),
            meetingCell(agenda, next, now),
            recoveryCell(recovery),
            acwrCell(acwr),
          ]}
        />

        <div className={classes.columns}>
          <NeedsYou decisions={decisions} unavailable={unavailable} />
          <Stack gap="md">
            <Meetings
              agenda={agenda}
              tasks={tasks}
              missing={agenda === null ? [] : missing}
              now={now}
            />
            <ActivityFeed groups={stream.groups} total={stream.total} stale={stale} now={now} />
          </Stack>
        </div>
      </Stack>
    </>
  )
}
