import { formatMinutes } from '../../lib/format'
/**
 * The Agenda tab's presentational pieces. They render `derive.ts` output and compute nothing:
 * every figure, count and window arrives already derived.
 */
import { ActionIcon, Box, Card, Group, Skeleton, Text } from '@mantine/core'
import { Meter, Section } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { IconVideo } from '@tabler/icons-react'
import { ScheduleRow } from '../../components/upstream/schedule-row'
import { SERIES } from '../../lib/series'
import classes from './agenda.module.css'
import { untilLabel, type EmptyWindow } from './summary'
import { SOURCES_LABEL, type FeedGap } from './query-state'
import { RetryButton } from './retry-button'
import {
  DAY_TARGET_H,
  dayLabel,
  shortDate,
  toDate,
  dayHeadLabel,
  nothingBooked,
  NO_EVENTS,
  SPLIT_LABEL,
  type AgendaDay,
  type AgendaRow,
  type CalendarItem,
  type DayKey,
  type DayLoad,
  type NextEvent,
  type SourceSplit,
  type TaskDue,
} from './derive'

/** Work and Personal are the one categorical split on the page, so they alone earn hues. */
const SPLIT_COLOR = { work: SERIES.calendarWork, personal: SERIES.calendarPersonal } as const
/**
 * The next item carries its `in 1 h 30 min` pill only while it is under 12 h away; further out the
 * summary's `next Mon 10:45` already says when, and a pill of `in 44h` is noise.
 */
const PILL_WITHIN_MIN = 12 * 60
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/** Pending is a skeleton, never a sentence. The width is definite so the bars resolve in a flex row. */
function SkeletonLines({ rows = 1, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <Box role="status" aria-label={label} w="100%" py="xs">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={14} width={i === 0 ? '60%' : '40%'} mt={i === 0 ? 0 : 'xs'} />
      ))}
    </Box>
  )
}

/**
 * Pending rows of a list card: each stands for one loaded row (a time column, a title bar and a
 * meta bar, ScheduleRow's height), so the card keeps its height from loading to loaded.
 */
