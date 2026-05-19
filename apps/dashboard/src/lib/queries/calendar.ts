import { queryOptions } from '@tanstack/react-query'
import dayjs from 'dayjs'
import type { ScheduleEventData } from '@mantine/schedule'
import type { MantineColor } from '@mantine/core'
import { api, unwrap } from '../eden'

export type CalendarSource = 'google' | 'm365' | 'ticktick'

export type CalendarEventPayload = {
  source: CalendarSource
  isAllDay?: boolean
  location?: string | null
  organizer?: string | null
  videoLink?: string | null
  webLink?: string | null
  bodyPreview?: string | null
  calendarName?: string | null
  projectName?: string | null
  priority?: number
}

export const SOURCE_COLOR: Record<CalendarSource, MantineColor> = {
  google: 'red',
  m365: 'indigo',
  ticktick: 'green',
}

export const SOURCE_LABEL: Record<CalendarSource, string> = {
  google: 'Personal (Google)',
  m365: 'Work (M365)',
  ticktick: 'Tasks (TickTick)',
}

export const calendarQueries = {
  all: () => ['calendar'] as const,

  google: (days: number) =>
    queryOptions({
      queryKey: [...calendarQueries.all(), 'google', days] as const,
      queryFn: async () => unwrap(await api.calendar.get({ query: { days: String(days) } })),
      staleTime: 60_000,
      retry: false,
    }),

  m365: (days: number) =>
    queryOptions({
      queryKey: [...calendarQueries.all(), 'm365', days] as const,
      queryFn: async () => unwrap(await api.m365.calendar.upcoming.get({ query: { days } })),
      staleTime: 60_000,
      retry: false,
    }),

  ticktickProjects: () =>
    queryOptions({
      queryKey: [...calendarQueries.all(), 'ticktick', 'projects'] as const,
      queryFn: async () => unwrap(await api.ticktick.projects.get()),
      staleTime: 5 * 60_000,
    }),

  ticktickProjectTasks: (projectId: string) =>
    queryOptions({
      queryKey: [...calendarQueries.all(), 'ticktick', 'projects', projectId, 'tasks'] as const,
      queryFn: async () => unwrap(await api.ticktick.projects({ projectId }).data.get()),
      staleTime: 60_000,
      enabled: projectId.length > 0,
    }),
}

type RawCalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  isAllDay?: boolean
  location?: string | null
  organizer?: { name?: string | null; email?: string | null } | string | null
  attendees?: unknown
  calendarName?: string | null
  videoLink?: string | null
  webLink?: string | null
  bodyPreview?: string | null
}

type RawTickTickTask = {
  id: string
  projectId: string
  title: string
  dueDate?: string | null
  startDate?: string | null
  priority?: number
  status?: number
  isAllDay?: boolean
}

type RawTickTickProject = { id: string; name: string }

type CalendarScheduleEvent = ScheduleEventData<CalendarEventPayload>

function isDateOnly(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input)
}

function toScheduleDateTime(input: string): string {
  if (isDateOnly(input)) return `${input} 00:00:00`
  return dayjs(input).format('YYYY-MM-DD HH:mm:ss')
}

function nextDayMidnight(dateOrDateTime: string): string {
  const day = dateOrDateTime.slice(0, 10)
  return `${dayjs(day).add(1, 'day').format('YYYY-MM-DD')} 00:00:00`
}

function organizerName(organizer: RawCalendarEvent['organizer']): string | null {
  if (!organizer) return null
  if (typeof organizer === 'string') return organizer
  return organizer.name ?? organizer.email ?? null
}

function mapCalendarEvent(
  source: 'google' | 'm365',
  event: RawCalendarEvent,
): CalendarScheduleEvent {
  const start = toScheduleDateTime(event.start)
  let end = toScheduleDateTime(event.end)
  if (event.isAllDay && end <= start) end = nextDayMidnight(start)

  return {
    id: `${source}-${event.id}`,
    title: event.title,
    start,
    end,
    color: SOURCE_COLOR[source],
    payload: {
      source,
      isAllDay: event.isAllDay,
      location: event.location ?? null,
      organizer: organizerName(event.organizer),
      videoLink: event.videoLink ?? null,
      webLink: event.webLink ?? null,
      bodyPreview: event.bodyPreview ?? null,
      calendarName: event.calendarName ?? null,
    },
  }
}

export function googleToEvents(events: unknown): CalendarScheduleEvent[] {
  if (!Array.isArray(events)) return []
  return events.map((event) => mapCalendarEvent('google', event as RawCalendarEvent))
}

export function m365ToEvents(events: unknown): CalendarScheduleEvent[] {
  if (!Array.isArray(events)) return []
  return events.map((event) => mapCalendarEvent('m365', event as RawCalendarEvent))
}

export function tickTickToEvents(
  tasks: unknown,
  project: RawTickTickProject,
): CalendarScheduleEvent[] {
  if (!Array.isArray(tasks)) return []
  return (tasks as RawTickTickTask[])
    .filter((task) => task.status === 0 && Boolean(task.dueDate))
    .map((task) => {
      const start = toScheduleDateTime(task.dueDate as string)
      return {
        id: `ticktick-${task.id}`,
        title: task.title,
        start,
        end: nextDayMidnight(start),
        color: SOURCE_COLOR.ticktick,
        payload: {
          source: 'ticktick',
          isAllDay: true,
          projectName: project.name,
          priority: task.priority,
        },
      }
    })
}
