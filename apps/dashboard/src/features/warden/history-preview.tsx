import { Group, Stack, Text } from '@mantine/core'
import { relativeTime } from 'basalt-ui/format'
import { sentenceCase, type TransitionLine } from './page-model'

function transitionText({ from, to }: TransitionLine): string {
  const target = sentenceCase(to) ?? to
  if (from === null) return to === 'new' ? 'Created' : `Created → ${target}`
  return `${sentenceCase(from) ?? from} → ${target}`
}

/** The decision card's right-hand context: the last state changes, newest last, `from → to` with the time in mono. */
export function HistoryPreview({ lines }: { lines: readonly TransitionLine[] }) {
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Recent changes
      </Text>
      {lines.map((line, index) => (
        <Group key={`${index}-${line.to}`} gap="xs" wrap="nowrap" justify="space-between">
          <Text size="xs">{transitionText(line)}</Text>
          <Text size="xs" c="dimmed" ff="monospace">
            {line.at ? relativeTime(line.at) : '—'}
          </Text>
        </Group>
      ))}
    </Stack>
  )
}
