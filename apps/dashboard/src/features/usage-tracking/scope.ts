/**
 * What a section of a tab covers: the payers it filters by, what its dollars are called and the ink
 * it draws in. The Overview covers every wallet, the Claude Max tab one subscription or all of them,
 * the IU API tab one API key or both. The one shape the shared sections (rhythm, over time, ranked lists,
 * figures) take instead of a wallet.
 */
import { VX } from 'basalt-ui/tokens'
import type { UsageIuKey } from '../../lib/window-stores'
import { IU_KEY_WALLETS, type KeyWallet, type PayerValue, type SubWallet } from './accounts'
import { colorForPayer } from './constants'

export type Scope = {
  /** Anchors and keys. */
  id: string
  title: string
  /** The payer filter; `undefined` = no constraint. */
  payers: PayerValue[] | undefined
  /** What `$` means here. */
  word: 'list value' | 'spend' | '$ at API prices'
  /** Dollars rising is the worse reading only for metered spend. */
  polarity: 'up-bad' | 'neutral'
  color: string
}

/** Every wallet: subscription dollars are list value, API dollars spend, both at API prices. */
export const ALL_WALLETS: Scope = {
  id: 'all',
  title: 'All wallets',
  payers: undefined,
  word: '$ at API prices',
  polarity: 'neutral',
  color: VX.line,
}

/** A scope that always filters by payer: the IU API tab's, whose payers are the keys it covers. */
export type PayerScope = Scope & { payers: PayerValue[] }

/** The IU API key wallets a selection covers, in registry order. */
export const selectedKeyWallets = (key: UsageIuKey): KeyWallet[] =>
  IU_KEY_WALLETS.filter((w) => key === 'all' || w.iuKey === key)

/**
 * The IU API tab's selection: one API key's wallet (its payer), or every key when `key` is `all`
 * (the records views sum them; the caps never do). The personal key keeps the id `iu-api`.
 */
export function iuKeyScope(key: UsageIuKey): PayerScope {
  const wallets = selectedKeyWallets(key)
  const [one, ...rest] = wallets
  if (one !== undefined && rest.length === 0) {
    return {
      id: one.id,
      title: one.title,
      payers: [one.id],
      word: 'spend',
      polarity: 'up-bad',
      color: colorForPayer(one.id),
    }
  }
  return {
    id: 'iu-keys',
    title: 'IU API',
    payers: wallets.map((w) => w.id),
    word: 'spend',
    polarity: 'up-bad',
    color: VX.line,
  }
}

/** The Claude Max tab's selection: the chosen subscription, or every live one when `account` is `all`. */
export function claudeScope(subs: readonly SubWallet[], account: string): Scope {
  const one = subs.find((s) => s.account === account)
  return {
    id: one === undefined ? 'claude' : `claude-${one.account}`,
    title: one === undefined ? 'Claude Max' : one.title,
    payers: (one === undefined ? subs : [one]).map((s) => s.id),
    word: 'list value',
    polarity: 'neutral',
    color: one === undefined ? VX.line : colorForPayer(one.id),
  }
}

/** The subscriptions a Claude Max selection covers. */
export const selectedSubs = (subs: readonly SubWallet[], account: string): SubWallet[] =>
  subs.filter((s) => account === 'all' || s.account === account)
