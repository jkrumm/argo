import { Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { relativeTime } from 'basalt-ui/format'
import classes from '../../components/upstream/decision-card.module.css'
import { NBSP } from '../../lib/format'
import type { HistoryView } from './page-model'

const when = (at: string) => relativeTime(at).replaceAll(' ', NBSP)

/** The age glued to the last word of the line it follows, so it never wraps onto a line alone. */
function withAge(text: string, at: string | null | undefined): string {
  if (!at) return text
  return `${text.replace(/ (\S*)$/, `${NBSP}$1`)}${NBSP}·${NBSP}${when(at)}`
}

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
        </Text>
        {only?.at ? `${NBSP}·${NBSP}${when(only.at)}` : null}
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
          {line.at ? withAge(line.text, line.at) : line.text}
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
