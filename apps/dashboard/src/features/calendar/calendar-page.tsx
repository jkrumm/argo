import { useNavigate } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
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

const DAYS_RANGE = 60

export type CalendarView = 'week' | 'month'

type SearchState = { view: CalendarView; date: string }

export type CalendarPageProps = {
  view: CalendarView
  date: string
}

const VIEW_OPTIONS = [
  { label: 'Week', value: 'week' as const },
  { label: 'Month', value: 'month' as const },
]

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
          <Box w={10} h={10} style={{ borderRadius: '50%', background: entry.color }} />
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
  if (priority >= 5) return '#FF3B30'
  if (priority >= 3) return '#FF9500'
  return '#64748b'
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
    ...(view === 'week' ? [{ label: SOURCE_LABEL.ticktick, color: '#34C759' }] : []),
  ]

  const errors: Array<{
    source: CalendarSource
    message: string
    reauthUrl?: string
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
          <IconFlag3Filled
            size={10}
            style={{
              color: flagColor,
              marginInlineStart: 4,
              verticalAlign: 'middle',
            }}
          />
        )}
      </>
    )
  }

  return (
    <Stack
      gap="xs"
      style={{
        height: 'calc(100dvh - 100px)',
        minHeight: 0,
      }}
    >
      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Stack gap={4}>
          <Group gap="xs" align="baseline">
            <Title order={2}>{headerLabel(date, view)}</Title>
            {date !== todayISO() && (
              <Badge
                color="gray"
                variant="light"
                size="sm"
                style={{ cursor: 'pointer' }}
                onClick={() => setSearch({ date: todayISO() })}
              >
                Jump to today
              </Badge>
            )}
          </Group>
          <Legend entries={legendEntries} />
        </Stack>
        <Group gap="sm" wrap="nowrap">
          <Group gap={4} wrap="nowrap">
            <Tooltip label={view === 'week' ? 'Previous week' : 'Previous month'}>
              <ActionIcon
                variant="default"
                aria-label="Previous"
                onClick={() => setSearch({ date: shiftDate(date, view, -1) })}
              >
                <IconChevronLeft size={16} />
              </ActionIcon>
            </Tooltip>
            <Button variant="default" size="xs" onClick={() => setSearch({ date: todayISO() })}>
              Today
            </Button>
            <Tooltip label={view === 'week' ? 'Next week' : 'Next month'}>
              <ActionIcon
                variant="default"
                aria-label="Next"
                onClick={() => setSearch({ date: shiftDate(date, view, 1) })}
              >
                <IconChevronRight size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <SegmentedControl
            size="xs"
            value={view}
            data={VIEW_OPTIONS}
            onChange={(value) => setSearch({ view: value as CalendarView })}
          />
        </Group>
      </Group>

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
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
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
