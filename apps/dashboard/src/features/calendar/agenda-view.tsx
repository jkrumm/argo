import { useMemo } from 'react'
import { Anchor, Box, Card, Stack, Text } from '@mantine/core'
import { Section, StatGroup } from 'basalt-ui'
import { format } from 'date-fns'
import { formatDurationMin } from '../../components/upstream/schedule-row-model'
import type { SourceClass } from '../../lib/queries/calendar'
import { countdown, summarySentence } from './summary'
import { useNow } from '../../lib/use-now'
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
  keyToDate,
  longestFreeBlock,
  tasksDue,
  type CalendarItem,
  type DayKey,
} from './derive'

const NEXT_DAYS = 7

export type SourceError = { label: string; reason: string; reauthUrl?: string | undefined }

const hhmm = (d: Date) => format(d, 'HH:mm')

export function AgendaView({
  events,
  errors,
  loading,
  unknown,
}: {
  events: readonly CalendarItem[]
  errors: readonly SourceError[]
  loading: boolean
  unknown: ReadonlySet<SourceClass>
}) {
  const nowMs = useNow()
  const now = useMemo(() => new Date(nowMs), [nowMs])
  const model = useMemo(() => {
    const summary = agendaSummary(events, now, unknown)
    const { todayKey } = summary
    const nextKeys = Array.from({ length: NEXT_DAYS }, (_, i) => addDays(todayKey, i + 1))
    const days = agendaDays(events, nextKeys)
    const allDay: Record<DayKey, CalendarItem[]> = {}
    for (const key of nextKeys) allDay[key] = allDayEvents(events, key)
    return {
      summary,
      free: summary.incomplete ? null : longestFreeBlock(events, todayKey, now),
      today: eventsOnDay(events, todayKey),
      todayAllDay: allDayEvents(events, todayKey),
      days,
      nextCount: days.reduce((sum, d) => sum + d.events.length, 0),
      allDay,
      load: dayLoad(events, summary.weekKeys, summary.incomplete),
      split: bookedBySourceClass(events, summary.weekKeys),
      tasks: tasksDue(events, todayKey),
    }
  }, [events, now, unknown])

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
              <Card>
                <Section
                  title="Today"
                  {...(summary.incomplete ? {} : { count: model.today.length })}
                >
                  {model.today.length === 0 ? (
                    <Text className={classes.muted}>
                      {summary.incomplete
                        ? '—'
                        : `No events today${countdown(summary) ? ` · ${countdown(summary)}` : ''}`}
                    </Text>
                  ) : (
                    <EventRows events={model.today} now={now} next={summary.next} />
                  )}
                </Section>
              </Card>
            </Box>
            <Box className={classes.oNext} data-shot="next-days">
              <Card>
                <Section
                  title="Next 7 days"
                  {...(summary.incomplete ? {} : { count: model.nextCount })}
                >
                  <DayGroups
                    days={model.days}
                    allDay={model.allDay}
                    now={now}
                    next={summary.next}
                    incomplete={summary.incomplete}
                  />
                </Section>
              </Card>
            </Box>
          </Box>
          <Box className={classes.col}>
            <Box className={classes.oStrip}>
              <WeekStrip
                title={`Booked hours, week ${format(keyToDate(summary.todayKey), 'I')}`}
                load={model.load}
                split={model.split}
                todayKey={summary.todayKey}
                unknown={unknown}
              />
            </Box>
            <Box className={classes.oFree} data-shot="free-block">
              <StatGroup
                variant="strip"
                label="Longest free block"
                cells={[
                  {
                    key: 'free-block',
                    caption: 'Longest free block',
                    qualifier: 'today',
                    value: free ? formatDurationMin(free.minutes) : null,
                    footer: summary.incomplete
                      ? 'a calendar has not answered'
                      : free
                        ? `${hhmm(free.start)}–${hhmm(free.end)}`
                        : 'none left in 08:00–18:00',
                  },
                ]}
              />
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
