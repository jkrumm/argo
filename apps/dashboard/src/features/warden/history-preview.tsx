import { Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { useNow } from '../../lib/use-now'
import classes from '../../components/upstream/decision-card.module.css'
import { gluedArrow, historyLineWithAge, historyTail, type HistoryView } from './page-model'

/**
 * The decision card's change history. One transition is a single inline sentence
 * (`Latest change: A → B · 2 h ago`) with no well; several are a short list, newest first, in the
 * card's right-hand well. A Warden card passes its one clock (`now`), shared with its `waiting` fact; a caller without one (Home) falls back to the page clock. State names are never truncated: a line wraps at its spaces instead.
 */
export function HistoryPreview({
  view,
  now: cardNow,
  unbrokenArrow = false,
}: {
  view: HistoryView
  now?: number
  /** Home's compact row: a transition never breaks at its arrow, so no line ends on a bare `→`. */
  unbrokenArrow?: boolean
}) {
  const text = (t: string) => (unbrokenArrow ? gluedArrow(t) : t)
  const ownNow = useNow()
  const now = cardNow ?? ownNow
  if (view.layout === 'inline') {
    const [only] = view.lines
    return (
      <Text size="xs" c="dimmed">
        Latest change:{' '}
        <Text span inherit c={VX.ink}>
          {only ? text(only.text) : null}
        </Text>
        {only?.at ? historyTail(only.at, now) : null}
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
          {historyLineWithAge(text(line.text), line.at, now)}
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
