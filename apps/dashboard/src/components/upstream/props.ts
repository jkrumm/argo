/** Local stand-ins for basalt-ui's internal `BasaltProps` / `cx` (not public exports). */
import type { CSSProperties } from 'react'

export type BasaltProps = { className?: string; style?: CSSProperties }

export const cx = (...names: (string | false | null | undefined)[]): string | undefined =>
  names.filter(Boolean).join(' ') || undefined
