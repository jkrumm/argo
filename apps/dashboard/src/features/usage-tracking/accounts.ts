import { BP } from 'basalt-ui/tokens'

/**
 * The Claude accounts the usage page names: the one registry the store enum, its labels and the
 * series colours all derive from. The API accepts any account id; an id missing here still draws, in
 * the neutral `unknown` colour.
 */
export const USAGE_ACCOUNTS = [
  { id: 'iu', token: 'iu', label: 'iu', hue: BP.blue },
  { id: 'me', token: 'me', label: 'me', hue: BP.violet },
] as const

export const ACCOUNT_IDS = USAGE_ACCOUNTS.map((a) => a.id)

export const ACCOUNT_LABELS = Object.fromEntries(
  USAGE_ACCOUNTS.map((a) => [a.id, a.label]),
) as Record<(typeof USAGE_ACCOUNTS)[number]['id'], string>
