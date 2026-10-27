import { BP } from 'basalt-ui/tokens'

/**
 * The Claude Max subscriptions the usage page names: the one registry every subscription list
 * derives from (wallet cards, the Account control, the compared table, the quota lines, the weekly
 * stack). A fourth subscription is one more entry here and needs no layout change. The API accepts
 * any account id; an id missing here still reads as itself. `plan` is the Max tier multiplier,
 * `payer` the payer id the API derives from (billing max, this account).
 */
export const USAGE_ACCOUNTS = [
  { id: 'iu', label: 'iu', plan: '20x', payer: 'iu-sub', who: 'IU pays · flat' },
  { id: 'me', label: 'me', plan: '5x', payer: 'me-sub', who: 'I pay · flat' },
  { id: 'me2', label: 'me2', plan: '5x', payer: 'me2-sub', who: 'I pay · flat' },
] as const

export type AccountId = (typeof USAGE_ACCOUNTS)[number]['id']

/**
 * List price per month of a Max plan, in dollars (edit when a plan changes). The value multiple is
 * the list value of the usage over this price: what the flat fee bought.
 */
export const PLAN_PRICE_USD: Record<(typeof USAGE_ACCOUNTS)[number]['plan'], number> = {
  '20x': 200,
  '5x': 100,
}

/**
 * Who pays for a row (the API derives it from billing + account): the Max subscriptions and the two
 * metered APIs. The wallets share one split bar, so each takes its own hue (gold, sky, turquoise,
 * violet); the registry the labels and colours derive from; `unknown` is the neutral catch-all.
 */
export const USAGE_PAYERS = [
  { id: 'iu-sub', token: 'iuSub', label: 'IU Max', hue: BP.gold },
  { id: 'iu-api', token: 'iuApi', label: 'IU API', hue: BP.violet },
  { id: 'me-sub', token: 'meSub', label: 'Me Max', hue: BP.blue },
  { id: 'me2-sub', token: 'me2Sub', label: 'Me2 Max', hue: BP.turquoise },
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
 * A wallet is one payer with a name. `kind` decides the `$` word: a subscription's dollars are list
 * value (what the usage would cost at API prices), an API's are spend. `account` links a
 * subscription to its quota samples. Me API has no wallet of its own: it is ~$0.
 */
export type SubWallet = {
  id: PayerValue
  title: string
  plan: string
  who: string
  kind: 'sub'
  account: AccountId
}

export type ApiWallet = {
  id: PayerValue
  title: string
  plan: null
  who: string
  kind: 'api'
  account: null
}

export type Wallet = SubWallet | ApiWallet

/** The subscription wallets in registry order. */
export const SUB_WALLETS: readonly SubWallet[] = USAGE_ACCOUNTS.map((a) => ({
  id: a.payer,
  title: PAYER_LABELS[a.payer],
  plan: a.plan,
  who: a.who,
  kind: 'sub',
  account: a.id,
}))

export const IU_API: ApiWallet = {
  id: 'iu-api',
  title: 'IU API',
  plan: null,
  who: 'IU pays · metered',
  kind: 'api',
  account: null,
}

/** Me API (OpenRouter, ~$0): a card only when its range total reaches a dollar; no tab, no limit. */
export const ME_API: ApiWallet = {
  id: 'me-api',
  title: 'Me API',
  plan: null,
  who: 'I pay · metered',
  kind: 'api',
  account: null,
}

/** What a wallet's dollars are called: a subscription's are list value, an API's are spend. */
export const dollarWord = (kind: Wallet['kind']): string =>
  kind === 'sub' ? 'list value' : 'spend'

/** The account ids in registry order: the values of the Account control. */
export const ACCOUNT_IDS: readonly AccountId[] = USAGE_ACCOUNTS.map((a) => a.id)
