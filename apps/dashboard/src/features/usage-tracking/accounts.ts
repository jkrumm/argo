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
 * Who pays for a row (the API derives it from billing + account + IU key): the Max subscriptions and
 * the metered APIs (the IU API per key, Me API); the registry the labels and colours derive from. The subscriptions are one family
 * (the same Claude Code usage) and take SHADES of the one accent, the biggest plan the strongest;
 * the metered APIs are a different kind of spend and stay neutral. `shade` is `[family, light
 * index, dark index]`: deeper ink on light, brighter on dark. `unknown` is the default grey.
 */
export const USAGE_PAYERS = [
  { id: 'iu-sub', token: 'iuSub', label: 'IU Max', shade: [BP.blue, 0, 4] },
  { id: 'me-sub', token: 'meSub', label: 'Me Max', shade: [BP.blue, 2, 2] },
  { id: 'me2-sub', token: 'me2Sub', label: 'Me2 Max', shade: [BP.blue, 3, 1] },
  { id: 'iu-api', token: 'iuApi', label: 'IU API', shade: [BP.gray, 0, 2] },
  { id: 'iu-team-api', token: 'iuTeamApi', label: 'Athena team', shade: [BP.gray, 2, 4] },
  { id: 'me-api', token: 'meApi', label: 'Me API', shade: [BP.gray, 4, 1] },
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
 * How a portal figure above the tracked one reads for a key. `pricing`: tracked rows are priced by
 * us, so the gap is mostly a pricing or unpriced-row difference (the personal key). `unseen`: the
 * tracked costs are producer-reported, so the gap is spend by producers we do not see (the team key,
 * whose build-phase spend predates its producer's rows).
 */
export type GapReading = 'pricing' | 'unseen'

/**
 * The IU API keys: each has its OWN rolling 30-day cap in IU's portal, so each is a wallet with its
 * own meter and never summed into another. `payer` is the payer id the API derives from (billing iu,
 * this key); `iu-api` means the personal key only. A later key is one entry here plus its payer entry
 * above. `title` / `who` name the key's wallet card, `label` the Key control's option; `gapReading`,
 * `spend` and `anchor` shape the key's portal-vs-tracked card.
 */
export const IU_KEYS = [
  {
    id: 'personal',
    label: 'Personal',
    payer: 'iu-api',
    title: 'IU API',
    who: 'IU pays · metered',
    gapReading: 'pricing',
    spend: 'IU spend',
    anchor: 'reconciliation',
  },
  {
    id: 'athena-team',
    label: 'Athena team',
    payer: 'iu-team-api',
    title: 'Athena team',
    who: 'IU pays · team key, metered',
    gapReading: 'unseen',
    spend: 'Athena team spend',
    anchor: 'reconciliation-athena-team',
  },
] as const satisfies readonly {
  id: string
  label: string
  payer: PayerValue
  title: string
  who: string
  gapReading: GapReading
  spend: string
  anchor: string
}[]

export type IuKeyId = (typeof IU_KEYS)[number]['id']

/** The key ids in registry order: the values of the IU API tab's Key control (after `all`). */
export const IU_KEY_IDS: readonly IuKeyId[] = IU_KEYS.map((k) => k.id)

/**
 * A wallet is one payer with a name. `kind` decides the `$` word: a subscription's dollars are list
 * value (what the usage would cost at API prices), an API's are spend. `account` links a
 * subscription to its quota samples. Me API has no wallet of its own: it is ~$0.
 */
export type SubWallet = {
  id: PayerValue
  title: string
  plan: (typeof USAGE_ACCOUNTS)[number]['plan']
  who: string
  kind: 'sub'
  account: AccountId
}

/** An API without a limit meter of its own (Me API): its `iuKey` is `null`. */
export type ApiWallet = {
  id: PayerValue
  title: string
  plan: null
  who: string
  kind: 'api'
  account: null
  iuKey: null
}

/**
 * An IU API key's wallet, the one kind with a cap meter and a portal-vs-tracked card. It is told from
 * `ApiWallet` by its `iuKey` (a key id, never `null`), so narrowing on that is sound.
 */
export type KeyWallet = Omit<ApiWallet, 'iuKey'> & {
  iuKey: IuKeyId
  /** The Key control's option, and what the IU API tab's cards call the key. */
  label: string
  gapReading: GapReading
  /** `IU spend`: what its portal-vs-tracked card calls the money. */
  spend: string
  /** The `data-shot` anchor of its portal-vs-tracked card. */
  anchor: string
}

export type Wallet = SubWallet | KeyWallet | ApiWallet

export const isKeyWallet = (wallet: Wallet): wallet is KeyWallet =>
  wallet.kind === 'api' && wallet.iuKey !== null

/** The subscription wallets in registry order. */
export const SUB_WALLETS: readonly SubWallet[] = USAGE_ACCOUNTS.map((a) => ({
  id: a.payer,
  title: PAYER_LABELS[a.payer],
  plan: a.plan,
  who: a.who,
  kind: 'sub',
  account: a.id,
}))

/** One wallet per IU API key, in registry order. */
export const IU_KEY_WALLETS: readonly KeyWallet[] = IU_KEYS.map((k) => ({
  id: k.payer,
  title: k.title,
  plan: null,
  who: k.who,
  kind: 'api',
  account: null,
  iuKey: k.id,
  label: k.label,
  gapReading: k.gapReading,
  spend: k.spend,
  anchor: k.anchor,
}))

function keyWalletOf(payer: PayerValue): KeyWallet {
  const wallet = IU_KEY_WALLETS.find((w) => w.id === payer)
  if (wallet === undefined) throw new Error(`no IU key is paid as ${payer}`)
  return wallet
}

/** The personal IU key's wallet (payer `iu-api`). */
export const IU_API: KeyWallet = keyWalletOf('iu-api')

/** Me API (OpenRouter, ~$0): a card only when its range total reaches a dollar; no tab, no limit. */
export const ME_API: ApiWallet = {
  id: 'me-api',
  title: 'Me API',
  plan: null,
  who: 'I pay · metered',
  kind: 'api',
  account: null,
  iuKey: null,
}

/** What a wallet's dollars are called: a subscription's are list value, an API's are spend. */
export const dollarWord = (kind: Wallet['kind']): string =>
  kind === 'sub' ? 'list value' : 'spend'

/** The account ids in registry order: the values of the Account control. */
export const ACCOUNT_IDS: readonly AccountId[] = USAGE_ACCOUNTS.map((a) => a.id)

/**
 * The Claude account picker's ceilings, in percent used: it stops sending work to an account whose
 * 5 h session passes `session` or whose weekly window passes `weekly` (98 instead while a window
 * resets within 24 h, which no chart draws). Source: dotfiles `docs/claude-accounts.md`, rule v1.4;
 * edit here when the rule changes.
 */
export const PICKER_CEILINGS = { session: 90, weekly: 95 } as const

/** The payer id of an account id (`me2` is `me2-sub`); an id outside the registry is `unknown`. */
export const payerOfAccount = (account: string): PayerValue =>
  USAGE_ACCOUNTS.find((a) => a.id === account)?.payer ?? 'unknown'
