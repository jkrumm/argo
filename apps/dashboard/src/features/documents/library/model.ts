/**
 * Pure logic of the document index: search, the faceted filters and their counts, the order, the
 * attention rules and the links of one document. The index is a few hundred records at most, so all
 * of it runs on the client over one `GET /paper/docs`.
 */

/** The fields of a `GET /paper/docs` record this page reads. */
export interface Doc {
  id: string
  title: string
  kind?: string | null | undefined
  issuer?: string | null | undefined
  date?: string | null | undefined
  taxYear?: number | null | undefined
  validUntil?: string | null | undefined
  subject?: string | null | undefined
  tags: string[]
  summary: string
  sharePath?: string | null | undefined
  textPath?: string | null | undefined
  vaultId?: string | null | undefined
  fileExists: boolean
}

export const ATTENTION_VALUES = ['all', 'any', 'expiry', 'missing', 'nokind'] as const
export type AttentionFilter = (typeof ATTENTION_VALUES)[number]

export const ATTENTION_LABELS: Record<AttentionFilter, string> = {
  all: 'All documents',
  any: 'Needs attention',
  expiry: 'Expiring or expired',
  missing: 'File missing',
  nokind: 'No kind',
}

/** A `valid_until` this many days ahead (or any day behind) needs attention. */
export const EXPIRY_WARNING_DAYS = 90

/** The filter values as the URL holds them; `''` is "not filtering". */
export interface Filters {
  q: string
  kind: string
  issuer: string
  year: string
  taxYear: string
  tag: string
  attention: AttentionFilter
}

export const NO_FILTERS: Filters = {
  q: '',
  kind: '',
  issuer: '',
  year: '',
  taxYear: '',
  tag: '',
  attention: 'all',
}

/** The year value of a document without a date. */
export const UNDATED = 'undated'

export type AttentionReason =
  | { type: 'expired'; label: string }
  | { type: 'expiring'; label: string }
  | { type: 'missing'; label: string }
  | { type: 'nokind'; label: string }

const DAY_MS = 86_400_000

/** Whole days from `today` to `date` (both `YYYY-MM-DD`); null when `date` is not a date. */
export function daysUntil(date: string, today: string): number | null {
  const to = Date.parse(`${date.slice(0, 10)}T00:00:00Z`)
  const from = Date.parse(`${today}T00:00:00Z`)
  return Number.isNaN(to) || Number.isNaN(from) ? null : Math.round((to - from) / DAY_MS)
}

export function attentionOf(doc: Doc, today: string): AttentionReason[] {
  const reasons: AttentionReason[] = []
  const days = doc.validUntil ? daysUntil(doc.validUntil, today) : null
  if (days !== null && days < 0) {
    reasons.push({ type: 'expired', label: `expired ${doc.validUntil}` })
  } else if (days !== null && days <= EXPIRY_WARNING_DAYS) {
    reasons.push({
      type: 'expiring',
      label: days === 0 ? 'expires today' : `expires in ${days} ${days === 1 ? 'day' : 'days'}`,
    })
  }
  if (!doc.fileExists) reasons.push({ type: 'missing', label: 'file missing' })
  if (!doc.kind?.trim()) reasons.push({ type: 'nokind', label: 'no kind' })
  return reasons
}

function matchesAttention(doc: Doc, filter: AttentionFilter, today: string): boolean {
  if (filter === 'all') return true
  const types = attentionOf(doc, today).map((reason) => reason.type)
  if (filter === 'any') return types.length > 0
  if (filter === 'expiry') return types.includes('expired') || types.includes('expiring')
  return types.includes(filter)
}

export const yearOf = (doc: Doc): string =>
  doc.date && /^\d{4}/.test(doc.date) ? doc.date.slice(0, 4) : UNDATED

/** Every word of `query` appears somewhere in title, issuer, kind, subject, tags or summary. */
export function matchesQuery(doc: Doc, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = [doc.title, doc.issuer, doc.kind, doc.subject, ...doc.tags, doc.summary]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}

export const FACETS = ['kind', 'issuer', 'year', 'taxYear', 'tag'] as const
export type Facet = (typeof FACETS)[number]

