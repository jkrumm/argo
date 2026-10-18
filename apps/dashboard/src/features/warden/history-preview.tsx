import { Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import classes from '../../components/upstream/decision-card.module.css'
import { NBSP } from '../../lib/format'
import { useNow } from '../../lib/use-now'
import { historyAge, historyLineWithAge, type HistoryView } from './page-model'

/**
 * The decision card's change history. One transition is a single inline sentence
 * (`Latest change: A → B · 2 h ago`) with no well; several are a short list, newest first, in the
 * card's right-hand well. State names are never truncated: a line wraps at its spaces instead.
 */
export function HistoryPreview({ view }: { view: HistoryView }) {
  const now = useNow()
  if (view.layout === 'inline') {
    const [only] = view.lines
    return (
      <Text size="xs" c="dimmed">
        Latest change:{' '}
        <Text span inherit c={VX.ink}>
          {only?.text}
        </Text>
        {only?.at ? `${NBSP}· ${historyAge(only.at, now)}` : null}
      </Text>
    )
  }
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        Latest changes
      </Text>
      {view.lines.map((line, i) => (
        <Text key={`${i}-${line.text}`} size="xs" miw={0} className={classes.wrap}>
          {historyLineWithAge(line.text, line.at, now)}
        </Text>
      ))}
      {view.earlier > 0 ? (
        <Text size="xs" c="dimmed">
          +{view.earlier} earlier
        </Text>
      ) : null}
    </Stack>
  )
}
