/**
 * The Quotas tab's verdict: one sentence over the four cards (will the Claude API credit be spent before
 * it expires, do the subscriptions last to their resets, and did Claude work land on the IU key). It is
 * state, not a range: "now" and the billing cycle, so it ignores the page Range and says so in its first
 * line. The credit words are `flow-model.ts`'s over `/usage/pace`; the subscription clause is the card's.
 */
import { Fragment } from 'react'
import { useSuspenseQueries } from '@tanstack/react-query'
import { Badge, Box, Text } from '@mantine/core'
import { PageSummary } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { usageQueries } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import { verdictOf, type SentencePart } from './flow-model'
import { QUOTA_WINDOW_HOURS, quotaDrain, quotaInputs } from './quotas-model'

const REFRESH_MS = 5 * 60_000

const Sentence = ({ parts }: { parts: readonly SentencePart[] }) => (
  <>
    {parts.map((p, i) => (
      <Fragment key={i}>
        {p.tone === 'warn' ? (
          <Text span inherit c={VX.status.warn}>
            {p.text}
          </Text>
        ) : (
          p.text
        )}
      </Fragment>
    ))}
  </>
)

export function VerdictBand() {
  const now = useNow()
  const [pace, quota, latest] = useSuspenseQueries({
    queries: [
      { ...usageQueries.pace(), refetchInterval: REFRESH_MS },
      { ...usageQueries.quota(QUOTA_WINDOW_HOURS), refetchInterval: REFRESH_MS },
      { ...usageQueries.quotaLatest(), refetchInterval: REFRESH_MS },
    ],
  })
  const verdict = verdictOf(pace.data)
  const subs = quotaDrain(quotaInputs(quota.data, latest.data), now)
  const atRisk = subs.accounts.some((a) => a.status === 'runs-out' || a.status === 'limit')
  const risky = subs.accounts.filter((a) => a.status === 'runs-out' || a.status === 'limit')
  const subClause: SentencePart = atRisk
    ? {
        text: `Subscriptions: ${risky.map((a) => a.label).join(', ')} ${risky.length === 1 ? 'runs' : 'run'} out before the reset.`,
        tone: 'warn',
      }
    : { text: 'Subscriptions last to their resets.' }

  return (
    <Box data-shot="quotas-sentence">
      <PageSummary
        sentence={
          <>
            <Sentence parts={verdict.sentence} /> <Sentence parts={[subClause]} />{' '}
            <Sentence parts={[verdict.iuClause]} />
          </>
        }
        facts={[
          `Quotas · ${verdict.asOf}`,
          <Badge
            key="state"
            variant="outline"
            color={verdict.state === 'over' ? VX.status.warn : VX.muted}
          >
            {verdict.badge}
          </Badge>,
          verdict.thin === null ? null : (
            <Badge key="thin" variant="dot" color={VX.muted}>
              Thin · {verdict.thin}
            </Badge>
          ),
        ]}
      />
    </Box>
  )
}
