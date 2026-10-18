import { Group, Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { relativeTime } from 'basalt-ui/format'
import classes from '../../components/upstream/decision-card.module.css'
import type { HistoryView } from './page-model'

const when = (at: string | null) => (at ? relativeTime(at) : '—')

/**
 * The decision card's change history. One transition is a single inline sentence
 * (`Latest change: A → B · 2 h ago`) with no well; several are a short list, newest first, in the
 * card's right-hand well. State names are never truncated: a line wraps at its spaces instead.
 */
export function HistoryPreview({ view }: { view: HistoryView }) {
  if (view.layout === 'inline') {
    const [only] = view.lines
    return (
      <Text size="xs" c="dimmed">
        Latest change:{' '}
        <Text span inherit c={VX.ink}>
          {only?.text}
        </Text>{' '}
        · {when(only?.at ?? null)}
      </Text>
    )
  }
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Latest changes
      </Text>
      {view.lines.map((line, i) => (
        <Group key={`${i}-${line.text}`} gap={4} align="baseline" wrap="wrap">
          <Text size="xs" miw={0} className={classes.wrap}>
            {line.text}
          </Text>
          <Text span size="xs" c="dimmed">
            {when(line.at)}
          </Text>
        </Group>
      ))}
      {view.earlier > 0 ? (
        <Text size="xs" c="dimmed">
          +{view.earlier} earlier
        </Text>
      ) : null}
    </Stack>
  )
}