export function SkeletonRows({
  rows,
  label = 'Loading',
  time = true,
}: {
  rows: number
  label?: string
  /** A time column before the bars: the schedule rows, not the task rows. */
  time?: boolean
}) {
  return (
    <Box role="status" aria-label={label} w="100%">
      {Array.from({ length: rows }, (_, i) => (
        <Box key={i} className={time ? classes.skelRow : classes.skelRowPlain}>
          {time && (
            <Box>
              <Skeleton height={14} width="3rem" />
              <Skeleton height={10} width="2rem" mt={4} />
            </Box>
          )}
          <Box>
            <Skeleton height={14} width={i % 2 === 0 ? '70%' : '50%'} />
            <Skeleton height={10} width="35%" mt={4} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** A card's gap line: a pending read is a skeleton; a failure names the source. */
export function GapLine({
  gap,
  skeleton,
  inline = false,
}: {
  gap: FeedGap
  /** What a pending read stands in for: the caller's `rows` of a list, or a single line of text. */
  skeleton: { kind: 'rows'; rows: number } | { kind: 'lines' }
  /** A span in a flex row instead of a block `Text`. */
  inline?: boolean
}) {
  if (gap.state === 'loading')
    return skeleton.kind === 'rows' ? <SkeletonRows rows={skeleton.rows} /> : <SkeletonLines />
  return inline ? (
    <span className={classes.muted} role="status">
      {gap.card}
    </span>
  ) : (
    <Text className={classes.muted} role="status">
      {gap.card}
    </Text>
  )
}

export function AllDayChips({ items }: { items: readonly CalendarItem[] }) {
  if (items.length === 0) return null
  return (
    <Box className={classes.chips}>
      <span className={classes.caption}>All day</span>
      {items.map((item) => (
        <span key={String(item.id)} className={classes.chip}>
          {item.title}
        </span>
      ))}
    </Box>
  )
}

export function EventRows({
  rows,
  now,
  next,
}: {
  rows: readonly AgendaRow[]
  now: Date
  next: NextEvent | null
}) {
  return (
    <div role="list">
      {rows.map(({ event, cancelled, start, durationMin, title, meta }) => {
        const videoLink = event.payload?.videoLink
        return (
          <ScheduleRow
            key={String(event.id)}
            start={start}
            durationMin={durationMin}
            title={title}
            past={cancelled || toDate(String(event.end)).getTime() <= now.getTime()}
            {...(meta ? { meta } : {})}
            {...(!cancelled && next?.event.id === event.id && next.inMin < PILL_WITHIN_MIN
              ? { pill: untilLabel(next.inMin) }
              : {})}
            {...(!cancelled && videoLink && isHttpUrl(videoLink)
              ? {
                  action: (
                    <ActionIcon
                      component="a"
                      href={videoLink}
                      target="_blank"
                      rel="noreferrer"
                      variant="subtle"
                      color="gray"
                      size="sm"
                      aria-label="Join"
                      title="Join"
                    >
                      <IconVideo size={16} />
                    </ActionIcon>
                  ),
                }
              : {})}
          />
        )
      })}
    </div>
  )
}

export function DayGroups({
  days,
  now,
  next,
  gap = null,
  skeletonRows,
}: {
  days: readonly AgendaDay[]
  now: Date
  next: NextEvent | null
  /**
   * A calendar has not answered: the card says so once, and an empty day is unknown, so it is not
   * listed as `No events`. Days that do hold items still show them.
   */
  gap?: FeedGap | null
  /** Rows a pending read stands for: the caller owns the list's usual length (a 7-day card, a 3-day phone list). */
  skeletonRows: number
}) {
  // An unanswered calendar cannot say a day is empty, so those days are not listed.
  const visible = gap ? days.filter((day) => day.count > 0 || day.rows.length > 0) : days
  return (
    <div>
      {gap && <GapLine gap={gap} skeleton={{ kind: 'rows', rows: skeletonRows }} />}
      {visible.map((day) => {
        const headLabel = dayHeadLabel(day, formatMinutes)
        if (day.rows.length === 0 && day.allDay.length === 0) {
          return (
            <Box key={day.key} className={classes.freeDay}>
              <span className={classes.caption}>{dayLabel(day.key)}</span>
              <span className={classes.muted}>{NO_EVENTS}</span>
            </Box>
          )
        }
        return (
          <Box key={day.key} className={classes.group}>
            <Box className={classes.groupHead}>
              <span className={classes.caption}>{dayLabel(day.key)}</span>
              {!gap && headLabel && <span className={classes.muted}>{headLabel}</span>}
            </Box>
            {day.allDay.length > 0 && (
              <Box pt="xs">
                <AllDayChips items={day.allDay} />
              </Box>
            )}
            <EventRows rows={day.rows} now={now} next={next} />
          </Box>
        )
      })}
    </div>
  )
}

export function WeekStrip({
  title,
  load,
  split,
  todayKey,
  unknown,
  gap,
  emptyWindow = null,
}: {
  title: string
  load: readonly DayLoad[]
  split: SourceSplit
  todayKey: DayKey
  /** Source classes whose feed failed; their figures read `—`, not 0. */
  unknown: ReadonlySet<keyof SourceSplit>
  /** Why those sources are unknown: the one shared wording. */
  gap: FeedGap | null
  /** The whole window is empty: the headline has the sentence, this is its short form. */
  emptyWindow?: EmptyWindow | null
}) {
  const total = split.work + split.personal
  const emptyWeek = nothingBooked(load)
  const showSplitBar = unknown.size === 0 && split.work > 0 && split.personal > 0
  return (
    <Card data-shot="week-strip" data-shot-states="empty loading error">
      <Section title={title}>
        <Box className={`${classes.stripRow} ${classes.stripHead}`} aria-hidden>
          <span />
          <span className={classes.stripTarget}>target {DAY_TARGET_H} h</span>
          <span className={classes.stripBooked}>booked</span>
          <span className={classes.stripCount}>events</span>
        </Box>
        <div>
          {load.map((day) => {
            const hours = day.bookedMin === null ? null : day.bookedMin / 60
            return (
              <Box
                key={day.key}
                className={`${classes.stripRow}${day.key === todayKey ? ` ${classes.today}` : ''}`}
              >
                <span className={classes.stripDay}>{dayLabel(day.key)}</span>
                <Meter
                  label={`${dayLabel(day.key)} booked against ${DAY_TARGET_H} hours`}
                  value={hours}
                  max={DAY_TARGET_H}
                  target={DAY_TARGET_H}
                  {...(hours !== null && hours > DAY_TARGET_H
                    ? { color: VX.status.warn }
                    : { tone: 'muted' as const })}
                  size="row"
                />
                <span className={classes.stripBooked}>
                  {day.bookedMin === null ? '—' : formatMinutes(day.bookedMin)}
                </span>
                <span className={classes.stripCount}>{day.count ?? '—'}</span>
              </Box>
            )
          })}
        </div>
        {showSplitBar ? (
          <Meter
            label="Booked hours by source"
            max={Math.max(total, 1)}
            format={formatMinutes}
            segments={(['work', 'personal'] as const).map((key) => ({
              value: split[key],
              label: SPLIT_LABEL[key],
              color: SPLIT_COLOR[key],
            }))}
          />
        ) : unknown.size > 0 ? (
          // The week's total is the headline's; a source that did answer keeps its minutes, the
          // missing one is named by the card's one gap line.
          <Box className={classes.split}>
            {(['work', 'personal'] as const)
              .filter((key) => !unknown.has(key))
              .map((key) => {
                // Personal is the booked time minus work: without the work feed it is a floor.
                const partial = key === 'personal' && unknown.has('work') ? ' (partial)' : ''
                return (
                  <span key={key}>
                    {SPLIT_LABEL[key]} {formatMinutes(split[key])}
                    {partial}
                  </span>
                )
              })}
            {gap && <GapLine gap={gap} skeleton={{ kind: 'lines' }} inline />}
          </Box>
        ) : emptyWeek ? (
          <Text className={classes.muted}>
            {emptyWindow ? emptyWindow.short : `Nothing booked this week in ${SOURCES_LABEL}`}
          </Text>
        ) : null}
      </Section>
    </Card>
  )
}

/** The copy for each priority tier: every task names its priority in words. */
const TIER_LABEL = { high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' } as const

const TONE_COLOR = { bad: VX.status.bad, warn: VX.status.warn, neutral: VX.neutral } as const

export function TaskList({
  tasks,
  todayKey,
  state,
  onRetryTasks,
  retryingTasks,
}: {
  tasks: readonly TaskDue[]
  todayKey: DayKey
  /** The task read itself: a pending or failed one is not an empty list, so it has no count. */
  state: 'loading' | 'error' | 'ready'
  /** Refetches the failed task reads: the step on the failed card itself. */
  onRetryTasks: () => void
  /** Those reads are in flight. */
  retryingTasks: boolean
}) {
  return (
    <Card data-shot="tasks-due" data-shot-states="empty loading error">
      <Section title="Tasks due" {...(state === 'ready' ? { count: tasks.length } : {})}>
        <Text className={classes.muted}>Overdue or due within 7 days</Text>
        {state === 'loading' ? (
          <SkeletonRows rows={3} label="Loading tasks" time={false} />
        ) : state === 'error' ? (
          <Group gap="xs">
            <Text className={classes.muted}>Tasks failed to load</Text>
            <RetryButton onClick={onRetryTasks} loading={retryingTasks} label="Retry tasks" />
          </Group>
        ) : tasks.length === 0 ? (
          <Text className={classes.muted}>Nothing due in the next 7 days.</Text>
        ) : (
          <div role="list">
            {tasks.map((task) => (
              <div key={task.id} role="listitem" className={classes.task}>
                <Box component="span" className={classes.dot} bg={TONE_COLOR[task.tone]} />
                <div>
                  <div className={classes.taskTitle} title={task.title}>
                    {task.title}
                  </div>
                  <div className={classes.taskMeta}>
                    {[TIER_LABEL[task.tier], task.project].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className={classes.due}>
                  {task.dueKey === todayKey
                    ? 'today'
                    : task.overdue
                      ? `overdue · ${shortDate(task.dueKey)}`
                      : dayLabel(task.dueKey)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </Card>
  )
}
