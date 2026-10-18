import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Stack } from '@mantine/core'
import { PageBar, StatGroup } from 'basalt-ui'
import { PageSummary } from '../../components/upstream/page-summary'
import { agentsQueries } from '../../lib/queries/agents'
import { calendarQueries } from '../../lib/queries/calendar'
import { recoveryQueries, trainingLoadQueries } from '../../lib/queries/daily-metrics'
import { wardenQueries } from '../../lib/queries/warden'
import { deriveDecisions } from '../../lib/decisions'
import { dayKey } from '../calendar/derive'
import { unanswered } from '../calendar/query-state'
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
  laterMeeting,
  nextMeeting,
  recoveryReading,
  summaryParts,
  taskCounts,
  todayAgenda,
  wardenEvents,
  type RawCalendarEvent,
} from './model'
import { NeedsYou } from './needs-you'
import { applyVisibilityFilter } from '../garmin-health/visibility'
import { acwrCell, agentsCell, budgetCell, meetingCell, recoveryCell } from './strip-cells'
import classes from './home.module.css'

/** Recovery and its baselines are window-wide, so Today reads the Garmin page's default window. */
const GARMIN_WINDOW = { window: '30d' } as const
/** ACWR is an EWMA: it needs the longer history to be warm. */
const LOAD_WINDOW = { window: '90d' } as const
const RECOVERY_DAYS = 7
/** Seven days from today's midnight: today's agenda plus the lookup for the next meeting after it. */
const CALENDAR_DAYS = 7
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

  // From local midnight, so this morning's meetings come back and render as ended.
  const todayKey = dayKey(new Date(now))
  const googleQuery = useQuery(calendarQueries.google(CALENDAR_DAYS, todayKey))
  const m365Query = useQuery(calendarQueries.m365(CALENDAR_DAYS, todayKey))
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
  const google = unanswered(googleQuery) ? null : asEvents(googleQuery.data)
  const m365 = unanswered(m365Query) ? null : asEvents(m365Query.data)
  const feeds = [
    ...(google === null ? [] : [{ sourceClass: 'personal' as const, events: google }]),
    ...(m365 === null ? [] : [{ sourceClass: 'work' as const, events: m365 }]),
  ]
  const missing = [
    ...(google === null ? ['personal' as const] : []),
    ...(m365 === null ? ['work' as const] : []),
  ]
  // Null only when no calendar answered; one answering with nothing reads as partial, not free.
  const agenda = feeds.length === 0 ? null : todayAgenda(feeds, now, missing)
  const later = agenda === null ? null : laterMeeting(feeds, now)
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
  const loadPoints = loadQuery.data?.points
  // The Garmin Health strip's visibility rule, so both pages name the same "latest" day.
  const acwr = useMemo(
    () =>
      loadPoints === undefined
        ? null
        : acwrReading(applyVisibilityFilter(loadPoints, (p) => p.date)),
    // `now` ticks the hide-today cutoff: the filter reads the clock itself.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [loadPoints, now],
  )

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

  const summary = summaryParts({ decisions, unavailable })

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
        <PageSummary
          sentence={summary.sentence}
          facts={summary.facts}
          aside={dateFormat.format(now)}
        />

        <StatGroup
          variant="strip"
          label="Today at a glance"
          cols={5}
          cells={[
            agentsCell(snapshot?.summary, fleet?.total ?? null, historyQuery.data?.data, now),
            budgetCell(wardenRaw?.budget, poller),
            meetingCell(agenda, next, later, now),
            recoveryCell(recovery, recoveryNow.isPending),
            acwrCell(acwr, now),
          ]}
        />

        <div className={classes.columns}>
          <NeedsYou decisions={decisions} unavailable={unavailable} />
          <Stack gap="md">
            <Meetings agenda={agenda} later={later} tasks={tasks} now={now} />
            <ActivityFeed
              groups={stream.groups}
              total={stream.total}
              stale={stale}
              loaded={warden !== null || agentsRecord !== null}
              now={now}
            />
          </Stack>
        </div>
      </Stack>
    </>
  )
}
