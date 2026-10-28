/**
 * The two limit meters, shared by the Overview's wallet cards and the wallet tabs: a Max
 * subscription's weekly quota (with a pace tick at the share of the week already elapsed) and an IU
 * API key's rolling 30-day cap (each key has its own, never summed). Each is a single meter, its percentage and its reset or headroom in one
 * line. A missing, failed or old reading is a state of its own, never an empty meter that reads as
 * headroom; the ink turns at 80 % and 100 %.
 */
import { useQuery } from '@tanstack/react-query'
import { Group, Stack, Text } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import { usageQueries, type IuBudget, type QuotaLatest } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { isKeyWallet, type KeyWallet, type SubWallet, type Wallet } from './accounts'
import {
  accountTitle,
  answersKey,
  budgetReading,
  freshnessBadge,
  noPortalNote,
  quotaReading,
  type CapState,
  type QuotaReading,
} from './budget-model'
import { fmtUsdWhole } from './model'
import { totalOf } from './split-model'

const WARN_AT = 0.8

const STATE_INK: Record<CapState, string | undefined> = {
  ok: undefined,
  warn: VX.status.warn,
  over: VX.status.bad,
}

const pctText = (v: number) => withUnit(Math.round(v), '%')

/** `71 %`, and the state word once it is past ok: `91 % · warn`. */
function pctCaption(reading: QuotaReading): string | null {
  if (reading.pct === null) return null
  return reading.state === null || reading.state === 'ok'
    ? pctText(reading.pct)
    : `${pctText(reading.pct)} · ${reading.state}`
}

/** A cell's title row; the marker is a freshness word that earns an ink when it is not fine. */
function Heading({
  title,
  marker,
  tone,
}: {
  title: string
  marker?: string | null | undefined
  tone?: 'warn' | 'bad' | undefined
}) {
  if (title === '' && !marker) return null
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="sm" fw={500}>
        {title}
      </Text>
      {marker ? (
        <Text size="xs" fw={600} c={tone === 'bad' ? VX.status.bad : VX.status.warn}>
          {marker}
        </Text>
      ) : null}
    </Group>
  )
}

/** `titled={false}`: the card around it already names the wallet, so only a freshness marker heads the meter. */
export function SubscriptionMeter({
  account,
  sample,
  now,
  titled = true,
}: {
  account: string
  sample: QuotaLatest | undefined
  now: number
  titled?: boolean
}) {
  const reading = quotaReading(sample, now)
  const ink = reading.state === null ? undefined : STATE_INK[reading.state]
  const caption = pctCaption(reading)
  const title = `Max ${accountTitle(account)} · ${withUnit(7, 'd')}`
  return (
    <Stack gap={4}>
      <Heading
        title={titled ? title : ''}
        marker={reading.status === 'stale' ? reading.note : null}
      />
      <Meter
        label={`${title} weekly quota used`}
        value={reading.pct}
        max={100}
        format={pctText}
        emptyText={reading.note ?? 'no reading'}
        {...(caption === null ? {} : { startCaption: caption })}
        {...(reading.resets === null ? {} : { endCaption: reading.resets })}
        {...(reading.pace === null ? {} : { ticks: [{ at: reading.pace * 100, label: 'pace' }] })}
        {...(ink === undefined ? {} : { color: ink })}
      />
    </Stack>
  )
}

/**
 * A key whose cap has no portal report yet: the cause and what is tracked so far, as plain lines.
 * Never a meter drawn from tracked spend: the portal is the cap's truth.
 */
function NoPortalReport({ trackedUsd, limitUsd }: { trackedUsd: number | null; limitUsd: number }) {
  const note = noPortalNote({ target: 'cap', trackedUsd, limitUsd })
  return (
    <Stack gap={2}>
      <Text size="sm" c="dimmed">
        {note.head}
      </Text>
      {note.tracked === null ? null : (
        <Text size="xs" c="dimmed">
          {note.tracked}
        </Text>
      )}
    </Stack>
  )
}

