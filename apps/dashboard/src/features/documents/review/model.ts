import type { DecideBody, DocsIndex, ReviewEntry } from '../../../lib/queries/paper'

export type Proposal = { label: string; body: DecideBody }

/** An index or inbox timestamp in ms: the CLI sends ms; a seconds value is lifted rather than shown as 1970. */
export const toMs = (stamp: number): number => (stamp < 1e11 ? stamp * 1000 : stamp)

/** `5 documents: pages 1-8, 9, 10-11, 12-13, 14-15` */
export function splitLine(documents: number, ranges: readonly string[]): string {
  return `${documents} documents: pages ${ranges.join(', ')}`
}

/** The one-tap answer the pipeline's own proposal stands for, or null when it proposes nothing. */
export function proposalOf(item: ReviewEntry): Proposal | null {
  const proposal = item.proposal
  if (!proposal) return null
  const split = proposal.split
  if (split && split.documents > 1 && split.starts.length > 0) {
    return {
      label: splitLine(split.documents, split.ranges),
      body: { split: split.starts.join(',') },
    }
  }
  const kind = proposal.kind ?? undefined
  const date = proposal.date ?? undefined
  if (!kind && !date) return null
  return {
    label: `One document: ${[kind, date].filter(Boolean).join(', ')}`,
    body: { ...(kind && { kind }), ...(date && { date }) },
  }
}

export type ManualValues = {
  split: string
  kind: string
  issuer: string
  date: string
  title: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The by-hand form, prefilled from the proposal: split points when it splits, else its kind and date. */
export function manualDefaults(item: ReviewEntry): ManualValues {
  const proposal = item.proposal
  const starts = proposal?.split?.starts ?? []
  if (starts.length > 0)
    return { split: starts.join(', '), kind: '', issuer: '', date: '', title: '' }
  const date = proposal?.date && DATE.test(proposal.date) ? proposal.date : ''
  return { split: '', kind: proposal?.kind ?? '', issuer: '', date, title: '' }
}

/** The values the form sends, or the sentence that says what to fix. Split points and values exclude each other. */
export function buildDecision(values: ManualValues): { body: DecideBody } | { error: string } {
  const text = {
    kind: values.kind.trim(),
    issuer: values.issuer.trim(),
    date: values.date.trim(),
    title: values.title.trim(),
  }
  const given = Object.entries(text).filter(([, value]) => value !== '')
  const tokens = values.split.split(/[,\s]+/).filter(Boolean)

  for (const [name, value] of given) {
    if (value.startsWith('-')) return { error: `${name} cannot start with a hyphen` }
    if (value.length > 200) return { error: `${name} is longer than 200 characters` }
  }
  if (text.date && !DATE.test(text.date)) return { error: 'The date is YYYY-MM-DD' }

  if (tokens.length > 0) {
    if (given.length > 0) {
      return {
        error: 'Split points and values exclude each other: the values describe one document',
      }
    }
    const pages = tokens.map(Number)
    const ascending = pages.every((page, index) => index === 0 || page > pages[index - 1]!)
    if (!pages.every((page) => Number.isInteger(page) && page >= 2 && page <= 999) || !ascending) {
      return {
        error:
          'Split points are the first pages of the documents after the first: 2 or more, ascending',
      }
    }
    return { body: { split: pages.join(',') } }
  }
  if (given.length === 0)
    return { error: 'Enter split points or at least one value, or choose One document' }
  return { body: Object.fromEntries(given) as DecideBody }
}

export type Suggestions = { kinds: string[]; issuers: string[] }

function rank(values: Array<string | null | undefined>): string[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    const clean = value?.trim()
    if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1)
  }
  return [...counts]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value)
}

/** Kinds and issuers the index already holds, most used first: the form's suggestions. */
export function suggestionsFrom(index: DocsIndex | undefined): Suggestions {
  const documents = index?.documents ?? []
  return {
    kinds: rank(documents.map((d) => d.kind)),
    issuers: rank(documents.map((d) => d.issuer)),
  }
}
/** What the inbox says about a collated front/back pair, in words. */
export function sidesLine(item: ReviewEntry): string | null {
  if (item.sides) {
    return `Collated from ${item.sides.fronts.length} front and ${item.sides.backs.length} back file(s)`
  }
  return item.sideOf ? `One side of a front/back pair` : null
}
