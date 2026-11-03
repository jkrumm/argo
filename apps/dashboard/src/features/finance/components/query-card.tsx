import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ChartCard } from 'basalt-ui/charts'
import type { ChartFact } from 'basalt-ui/charts'

type QueryCardProps = {
  title: string
  info?: string
  query: Pick<UseQueryResult, 'isPending' | 'error' | 'refetch' | 'isRefetching'>
  /** True (or the copy to show) when the query answered with nothing to draw. */
  empty: boolean | string
  facts?: ChartFact | readonly ChartFact[] | undefined
  ghost?: 'bars' | 'line'
  /** The card is not a chart (a ranked list): an error or empty state ends at its content. */
  content?: boolean
  actions?: ReactNode
  children: ReactNode
}

/**
 * A `ChartCard` whose state comes from the query: pending, failed (with Retry) or empty replaces the
 * body, the header stays. Every chart and ranked list of the dashboard goes through it.
 */
export function QueryCard({
  query,
  empty,
  facts,
  ghost,
  content = false,
  children,
  ...rest
}: QueryCardProps) {
  return (
    <ChartCard
      {...rest}
      facts={facts}
      state={{ pending: query.isPending, error: query.error ?? undefined, empty }}
      onRetry={() => void query.refetch()}
      retrying={query.isRefetching}
      {...(ghost !== undefined && { ghost })}
      {...(content && { placeholderHeight: 'content' as const })}
    >
      {children}
    </ChartCard>
  )
}
