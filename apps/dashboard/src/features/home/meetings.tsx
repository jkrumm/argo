import { Anchor, Badge, Box, Group, Stack, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { isSafeHttpUrl } from '../warden/model'
import { durationLabel, meetingState, type Agenda, type Meeting } from './model'
import classes from './home.module.css'

/** Shape of the shared schedule row the Calendar worker is building (`components/upstream/schedule-row.tsx`). */
export type ScheduleRowProps = {
  start: string
  durationMin: number
  title: string
  meta?: string | undefined
  pill?: { label: string; href?: string } | undefined
  action?: { label: string; href: string } | undefined
  past?: boolean | undefined
  now?: boolean | undefined
}

const clock = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

function ScheduleRow({
  start,
  durationMin,
  title,
  meta,
  pill,
  action,
  past,
  now,
}: ScheduleRowProps) {
  return (
    <div className={classes.meetingRow} data-state={past ? 'past' : now ? 'now' : 'upcoming'}>
      <span className={classes.meetingTime}>
        {start}
        <span className={classes.meetingDuration}>{durationLabel(durationMin)}</span>
      </span>
      <Text size="sm" lineClamp={2} fw={now ? 600 : 400} {...(past ? { c: 'dimmed' } : {})}>
        {title}
      </Text>
      <span className={classes.meetingTrail}>
        {meta ? <span className={classes.meetingMeta}>{meta}</span> : null}
        {now ? (
          <Badge variant="light" color="gray" size="sm" tt="none">
            Now
          </Badge>
        ) : null}
        {pill ? (
          pill.href && isSafeHttpUrl(pill.href) ? (
            <Badge
              component="a"
              href={pill.href}
              target="_blank"
              rel="noreferrer"
              variant="light"
              color="gray"
              size="sm"
              tt="none"
            >
              {pill.label}
            </Badge>
          ) : (
            <Badge variant="light" color="gray" size="sm" tt="none">
              {pill.label}
            </Badge>
          )
        ) : null}
        {action ? (
          <Anchor href={action.href} size="xs">
            {action.label}
          </Anchor>
        ) : null}
      </span>
    </div>
  )
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

function row(m: Meeting, now: number): ScheduleRowProps {
  const state = meetingState(m, now)
  return {
    start: clock(m.startMs),
    durationMin: m.durationMin,
    title: m.title,
    ...(m.attendees > 1 && { meta: people(m.attendees) }),
    ...(m.videoLink !== null && { pill: { label: 'Meet', href: m.videoLink } }),
    past: state === 'past',
    now: state === 'now',
  }
}

type Props = {
  /** `null` when no calendar feed loaded: the agenda is unknown, not empty. */
  agenda: Agenda | null
  tasks: { overdue: number; dueSoon: number } | null
  /** Calendar feeds that failed while another loaded: the agenda is partial. */
  missing: readonly string[]
  now: number
}

/** Today as an agenda: only hours that hold a meeting are drawn, then the tasks line. */
export function Meetings({ agenda, tasks, missing, now }: Props) {
  return (
    <Section title="Meetings today" {...(agenda !== null && { count: agenda.meetings.length })}>
      <Stack gap="sm" data-shot="meetings">
        {agenda === null ? (
          <Text size="sm" c="dimmed">
            Unknown: the calendar feeds did not load, so today's meetings cannot be listed.
          </Text>
        ) : (
          <>
            {agenda.allDay.length > 0 ? (
              <Group gap="xs" aria-label="All-day events">
                {agenda.allDay.map((title, i) => (
                  <Badge key={`${title}-${i}`} variant="light" color="gray" size="sm" tt="none">
                    {title}
                  </Badge>
                ))}
              </Group>
            ) : null}
            {agenda.meetings.length === 0 ? (
              <Text size="sm" c="dimmed">
                No meetings today.
              </Text>
            ) : (
              <Box role="list">
                {agenda.meetings.map((m) => (
                  <div role="listitem" key={m.key}>
                    <ScheduleRow {...row(m, now)} />
                  </div>
                ))}
              </Box>
            )}
          </>
        )}
        {agenda !== null && missing.length > 0 ? (
          <Text size="xs" c="dimmed">
            {missing.join(' and ')} calendar unavailable: the agenda is incomplete.
          </Text>
        ) : null}
        <Text size="sm" c="dimmed">
          {tasks === null ? (
            'Tasks: unknown'
          ) : (
            <>
              <Text component="span" size="sm" {...(tasks.overdue > 0 && { c: VX.status.bad })}>
                Tasks: {tasks.overdue} overdue
              </Text>
              {` · ${tasks.dueSoon} due within 7 d`}
            </>
          )}
        </Text>
      </Stack>
    </Section>
  )
}
