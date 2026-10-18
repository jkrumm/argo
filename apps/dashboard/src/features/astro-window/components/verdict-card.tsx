import { Box, Group, Stack, Text } from '@mantine/core'
import { StatusDot } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { DecisionCard } from '../../../components/upstream/decision-card'
import {
  gateRows,
  verdictFacts,
  verdictHeadline,
  verdictStatus,
  type GateRowModel,
} from '../formulas'
import type { Night } from '../types'

const TONE: Record<GateRowModel['tone'], string> = {
  good: VX.status.good,
  warn: VX.status.warn,
  neutral: VX.muted,
}

/** One gate or factor: a status dot, its name, a state word, and one line of cause in plain words. */
function GateRow({ label, state, tone, detail }: Omit<GateRowModel, 'key'>) {
  return (
    <Stack gap={2}>
      <Group gap="xs" wrap="nowrap">
        <StatusDot color={TONE[tone]} />
        <Text size="sm" fw={600}>
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {state}
        </Text>
      </Group>
      {detail !== null && (
        <Text size="xs" c="dimmed">
          {detail}
        </Text>
      )}
    </Stack>
  )
}

/**
 * The one verdict for the selected night: a status dot + word, one line stating why, the night it
 * is about, and the gates it was judged by, each with a cause in words (`gateRows`). The core
 * reading against its gate is drawn in the Core cell and the moon in the Moon cell.
 */
export function VerdictCard({
  night,
  nights,
  moonLimit,
}: {
  night: Night
  nights: readonly Night[]
  moonLimit: number
}) {
  const status = verdictStatus(night)
  const facts = verdictFacts(night, nights)

  return (
    <Box data-shot="verdict-card">
      <DecisionCard
        question={verdictHeadline(night)}
        status={
          <Group gap={6} wrap="nowrap">
            <StatusDot color={status.color} />
            <Text size="sm" fw={600}>
              {status.word}
            </Text>
          </Group>
        }
        facts={facts}
        evidence={
          <Stack gap="sm">
            {gateRows(night, moonLimit).map(({ key, ...row }) => (
              <GateRow key={key} {...row} />
            ))}
          </Stack>
        }
      />
    </Box>
  )
}
