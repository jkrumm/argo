import { useNavigate } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Alert, Anchor, Box, Group, Stack, Text, useMantineColorScheme } from '@mantine/core'
import { MonthView, WeekView } from '@mantine/schedule'
import type { ScheduleEventData } from '@mantine/schedule'
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconFlag3Filled,
} from '@tabler/icons-react'
import { addMonths, addWeeks, endOfWeek, format, startOfWeek } from 'date-fns'
import {
  calendarQueries,
  googleToEvents,
  GOOGLE_CALENDAR_COLORS,
  m365ToEvents,
  M365_COLOR,
  SOURCE_LABEL,
  tickTickToEvents,
  type CalendarEventPayload,
  type CalendarSource,
} from '../../lib/queries/calendar'
import { VX } from 'basalt-ui/tokens'
import { SERIES } from '../../lib/series'
import { PageBar } from 'basalt-ui'
import type { BarAction } from 'basalt-ui'
import { ViewTabs } from 'basalt-ui/controls'
import { calendarStore } from '../../lib/window-stores'

const DAYS_RANGE = 60

export type CalendarView = 'week' | 'month'

type SearchState = { view: CalendarView; date: string }

export type CalendarPageProps = {
  view: CalendarView
  date: string
}

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

function shiftDate(date: string, view: CalendarView, delta: number): string {
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

type LegendEntry = { label: string; color: string }

function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <Group gap="sm" wrap="wrap">
      {entries.map((entry) => (
        <Group key={`${entry.label}-${entry.color}`} gap={6} wrap="nowrap">
          <Box w={10} h={10} bdrs="50%" style={{ background: entry.color }} />
          <Text size="xs" c="dimmed">
            {entry.label}
          </Text>
        </Group>
      ))}
    </Group>
  )
}

function priorityColor(priority: number | undefined): string | null {
  if (!priority || priority < 1) return null
  if (priority >= 5) return VX.status.bad
  if (priority >= 3) return VX.status.warn
  return VX.neutral
}

