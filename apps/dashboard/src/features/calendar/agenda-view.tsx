import { formatMinutes } from '../../lib/format'
import { useMemo } from 'react'
import { Anchor, Box, Card, Stack, Text } from '@mantine/core'
import { Section, StatGroup, PageSummary } from 'basalt-ui'
import { format } from 'date-fns'
import type { SourceClass } from '../../lib/queries/calendar'
import { summaryParts, todayCardState } from './summary'
import { feedGap } from './query-state'
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
  agendaDay,
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
  failed,
  tasksState,
}: {
  events: readonly CalendarItem[]
  errors: readonly SourceError[]
  loading: boolean
  unknown: ReadonlySet<SourceClass>
  /** Unknown sources that stopped trying (failed), as against still loading. */
  failed: ReadonlySet<SourceClass>
  tasksState: 'loading' | 'error' | 'ready'
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
      today: agendaDay(events, todayKey),
      todayAllDay: allDayEvents(events, todayKey),
      days,
      nextCount: days.reduce((sum, d) => sum + d.count, 0),
      allDay,
      load: dayLoad(events, summary.weekKeys, summary.incomplete),
      split: bookedBySourceClass(events, summary.weekKeys),
      tasks: tasksDue(events, todayKey),
    }
  }, [events, now, unknown])

  const { summary, free } = model
  const gap = feedGap(unknown, failed)
  const parts = summaryParts(summary, gap)
  const todayState = todayCardState(model.today.rows.length, summary.incomplete)
  return (
    <Stack gap="md">
      <Box>
        <PageSummary {...parts} loading={loading} />
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
            {/* Confirmed-empty hides the card (the headline says so and names the next event); an
                unanswered calendar keeps it, as unknown. */}
            {todayState !== 'hidden' && (
              <Box
                className={classes.oToday}
                data-shot="today"
                data-shot-states="loading error"
                data-shot-absent="empty"
              >
                <Card>
                  <Section
                    title="Today"
                    {...(summary.incomplete ? {} : { count: model.today.count })}
                  >
                    {todayState === 'unknown' ? (
                      <Text className={classes.muted}>{gap?.text}</Text>
                    ) : (
                      <EventRows rows={model.today.rows} now={now} next={summary.next} />
                    )}
                  </Section>
                </Card>
              </Box>
            )}
            <Box
              className={classes.oNext}
              data-shot="next-days"
              data-shot-states="empty loading error"
            >
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
                    gap={gap}
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
                failed={failed}
              />
            </Box>
            <Box
              className={classes.oFree}
              data-shot="free-block"
              data-shot-states="empty loading error"
            >
              <StatGroup
                variant="strip"
                label="Longest free block"
                cells={[
                  {
                    key: 'free-block',
                    caption: 'Longest free block',
                    qualifier: 'today',
                    value: free ? formatMinutes(free.minutes) : null,
                    footer: gap
                      ? gap.text
                      : free
                        ? `${hhmm(free.start)}–${hhmm(free.end)}`
                        : 'none left in 08:00–18:00',
                  },
                ]}
              />
            </Box>
            <Box className={classes.oTasks}>
              <TaskList tasks={model.tasks} todayKey={summary.todayKey} state={tasksState} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Stack>
  )
}
