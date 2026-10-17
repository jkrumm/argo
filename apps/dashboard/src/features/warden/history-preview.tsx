import { Group, Stack, Text } from '@mantine/core'
import { relativeTime } from 'basalt-ui/format'
import { sentenceCase, type TransitionLine } from './page-model'

/** The decision card's right-hand context: the last state changes, newest last, `from → to` with the time in mono. */
export function HistoryPreview({ lines }: { lines: readonly TransitionLine[] }) {
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Recent changes
      </Text>
      {lines.map((line, index) => (
        <Group key={`${index}-${line.to}`} gap="xs" wrap="nowrap" justify="space-between">
          <Text size="xs">
            {line.from === null ? 'New' : sentenceCase(line.from)} → {sentenceCase(line.to)}
          </Text>
          <Text size="xs" c="dimmed" ff="monospace">
            {line.at ? relativeTime(line.at) : '—'}
          </Text>
        </Group>
      ))}
    </Stack>
  )
}
