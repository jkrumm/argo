import { formatMinutes } from '../../lib/format'
import { useMemo } from 'react'
import { Box, Card, Stack, Text } from '@mantine/core'
import { Section, StatGroup, PageSummary } from 'basalt-ui'
import { format } from 'date-fns'
import type { SourceClass } from '../../lib/queries/calendar'
import { EMPTY_WINDOW, summaryParts, todayCardState } from './summary'
import { feedGap, type SignInStep } from './query-state'
import { SignInStepView } from './sign-in-step'
import { RetryButton } from './retry-button'
import { useNow } from '../../lib/use-now'
import classes from './agenda.module.css'
import {
  AllDayChips,
  DayGroups,
  EventRows,
  GapLine,
  SkeletonRows,
  TaskList,
  WeekStrip,
} from './agenda-parts'
import {
  addDays,
  agendaDays,
  agendaSummary,
  bookedBySourceClass,
  dayLoad,
  agendaDay,
  keyToDate,
  isEmptyWindow,
  longestFreeBlock,
  tasksDue,
  type CalendarItem,
} from './derive'

const NEXT_DAYS = 7

export type SourceError = { label: string; reason: string; step?: SignInStep | undefined }

const hhmm = (d: Date) => format(d, 'HH:mm')

/** Rows the pending Today card stands for: the loaded card typically shows this many. */
const TODAY_SKELETON_ROWS = 5

/** Rows the pending Next 7 days card stands for. */
const NEXT_DAYS_SKELETON_ROWS = 6

export function AgendaView({
  events,
  errors,
  loading,
  unknown,
  failed,
  tasksState,
  canRetryCalendar,
  onRetryCalendar,
  retryingCalendar,
  onRetryTasks,
  retryingTasks,
}: {
  events: readonly CalendarItem[]
  errors: readonly SourceError[]
  loading: boolean
  unknown: ReadonlySet<SourceClass>
  /** Unknown sources that stopped trying (failed), as against still loading. */
  failed: ReadonlySet<SourceClass>
  tasksState: 'loading' | 'error' | 'ready'
  /** A failed source a refetch can fix exists (a sign-in failure is Re-authorize's, not Retry's). */
  canRetryCalendar: boolean
  /** Refetches every such source: the one step for the headline and the error lines. */
  onRetryCalendar: () => void
  retryingCalendar: boolean
  /** Refetches the failed task reads. */
  onRetryTasks: () => void
  retryingTasks: boolean
}) {
  const nowMs = useNow()
  const now = useMemo(() => new Date(nowMs), [nowMs])
  const model = useMemo(() => {
    const summary = agendaSummary(events, now, unknown)
    const { todayKey } = summary
    const nextKeys = Array.from({ length: NEXT_DAYS }, (_, i) => addDays(todayKey, i + 1))
    const days = agendaDays(events, nextKeys)
    return {
      summary,
      nextKeys,
      emptyWindow: isEmptyWindow(events, summary, nextKeys) ? EMPTY_WINDOW : null,
      free: summary.incomplete ? null : longestFreeBlock(events, todayKey, now),
      today: agendaDay(events, todayKey),
      days,
      nextCount: days.reduce((sum, d) => sum + d.count, 0),
      load: dayLoad(events, summary.weekKeys, summary.incomplete),
      split: bookedBySourceClass(events, summary.weekKeys),
      tasks: tasksDue(events, todayKey),
    }
  }, [events, now, unknown])

  // One gap across the strip, the next days and the headline: the whole window holds nothing.
  const { summary, free, emptyWindow } = model
  const gap = feedGap(unknown, failed)
  const parts = summaryParts(summary, gap, emptyWindow)
  const todayState = todayCardState(model.today.count, summary.incomplete)
  return (
    <Stack gap="md">
      <Box data-shot="calendar-headline" data-shot-states="loading error empty">
        <PageSummary {...parts} loading={loading} />
        {errors.map((error) => (
          <Text key={error.label} className={classes.muted}>
            {error.label} unavailable — {error.reason}
            {error.step && <SignInStepView step={error.step} />}
          </Text>
        ))}
        {canRetryCalendar && (
          <RetryButton
            onClick={onRetryCalendar}
            loading={retryingCalendar}
            label="Retry calendar sources"
          />
        )}
      </Box>
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
                      gap ? (
                        <GapLine gap={gap} skeleton={{ kind: 'rows', rows: TODAY_SKELETON_ROWS }} />
                      ) : (
                        <SkeletonRows rows={TODAY_SKELETON_ROWS} />
                      )
                    ) : (
                      <>
                        <AllDayChips items={model.today.allDay} />
                        <EventRows rows={model.today.rows} now={now} next={summary.next} />
                      </>
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
                    now={now}
                    next={summary.next}
                    gap={gap}
                    skeletonRows={NEXT_DAYS_SKELETON_ROWS}
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
                gap={gap}
                emptyWindow={emptyWindow}
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
                    // A measured zero (the day is over) is `0 min`; a dash only where the feed is unknown.
                    value: summary.incomplete ? null : formatMinutes(free?.minutes ?? 0),
                    ...(gap?.state === 'loading'
                      ? { loading: true }
                      : {
                          footer: gap
                            ? gap.card
                            : free
                              ? `${hhmm(free.start)}–${hhmm(free.end)}`
                              : 'none left in 08:00–18:00',
                        }),
                  },
                ]}
              />
            </Box>
            <Box className={classes.oTasks}>
              <TaskList
                tasks={model.tasks}
                todayKey={summary.todayKey}
                state={tasksState}
                onRetryTasks={onRetryTasks}
                retryingTasks={retryingTasks}
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Stack>
  )
}
