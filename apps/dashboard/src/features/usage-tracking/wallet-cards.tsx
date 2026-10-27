/**
 * The Overview's first row: one card per wallet. Each card owns its scale, because the wallets differ
 * ~25× in dollars and a shared axis would bury the small one. It reads top to bottom as: how much
 * (the dollars at API prices with the change against the window before), how many tokens (fresh,
 * with the cache-read beside it), when (a daily sparkline in the wallet's hue), where (the project
 * and tool that hold most of it) and the limit meter. The card opens its wallet tab.
 */
import { Box, Button, Stack, Text } from '@mantine/core'
import { ChartCard, Sparkline } from 'basalt-ui/charts'
import type { SplitRow, SplitTotal } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { usageStore, type UsageLens } from '../../lib/window-stores'
import { dollarWord, walletOf, type CardWallet } from './accounts'
import { colorForPayer, bucketToDate } from './constants'
import { ChangeBadge } from './change-badge'
import { WalletMeter } from './limits'
import {
  dropPartialBucket,
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  periodNoun,
  shortDay,
  tokensFormatterFor,
} from './model'
import { change } from './period-model'
import { measureOf, mostlyOf, type Mostly } from './split-model'

type Buckets = ReadonlyArray<{ bucket: string; groups: Record<string, number | null> }>

const SPARK_HEIGHT = 40

const part = (m: Mostly) => `${m.key} ${fmtShare(m.share)}`

function MostlyLine({ project, tool }: { project: Mostly | null; tool: Mostly | null }) {
  if (project === null && tool === null) return null
  return (
    <Text size="xs" c="dimmed">
      mostly{' '}
      {[project, tool]
        .filter((m) => m !== null)
        .map(part)
        .join(' · ')}
    </Text>
  )
}

export function WalletCard({
  wallet,
  total,
  projects,
  tools,
  daily,
  lens,
  range,
  now,
}: {
  wallet: CardWallet
  total: SplitTotal | undefined
  projects: readonly SplitRow[]
  tools: readonly SplitRow[]
  daily: Buckets
  lens: UsageLens
  range: '7d' | '30d' | '90d' | 'all'
  now: number
}) {
  const [, setView] = usageStore.field.view.use()
  const tab = walletOf(wallet.id)
  const word = dollarWord(wallet.kind)
  const polarity = wallet.kind === 'api' ? 'up-bad' : 'neutral'
  const empty =
    shotState() === 'empty' || total === undefined || (total.cost <= 0 && total.fresh <= 0)
  const walletTotal = total === undefined ? 0 : measureOf(total, lens)

  const points = daily.map((b) => ({
    date: bucketToDate(b.bucket),
    value: b.groups[wallet.id] ?? 0,
  }))
  const drawn = dropPartialBucket(points, now, 'day')
  const peak = drawn.reduce((max, p) => Math.max(max, p.value), 0)
  const format = lens === 'cost' ? fmtUsdWhole : tokensFormatterFor(peak)

  return (
    <Box data-shot={`wallet-${wallet.id}`} data-shot-states="empty">
      <ChartCard
        title={wallet.plan === null ? wallet.title : `${wallet.title} ${wallet.plan}`}
        subtitle={wallet.who}
        placeholderHeight="content"
        actions={
          tab ? (
            <Button
              variant="subtle"
              size="compact-xs"
              aria-label={`Open the ${tab.title} tab`}
              onClick={() => setView(tab.id)}
            >
              Open
            </Button>
          ) : undefined
        }
        state={{ empty: empty && 'No usage in this window' }}
        {...(empty || total === undefined
          ? {}
          : {
              facts: {
                value: fmtUsdWhole(total.cost),
                period: [word, periodNoun(range)],
                comparison: (
                  <ChangeBadge
                    change={change(total.cost, total.prior === null ? null : total.prior.cost)}
                    polarity={polarity}
                  />
                ),
              },
            })}
      >
        {total === undefined ? null : (
          <Stack gap="sm">
            {tab ? <WalletMeter wallet={tab} titled={false} /> : null}
            <Text size="sm">
              {fmtTokens(total.fresh)} fresh{' '}
              <Text component="span" inherit c="dimmed">
                · {fmtTokens(total.cacheRead)} cache-read
              </Text>
            </Text>
            <Sparkline
              ariaLabel={`${wallet.title} ${lens === 'cost' ? word : 'fresh tokens'} per day, ${periodNoun(range)}`}
              data={drawn.map((p) => p.value)}
              labels={drawn.map((p) => shortDay(p.date))}
              height={SPARK_HEIGHT}
              mark="bar"
              color={colorForPayer(wallet.id)}
              emphasizeLast={false}
              format={format}
            />
            <MostlyLine
              project={mostlyOf(projects, wallet.id, walletTotal, lens)}
              tool={mostlyOf(tools, wallet.id, walletTotal, lens)}
            />
          </Stack>
        )}
      </ChartCard>
    </Box>
  )
}
