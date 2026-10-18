import { formatMinutes } from '../../lib/format'
/**
 * The Agenda tab's presentational pieces. They render `derive.ts` output and compute nothing:
 * every figure, count and window arrives already derived.
 */
import { ActionIcon, Box, Card, Text } from '@mantine/core'
import { Meter, Section } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { IconVideo } from '@tabler/icons-react'
import { ScheduleRow } from '../../components/upstream/schedule-row'
import { SERIES } from '../../lib/series'
import classes from './agenda.module.css'
import { untilLabel } from './summary'
import { sourceGapWord, type FeedGap } from './query-state'
import {
  DAY_TARGET_H,
  dayLabel,
  shortDate,
  toDate,
  dayHeadLabel,
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

export function AllDayChips({ items }: { items: readonly CalendarItem[] }) {
  if (items.length === 0) return null
  return (
    <Box className={classes.chips}>
      <span className={classes.caption}>All day · {items.length}</span>
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
  allDay,
  now,
  next,
  gap = null,
}: {
  days: readonly AgendaDay[]
  /** All-day items per day key. */
  allDay: Readonly<Record<DayKey, readonly CalendarItem[]>>
  now: Date
  next: NextEvent | null
  /** A calendar has not answered: an empty day says why it is unknown, never "no events". */
  gap?: FeedGap | null
}) {
  return (
    <div>
      {days.map((day) => {
        const chips = allDay[day.key] ?? []
        if (day.rows.length === 0 && chips.length === 0) {
          return (
            <Box key={day.key} className={classes.freeDay}>
              <span className={classes.caption}>{dayLabel(day.key)}</span>
              <span className={classes.muted}>{gap ? gap.short : 'no events'}</span>
            </Box>
          )
        }
        return (
          <Box key={day.key} className={classes.group}>
            <Box className={classes.groupHead}>
              <span className={classes.caption}>{dayLabel(day.key)}</span>
              <span className={classes.muted}>
                {gap
                  ? gap.state === 'loading'
                    ? gap.short
                    : 'partial'
                  : dayHeadLabel(day, formatMinutes, chips.length)}
              </span>
            </Box>
            {chips.length > 0 && (
              <Box pt="xs">
                <AllDayChips items={chips} />
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
  failed,
}: {
  title: string
  load: readonly DayLoad[]
  split: SourceSplit
  todayKey: DayKey
  /** Source classes whose feed failed; their figures read `—`, not 0. */
  unknown: ReadonlySet<keyof SourceSplit>
  /** The unknown sources that failed rather than still load. */
  failed: ReadonlySet<keyof SourceSplit>
}) {
  const total = split.work + split.personal
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
          // The week's total is the headline's; a split is only worth a line when a source is
          // missing: the known source keeps its minutes, the missing one says so.
          <Box className={classes.split}>
            {(['work', 'personal'] as const).map((key) => (
              <span key={key}>
                {SPLIT_LABEL[key]}{' '}
                {unknown.has(key)
                  ? sourceGapWord(key, failed)
                  : // Personal is the booked time minus work: without the work feed it is a floor.
                    `${formatMinutes(split[key])}${key === 'personal' && unknown.has('work') ? ' (partial)' : ''}`}
              </span>
            ))}
          </Box>
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
}: {
  tasks: readonly TaskDue[]
  todayKey: DayKey
  /** The task read itself: a pending or failed one is not an empty list, so it has no count. */
  state: 'loading' | 'error' | 'ready'
}) {
  return (
    <Card data-shot="tasks-due" data-shot-states="empty loading error">
      <Section title="Tasks due" {...(state === 'ready' ? { count: tasks.length } : {})}>
        <Text className={classes.muted}>Overdue or due within 7 days</Text>
        {state === 'loading' ? (
          <Text className={classes.muted}>Loading tasks</Text>
        ) : state === 'error' ? (
          <Text className={classes.muted}>Tasks failed to load — reload to retry</Text>
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
