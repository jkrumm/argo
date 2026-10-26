/**
 * The page's opening: how much was spent and how many tokens were used in the range, each with its
 * change against the equally long period before. Both come from one day-grain series per figure, so
 * the delta and the total read the same buckets. Under the all-payer scope the dollars split into API
 * spend (money paid) and Max list value (what the plans would have cost, never paid).
 */
import { useSuspenseQueries } from '@tanstack/react-query'
import { StatGroup, type StatStripCell } from 'basalt-ui'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import type { UsageScope } from '../../lib/window-stores'
import { scopePayers } from './budget-model'
import { fmtUsdWhole, periodNoun, tokensQuantity } from './model'
import { change, periodSums, priorRange, sumOf } from './period-model'
import { ChangeBadge } from './change-badge'
import type { WorkspaceValue } from './types'

const SPEND_INFO =
  'Dollars over the range against the period before. API spend is money paid; Max list value is what the subscription usage would have cost at API prices, and was never paid. Complete days only: today is left out so it does not read as a drop.'
const TOKENS_INFO =
  'Tokens the models read as fresh input and wrote as output or cache-write over the range, against the period before. Tokens re-read from the cache are left out: they are most of the volume and cost a fraction. Complete days only: today is left out so it does not read as a drop.'

const sumKeys = (m: ReadonlyMap<string, number>, keys: readonly string[]): number =>
  keys.reduce((a, k) => a + (m.get(k) ?? 0), 0)

export function Headline({
  range,
  scope,
  workspace,
}: {
  range: Range
  scope: UsageScope
  workspace: WorkspaceValue[] | undefined
}) {
  const base = {
    range: priorRange(range),
    grain: 'day',
    payer: scopePayers(scope),
    workspace,
  } as const
  const [cost, tokens] = useSuspenseQueries({
    queries: [
      usageQueries.timeseries({ ...base, metric: 'cost', groupBy: 'payer' }),
      usageQueries.timeseries({ ...base, metric: 'tokens', groupBy: 'none' }),
    ],
  })
  const now = useNow()
  const costSums = periodSums(cost.data.buckets, range, now)
  const tokenSums = periodSums(tokens.data.buckets, range, now)
  const spend = sumOf(costSums.current) ?? 0
  const fresh = sumOf(tokenSums.current) ?? 0
  const period = periodNoun(range)
  const vs = range === 'all' ? undefined : `prior ${period}`
  const spendDelta = change(spend, sumOf(costSums.prior))
  const tokenDelta = change(fresh, sumOf(tokenSums.prior))
  const qty = tokensQuantity(fresh)
  const api = sumKeys(costSums.current, ['iu-api', 'me-api'])
  const max = sumKeys(costSums.current, ['iu-sub', 'me-sub'])
  const split = scope === 'all' && max > 0

  const cells: StatStripCell[] = [
    {
      key: 'spend',
      caption: split ? 'Spend + list value' : 'Spend',
      qualifier: period,
      info: SPEND_INFO,
      value: fmtUsdWhole(spend),
      delta:
        spendDelta === null ? undefined : (
          <ChangeBadge change={spendDelta} polarity="up-bad" period={vs} />
        ),
      ...(split ? { footer: `${fmtUsdWhole(api)} API · ${fmtUsdWhole(max)} Max list value` } : {}),
    },
    {
      key: 'tokens',
      caption: 'Tokens',
      qualifier: period,
      info: TOKENS_INFO,
      value: qty.value,
      unit: qty.unit ? `${qty.unit} tokens` : 'tokens',
      delta:
        tokenDelta === null ? undefined : (
          <ChangeBadge change={tokenDelta} polarity="neutral" period={vs} />
        ),
      footer: 'fresh tokens, cache-read not counted',
    },
  ]

  return <StatGroup variant="strip" label={`Usage over ${period}`} cols={2} cells={cells} />
}
