import { BP } from 'basalt-ui/tokens'

/**
 * The Claude accounts the usage page names: the one registry the store enum, its labels and the
 * series colours all derive from. The API accepts any account id; an id missing here still draws, in
 * the neutral `unknown` colour. An account keeps the hue of its subscription payer below. `plan` is
 * the Max tier multiplier the quota meters name the account by (`iu 20x`).
 */
export const USAGE_ACCOUNTS = [
  { id: 'iu', token: 'iu', label: 'iu', plan: '20x', hue: BP.gold },
  { id: 'me', token: 'me', label: 'me', plan: '5x', hue: BP.blue },
] as const

export const ACCOUNT_IDS = USAGE_ACCOUNTS.map((a) => a.id)

export const ACCOUNT_LABELS = Object.fromEntries(
  USAGE_ACCOUNTS.map((a) => [a.id, a.label]),
) as Record<(typeof USAGE_ACCOUNTS)[number]['id'], string>

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
