/**
 * What a section of a tab covers: the payers it filters by, what its dollars are called and the ink
 * it draws in. The Overview covers every wallet, the Claude Max tab one subscription or all of them,
 * the IU API tab its own wallet. The one shape the shared sections (rhythm, over time, ranked lists,
 * figures) take instead of a wallet.
 */
import { VX } from 'basalt-ui/tokens'
import { IU_API, type PayerValue, type SubWallet } from './accounts'
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

export const IU_API_SCOPE: Scope = {
  id: IU_API.id,
  title: IU_API.title,
  payers: [IU_API.id],
  word: 'spend',
  polarity: 'up-bad',
  color: colorForPayer(IU_API.id),
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
