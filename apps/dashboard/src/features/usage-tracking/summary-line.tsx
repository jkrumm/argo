import { useQuery } from '@tanstack/react-query'
import { Skeleton, Text } from '@mantine/core'
import { usageQueries } from '../../lib/queries/usage'
import { relativeTime } from '../../lib/format'
import { useNow } from '../../lib/use-now'
import { footerLine, summarySentence } from './model'
import classes from './usage.module.css'

/** `relativeTime` against the shared clock, or null when the feed has no record. */
function age(iso: string | null | undefined, now: number): string | null {
  if (iso === null || iso === undefined) return null
  return relativeTime(new Date(iso), { now })
}

export function SummaryLine() {
  const { data, isPending } = useQuery(usageQueries.headline())
  const now = useNow()
  if (isPending) return <Skeleton height={20} width="60%" radius="sm" />
  if (data === undefined) {
    return (
      <Text size="sm" c="dimmed">
        Usage headline unavailable
      </Text>
    )
  }
  return (
    <Text size="sm" c="dimmed">
      {summarySentence({
        cost30d: data.costUsd30d,
        cost7d: data.costUsd7d,
        tokens30d: data.tokens30d,
        errorRate30d: data.calls30d === 0 ? null : data.errorRate30d,
        lastEvent: age(data.maxTs, now),
      })}
    </Text>
  )
}

export function FreshnessFooter() {
  const { data } = useQuery(usageQueries.headline())
  const now = useNow()
  if (data === undefined) return null
  const stale = data.maxTs !== null && (now - new Date(data.maxTs).getTime()) / 60_000 > 30
  return (
    <div className={classes.freshness}>
      <span className={stale ? `${classes.dot} ${classes.dotStale}` : classes.dot} />
      {footerLine({
        records: data.recordsTotal,
        sources: data.sourcesActive,
        lastEvent: age(data.maxTs, now),
      })}
      {stale ? ' · stale > 30 min' : ''}
    </div>
  )
}
