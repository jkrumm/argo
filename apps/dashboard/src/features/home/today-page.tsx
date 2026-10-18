import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Stack } from '@mantine/core'
import { PageBar, StatGroup, PageSummary } from 'basalt-ui'
import { agentsQueries } from '../../lib/queries/agents'
import { calendarQueries } from '../../lib/queries/calendar'
import { RECOVERY_DAYS, lastScored, windowDayCount } from '../garmin-health/model'
import { VISIBLE_DATE_MIN } from '../garmin-health/constants'
import { activitiesRange } from '../../lib/queries/activities-window'
import { recoveryQueries, trainingLoadQueries } from '../../lib/queries/daily-metrics'
import { wardenQueries } from '../../lib/queries/warden'
import { deriveDecisions } from '../../lib/decisions'
import { dayKey } from '../calendar/derive'
import { unanswered } from '../calendar/query-state'
import { useNow } from '../../lib/use-now'
import { shotState } from '../../lib/shot-state'
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
  homeSummaryParts,
  taskCounts,
  todayAgenda,
  wardenEvents,
  type RawCalendarEvent,
} from './model'
import { NeedsYou } from './needs-you'
import { garminStore, toApiWindow } from '../../lib/window-stores'
import { applyVisibilityFilter } from '../garmin-health/visibility'
import { acwrCell, agentsCell, budgetCell, meetingCell, recoveryCell } from './strip-cells'
import classes from './home.module.css'

/** The Garmin page's default window, the fallback for a dateless custom range. */
const GARMIN_DEFAULT_WINDOW = '30d'
/** Seven days from today's midnight: today's agenda plus the lookup for the next meeting after it. */
const CALENDAR_DAYS = 7

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
  // `basalt-ui shot`'s `empty` state: the real empty branches (no decision, no meeting, no update).
  const shotEmpty = shotState() === 'empty'

  const agentsQuery = useQuery(agentsQueries.latest())
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

  // Recovery (window-wide baselines) and the ACWR (an EWMA seeded at the window's first day) both
  // depend on the window: Today reads the Garmin page's own (URL ⊳ stored ⊳ 30 d), so both pages
  // print the same figures.
  const garmin = garminStore.useValues()
  const garminParams = toApiWindow(
    garminStore.field.window.toWindow({ preset: garmin.window, from: garmin.from, to: garmin.to }),
    GARMIN_DEFAULT_WINDOW,
  )
  const recoveryNow = useQuery(recoveryQueries.summary(garminParams))
  const recoverySeries = useQuery(recoveryQueries.series(garminParams))
  const loadQuery = useQuery(trainingLoadQueries.summary(garminParams))

  // ── Sources ────────────────────────────────────────────────────────────────────────────────
  // Under the shot's `empty` the overview feed holds no snapshot: the cell reads the real no-snapshot branch.
  const agentsRecord = shotEmpty ? null : (agentsQuery.data?.latest ?? null)
  const snapshot = agentsRecord?.snapshot
  const warden = wardenQuery.data ?? null
  const wardenRaw = warden?.raw
  // Under the shot's `empty` every source answered: nothing is unavailable or stale.
  const unavailable = shotEmpty
    ? []
    : [
        ...(warden === null && !wardenQuery.isPending ? ['Warden'] : []),
        ...(agentsRecord === null && !agentsQuery.isPending ? ['Agents'] : []),
      ]

  const decisions = shotEmpty
    ? []
    : deriveDecisions({
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
  // Under the shot's `empty` the sources answered with nothing: the real empty agenda, not the unknown one.
  const google = shotEmpty ? [] : unanswered(googleQuery) ? null : asEvents(googleQuery.data)
  const m365 = shotEmpty ? [] : unanswered(m365Query) ? null : asEvents(m365Query.data)
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
    shotEmpty ||
    (!projectsQuery.isError && projectsQuery.data !== undefined && taskQueries.every((q) => q.data))
  const tasks = tasksLoaded
    ? taskCounts(
        shotEmpty
          ? []
          : taskQueries.flatMap(
              (q) =>
                ((q.data as { data?: { tasks?: unknown } } | undefined)?.data?.tasks ??
                  []) as Parameters<typeof taskCounts>[0],
            ),
        now,
      )
    : null

  // ── Body ───────────────────────────────────────────────────────────────────────────────────
  // The series is the source of the trend and of the last scored day: one flag for both and for the cell.
  const seriesSettled = recoverySeries.isSuccess && !recoverySeries.isPlaceholderData
  const recoverySnapshot = shotEmpty ? undefined : recoveryNow.data
  const recoveryPoints = applyVisibilityFilter(
    shotEmpty ? [] : (recoverySeries.data?.points ?? []),
    (p) => p.date,
  )
  const recovery =
    recoverySnapshot || shotEmpty
      ? recoveryReading(
          recoverySnapshot,
          recoveryPoints.slice(-RECOVERY_DAYS),
          now,
          seriesSettled ? lastScored(recoveryPoints) : null,
        )
      : null
  const loadPoints = shotEmpty ? [] : loadQuery.data?.points
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
    shotEmpty
      ? []
      : [
          ...wardenEvents(wardenRaw),
          ...narrativeEvents(narrativesQuery.data?.data),
          ...(agenda === null ? [] : calendarEvents(agenda.meetings, now)),
        ],
    now,
  )
  const stale = staleFeeds(
    shotEmpty
      ? []
      : [
          ...(warden === null ? [] : [{ name: 'Warden', receivedAt: warden.receivedAt }]),
          ...(agentsRecord === null
            ? []
            : [{ name: 'Agents', receivedAt: agentsRecord.receivedAt }]),
        ],
    now,
  )

  const summary = homeSummaryParts({ decisions, unavailable })

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
            agentsCell(
              snapshot?.summary,
              fleet,
              agentsRecord !== null ? null : agentsQuery.isError ? 'failed' : 'none',
            ),
            budgetCell(wardenRaw?.budget, poller),
            meetingCell(agenda, next, later, now),
            recoveryCell(recovery, recoveryNow.isPending, {
              settled: seriesSettled,
              failed: recoverySeries.isError,
              windowDays: windowDayCount(activitiesRange(garminParams), VISIBLE_DATE_MIN),
            }),
            acwrCell(acwr, now),
          ]}
        />

        <div className={classes.columns}>
          <NeedsYou decisions={decisions} unavailable={unavailable} />
          <Stack gap="md">
            <Meetings agenda={agenda} tasks={tasks} now={now} />
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
