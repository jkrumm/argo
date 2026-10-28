/**
 * Which wallets the page shows, derived from the registry and the data. A subscription with no usage
 * and no quota sample in the range has no card and no series (a third account before its first
 * login); every IU API key always has one (its cap is worth showing at $0); Me API appears only once its range total reaches a dollar. No
 * React, no queries.
 */
import { IU_KEY_WALLETS, ME_API, SUB_WALLETS, type SubWallet, type Wallet } from './accounts'
import { SHOW_AT_USD } from './split-model'

type Total = { payer: string; cost: number; fresh: number }

/**
 * The subscriptions with something to show: usage in the range (`totals`, from `/usage/split`) or a
 * quota sample (`quotaAccounts`, the accounts the quota history names). Registry order.
 */
export function liveSubscriptions(
  totals: readonly Total[],
  quotaAccounts: readonly string[],
): SubWallet[] {
  return SUB_WALLETS.filter((w) => {
    const total = totals.find((t) => t.payer === w.id)
    const used = total !== undefined && (total.cost > 0 || total.fresh > 0)
    return used || quotaAccounts.includes(w.account)
  })
}

/** The Overview's cards: live subscriptions, one per IU API key, and Me API once it reaches a dollar. */
export function liveWallets(totals: readonly Total[], quotaAccounts: readonly string[]): Wallet[] {
  const meApi = totals.find((t) => t.payer === ME_API.id)
  return [
    ...liveSubscriptions(totals, quotaAccounts),
    ...IU_KEY_WALLETS,
    ...(meApi !== undefined && meApi.cost >= SHOW_AT_USD ? [ME_API] : []),
  ]
}

/** Up to four cards share a row; more split into two even rows (5 → 3 + 2) rather than leave one alone. */
export const cardsPerRow = (cards: number): number =>
  cards <= 4 ? Math.max(cards, 1) : Math.ceil(cards / 2)
