import type { TxRow } from '../api/types'

/** Who a booking was with: the merchant the rules found, else the bank's counterparty. */
export const bookingName = (row: Pick<TxRow, 'merchant' | 'counterparty'>): string =>
  row.merchant ?? row.counterparty ?? 'Unknown'
