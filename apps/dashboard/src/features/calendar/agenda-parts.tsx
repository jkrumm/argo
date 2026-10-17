/**
 * The Agenda tab's presentational pieces. They render `derive.ts` output and compute nothing:
 * every figure, count and window arrives already derived.
 */
import { ActionIcon, Box, Card, Text } from '@mantine/core'
import { Meter, Section } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { IconVideo } from '@tabler/icons-react'
import { ScheduleRow } from '../../components/upstream/schedule-row'
import { formatDurationMin } from '../../components/upstream/schedule-row-model'
import type { CalendarEventPayload } from '../../lib/queries/calendar'
import { SERIES } from '../../lib/series'
import classes from './agenda.module.css'
import {
  DAY_TARGET_H,
  durationMin,
  dayLabel,
  shortDate,
  toDate,
  type AgendaDay,
  type CalendarItem,
  type DayKey,
  type DayLoad,
  type NextEvent,
  type SourceSplit,
  type TaskDue,
} from './derive'

/** Work and Personal are the one categorical split on the page, so they alone earn hues. */
const SPLIT_COLOR = { work: SERIES.sleepDuration, personal: SERIES.vo2max } as const
/** The `in {n}m` pill only reads as a countdown when the next item is close. */
const PILL_WITHIN_MIN = 12 * 60
const SPLIT_LABEL = { work: 'Work', personal: 'Personal' } as const

const clock = (local: string) => local.slice(11, 16)

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function eventMeta(payload: CalendarEventPayload | undefined): string {
  const parts: string[] = []
  if (payload?.sourceClass) parts.push(SPLIT_LABEL[payload.sourceClass])
  if (payload?.source === 'google' && payload.calendarName) parts.push(payload.calendarName)
  if (payload?.attendeeTotal)
    parts.push(`${payload.attendeeAccepted ?? 0}/${payload.attendeeTotal} accepted`)
  return parts.join(' · ')
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
  events,
  now,
  next,
}: {
  events: readonly CalendarItem[]
  now: Date
  next: NextEvent | null
}) {
  return (
    <div role="list">
      {events.map((event) => {
        const payload = event.payload
        const videoLink = payload?.videoLink
        const meta = eventMeta(payload)
        return (
          <ScheduleRow
            key={String(event.id)}
            start={clock(String(event.start))}
            durationMin={durationMin(event)}
            title={event.title}
            past={toDate(String(event.end)).getTime() <= now.getTime()}
            {...(meta ? { meta } : {})}
            {...(next?.event.id === event.id && next.inMin < PILL_WITHIN_MIN
              ? { pill: `in ${formatDurationMin(next.inMin)}` }
              : {})}
            {...(videoLink && isHttpUrl(videoLink)
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
}: {
  days: readonly AgendaDay[]
  /** All-day items per day key. */
  allDay: Readonly<Record<DayKey, readonly CalendarItem[]>>
  now: Date
  next: NextEvent | null
}) {
  return (
    <div>
      {days.map((day) => {
        const chips = allDay[day.key] ?? []
        if (day.events.length === 0 && chips.length === 0) {
          return (
            <Box key={day.key} className={classes.freeDay}>
              <span className={classes.caption}>{dayLabel(day.key)}</span>
              <span className={classes.muted}>free</span>
            </Box>
          )
        }
        return (
          <Box key={day.key} className={classes.group}>
            <Box className={classes.groupHead}>
              <span className={classes.caption}>{dayLabel(day.key)}</span>
              <span className={classes.muted}>
                {day.events.length === 0
                  ? 'no meetings'
                  : `${day.events.length} ${day.events.length === 1 ? 'event' : 'events'} · ${formatDurationMin(day.bookedMin)}`}
              </span>
            </Box>
            {chips.length > 0 && (
              <Box pt="xs">
                <AllDayChips items={chips} />
              </Box>
            )}
            <EventRows events={day.events} now={now} next={next} />
          </Box>
        )
      })}
    </div>
  )
}

export function WeekStrip({
  title,
  range,
  load,
  split,
  todayKey,
  unknown,
}: {
  title: string
  /** The window the rows cover, stated beside the figures (`Sat 17 – Fri 23`). */
  range: string
  load: readonly DayLoad[]
  split: SourceSplit
  todayKey: DayKey
  /** Source classes whose feed failed; their figures read `—`, not 0. */
  unknown: ReadonlySet<keyof SourceSplit>
}) {
  const total = split.work + split.personal
  return (
    <Card py="sm" px="md" data-shot="week-strip">
      <Section title={title}>
        <Text className={classes.muted}>
          {range} · tick at {DAY_TARGET_H} h · number = events · today counts from now
        </Text>
        <div>
          {load.map((day) => {
            const hours = day.bookedMin / 60
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
                  color={hours > DAY_TARGET_H ? VX.status.warn : VX.muted}
                  startCaption={null}
                  endCaption={null}
                />
                <span className={classes.stripBooked}>{formatDurationMin(day.bookedMin)}</span>
                <span className={classes.stripCount}>{day.count > 0 ? `· ${day.count}` : ''}</span>
              </Box>
            )
          })}
        </div>
        {split.work > 0 && split.personal > 0 && (
          <Meter
            label="Booked hours by source"
            max={Math.max(total, 1)}
            segments={(['work', 'personal'] as const).map((key) => ({
              value: split[key],
              label: SPLIT_LABEL[key],
              color: SPLIT_COLOR[key],
            }))}
            startCaption={null}
            endCaption={null}
          />
        )}
        <Box className={classes.split}>
          {(['work', 'personal'] as const).map((key) => (
            <span key={key}>
              <Box component="span" className={classes.swatch} bg={SPLIT_COLOR[key]} />
              {SPLIT_LABEL[key]} {unknown.has(key) ? '—' : formatDurationMin(split[key])}
            </span>
          ))}
        </Box>
      </Section>
    </Card>
  )
}

const TONE_COLOR = { bad: VX.status.bad, warn: VX.status.warn, neutral: VX.neutral } as const

export function TaskList({ tasks, todayKey }: { tasks: readonly TaskDue[]; todayKey: DayKey }) {
  return (
    <Card py="sm" px="md" data-shot="tasks-due">
      <Section title="Tasks due" count={tasks.length}>
        <Text className={classes.muted}>Overdue or due within 7 days</Text>
        {tasks.length === 0 ? (
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
                    {[task.label, task.project].filter(Boolean).join(' · ')}
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
