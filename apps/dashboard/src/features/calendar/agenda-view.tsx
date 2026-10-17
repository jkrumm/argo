import { useMemo } from 'react'
import { Anchor, Box, Card, Stack, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { format } from 'date-fns'
import { StatStrip, StripCell } from '../garmin-health/stat-strip'
import { formatDurationMin } from '../../components/upstream/schedule-row-model'
import { useNow } from './use-now'
import classes from './agenda.module.css'
import { AllDayChips, DayGroups, EventRows, TaskList, WeekStrip } from './agenda-parts'
import {
  addDays,
  agendaDays,
  agendaSummary,
  allDayEvents,
  bookedBySourceClass,
  dayLoad,
  eventsOnDay,
  dayLabel,
  keyToDate,
  longestFreeBlock,
  tasksDue,
  type AgendaSummary,
  type CalendarItem,
  type DayKey,
  type FreeBlock,
  type SourceSplit,
} from './derive'

const NEXT_DAYS = 7

export type SourceError = { label: string; reason: string; reauthUrl?: string | undefined }

const hhmm = (d: Date) => format(d, 'HH:mm')

function countdown(summary: AgendaSummary): string | null {
  const next = summary.next
  if (!next) return null
  if (next.inMin < 120) return `next in ${next.inMin} min`
  const start = String(next.event.start)
  const startKey = start.slice(0, 10)
  const time = start.slice(11, 16)
  return startKey === summary.todayKey
    ? `next at ${time}`
    : startKey === addDays(summary.todayKey, 1)
      ? `next tomorrow ${time}`
      : `next ${format(keyToDate(startKey), 'EEE')} ${time}`
}

/** One sentence, built from the same derivation as the lists and the strip beside it. */
function summarySentence(summary: AgendaSummary, free: FreeBlock | null): string {
  const today =
    summary.todayCount > 0
      ? `${summary.todayCount} ${summary.todayCount === 1 ? 'meeting' : 'meetings'} left today, ${formatDurationMin(summary.todayBookedMin)} booked`
      : `No more events today${free ? ` · ${formatDurationMin(free.minutes)} free` : ''}`
  const week =
    summary.rangeBookedMin === 0
      ? 'nothing booked in the next 7 days'
      : `${formatDurationMin(summary.rangeBookedMin)} booked in the next 7 days`
  return [today, countdown(summary), week].filter(Boolean).join(' · ')
}

export function AgendaView({
  events,
  errors,
  loading,
  unknown,
}: {
  events: readonly CalendarItem[]
  errors: readonly SourceError[]
  loading: boolean
  unknown: ReadonlySet<keyof SourceSplit>
}) {
  const now = useNow()
  const model = useMemo(() => {
    const summary = agendaSummary(events, now)
    const { todayKey } = summary
    const nextKeys = Array.from({ length: NEXT_DAYS }, (_, i) => addDays(todayKey, i + 1))
    const days = agendaDays(events, nextKeys, now)
    const allDay: Record<DayKey, CalendarItem[]> = {}
    for (const key of nextKeys) allDay[key] = allDayEvents(events, key)
    return {
      summary,
      free: longestFreeBlock(events, todayKey, now),
      today: eventsOnDay(events, todayKey, now),
      todayAllDay: allDayEvents(events, todayKey),
      days,
      nextCount: days.reduce((sum, d) => sum + d.events.length, 0),
      allDay,
      load: dayLoad(events, summary.rangeKeys, now),
      split: bookedBySourceClass(events, summary.rangeKeys, now),
      tasks: tasksDue(events, todayKey),
    }
  }, [events, now])

  const { summary, free } = model
  return (
    <Stack gap="md">
      <Box data-shot="summary">
        <Text className={classes.summary}>
          {loading ? 'Loading agenda…' : summarySentence(summary, free)}
        </Text>
        {errors.map((error) => (
          <Text key={error.label} className={classes.muted}>
            {error.label} unavailable — {error.reason}
            {error.reauthUrl && (
              <>
                {' '}
                <Anchor href={error.reauthUrl} target="_blank" rel="noreferrer" size="sm">
                  Re-authorize
                </Anchor>
              </>
            )}
          </Text>
        ))}
      </Box>
      <AllDayChips items={model.todayAllDay} />
      <Box className={classes.frame}>
        <Box className={classes.page}>
          <Box className={classes.col}>
            <Box className={classes.oToday} data-shot="today">
              <Card py="sm" px="md">
                <Section title="Today" count={model.today.length}>
                  {model.today.length === 0 ? (
                    <Text className={classes.muted}>Nothing left today.</Text>
                  ) : (
                    <EventRows events={model.today} now={now} next={summary.next} />
                  )}
                </Section>
              </Card>
            </Box>
            <Box className={classes.oNext} data-shot="next-days">
              <Card py="sm" px="md">
                <Section title="Next 7 days" count={model.nextCount}>
                  <DayGroups
                    days={model.days}
                    allDay={model.allDay}
                    now={now}
                    next={summary.next}
                  />
                </Section>
              </Card>
            </Box>
          </Box>
          <Box className={classes.col}>
            <Box className={classes.oStrip}>
              <WeekStrip
                title="Booked hours, next 7 days"
                range={`${dayLabel(summary.rangeKeys[0] ?? summary.todayKey)} – ${dayLabel(summary.rangeKeys[summary.rangeKeys.length - 1] ?? summary.todayKey)}`}
                load={model.load}
                split={model.split}
                todayKey={summary.todayKey}
                unknown={unknown}
              />
            </Box>
            <Box className={classes.oFree} data-shot="free-block">
              <StatStrip>
                <StripCell
                  caption="Longest free block"
                  qualifier="today"
                  value={free ? formatDurationMin(free.minutes) : '—'}
                  footer={
                    free ? `${hhmm(free.start)}–${hhmm(free.end)}` : 'none left in 08:00–18:00'
                  }
                />
              </StatStrip>
            </Box>
            <Box className={classes.oTasks}>
              <TaskList tasks={model.tasks} todayKey={summary.todayKey} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Stack>
  )
}