export function CapMeter({
  budget,
  now,
  title,
  titled = true,
}: {
  budget: IuBudget
  now: number
  /** The key's wallet name (`IU API`, `Athena team`). */
  title: string
  titled?: boolean
}) {
  const reading = budgetReading(budget, now)
  const badge = freshnessBadge(budget.fetchedAt, now)
  const ink = reading.state === null ? undefined : STATE_INK[reading.state]
  const stale = badge !== null && badge.tone !== 'muted'
  return (
    <Stack gap={4}>
      <Heading
        title={titled ? `${title} · ${withUnit('rolling 30', 'd')}` : ''}
        marker={stale ? badge.text : null}
        tone={badge?.tone === 'bad' ? 'bad' : 'warn'}
      />
      {reading.freshness === 'empty' ? (
        <NoPortalReport trackedUsd={null} limitUsd={budget.limitUsd} />
      ) : (
        <Meter
          label={`${title} spend over the rolling 30 days against the cap`}
          value={budget.rolling30Usd}
          max={budget.limitUsd}
          format={fmtUsdWhole}
          ticks={[{ at: budget.limitUsd * WARN_AT, label: withUnit(WARN_AT * 100, '%') }]}
          startCaption={reading.cap ?? ''}
          {...(reading.canSpend === null ? {} : { endCaption: reading.canSpend })}
          {...(ink === undefined ? {} : { color: ink })}
        />
      )}
    </Stack>
  )
}

/** A subscription's weekly quota meter: owns the quota query. */
function SubscriptionWalletMeter({ wallet, titled }: { wallet: SubWallet; titled: boolean }) {
  const quota = useQuery(usageQueries.quotaLatest())
  const now = useNow()
  const empty = shotState() === 'empty'

  if (quota.isError && !empty) {
    return (
      <Text size="sm" c={VX.status.bad}>
        Quota samples did not load
      </Text>
    )
  }
  if (quota.isPending && !empty) return <Meter label={`${wallet.title} weekly quota`} loading />
  const samples = empty ? [] : (quota.data?.accounts ?? [])
  return (
    <SubscriptionMeter
      account={wallet.account}
      sample={samples.find((s) => s.account === wallet.account)}
      now={now}
      titled={titled}
    />
  )
}

/**
 * One IU API key's cap answer, and whether IU's portal has reported for it: not when the answer names
 * another key, or carries no fetch (`fetchedAt` null). Owns the budget query of that key.
 */
export function useKeyBudget(wallet: KeyWallet) {
  const budget = useQuery(usageQueries.iuBudget(wallet.iuKey))
  const missing =
    budget.data !== undefined &&
    (!answersKey(budget.data, wallet.iuKey) || budget.data.fetchedAt === null)
  return { budget, missing }
}

/** An IU API key's rolling cap meter: its own budget query, fired for key wallets only. */
function KeyCapMeter({ wallet, titled }: { wallet: KeyWallet; titled: boolean }) {
  const { budget, missing } = useKeyBudget(wallet)
  const now = useNow()
  const empty = shotState() === 'empty'
  // Only a key without a portal report reads what is tracked: the rolling window of the cap.
  const tracked = useQuery({
    ...usageQueries.split({
      by: 'project',
      range: '30d',
      lens: 'cost',
      payer: [wallet.id],
      top: 2,
    }),
    enabled: missing,
  })

  if (budget.isError && !empty) {
    return (
      <Text size="sm" c={VX.status.bad}>
        The budget did not load
      </Text>
    )
  }
  if (budget.data === undefined)
    return <Meter label={`${wallet.title} spend against the cap`} loading />
  if (missing) {
    const trackedUsd =
      tracked.data === undefined ? null : (totalOf(tracked.data.totals, wallet.id)?.cost ?? null)
    return <NoPortalReport trackedUsd={trackedUsd} limitUsd={budget.data.limitUsd} />
  }
  return <CapMeter budget={budget.data} now={now} title={wallet.title} titled={titled} />
}

/**
 * The limit meter of a wallet: its subscription's weekly quota, or its IU API key's rolling cap. Each
 * meter owns its one query, mounted only for the wallets that have it (Me API has no meter); a failed
 * query is a line of its own and a pending one a skeleton, never a meter that reads as headroom.
 */
export function WalletMeter({ wallet, titled = true }: { wallet: Wallet; titled?: boolean }) {
  if (wallet.kind === 'sub') return <SubscriptionWalletMeter wallet={wallet} titled={titled} />
  if (isKeyWallet(wallet)) return <KeyCapMeter wallet={wallet} titled={titled} />
  return null
}
