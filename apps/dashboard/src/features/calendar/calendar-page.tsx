import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Box, Stack, Text, useMantineColorScheme } from '@mantine/core'
import { MonthView, WeekView } from '@mantine/schedule'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { addMonths, addWeeks, endOfWeek, format, startOfWeek } from 'date-fns'
import {
  CALENDAR_DAYS_RANGE,
  calendarQueries,
  googleToEvents,
  m365ToEvents,
  tickTickToEvents,
} from '../../lib/queries/calendar'
import type { SourceClass } from '../../lib/queries/calendar'
import { PageBar, useSizeClass } from 'basalt-ui'
import type { BarAction } from 'basalt-ui/controls'
import { ViewTabs } from 'basalt-ui/controls'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { calendarStore } from '../../lib/window-stores'
import { AgendaView } from './agenda-view'
import { failed, feedGap, taskFeedState, taskReadFailed, unanswered } from './query-state'
import { failureReason, isAuthError, signInStep } from './sign-in'
import { SourceErrorLine, type SourceError } from './sign-in-step'
import { DayGroups } from './agenda-parts'
import {
  addDays,
  agendaDays,
  isCancelled,
  dayKey,
  hourToTime,
  queryFromKey,
  weekKeys,
  weekWindow,
  type CalendarItem,
  type CalendarView,
  type DayKey,
} from './derive'

type SearchState = { view: CalendarView; date: string }

export type CalendarPageProps = {
  view: CalendarView
  date: string
}

/** The Week tab on a phone: this many days, anchored on the selected date (± 1 day). */
const COMPACT_DAYS = 3

/** The phone Week view's pending list stands for its three days. */
const COMPACT_SKELETON_ROWS = COMPACT_DAYS

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

function shiftDate(date: string, view: CalendarView, delta: number, compact: boolean): string {
  if (view === 'week' && compact) return addDays(date, delta * COMPACT_DAYS)
  const parsed = new Date(`${date}T00:00:00`)
  const next = view === 'week' ? addWeeks(parsed, delta) : addMonths(parsed, delta)
  return format(next, 'yyyy-MM-dd')
}

function headerLabel(date: string, view: CalendarView): string {
  const parsed = new Date(`${date}T00:00:00`)
  if (view === 'month') return format(parsed, 'MMMM yyyy')
  const start = startOfWeek(parsed, { weekStartsOn: 1 })
  const end = endOfWeek(parsed, { weekStartsOn: 1 })
  const sameMonth = format(start, 'MMM') === format(end, 'MMM')
  const sameYear = format(start, 'yyyy') === format(end, 'yyyy')
  if (sameMonth) return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
  if (sameYear) return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
  return `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`
}

