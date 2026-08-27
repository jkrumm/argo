import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { SidebarBlock } from 'basalt-ui'
import { navTarget } from 'basalt-ui/router-tanstack'
import { NAV } from '../../lib/nav'
import { readingQueries } from '../../lib/queries/reading'

/**
 * `sidebarBlocks` for `BasaltShell` — declared DATA, never a `ReactNode` slot (basalt-ui 1.26.0,
 * law C13), which is what lets basalt own the projections: a dot on the collapsed rail's icon and
 * one row in the mobile More sheet that opens a nested sheet of the items.
 *
 * ONE block today, and it is the canonical "awaiting action" shape: reading activity we could not
 * auto-link to a Hardcover book. It is the only sidebar-worthy list argo has — a count that means
 * "do something", small, and already fetched by the Reading page. Today's-events and
 * important-M365 are deliberately NOT blocks: both already carry a nav BADGE, and the same number
 * twice in one sidebar is one number too many.
 *
 * Returns an EMPTY array when nothing is awaiting action, so a clean shelf costs no sidebar rows
 * (law C14). `retry: false` for the same reason `useSidebarBadges` uses it: an always-on sidebar
 * query must not hammer an upstream that is down in local dev.
 */
export function useSidebarBlocks(): SidebarBlock[] {
  const navigate = useNavigate()
  const { data } = useQuery({ ...readingQueries.unmatched(), retry: false })

  const unmatched = data?.unmatched ?? []
  if (unmatched.length === 0) return []

  const openReading = () => {
    void navigate(navTarget(NAV, 'reading'))
  }

  return [
    {
      kind: 'list',
      key: 'unmatched-books',
      label: 'Unmatched books',
      count: unmatched.length,
      // Five rows, then a "Show more" toggle — the sidebar is navigation, not the page.
      max: 5,
      items: unmatched.map((row) => ({
        key: row.bookKey,
        label: row.readingTitle ?? row.bookKey,
        meta: `${Math.round(row.currentPercent)}%`,
        onClick: openReading,
      })),
      placement: 'nav',
      rail: 'dot',
      mobile: 'more',
    },
  ]
}
