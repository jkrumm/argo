/**
 * The Flow tab's verdict: one sentence (will the credit be spent before it expires, and did Claude work
 * land on IU), a facts strip and the pace chart. It is state, not a range: "now" and the billing cycle,
 * so it ignores the page Range and says so in its first line. Everything is `flow-model.ts`'s words over
 * `/usage/pace`, the IU clause and its facts cell included (`claudeOnIuUsd`, since the cutover).
 */
import { Fragment } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Badge, Box, Stack, Text } from '@mantine/core'
import { PageSummary, StatGroup, type StatStripCell } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { usageQueries } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import { factsOf, verdictOf, type SentencePart } from './flow-model'
import { PaceChart } from './pace-chart'
import { paceModel } from './pace-model'

const CHART_HEIGHT = 260

const CHART_INFO =
  'Credit left per pool over its billing cycle. Solid: what happened (our meter against the provider’s report, the larger per day). Dashed: the projection at today’s production rate, flat until the router starts drawing on the pool. Dotted: the even pace that would spend the grant exactly at expiry. A shaded band is the stretch with no pool left, when Claude seats fall back to GPT on the IU personal key.'

const VERDICT_INFO = {
  left: 'The grant minus the larger of our meter and the provider’s report, summed over the enabled pools.',
  required:
    'Credit left divided by the days to expiry, per pool: the daily spend that uses all of it.',
  production:
    'Credit-eligible Claude demand per day over the last 7 days (evals excluded; they run on the reserve and can stop), clipped to the first gateway row.',
  iu: 'Everything the gateway billed to the IU personal key since its first row, and how much of it was fallback. Claude work on IU is drawn in the warn ink.',
  key: 'The IU personal key’s rolling 30-day spend against its $500 cap, from the portal, and the day it drops back under at the last 7 days’ mean.',
} as const

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
  const { data: pace } = useSuspenseQuery({ ...usageQueries.pace(), refetchInterval: 5 * 60_000 })
  const now = useNow()
  const verdict = verdictOf(pace)
  const cells: StatStripCell[] = factsOf(pace, now).map((f) => ({
    key: f.key,
    caption: f.caption,
    value: f.value,
    footer: f.footer,
    info: VERDICT_INFO[f.key as keyof typeof VERDICT_INFO],
    ...(f.tone === undefined ? {} : { tone: f.tone }),
  }))
  const model = paceModel(pace)

  return (
    <Stack gap="md">
      <Box data-shot="flow-sentence">
        <PageSummary
          sentence={
            <>
              <Sentence parts={verdict.sentence} /> <Sentence parts={[verdict.iuClause]} />
            </>
          }
          facts={[
            `Claude API credit · ${verdict.asOf}`,
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
      <Box data-shot="flow-facts">
        <StatGroup variant="strip" label="Claude API credit" cols={5} cells={cells} />
      </Box>
      <Box data-shot="flow-pace">
        <ChartCard
          title="Credit left per pool"
          subtitle="state now · the billing cycle, not the page range"
          info={CHART_INFO}
          placeholderHeight={CHART_HEIGHT}
          state={{ empty: model.lines.length === 0 && 'No credit pool enabled' }}
        >
          <PaceChart
            pace={pace}
            model={model}
            height={CHART_HEIGHT}
            cursorGroup="usage-flow-pace"
            ariaLabel="Credit left per pool over its billing cycle: actual, even pace to expiry and the projection at today’s rate"
          />
        </ChartCard>
      </Box>
    </Stack>
  )
}