export function CalendarPage({ view, date }: CalendarPageProps) {
  const navigate = useNavigate({ from: '/calendar' })
  const { colorScheme } = useMantineColorScheme()
  const compact = useSizeClass() === 'compact'

  const nowMs = useNow()
  const fromKey = queryFromKey(view, date, dayKey(new Date(nowMs)))
  const googleQuery = useQuery(calendarQueries.google(CALENDAR_DAYS_RANGE, fromKey))
  const m365Query = useQuery(calendarQueries.m365(CALENDAR_DAYS_RANGE, fromKey))
  const projectsQuery = useQuery(calendarQueries.ticktickProjects())

  const projects = ((projectsQuery.data as { data?: unknown } | undefined)?.data ?? []) as Array<{
    id: string
    name: string
  }>
  // Tasks are a list on the Agenda tab; the Week and Month grids carry meetings only.
  const projectQueries = useQueries({
    queries: projects.map((project) => ({
      ...calendarQueries.ticktickProjectTasks(project.id),
      enabled: view === 'agenda',
    })),
  })

  // `basalt-ui shot`'s `empty` state: the sources answered with no events and no tasks.
  const shotEmpty = shotState() === 'empty'
  const googleData = shotEmpty ? undefined : googleQuery.data
  const m365Data = shotEmpty ? undefined : m365Query.data
  const meetings = useMemo<CalendarItem[]>(
    () => [...googleToEvents(googleData), ...m365ToEvents(m365Data)],
    [googleData, m365Data],
  )
  // The Week and Month grids draw the meetings that still happen; the agenda lists cancelled ones.
  const liveMeetings = useMemo(() => meetings.filter((m) => !isCancelled(m)), [meetings])
  const taskData = projectQueries.map((query) => (shotEmpty ? undefined : query.data))
  const events = useMemo<CalendarItem[]>(() => {
    if (view !== 'agenda') return meetings
    const tasks = taskData.flatMap((data, index) => {
      const list = (data as { data?: { tasks?: unknown } } | undefined)?.data?.tasks
      const project = projects[index]
      return list && project ? tickTickToEvents(list, project) : []
    })
    return [...meetings, ...tasks]
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `taskData` is rebuilt every render; its entries are the dependency
  }, [view, meetings, projects, ...taskData])

  const errors: SourceError[] = []
  if (googleQuery.error && !shotEmpty) {
    errors.push({
      label: 'Google',
      reason: failureReason(googleQuery.error, 'Google'),
      step: signInStep('personal', googleQuery.error),
    })
  }
  if (m365Query.error && !shotEmpty) {
    errors.push({
      label: 'Microsoft 365',
      reason: failureReason(m365Query.error, 'Microsoft 365'),
      step: signInStep('work', m365Query.error),
    })
  }

  // A source that has not answered (still loading, or failed with nothing of this window cached)
  // makes every figure that depends on it unknown — a dash, never a zero or "free".
  const personalUnknown = !shotEmpty && unanswered(googleQuery)
  const workUnknown = !shotEmpty && unanswered(m365Query)
  const unknown = useMemo(() => {
    const set = new Set<SourceClass>()
    if (personalUnknown) set.add('personal')
    if (workUnknown) set.add('work')
    return set
  }, [personalUnknown, workUnknown])
  const personalFailed = failed(googleQuery)
  const workFailed = failed(m365Query)
  const gap = useMemo(() => {
    const failedSources = new Set<SourceClass>()
    if (personalFailed) failedSources.add('personal')
    if (workFailed) failedSources.add('work')
    return { gap: feedGap(unknown, failedSources), failedSources }
  }, [unknown, personalFailed, workFailed])
  // Tasks are their own read: a pending or failed one is not an empty list.
  const taskQueries = [projectsQuery, ...projectQueries]
  const tasksState = taskFeedState(taskQueries)

  // Retry refetches what a failure surface shows, minus a sign-in failure: that one's step is
  // Re-authorize, and a refetch cannot fix it. Tasks: exactly the reads `taskFeedState` counts as failed.
  const failedCalendar = shotEmpty
    ? []
    : [googleQuery, m365Query].filter((query) => query.isError && !isAuthError(query.error))
  const failedTasks = taskQueries.filter(taskReadFailed)
  function retryFailedCalendar() {
    for (const query of failedCalendar) void query.refetch()
  }
  function retryFailedTasks() {
    for (const query of failedTasks) void query.refetch()
  }

  function setSearch(patch: Partial<SearchState>) {
    void navigate({
      search: (prev) => ({ ...(prev as SearchState), ...patch }),
    })
  }

  /*
   * `‹ Today ›` as typed action DATA, not a hand-rolled row: `group: true` on the three joins them
   * into one `ControlGroup` (shared hairlines, radius on the outer ends), the two that ship an icon
   * render icon-only with the label demoted to the accessible name, and basalt folds whatever does
   * not fit into the single kebab. They ride `filtersEnd`: 2.0's `actions` tuple demands a primary first,
   * and the date nav has none. The Agenda tab is always "now", so it has no date navigation.
   */
  const unit = view === 'month' ? 'month' : compact ? '3 days' : 'week'
  const dateActions: BarAction[] =
    view === 'agenda'
      ? []
      : [
          {
            key: 'prev',
            label: `Previous ${unit}`,
            icon: <IconChevronLeft size={16} />,
            group: true,
            onClick: () => setSearch({ date: shiftDate(date, view, -1, compact) }),
          },
          {
            key: 'today',
            label: 'Today',
            group: true,
            onClick: () => setSearch({ date: todayISO() }),
          },
          {
            key: 'next',
            label: `Next ${unit}`,
            icon: <IconChevronRight size={16} />,
            group: true,
            onClick: () => setSearch({ date: shiftDate(date, view, 1, compact) }),
          },
          {
            key: 'label',
            kind: 'custom',
            // The 44px header has no room for a date range beside the breadcrumb on a phone; the view
            // itself already names the week.
            mobile: 'hidden',
            node: (
              <Text fw={600} size="sm" style={{ whiteSpace: 'nowrap' }}>
                {headerLabel(date, view)}
              </Text>
            ),
          },
        ]

  const hours = weekWindow(liveMeetings, weekKeys(date))
  const compactKeys: DayKey[] = [-1, 0, 1].map((n) => addDays(date, n))

  return (
    <Stack
      gap="xs"
      {...(view === 'agenda'
        ? {}
        : {
            style: {
              // Both sticky bars, measured rather than guessed: the shell header is a token and
              // `--basalt-page-bar-h` is published by `PageBar`'s own row 2 in the layout phase.
              height:
                'calc(100dvh - var(--app-shell-header-height) - var(--basalt-page-bar-h, 0px) - var(--vx-space-stack-md, 16px))',
              minHeight: 0,
            },
          })}
    >
      <PageBar
        filtersEnd={dateActions}
        tabs={<ViewTabs field={calendarStore.field.view} label="Calendar view" />}
      />

      {view === 'agenda' && (
        <AgendaView
          events={events}
          errors={errors}
          loading={personalUnknown && workUnknown && googleQuery.isPending && m365Query.isPending}
          unknown={unknown}
          failed={gap.failedSources}
          tasksState={tasksState}
          canRetryCalendar={failedCalendar.length > 0}
          onRetryCalendar={retryFailedCalendar}
          retryingCalendar={failedCalendar.some((query) => query.isFetching)}
          onRetryTasks={retryFailedTasks}
          retryingTasks={failedTasks.some((query) => query.isFetching)}
        />
      )}

      {view !== 'agenda' && errors.length > 0 && (
        <Stack gap={2}>
          {errors.map((error) => (
            <SourceErrorLine key={error.label} error={error} />
          ))}
        </Stack>
      )}

      {view === 'week' && compact && (
        <DayGroups
          days={agendaDays(meetings, compactKeys)}
          now={new Date(nowMs)}
          next={null}
          gap={gap.gap}
          skeletonRows={COMPACT_SKELETON_ROWS}
        />
      )}

      {((view === 'week' && !compact) || view === 'month') && (
        <Box
          key={`${view}-${colorScheme}`}
          display="flex"
          style={{ flex: 1, minHeight: 0, flexDirection: 'column' }}
        >
          {view === 'week' ? (
            <WeekView
              date={date}
              onDateChange={(next) => setSearch({ date: next })}
              events={liveMeetings}
              withHeader={false}
              highlightToday
              withCurrentTimeIndicator
              withCurrentTimeBubble
              withWeekNumber
              firstDayOfWeek={1}
              startTime={hourToTime(hours.startH)}
              endTime={hourToTime(hours.endH)}
              startScrollTime={hourToTime(hours.startH)}
              slotHeight={64}
              allDaySlotHeight={72}
              radius="sm"
              style={{ flex: 1, minHeight: 0 }}
            />
          ) : (
            <MonthView
              date={date}
              onDateChange={(next) => setSearch({ date: next })}
              events={liveMeetings}
              withHeader={false}
              highlightToday
              consistentWeeks
              firstDayOfWeek={1}
              maxEventsPerDay={4}
              radius="sm"
              onDayClick={(next) => setSearch({ date: next, view: 'week' })}
              style={{ flex: 1, minHeight: 0 }}
            />
          )}
        </Box>
      )}
    </Stack>
  )
}
