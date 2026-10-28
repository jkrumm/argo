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

/** Grid columns of the card row: divisible by 1–6, so every row of up to six cards splits evenly. */
export const WALLET_COLUMNS = 60

/**
 * The narrowest a wallet card may be: its two figures side by side and `+ 10.0 M cache-read` under
 * the tokens must not wrap or clip (measured from shots), and `WALLET_GAP_PX` the Grid's gutter.
 */
export const WALLET_MIN_PX = 288
const WALLET_GAP_PX = 16

/** The container width from which `perRow` cards fit one row. */
const widthFor = (perRow: number): number => perRow * WALLET_MIN_PX + (perRow - 1) * WALLET_GAP_PX

/**
 * How many cards each row holds when at most `perRow` fit: as few rows as that takes, the cards spread
 * over them as evenly as possible (5 at three per row is 3 + 2, never 3 + 1 + 1).
 */
export function rowSizes(cards: number, perRow: number): number[] {
  const rows = Math.ceil(cards / perRow)
  const base = Math.floor(cards / rows)
  const extra = cards % rows
  return Array.from({ length: rows }, (_, i) => (i < extra ? base + 1 : base))
}

/** The Grid's breakpoint names, which a Grid takes five of. */
const BREAKPOINT_NAMES = ['xs', 'sm', 'md', 'lg', 'xl'] as const
type BreakpointName = (typeof BREAKPOINT_NAMES)[number]

/**
 * The layouts a row of cards goes through as the container widens from one card per row: each
 * distinct arrangement once, with the width from which it holds, narrowest first.
 */
function tiers(cards: number): { width: number; sizes: number[] }[] {
  const seen = new Set<string>()
  return Array.from({ length: cards }, (_, i) => i + 1)
    .map((perRow) => ({ width: widthFor(perRow), sizes: rowSizes(cards, perRow) }))
    .filter(({ sizes }) => {
      const signature = sizes.join(',')
      if (seen.has(signature)) return false
      seen.add(signature)
      return true
    })
    .slice(1)
}

/** The size of the row each card sits in, in card order. */
const rowOfCards = (sizes: readonly number[]): number[] =>
  sizes.flatMap((size) => Array.from({ length: size }, () => size))

/**
 * The card's Grid span (of `WALLET_COLUMNS`) at each container width, one entry per card. A card
 * never gets narrower than `WALLET_MIN_PX`: the widest container holds every wallet in one row; as it
 * narrows the cards fall into two rows, then three, down to one per row, and each row splits its width
 * equally between its own cards (3 × ⅓ over 2 × ½). `base` is one card per row; the other keys are
 * the Grid's breakpoint names, resolved to widths by `walletBreakpoints`.
 */
export function walletSpans(cards: number): Partial<Record<'base' | BreakpointName, number>>[] {
  const layouts = tiers(cards).map((tier, i) => ({
    name: BREAKPOINT_NAMES[i],
    rowOf: rowOfCards(tier.sizes),
  }))
  return Array.from({ length: cards }, (_, index) => ({
    base: WALLET_COLUMNS,
    ...Object.fromEntries(
      layouts.flatMap(({ name, rowOf }) =>
        name === undefined ? [] : [[name, WALLET_COLUMNS / (rowOf[index] ?? 1)]],
      ),
    ),
  }))
}

/**
 * The container widths `walletSpans` switches at, as the Grid's five breakpoints (a name no layout
 * uses repeats the widest width, so it never switches anything).
 */
export function walletBreakpoints(cards: number): Record<BreakpointName, string> {
  const found = tiers(cards)
  const widest = found.at(-1)?.width ?? 0
  return {
    xs: `${found[0]?.width ?? widest}px`,
    sm: `${found[1]?.width ?? widest}px`,
    md: `${found[2]?.width ?? widest}px`,
    lg: `${found[3]?.width ?? widest}px`,
    xl: `${found[4]?.width ?? widest}px`,
  }
}
