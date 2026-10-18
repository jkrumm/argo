import { useQuery } from '@tanstack/react-query'
import { relativeTime } from 'basalt-ui/format'
import { Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import { PageSummary } from '../../components/upstream/page-summary'
import { usageQueries } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import { freshness, summaryFacts, summarySentence } from './model'

/** `relativeTime` against the shared clock, or null when the feed has no record. */
function age(iso: string | null | undefined, now: number): string | null {
  if (iso === null || iso === undefined) return null
  return relativeTime(new Date(iso), { now })
}

const STALE_INK = { warn: VX.status.warn, bad: VX.status.bad } as const

/** The page's opening: 7 d spend as the sentence, sources and last event as facts, freshness as a word. */
export function UsageHeadline() {
  const { data, isPending } = useQuery(usageQueries.headline())
  const now = useNow()
  if (isPending) return <PageSummary sentence="" loading />
  if (data === undefined) return <PageSummary sentence="Usage headline unavailable" />
  const fresh = freshness(data.maxTs, now)
  return (
    <PageSummary
      sentence={summarySentence({ cost7d: data.costUsd7d })}
      facts={summaryFacts({
        sources: data.sourcesActive,
        lastEvent: age(data.maxTs, now),
      })}
      aside={
        fresh.tone === 'warn' || fresh.tone === 'bad' ? (
          <Text component="span" inherit c={STALE_INK[fresh.tone]}>
            feed {fresh.word}
          </Text>
        ) : undefined
      }
    />
  )
}
