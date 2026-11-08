import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Anchor, Group, Stack, Text } from '@mantine/core'
import { IconExternalLink } from '@tabler/icons-react'
import { PageBar, StatGroup, PageSummary } from 'basalt-ui'
import { calendarQueries } from '../../lib/queries/calendar'
import { RECOVERY_DAYS, allocateForms, lastScored, windowCopyDays } from '../garmin-health/model'
import { VISIBLE_DATE_MIN } from '../garmin-health/constants'
import { recoveryQueries, trainingLoadQueries } from '../../lib/queries/daily-metrics'
import { consoleUrl } from '../../lib/console-url'
import { dayKey } from '../calendar/derive'
import { taskFeedState, unanswered } from '../calendar/query-state'
import { useNow } from '../../lib/use-now'
import { shotState } from '../../lib/shot-state'
import { ActivityFeed } from './activity-feed'
import { Meetings } from './meetings'
import {
  acwrReading,
  activityStream,
  calendarEvents,
  laterMeeting,
  nextMeeting,
  recoveryReading,
  recoveryWindow,
  homeSummaryParts,
  taskCounts,
  todayAgenda,
  type RawCalendarEvent,
} from './model'
import { garminStore, toApiWindow } from '../../lib/window-stores'
import { applyVisibilityFilter } from '../garmin-health/visibility'
import { acwrCell, acwrCellGap, meetingCell, recoveryCell, recoveryCellGap } from './strip-cells'
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
 * Today: what is next on the day and whether the body is fit to work. Every figure is one read of
 * an existing endpoint. The factory's own pages (needs-you, flow, chain, improve) live in the Console.
 */
export function TodayPage() {
  const now = useNow()
  // `basalt-ui shot`'s `empty` state: the real empty branches (no meeting, no update).
  const shotEmpty = shotState() === 'empty'

  // From local midnight, so this morning's meetings come back and render as ended.
  const todayKey = dayKey(new Date(now))
  const googleQuery = useQuery(calendarQueries.google(CALENDAR_DAYS, todayKey))
  const m365Query = useQuery(calendarQueries.m365(CALENDAR_DAYS, todayKey))
  const projectsQuery = useQuery(calendarQueries.ticktickProjects())
  // Under the shot's `empty` TickTick holds no project: the real "no tasks" branch, not a forced feed state.
  const projects = (
    shotEmpty ? [] : ((projectsQuery.data as { data?: unknown } | undefined)?.data ?? [])
  ) as Array<{ id: string }>
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

  const tasksFeed = taskFeedState([projectsQuery, ...taskQueries])
  const tasks =
    tasksFeed === 'ready'
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
  // The series is the source of the trend and of the last scored day: one flag for both and for the cell.
  const seriesSettled = recoverySeries.isSuccess && !recoverySeries.isPlaceholderData
  const recoverySnapshot = shotEmpty ? undefined : recoveryNow.data
  const recoveryPoints = recoveryWindow(shotEmpty ? [] : (recoverySeries.data?.points ?? []), now)
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
    shotEmpty ? [] : [...(agenda === null ? [] : calendarEvents(agenda.meetings, now))],
    now,
  )
  const summary = homeSummaryParts(agenda, now)
  // Null when no Console origin is configured: no link.
  const consoleHref = consoleUrl(import.meta.env.VITE_CONSOLE_URL, '/needs-you')
  // Neither calendar has answered yet: the sentence would read "unavailable" for what is only loading.
  const calendarPending = !shotEmpty && googleQuery.isPending && m365Query.isPending

  // The Garmin cadence sentence prints once: on the first of these two cells that shows a data gap.
  const recoverySeriesState = {
    settled: seriesSettled,
    failed: recoverySeries.isError,
    windowDays: windowCopyDays(garminParams, VISIBLE_DATE_MIN),
  }
  const acwrFeed = loadQuery.isPending ? 'loading' : 'error'
  const forms = allocateForms([
    recoveryCellGap(recovery, recoveryNow.isPending, recoverySeriesState),
    acwrCellGap(acwr, acwrFeed, recoverySeriesState.windowDays, loadQuery.isPlaceholderData),
  ])
  const [recoveryForm, acwrForm] = [forms[0] ?? 'short', forms[1] ?? 'short'] as const

  return (
    <>
      <PageBar />
      <Stack gap="md" className={classes.root}>
        {calendarPending ? (
          <PageSummary loading aside={dateFormat.format(now)} />
        ) : (
          <PageSummary
            sentence={summary.sentence}
            facts={summary.facts}
            aside={dateFormat.format(now)}
          />
        )}

        <StatGroup
          variant="strip"
          label="Today at a glance"
          cols={3}
          cells={[
            meetingCell(agenda, next, later, now),
            recoveryCell(recovery, recoveryNow.isPending, recoverySeriesState, recoveryForm),
            acwrCell(
              acwr,
              now,
              acwrFeed,
              recoverySeriesState.windowDays,
              loadQuery.isPlaceholderData,
              acwrForm,
            ),
          ]}
        />

        <div className={classes.columns}>
          <Meetings agenda={agenda} tasks={tasks} tasksFeed={tasksFeed} now={now} />
          <ActivityFeed events={stream.events} total={stream.total} now={now} />
        </div>
        {consoleHref === null ? null : (
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Needs-you, flow, chain and improve live in the Console.
            </Text>
            <Anchor href={consoleHref} target="_blank" rel="noopener noreferrer" size="sm">
              <Group gap={4} component="span" wrap="nowrap">
                Open Console
                <IconExternalLink size={14} aria-hidden />
              </Group>
            </Anchor>
          </Group>
        )}
      </Stack>
    </>
  )
}
