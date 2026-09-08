import { Badge, Code, Divider, Group, Stack, Text } from '@mantine/core'
import { EmptyState, Section } from 'basalt-ui'
import { relativeTime } from 'basalt-ui/format'
import { VX } from 'basalt-ui/tokens'
import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react'
import type { HumanQueueItem } from '../../lib/queries/agents'
import { formatWaitDuration, isAbandonedWait, STATE_COLOR, type AgentRow } from './model'

type Props = {
  humanQueue: HumanQueueItem[]
  agents: AgentRow[]
}

/**
 * Everything waiting on the human, in one block: the mini's human-queue requests (a biometric
 * `op`, an ACL push — things only a present person can do) and the agents sideclaw derived as
 * `needs_you` (a permission prompt, a question, a dialog). Both are answered elsewhere — this
 * block only makes sure they are seen.
 *
 * A `needs_you` item waiting past `ABANDONED_AFTER_MS` (7 days) is split into its own labelled
 * group below the live ones — the concrete case is a herdr pane blocked on a dialog since 21 days,
 * re-announced to Slack ~35 times. It is not a live "waiting on an answer" any more; it's stuck,
 * and must read that way rather than blend into the same list.
 */
export function NeedsYouSection({ humanQueue, agents }: Props) {
  const waiting = agents.filter((a) => a.state === 'needs_you')
  const liveWaiting = waiting.filter((a) => !isAbandonedWait(a))
  const abandonedWaiting = waiting.filter((a) => isAbandonedWait(a))
  const count = humanQueue.length + waiting.length

  return (
    <Section title="Needs you" count={count}>
      {count === 0 ? (
        <EmptyState
          tier="section"
          icon={<IconCircleCheck size={28} />}
          title="Nothing needs you"
          description="No human-queue requests and no agent waiting on an answer."
        />
      ) : (
        <Stack gap="xs">
          {humanQueue.map((item) => (
            <Group key={item.id} gap="sm" wrap="nowrap" align="flex-start">
              <Badge variant="light" color="orange" style={{ flexShrink: 0 }}>
                human queue
              </Badge>
              <Stack gap={2} miw={0}>
                <Text size="sm">{item.question}</Text>
                <Group gap="xs">
                  {item.cmd ? <Code>{item.cmd}</Code> : null}
                  {item.askedAt ? (
                    <Text size="xs" c="dimmed">
                      {relativeTime(item.askedAt)}
                      {item['host'] ? ` · ${String(item['host'])}` : ''}
                    </Text>
                  ) : null}
                </Group>
              </Stack>
            </Group>
          ))}
          {liveWaiting.map((agent) => (
            <Group key={agent.id} gap="sm" wrap="nowrap" align="flex-start">
              <Badge variant="light" color={STATE_COLOR.needs_you} style={{ flexShrink: 0 }}>
                {agent.project}
              </Badge>
              <Stack gap={2} miw={0}>
                <Text size="sm">{agent.title ?? agent.lastPrompt ?? agent.id}</Text>
                <Text size="xs" c="dimmed">
                  {agent.blocker ?? agent.waitingFor ?? agent.standing ?? 'waiting on you'}
                  {agent.lastActivityAt ? ` · ${relativeTime(agent.lastActivityAt)}` : ''}
                </Text>
              </Stack>
            </Group>
          ))}
          {abandonedWaiting.length > 0 ? (
            <>
              <Divider
                mt={4}
                color="red"
                labelPosition="left"
                label={
                  <Group gap={4} wrap="nowrap">
                    <IconAlertTriangle size={12} color={VX.status.bad} />
                    <Text size="xs" fw={600} c="red">
                      Abandoned — waiting over 7 days
                    </Text>
                  </Group>
                }
              />
              {abandonedWaiting.map((agent) => (
                <Group key={agent.id} gap="sm" wrap="nowrap" align="flex-start">
                  <Badge variant="filled" color="red" style={{ flexShrink: 0 }}>
                    {agent.project}
                  </Badge>
                  <Stack gap={2} miw={0}>
                    <Text size="sm">{agent.title ?? agent.lastPrompt ?? agent.id}</Text>
                    <Text size="xs" c="red">
                      {agent.blocker ?? agent.waitingFor ?? agent.standing ?? 'waiting on you'}
                      {agent.lastActivityAt
                        ? ` · waiting ${formatWaitDuration(Date.now() - agent.lastActivityAt)}`
                        : ''}
                    </Text>
                  </Stack>
                </Group>
              ))}
            </>
          ) : null}
        </Stack>
      )}
    </Section>
  )
}
