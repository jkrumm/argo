import type { Category } from '../api/types'

/** The transactions filter value for "no category" / "no merchant"; the server reads it as NULL. */
export const NONE = '__none__'

/** `/api/merchants` names merchant-less bookings this way. */
export const UNKNOWN_MERCHANT = '(unknown)'

/** The merchant filter value a merchant name drills down with. */
export const merchantFilter = (merchant: string): string =>
  merchant === UNKNOWN_MERCHANT ? NONE : merchant

export const merchantLabel = (merchant: string): string =>
  merchant === UNKNOWN_MERCHANT || merchant === NONE ? 'Unknown merchant' : merchant

/** The label of a category id; an unknown id (or a NULL one) reads as itself. */
export function categoryLabel(
  categories: readonly Category[] | undefined,
  id: string | null,
): string {
  if (id === null || id === NONE) return 'Uncategorized'
  const known = categories?.find((c) => c.id === id)
  if (known !== undefined) return known.label
  const leaf = id.slice(id.lastIndexOf('/') + 1).replaceAll('-', ' ')
  return leaf.charAt(0).toUpperCase() + leaf.slice(1)
}
