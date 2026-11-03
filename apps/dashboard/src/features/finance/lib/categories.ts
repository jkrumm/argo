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

const titleCase = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1).replaceAll('-', ' ')

/** `food/groceries` -> `food`; a top-level id is its own top. */
export const topOf = (id: string): string => id.split('/')[0] ?? id

/** The label of a top category id (`food` -> `Food`), from the category list when it carries one. */
export function topLabel(categories: readonly Category[] | undefined, top: string | null): string {
  if (top === null || top === NONE) return 'Uncategorized'
  return categories?.find((c) => c.id === top)?.label ?? titleCase(top)
}

type GroupedOption = { group: string; items: { value: string; label: string }[] }

/**
 * The options of a category select, grouped by top category and ordered by group then label. Income
 * and saving kinds are included: a booking can be any of them.
 */
export function categoryGroups(categories: readonly Category[] | undefined): GroupedOption[] {
  const groups = new Map<string, GroupedOption>()
  for (const c of categories ?? []) {
    const top = topOf(c.id)
    const group = groups.get(top) ?? { group: topLabel(categories, top), items: [] }
    group.items.push({ value: c.id, label: c.label })
    groups.set(top, group)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, items: g.items.toSorted((a, b) => a.label.localeCompare(b.label)) }))
    .toSorted((a, b) => a.group.localeCompare(b.group))
}

/** The tax tags a booking can carry (finances `SetTagRequest`). */
export const TAX_TAGS = [
  'business',
  'tax',
  'donation',
  'private',
  'transfer',
  'investment',
  'income',
] as const

export type TaxTag = (typeof TAX_TAGS)[number]

export const tagLabel = (tag: string | null): string => (tag === null ? 'No tag' : titleCase(tag))
