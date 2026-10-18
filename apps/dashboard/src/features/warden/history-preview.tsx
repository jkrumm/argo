import { Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import classes from '../../components/upstream/decision-card.module.css'
import { NBSP, formatAgo } from '../../lib/format'
import { useNow } from '../../lib/use-now'
import type { HistoryView } from './page-model'

/** `3 min ago` in the app's one duration spelling; `—` for an unreadable time. */
const when = (at: string, now: number) =>
  formatAgo(Math.max(0, now - Date.parse(at))).replaceAll(' ', NBSP)

/** The age glued to the last word of the line it follows, so it never wraps onto a line alone. */
function withAge(text: string, at: string | null | undefined, now: number): string {
  if (!at) return text
  return `${text.replace(/ (\S*)$/, `${NBSP}$1`)}${NBSP}·${NBSP}${when(at, now)}`
}

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
        {only?.at ? `${NBSP}·${NBSP}${when(only.at, now)}` : null}
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
          {line.at ? withAge(line.text, line.at, now) : line.text}
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
