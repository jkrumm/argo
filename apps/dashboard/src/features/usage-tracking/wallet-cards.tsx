/**
 * The Overview's first row: one card per wallet. Each card owns its scale, because the wallets differ
 * ~25× in dollars and a shared axis would bury the small one. It reads top to bottom as: who pays,
 * the limit meter, two equal figures (dollars at API prices left, fresh tokens right, each with the change
 * against the window before and the cache-read under the tokens), when (a daily sparkline in the
 * wallet's hue) and where (the project and tool that hold most of it). The card opens its tab.
 */
import type { ReactNode } from 'react'
import { Box, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { ChartCard, Sparkline } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import type { SplitRow, SplitTotal } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { usageStore, type UsageLens } from '../../lib/window-stores'
import { dollarWord, type Wallet } from './accounts'
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
  tokensQuantity,
  usdFormatterFor,
} from './model'
import { change } from './period-model'
import classes from './usage.module.css'
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

/** One of the card's two equal figures: caption, the figure and its unit, the change, a note under it. */
function Figure({
  caption,
  value,
  unit,
  delta,
  note,
}: {
  caption: string
  value: string
  unit?: string | undefined
  delta: ReactNode
  note?: string | undefined
}) {
  return (
    <Stack gap={2} miw={0}>
      <Text size="xs" c="dimmed">
        {caption}
      </Text>
      <Group gap={4} align="baseline" wrap="nowrap">
        <Text fz={VX.text.xl} fw={600} lh={1.1} ff="monospace">
          {value}
        </Text>
        {unit === undefined ? null : (
          <Text size="xs" c="dimmed">
            {unit}
          </Text>
        )}
      </Group>
      <Text size="xs" c="dimmed" component="div">
        {delta}
      </Text>
      {note === undefined ? null : (
        <Text size="xs" c="dimmed">
          {note}
        </Text>
      )}
    </Stack>
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
  wallet: Wallet
  total: SplitTotal | undefined
  projects: readonly SplitRow[]
  tools: readonly SplitRow[]
  daily: Buckets
  lens: UsageLens
  range: '7d' | '30d' | '90d' | 'all'
  now: number
}) {
  const [, setView] = usageStore.field.view.use()
  const [, setAccount] = usageStore.field.account.use()
  const [, setIuKey] = usageStore.field.iuKey.use()
  const word = dollarWord(wallet.kind)
  const polarity = wallet.kind === 'api' ? 'up-bad' : 'neutral'
  const fresh = tokensQuantity(total?.fresh ?? 0)
  const noUsage = total === undefined || (total.cost <= 0 && total.fresh <= 0)
  const shotEmpty = shotState() === 'empty'
  const walletTotal = total === undefined ? 0 : measureOf(total, lens)
  const period = periodNoun(range)

  const points = daily.map((b) => ({
    date: bucketToDate(b.bucket),
    value: b.groups[wallet.id] ?? 0,
  }))
  const drawn = dropPartialBucket(points, now, 'day', (p) => p.value)
  const peak = drawn.reduce((max, p) => Math.max(max, p.value), 0)
  const format = lens === 'cost' ? usdFormatterFor(peak) : tokensFormatterFor(peak)

  const open = () => {
    if (wallet.kind === 'sub') {
      setAccount(wallet.account)
      setView('claude')
      return
    }
    // An IU API key's card opens the IU API tab on that key; Me API has no tab.
    if (wallet.iuKey !== null) setIuKey(wallet.iuKey)
    setView('iu-api')
  }
  const canOpen = wallet.id !== 'me-api'

  return (
    <Box data-shot={`wallet-${wallet.id}`} data-shot-states="empty" h="100%">
      <ChartCard
        className={classes.fill}
        title={wallet.plan === null ? wallet.title : `${wallet.title} ${wallet.plan}`}
        placeholderHeight="content"
        actions={
          canOpen ? (
            <Button
              variant="subtle"
              size="compact-xs"
              aria-label={`Open the ${wallet.kind === 'sub' ? 'Claude Max' : wallet.title} tab`}
              onClick={open}
            >
              Open
            </Button>
          ) : undefined
        }
        state={{ empty: shotEmpty && 'No usage in this window' }}
      >
        <Stack gap="sm">
          <Text size="xs" c="dimmed">
            {wallet.who}
          </Text>
          {canOpen ? <WalletMeter wallet={wallet} heading="window" /> : null}
          {noUsage || total === undefined ? (
            <Text size="sm" c="dimmed">
              No usage in this window
            </Text>
          ) : (
            <>
              <SimpleGrid cols={2} spacing="sm">
                <Figure
                  caption={`${word} · ${period}`}
                  value={fmtUsdWhole(total.cost)}
                  delta={
                    <ChangeBadge
                      change={change(total.cost, total.prior === null ? null : total.prior.cost)}
                      polarity={polarity}
                    />
                  }
                />
                <Figure
                  caption={`fresh tokens · ${period}`}
                  value={fresh.value}
                  unit={fresh.unit === '' ? undefined : fresh.unit}
                  delta={
                    <ChangeBadge
                      change={change(total.fresh, total.prior === null ? null : total.prior.fresh)}
                      polarity="neutral"
                    />
                  }
                  note={`+ ${fmtTokens(total.cacheRead)} cache-read`}
                />
              </SimpleGrid>
              <Sparkline
                ariaLabel={`${wallet.title} ${lens === 'cost' ? word : 'fresh tokens'} per day, ${period}`}
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
            </>
          )}
        </Stack>
      </ChartCard>
    </Box>
  )
}
