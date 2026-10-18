import { Group, Stack, Text } from '@mantine/core'
import { relativeTime } from 'basalt-ui/format'
import {
  historySummary,
  sentenceCase,
  type TransitionHistory,
  type TransitionLine,
} from './page-model'

function transitionText({ from, to }: TransitionLine): string {
  const target = sentenceCase(to) ?? to
  if (from === null) return to === 'new' ? 'Created' : `Created → ${target}`
  return `${sentenceCase(from) ?? from} → ${target}`
}

/**
 * The decision card's right-hand context: the latest state change on ONE line (`from → to`, time in
 * mono), with a count of the earlier ones. The full text rides in `title`; the whole log is in the
 * item timeline.
 */
export function HistoryPreview({ lines }: { lines: TransitionHistory }) {
  const summary = historySummary(lines, lines.total)
  if (summary === null) return null
  const { latest, earlier } = summary
  const text = transitionText(latest)
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Latest change
      </Text>
      <Group gap="xs" wrap="nowrap" justify="space-between">
        <Text size="xs" truncate="end" title={text} aria-label={text} miw={0}>
          {text}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace" style={{ flex: 'none' }}>
          {latest.at ? relativeTime(latest.at) : '—'}
        </Text>
      </Group>
      {earlier > 0 ? (
        <Text size="xs" c="dimmed">
          +{earlier} earlier
        </Text>
      ) : null}
    </Stack>
  )
}
