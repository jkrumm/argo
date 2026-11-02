/**
 * One IU key's cap in a card of its own: the rolling 30-day meter against the key's $500 cap (the
 * portal's figure; the tick marks 80 %), can spend today, and the date the key falls back under the
 * cap. A key IU's portal has not reported for reads "No portal report for this key yet" and never a
 * meter drawn from tracked spend.
 */
import { Stack, Text } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { withUnit } from '../../lib/format'
import { shotState } from '../../lib/shot-state'
import type { KeyWallet } from './accounts'
import { iuKeyLimitInfo, underCapLine } from './iu-key-model'
import { WalletMeter, useKeyBudget } from './limits'
import classes from './usage.module.css'

export function IuKeyLimit({ wallet }: { wallet: KeyWallet }) {
  const { budget, missing } = useKeyBudget(wallet)
  const under =
    shotState() === 'empty' || missing || budget.data === undefined
      ? null
      : underCapLine(budget.data)

  return (
    <ChartCard
      className={classes.fill}
      title={`Limit · ${wallet.label} · ${withUnit('rolling 30', 'd')}`}
      info={iuKeyLimitInfo(wallet.label, !missing)}
      placeholderHeight="content"
    >
      <Stack gap="sm" data-shot={`limit-${wallet.id}`}>
        <WalletMeter wallet={wallet} heading="none" />
        {under === null ? null : (
          <Text size="sm" c="dimmed" data-shot={`under-cap-${wallet.id}`}>
            {under}
          </Text>
        )}
      </Stack>
    </ChartCard>
  )
}
