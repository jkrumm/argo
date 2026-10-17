import { StatusVerdict } from 'basalt-ui'
import { sentenceCase } from './page-model'
import { VX } from 'basalt-ui/tokens'

/**
 * StatusChip — a category or state as a neutral dot + sentence-case word. A tag or failure class
 * names what kind of thing needs the owner, not a verdict, so it never takes a status hue.
 */
export function StatusChip({ label }: { label: string }) {
  return <StatusVerdict color={VX.muted} word={sentenceCase(label)} />
}
