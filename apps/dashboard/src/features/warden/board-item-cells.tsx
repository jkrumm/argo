import type { CSSProperties } from 'react'
import { Badge, Text } from '@mantine/core'
import { relativeTime } from 'basalt-ui/format'
import { stateColor, stateLabel } from './model'

/**
 * A board item's `state`, rendered as a colored badge (`stateColor`) — a `closed` item also shows
 * its `close_reason` (`stateLabel`). Shared by `board-section.tsx`, `issues-section.tsx` and
 * `awaiting-owner-section.tsx`'s table columns. Mantine's `Badge` clips to an ellipsis by default
 * (`width: fit-content` + `overflow: hidden`), which collapses its min-content width to ~0 under
 * table-layout auto — so the browser happily shrinks the column and truncates a long state name
 * like `needs_decision` to `NE…`. Overriding overflow back to visible restores the badge's real
 * min-content width, which is the column's own fixed-width floor. `style` merges on top (e.g. a
 * card header's `flexShrink: 0` to hold its size in a `nowrap` `Group`).
 */
export function StateBadge({
  state,
  closeReason,
  style,
}: {
  state: string
  closeReason?: string | null
  style?: CSSProperties
}) {
  return (
    <Badge
      variant="light"
      color={stateColor(state)}
      style={{ overflow: 'visible', textOverflow: 'clip', ...style }}
    >
      {stateLabel(state, closeReason)}
    </Badge>
  )
}

/** `updated_at ?? created_at`, formatted as relative time — a dimmed em dash when neither is set.
 * Shared by both files' Age table column. */
export function AgeText({ at, style }: { at: string | null | undefined; style?: CSSProperties }) {
  return at ? (
    <Text size="sm" style={style}>
      {relativeTime(at)}
    </Text>
  ) : (
    <Text c="dimmed" style={style}>
      —
    </Text>
  )
}