/** The values a document carries for a facet. */
function valuesOf(doc: Doc, facet: Facet): string[] {
  switch (facet) {
    case 'kind':
      return doc.kind ? [doc.kind] : []
    case 'issuer':
      return doc.issuer ? [doc.issuer] : []
    case 'year':
      return [yearOf(doc)]
    case 'taxYear':
      return doc.taxYear === null || doc.taxYear === undefined ? [] : [String(doc.taxYear)]
    case 'tag':
      return [...new Set(doc.tags)]
  }
}

/** `skip` leaves one facet out, which is how a facet's own counts are taken. */
function matches(doc: Doc, filters: Filters, today: string, skip?: Facet): boolean {
  if (!matchesQuery(doc, filters.q)) return false
  if (!matchesAttention(doc, filters.attention, today)) return false
  return FACETS.every(
    (facet) =>
      facet === skip || filters[facet] === '' || valuesOf(doc, facet).includes(filters[facet]),
  )
}

/** Newest first; undated last; then by title. */
export function byNewest(a: Doc, b: Doc): number {
  const left = a.date ?? ''
  const right = b.date ?? ''
  if (left !== right) return left < right ? 1 : -1
  return a.title.localeCompare(b.title)
}

export function filterDocs<T extends Doc>(
  docs: readonly T[],
  filters: Filters,
  today: string,
): T[] {
  return docs.filter((doc) => matches(doc, filters, today)).toSorted(byNewest)
}

export interface FacetOption {
  value: string
  count: number
}

const isYearFacet = (facet: Facet): boolean => facet === 'year' || facet === 'taxYear'

/**
 * The options of one facet, each with the number of documents picking it would leave: the other
 * filters and the search apply, the facet's own selection does not. Years newest first, the rest by
 * count then name. The selected value stays listed even at zero, so it can be seen and cleared.
 */
export function facetOptions(
  docs: readonly Doc[],
  facet: Facet,
  filters: Filters,
  today: string,
): FacetOption[] {
  const counts = new Map<string, number>()
  for (const doc of docs) {
    if (!matches(doc, filters, today, facet)) continue
    for (const value of valuesOf(doc, facet)) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const selected = filters[facet]
  if (selected !== '' && !counts.has(selected)) counts.set(selected, 0)
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .toSorted((a, b) => {
      if (isYearFacet(facet)) {
        if (a.value === UNDATED || b.value === UNDATED) return a.value === UNDATED ? 1 : -1
        return b.value.localeCompare(a.value)
      }
      return b.count - a.count || a.value.localeCompare(b.value)
    })
}

export interface AttentionCounts {
  any: number
  expiry: number
  missing: number
  nokind: number
}

export function attentionCounts(docs: readonly Doc[], today: string): AttentionCounts {
  const count = (filter: AttentionFilter) =>
    docs.filter((doc) => matchesAttention(doc, filter, today)).length
  return {
    any: count('any'),
    expiry: count('expiry'),
    missing: count('missing'),
    nokind: count('nokind'),
  }
}

export const isFiltering = (filters: Filters): boolean =>
  filters.attention !== 'all' || filters.q !== '' || FACETS.some((facet) => filters[facet] !== '')

/** The vault of the brain; `file` by name resolves like a wiki link, and a note's stem is the id. */
export const obsidianUrl = (id: string): string =>
  `obsidian://open?vault=brain&file=${encodeURIComponent(id)}`

/** Where the original lies, from the root of the Dokumente share (mounted differently per machine). */
export const shareLocation = (sharePath: string): string => `Dokumente/${sharePath}`

/** The file name a download gets: the original's own, else the id as a PDF. */
export function downloadName(doc: Pick<Doc, 'id' | 'sharePath'>): string {
  const own = doc.sharePath?.split('/').at(-1)
  return own && own !== '' ? own : `${doc.id}.pdf`
}

export const isPdf = (doc: Pick<Doc, 'sharePath'>): boolean =>
  !doc.sharePath || /\.pdf$/i.test(doc.sharePath)
