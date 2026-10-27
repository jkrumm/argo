/**
 * One wallet's figures, a strip of four from `/usage/split` totals: dollars at API prices (list
 * value for a subscription, spend for the API) and fresh tokens, each with the change against the
 * equally long window before, then the cache-read and output tokens beside them.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { StatGroup, type StatStripCell } from 'basalt-ui'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { dollarWord, type Wallet } from './accounts'
import { ChangeBadge } from './change-badge'
import { fmtUsdWhole, periodNoun, tokensQuantity } from './model'
import { change } from './period-model'
import { totalOf } from './split-model'
import type { WorkspaceValue } from './types'

const FRESH_INFO =
  'Tokens the models newly processed over the range: input, output, cache-write and reasoning. Tokens re-read from the cache are the next cell.'
const CACHE_INFO =
  'Tokens re-read from the prompt cache across every call, billed at a fraction of input. Most of the volume, and it grows with every agent turn.'
const OUTPUT_INFO = 'Tokens the models wrote, reasoning included: the real work.'

const tokenCell = (n: number): Pick<StatStripCell, 'value' | 'unit'> => {
  const q = tokensQuantity(n)
  return { value: q.value, unit: q.unit ? `${q.unit} tokens` : 'tokens' }
}

export function WalletFigures({
  wallet,
  range,
  workspace,
}: {
  wallet: Wallet
  range: Range
  workspace: WorkspaceValue[] | undefined
}) {
  const query = useSuspenseQuery(
    usageQueries.split({ by: 'project', range, lens: 'cost', payer: [wallet.id], workspace }),
  )
  const total = shotState() === 'empty' ? undefined : totalOf(query.data.totals, wallet.id)
  const period = periodNoun(range)
  const word = dollarWord(wallet.kind)
  const dollars = total?.prior === null || total === undefined ? null : total.prior.cost
  const fresh = total?.prior === null || total === undefined ? null : total.prior.fresh
  const reason = 'No usage in this window'
  const state = total === undefined ? ({ kind: 'empty', reason } as const) : undefined

  const cells: StatStripCell[] = [
    {
      key: 'dollars',
      caption: word === 'spend' ? 'Spend' : 'List value',
      qualifier: period,
      info:
        wallet.kind === 'sub'
          ? 'What the usage would cost at API prices over the range. The subscription is flat: this was never charged.'
          : 'API spend over the range: money paid, priced per row from the tokens.',
      value: total === undefined ? null : fmtUsdWhole(total.cost),
      delta:
        total === undefined ? undefined : (
          <ChangeBadge
            change={change(total.cost, dollars)}
            polarity={wallet.kind === 'api' ? 'up-bad' : 'neutral'}
            period={range === 'all' ? undefined : `prior ${period}`}
          />
        ),
      ...(state ? { state } : {}),
    },
    {
      key: 'fresh',
      caption: 'Fresh tokens',
      qualifier: period,
      info: FRESH_INFO,
      ...(total === undefined ? { value: null } : tokenCell(total.fresh)),
      delta:
        total === undefined ? undefined : (
          <ChangeBadge
            change={change(total.fresh, fresh)}
            polarity="neutral"
            period={range === 'all' ? undefined : `prior ${period}`}
          />
        ),
      ...(state ? { state } : {}),
    },
    {
      key: 'cache',
      caption: 'Cache-read',
      qualifier: period,
      info: CACHE_INFO,
      ...(total === undefined ? { value: null } : tokenCell(total.cacheRead)),
      ...(state ? { state } : {}),
    },
    {
      key: 'output',
      caption: 'Output',
      qualifier: period,
      info: OUTPUT_INFO,
      ...(total === undefined ? { value: null } : tokenCell(total.output)),
      ...(state ? { state } : {}),
    },
  ]

  return (
    <Box data-shot={`figures-${wallet.id}`} data-shot-states="empty">
      <StatGroup variant="strip" label={`${wallet.title} over ${period}`} cols={4} cells={cells} />
    </Box>
  )
}
