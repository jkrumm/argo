/**
 * What a section of a tab covers: the payers it filters by, what its dollars are called and the ink
 * it draws in. The Overview covers every wallet, the Claude Max tab one subscription or all of them,
 * the IU API tab one API key. The one shape the shared sections (rhythm, over time, ranked lists,
 * figures) take instead of a wallet.
 */
import type { UsageIuKey } from '../../lib/window-stores'
import { IU_API, IU_KEY_WALLETS, type KeyWallet, type PayerValue } from './accounts'
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

/** A scope that always filters by payer: the IU API tab's, whose payers are the keys it covers. */
export type PayerScope = Scope & { payers: PayerValue[] }

/** The IU API key wallet a selection names; anything unregistered reads as the personal key's. */
export const selectedKeyWallet = (key: UsageIuKey): KeyWallet =>
  IU_KEY_WALLETS.find((w) => w.iuKey === key) ?? IU_API

/**
 * The IU API tab's selection: always one API key's wallet (its payer). Two keys are two wallets with
 * two caps, so no view of the tab ever adds them up. The personal key keeps the id `iu-api`.
 */
export function iuKeyScope(key: UsageIuKey): PayerScope {
  const one = selectedKeyWallet(key)
  return {
    id: one.id,
    title: one.title,
    payers: [one.id],
    word: 'spend',
    polarity: 'up-bad',
    color: colorForPayer(one.id),
  }
}
