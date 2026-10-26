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
  { id: 'iu-api', token: 'iuApi', label: 'IU API', hue: BP.orange },
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
