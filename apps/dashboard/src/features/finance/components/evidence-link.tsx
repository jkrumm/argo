import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { ReportSentence } from '../api/types'
import { isMonth } from '../lib/months'
import { FILTERS_CLEARED } from '../../../lib/window-stores'
import type { FinanceFilters as Filters } from '../../../lib/window-stores'

const MAX_TEXT = 120

const isYear = (value: string): boolean => /^\d{4}$/.test(value)
const isText = (value: string): boolean => value.length <= MAX_TEXT

/** Per filter, what a value must look like to be used. */
const VALID: Record<keyof Filters, (value: string) => boolean> = {
  from: isMonth,
  to: isMonth,
  year: isYear,
  category: isText,
  merchant: isText,
  search: isText,
  event: isText,
  focus: isText,
}

/**
 * The filters of an evidence link: exactly what the evidence names, nothing carried over from the
 * page it sits on, and only values that pass their check.
 */
function evidenceFilters(evidence: Record<string, string> | undefined): Filters {
  const filters = { ...FILTERS_CLEARED }
  for (const key of Object.keys(VALID) as (keyof Filters)[]) {
    const value = evidence?.[key]
    if (typeof value === 'string' && VALID[key](value)) filters[key] = value
  }
  return filters
}

type EvidenceLinkProps = {
  link: ReportSentence['link']
  children: ReactNode
}

/**
 * A report sentence's evidence: the server names a route and search params, the router wants typed
 * targets, so each known route is spelled out. An unknown route renders no link rather than a dead one.
 */
export function EvidenceLink({ link, children }: EvidenceLinkProps) {
  if (link === null) return null
  const search = evidenceFilters(link.search)
  const month = /^\/month\/(\d{4}-\d{2})$/.exec(link.to)?.[1]
  if (month !== undefined && isMonth(month)) {
    return (
      <Link to="/finance/month/$month" params={{ month }} search={search}>
        {children}
      </Link>
    )
  }
  switch (link.to) {
    case '/':
      return (
        <Link to="/finance" search={search}>
          {children}
        </Link>
      )
    case '/spending':
      return (
        <Link to="/finance/spending" search={search}>
          {children}
        </Link>
      )
    case '/fixed':
      return (
        <Link to="/finance/fixed" search={search}>
          {children}
        </Link>
      )
    case '/events':
      return (
        <Link to="/finance/events" search={search}>
          {children}
        </Link>
      )
    case '/net-worth':
      return (
        <Link to="/finance/net-worth" search={search}>
          {children}
        </Link>
      )
    case '/transactions':
      return (
        <Link to="/finance/transactions" search={search}>
          {children}
        </Link>
      )
    case '/tax':
      return (
        <Link to="/finance/tax" search={search}>
          {children}
        </Link>
      )
    default:
      return null
  }
}
