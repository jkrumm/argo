import { StatusVerdict } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'

/** `BLOCKER` / `data_loss` → `Blocker` / `Data loss`: a category word reads as a sentence, not an enum. */
export function sentenceCase(raw: string): string {
  const words = raw
    .trim()
    .replaceAll(/[_\s]+/g, ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * StatusChip — a category or state as a neutral dot + sentence-case word. A tag or failure class
 * names what kind of thing needs the owner, not a verdict, so it never takes a status hue.
 */
export function StatusChip({ label }: { label: string }) {
  return <StatusVerdict color={VX.muted} word={sentenceCase(label)} />
}
