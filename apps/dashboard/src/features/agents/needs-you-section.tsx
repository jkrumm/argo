import { Badge, Code, Group, Stack, Text } from '@mantine/core'
import { EmptyState, Section } from 'basalt-ui'
import { relativeTime } from 'basalt-ui/format'
import { IconCircleCheck } from '@tabler/icons-react'
import type { HumanQueueItem } from '../../lib/queries/agents'
import { STATE_COLOR, type AgentRow } from './model'

type Props = {
  humanQueue: HumanQueueItem[]
  agents: AgentRow[]
}

/**
 * Everything waiting on the human, in one block: the mini's human-queue requests (a biometric
 * `op`, an ACL push — things only a present person can do) and the agents sideclaw derived as
 * `needs_you` (a permission prompt, a question, a dialog). Both are answered elsewhere — this
 * block only makes sure they are seen.
 */
export function NeedsYouSection({ humanQueue, agents }: Props) {
  const waiting = agents.filter((a) => a.state === 'needs_you')
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
          {waiting.map((agent) => (
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
        </Stack>
      )}
    </Section>
  )
}
