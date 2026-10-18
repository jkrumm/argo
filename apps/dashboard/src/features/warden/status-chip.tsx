import { Group, Text } from '@mantine/core'
import { StatusDot } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { sentenceCase } from './page-model'

/**
 * StatusChip — a category or state as a neutral dot + sentence-case word. A tag or failure class
 * names what kind of thing needs the owner, not a verdict, so it never takes a status hue. The word
 * is set at the card's `xs` step (basalt's `StatusVerdict` uses a smaller micro step, which made it a
 * fourth size on a decision card).
 */
export function StatusChip({ label }: { label: string }) {
  const word = sentenceCase(label)
  if (word === null) return null
  return (
    <Group gap={6} wrap="nowrap" component="span">
      <StatusDot color={VX.muted} />
      <Text span size="xs" c="dimmed">
        {word}
      </Text>
    </Group>
  )
}
