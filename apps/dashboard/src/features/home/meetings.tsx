import { ActionIcon, Badge, Card, Group, Stack, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { IconVideo } from '@tabler/icons-react'
import { ScheduleRow } from '../../components/upstream/schedule-row'
import { isSafeHttpUrl } from '../warden/model'
import {
  classLabels,
  countdownLabel,
  meetingState,
  noMeetingsLabel,
  weekdayTime,
  type Agenda,
  type LaterMeeting,
  type Meeting,
} from './model'

/** The next meeting carries its countdown pill only while it is under 12 h away. */
const PILL_WITHIN_MS = 12 * 60 * 60_000

const SPLIT_LABEL = { work: 'Work', personal: 'Personal' } as const

const clock = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

const meta = (m: Meeting) =>
  [SPLIT_LABEL[m.sourceClass], m.attendees > 1 ? `${m.attendees} people` : null]
    .filter(Boolean)
    .join(' · ')

function MeetingRow({ meeting, isNext, now }: { meeting: Meeting; isNext: boolean; now: number }) {
  const state = meetingState(meeting, now)
  const untilMs = meeting.startMs - now
  const pill =
    state === 'now'
      ? 'now'
      : isNext && untilMs < PILL_WITHIN_MS
        ? countdownLabel(untilMs)
        : undefined
  const link = meeting.videoLink
  return (
    <ScheduleRow
      start={clock(meeting.startMs)}
      durationMin={meeting.durationMin}
      title={meeting.title}
      meta={meta(meeting)}
      past={state === 'past'}
      {...(pill !== undefined && { pill })}
      {...(link !== null && isSafeHttpUrl(link)
        ? {
            action: (
              <ActionIcon
                component="a"
                href={link}
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
}

type Props = {
  /** `null` when a calendar feed has not answered and nothing else is known: the agenda is unknown, not empty. */
  agenda: Agenda | null
  next: Meeting | null
  later: LaterMeeting | null
  tasks: { overdue: number; dueSoon: number } | null
  now: number
}

/** Today as an agenda, ended meetings dimmed: only hours that hold a meeting are drawn, then the tasks line. */
export function Meetings({ agenda, next, later, tasks, now }: Props) {
  return (
    <Card>
      <Section
        title="Meetings today"
        {...(agenda !== null && { count: agenda.meetings.length })}
        {...(agenda === null && { value: '—' })}
      >
        <Stack gap="sm" data-shot="meetings">
          {agenda === null ? (
            <Text size="sm" c="dimmed">
              Unknown: a calendar has not answered, so today's meetings cannot be listed.
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
                  {agenda.unavailable.length === 0 && later !== null
                    ? `None today · next ${weekdayTime(later.startMs)}`
                    : `${noMeetingsLabel(agenda)}.`}
                </Text>
              ) : (
                <div role="list">
                  {agenda.meetings.map((m) => (
                    <MeetingRow key={m.key} meeting={m} isNext={m === next} now={now} />
                  ))}
                </div>
              )}
            </>
          )}
          {agenda !== null && agenda.unavailable.length > 0 ? (
            <Text size="xs" c="dimmed">
              {classLabels(agenda.unavailable)} calendar unavailable: the agenda is incomplete.
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
    </Card>
  )
}
