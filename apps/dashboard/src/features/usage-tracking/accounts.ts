import { BP } from 'basalt-ui/tokens'

/**
 * The Claude accounts the usage page names: the one registry the quota meters derive from. The API
 * accepts any account id; an id missing here still reads as itself. `plan` is the Max tier
 * multiplier the quota meters name the account by (`iu 20x`).
 */
export const USAGE_ACCOUNTS = [
  { id: 'iu', label: 'iu', plan: '20x' },
  { id: 'me', label: 'me', plan: '5x' },
] as const

/**
 * Who pays for a row (the API derives it from billing + account): the two Max subscriptions and the
 * two metered APIs, IU's family in warm hues and the personal one in blues. The registry the labels
 * and colours derive from; `unknown` is the neutral catch-all.
 */
export const USAGE_PAYERS = [
  { id: 'iu-sub', token: 'iuSub', label: 'IU Max', hue: BP.gold },
  { id: 'iu-api', token: 'iuApi', label: 'IU API', hue: BP.violet },
  { id: 'me-sub', token: 'meSub', label: 'Me Max', hue: BP.blue },
  { id: 'me-api', token: 'meApi', label: 'Me API', hue: BP.cerulean },
] as const

export type PayerValue = (typeof USAGE_PAYERS)[number]['id'] | 'unknown'

export const PAYER_LABELS: Record<PayerValue, string> = {
  ...(Object.fromEntries(USAGE_PAYERS.map((p) => [p.id, p.label])) as Record<
    Exclude<PayerValue, 'unknown'>,
    string
  >),
  unknown: 'Unknown',
}

/**
 * The three wallets the page is built around, in display order. `kind` decides the `$` word: a
 * subscription's dollars are list value (what the usage would cost at API prices), an API's are
 * spend. `account` links a subscription to its quota samples. Me API has no wallet: it is ~$0.
 */
export const WALLETS = [
  { id: 'iu-sub', title: 'IU Max', plan: '20x', who: 'IU pays · flat', kind: 'sub', account: 'iu' },
  { id: 'me-sub', title: 'Me Max', plan: '5x', who: 'I pay · flat', kind: 'sub', account: 'me' },
  {
    id: 'iu-api',
    title: 'IU API',
    plan: null,
    who: 'IU pays · metered',
    kind: 'api',
    account: null,
  },
] as const

export type Wallet = (typeof WALLETS)[number]
export type WalletId = Wallet['id']

export const walletOf = (id: string): Wallet | undefined => WALLETS.find((w) => w.id === id)

/** What a wallet's dollars are called: a subscription's are list value, an API's are spend. */
export const dollarWord = (kind: Wallet['kind']): string =>
  kind === 'sub' ? 'list value' : 'spend'

/** Me API (OpenRouter, ~$0): a card only when its range total reaches a dollar; no tab, no limit. */
export const ME_API = {
  id: 'me-api',
  title: 'Me API',
  plan: null,
  who: 'I pay · metered',
  kind: 'api',
  account: null,
} as const

export type CardWallet = Wallet | typeof ME_API
