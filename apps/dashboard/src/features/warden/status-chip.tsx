import { Badge } from '@mantine/core'
import type { ChipTone } from './page-model'

const TONE_COLOR: Record<ChipTone, string> = {
  work: 'red',
  infra: 'blue',
  policy: 'orange',
  neutral: 'gray',
}

/**
 * StatusChip — a small toned label. Prototype of the upstream status chip (docs/design/UPSTREAM.md):
 * `tone` picks the hue, `label` is the text; an unknown value is the caller's `neutral` tone with
 * its raw label.
 */
export function StatusChip({ tone, label }: { tone: ChipTone; label: string }) {
  return (
    <Badge variant="light" color={TONE_COLOR[tone]} size="sm">
      {label}
    </Badge>
  )
}
