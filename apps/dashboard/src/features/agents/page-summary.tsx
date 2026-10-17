import { Group, Stack, Text } from '@mantine/core'
import { StatusDot } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import type { OverviewRecord } from '../../lib/queries/agents'
import { ageAgo, STALE_AFTER_MS, snapshotAgeMs, summarySentence, type SummaryInput } from './model'

type Props = {
  summary: SummaryInput
  latest: OverviewRecord | null
  now: number
}

/** The page's one sentence (count, oldest wait, fleet) plus feed freshness as a fact on every load. */
export function PageSummary({ summary, latest, now }: Props) {
  if (latest === null) return null
  const age = snapshotAgeMs(latest, now)
  const live = age !== null && age < STALE_AFTER_MS
  return (
    <Stack gap={4}>
      <Text size="md">{summarySentence(summary)}</Text>
      {age === null ? null : (
        <Group gap="xs" wrap="nowrap">
          <StatusDot color={live ? VX.line : VX.status.warn} />
          <Text size="xs" ff="monospace" c="dimmed">
            {live ? 'Live' : 'Stale'} · updated {ageAgo(age)}
          </Text>
        </Group>
      )}
    </Stack>
  )
}
