import { Stack, Text } from '@mantine/core'
import { relativeTime } from '../../lib/format'
import type { TransitionLine } from './page-model'

/** The decision card's right-hand context: where the item has been, newest last. */
export function HistoryPreview({ lines }: { lines: readonly TransitionLine[] }) {
  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed" ff="monospace" tt="uppercase">
        State history
      </Text>
      {lines.map((line, index) => (
        <Stack key={`${index}-${line.to}`} gap={0}>
          <Text size="xs" ff="monospace">
            {line.from} → {line.to}
          </Text>
          <Text size="xs" c="dimmed">
            {line.at ? relativeTime(line.at) : '—'}
          </Text>
        </Stack>
      ))}
    </Stack>
  )
}
