import { withUnit } from '../../lib/format'
import { ActionIcon, Badge, Card, Group, Stack, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { IconVideo } from '@tabler/icons-react'
import { ScheduleRow } from '../../components/upstream/schedule-row'
import { isSafeHttpUrl } from '../warden/model'
import { classLabels, meetingState, noMeetingsLabel, type Agenda, type Meeting } from './model'

const SPLIT_LABEL = { work: 'Work', personal: 'Personal' } as const

const clock = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(ms)

const meta = (m: Meeting) =>
  [SPLIT_LABEL[m.sourceClass], m.attendees > 1 ? `${m.attendees} people` : null]
    .filter(Boolean)
    .join(' · ')

function MeetingRow({ meeting, now }: { meeting: Meeting; now: number }) {
  const state = meetingState(meeting, now)
  // Only a meeting in progress earns a pill; the countdown to the next one is the strip's.
  const pill = state === 'now' ? 'now' : undefined
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
  tasks: { overdue: number; dueSoon: number } | null
  now: number
}

/** Today as an agenda, ended meetings dimmed: only hours that hold a meeting are drawn, then the tasks line. */
export function Meetings({ agenda, tasks, now }: Props) {
  return (
    <Card>
      <Section title="Agenda" {...(agenda === null && { value: '—' })}>
        <Stack gap="sm" data-shot="meetings" data-shot-states="empty error">
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
                  {noMeetingsLabel(agenda)}.
                </Text>
              ) : (
                <div role="list">
                  {agenda.meetings.map((m) => (
                    <MeetingRow key={m.key} meeting={m} now={now} />
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
                {` · ${tasks.dueSoon} due within ${withUnit(7, 'd')}`}
              </>
            )}
          </Text>
        </Stack>
      </Section>
    </Card>
  )
}
