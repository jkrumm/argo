import { Badge, Group, Stack, Text } from '@mantine/core'
import { EmptyState, Section } from 'basalt-ui'
import { IconCircleCheck } from '@tabler/icons-react'
import type { WardenIntents } from '../../lib/queries/warden'
import { intentSummary } from './model'

type Props = {
  intents: WardenIntents | undefined
}

/**
 * "Recorded intents — not approvals": an intent is a wish a human or an agent recorded (e.g. an
 * approval decision written to a file), and it authorizes nothing by itself — it is only verified
 * against the real dispatch policy at spend time. This section exists so a pending/rejected count
 * never reads as "already acted on".
 */
export function IntentsSection({ intents }: Props) {
  const { pending, rejected, entries } = intentSummary(intents)
  const count = pending + rejected

  return (
    <Section title="Recorded intents — not approvals" count={count}>
      <Text size="xs" c="dimmed" mb="xs">
        An intent is a recorded wish — it authorizes nothing on its own, and is verified only at
        spend time against the actual dispatch policy.
      </Text>
      {count === 0 && entries.length === 0 ? (
        <EmptyState
          tier="section"
          icon={<IconCircleCheck size={28} />}
          title="No recorded intents"
          description="Nothing pending or rejected."
        />
      ) : (
        <Stack gap="xs">
          <Group gap="md">
            <Text size="sm">
              Pending:{' '}
              <Text span fw={600} c="inherit">
                {pending}
              </Text>
            </Text>
            <Text size="sm">
              Rejected:{' '}
              <Text span fw={600} c="inherit">
                {rejected}
              </Text>
            </Text>
          </Group>
          {entries.map((entry, i) => (
            <Group key={i} gap="sm" wrap="nowrap">
              <Badge
                variant="light"
                color={entry.status === 'rejected' ? 'red' : 'orange'}
                style={{ flexShrink: 0 }}
              >
                {entry.status ?? entry.decision ?? 'pending'}
              </Badge>
              <Text size="sm" lineClamp={1}>
                {entry.kind ?? 'intent'} · {entry.source ?? 'unknown source'}
                {entry.file ? ` · ${entry.file}` : ''}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Section>
  )
}
