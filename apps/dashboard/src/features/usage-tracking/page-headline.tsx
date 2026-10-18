import { useQuery } from '@tanstack/react-query'
import { relativeTime } from 'basalt-ui/format'
import { PageSummary } from '../../components/upstream/page-summary'
import { usageQueries } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import { freshnessWord, summaryFacts, summarySentence } from './model'

/** `relativeTime` against the shared clock, or null when the feed has no record. */
function age(iso: string | null | undefined, now: number): string | null {
  if (iso === null || iso === undefined) return null
  return relativeTime(new Date(iso), { now })
}

/** The page's opening: 30 d spend as the sentence, the rest as facts, freshness as a word. */
export function UsageHeadline() {
  const { data, isPending } = useQuery(usageQueries.headline())
  const now = useNow()
  if (isPending) return <PageSummary sentence="" loading />
  if (data === undefined) return <PageSummary sentence="Usage headline unavailable" />
  return (
    <PageSummary
      sentence={summarySentence({ cost30d: data.costUsd30d, cost7d: data.costUsd7d })}
      facts={summaryFacts({
        tokens30d: data.tokens30d,
        errorRate30d: data.calls30d === 0 ? null : data.errorRate30d,
        sources: data.sourcesActive,
        lastEvent: age(data.maxTs, now),
      })}
      aside={freshnessWord(data.maxTs, now)}
    />
  )
}