export function CalendarPage({ view, date }: CalendarPageProps) {
  const navigate = useNavigate({ from: '/calendar' })
  const { colorScheme } = useMantineColorScheme()

  const googleQuery = useQuery(calendarQueries.google(DAYS_RANGE))
  const m365Query = useQuery(calendarQueries.m365(DAYS_RANGE))
  const projectsQuery = useQuery(calendarQueries.ticktickProjects())

  const projects = ((projectsQuery.data as { data?: unknown } | undefined)?.data ?? []) as Array<{
    id: string
    name: string
  }>
  const projectQueriesEnabled = view === 'week'
  const projectQueries = useQueries({
    queries: projects.map((project) => ({
      ...calendarQueries.ticktickProjectTasks(project.id),
      enabled: projectQueriesEnabled,
    })),
  })

  const events: ScheduleEventData<CalendarEventPayload>[] = []
  events.push(...googleToEvents(googleQuery.data))
  events.push(...m365ToEvents(m365Query.data))
  if (view === 'week') {
    projectQueries.forEach((query, index) => {
      const tasks = (query.data as { data?: { tasks?: unknown } } | undefined)?.data?.tasks
      const project = projects[index]
      if (project && tasks) {
        events.push(...tickTickToEvents(tasks, project))
      }
    })
  }

  function setSearch(patch: Partial<SearchState>) {
    void navigate({
      search: (prev) => ({ ...(prev as SearchState), ...patch }),
    })
  }

  const legendEntries: LegendEntry[] = [
    ...Object.entries(GOOGLE_CALENDAR_COLORS).map(([label, color]) => ({ label, color })),
    { label: SOURCE_LABEL.m365, color: M365_COLOR },
    ...(view === 'week' ? [{ label: SOURCE_LABEL.ticktick, color: SERIES.steps }] : []),
  ]

  const errors: Array<{
    source: CalendarSource
    message: string
    reauthUrl?: string | undefined
  }> = []
  if (googleQuery.error) {
    errors.push({
      source: 'google',
      message: extractErrorMessage(googleQuery.error, 'Google'),
      reauthUrl: isAuthError(googleQuery.error) ? '/api/oauth/google/init' : undefined,
    })
  }
  if (m365Query.error) {
    errors.push({
      source: 'm365',
      message: extractErrorMessage(m365Query.error, 'Microsoft 365'),
    })
  }

  const renderEventBody: NonNullable<React.ComponentProps<typeof WeekView>['renderEventBody']> = (
    event,
  ) => {
    const payload = event.payload as CalendarEventPayload | undefined
    if (payload?.source !== 'ticktick') return event.title
    const flagColor = priorityColor(payload.priority)
    const projectName = payload.projectName?.trim()
    return (
      <>
        {projectName && (
          <>
            <span style={{ opacity: 0.7, fontWeight: 400 }}>{projectName}</span>
            {' — '}
          </>
        )}
        {event.title}
        {flagColor && (
          <Box component="span" ml={4}>
            <IconFlag3Filled
              size={10}
              style={{
                color: flagColor,
                verticalAlign: 'middle',
              }}
            />
          </Box>
        )}
      </>
    )
  }

  /*
   * `‹ Today ›` as typed action DATA, not a hand-rolled row: `group: true` on the three joins them
   * into one `ControlGroup` (shared hairlines, radius on the outer ends), the two that ship an icon
   * render icon-only with the label demoted to the accessible name, and basalt folds whatever does
   * not fit into the header's single kebab. Four secondaries is exactly the `page-bar-budget` limit.
   */
  const dateActions: BarAction[] = [
    {
      key: 'prev',
      label: view === 'week' ? 'Previous week' : 'Previous month',
      icon: <IconChevronLeft size={16} />,
      group: true,
      onClick: () => setSearch({ date: shiftDate(date, view, -1) }),
    },
    {
      key: 'today',
      label: 'Today',
      group: true,
      onClick: () => setSearch({ date: todayISO() }),
    },
    {
      key: 'next',
      label: view === 'week' ? 'Next week' : 'Next month',
      icon: <IconChevronRight size={16} />,
      group: true,
      onClick: () => setSearch({ date: shiftDate(date, view, 1) }),
    },
    {
      key: 'label',
      kind: 'custom',
      // The 48px header has no room for a date range beside the breadcrumb on a phone; the view
      // itself already names the week.
      mobile: 'hidden',
      node: (
        <Text fw={600} size="sm" style={{ whiteSpace: 'nowrap' }}>
          {headerLabel(date, view)}
        </Text>
      ),
    },
  ]

  return (
    <Stack
      gap="xs"
      style={{
        // Both sticky bars, measured rather than guessed: the shell header is a token and
        // `--basalt-page-bar-h` is published by `PageBar`'s own row 2 in the layout phase, so the
        // hardcoded 100px (and the 49px it was wrong by on a phone) is gone.
        height:
          'calc(100dvh - var(--app-shell-header-height) - var(--basalt-page-bar-h, 0px) - var(--vx-space-stack-md, 16px))',
        minHeight: 0,
      }}
    >
      <PageBar
        actions={{ secondary: dateActions }}
        tabs={<ViewTabs field={calendarStore.field.view} label="Calendar view" />}
      />

      <Legend entries={legendEntries} />

      {errors.length > 0 && (
        <Stack gap="xs">
          {errors.map((error) => (
            <Alert
              key={error.source}
              color="yellow"
              icon={<IconAlertTriangle size={16} />}
              variant="light"
              title={`${SOURCE_LABEL[error.source]} unavailable`}
            >
              <Stack gap={6}>
                <Text size="sm">{error.message}</Text>
                {error.reauthUrl && (
                  <Anchor href={error.reauthUrl} target="_blank" rel="noreferrer" size="sm">
                    Re-authorize Google →
                  </Anchor>
                )}
              </Stack>
            </Alert>
          ))}
        </Stack>
      )}

      <Box
        key={`${view}-${colorScheme}`}
        display="flex"
        style={{ flex: 1, minHeight: 0, flexDirection: 'column' }}
      >
        {view === 'week' ? (
          <WeekView
            date={date}
            onDateChange={(next) => setSearch({ date: next })}
            events={events}
            withHeader={false}
            highlightToday
            withCurrentTimeIndicator
            withCurrentTimeBubble
            withWeekNumber
            firstDayOfWeek={1}
            startTime="07:00:00"
            endTime="22:00:00"
            startScrollTime="08:00:00"
            slotHeight={64}
            allDaySlotHeight={72}
            radius="sm"
            renderEventBody={renderEventBody}
            style={{ flex: 1, minHeight: 0 }}
          />
        ) : (
          <MonthView
            date={date}
            onDateChange={(next) => setSearch({ date: next })}
            events={events}
            withHeader={false}
            highlightToday
            consistentWeeks
            firstDayOfWeek={1}
            maxEventsPerDay={4}
            radius="sm"
            renderEventBody={renderEventBody}
            onDayClick={(next) => setSearch({ date: next, view: 'week' })}
            style={{ flex: 1, minHeight: 0 }}
          />
        )}
      </Box>
    </Stack>
  )
}

function isAuthError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status?: number }).status === 503
  )
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (isAuthError(error)) {
    return `${fallback} re-authentication required (OAuth token expired or revoked).`
  }
  if (error instanceof Error) return error.message
  return `Failed to load ${fallback} events.`
}
