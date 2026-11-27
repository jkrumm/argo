import { describe, expect, it } from 'bun:test'
import {
  NO_FILTERS,
  attentionCounts,
  attentionOf,
  daysUntil,
  downloadName,
  facetOptions,
  filterDocs,
  isFiltering,
  isPdf,
  matchesQuery,
  obsidianUrl,
  type Doc,
  type Filters,
} from './model'

const TODAY = '2026-06-01'

/** Synthetic documents only: no real issuer, title or text belongs in the repo. */
const doc = (over: Partial<Doc> & { id: string }): Doc => ({
  title: over.id,
  kind: 'invoice',
  issuer: 'Acme Energy',
  date: '2026-03-04',
  taxYear: 2026,
  tags: [],
  summary: '',
  fileExists: true,
  ...over,
})

const DOCS: Doc[] = [
  doc({ id: 'power', title: 'Power bill', tags: ['utility', 'flat'], summary: 'Yearly total' }),
  doc({
    id: 'policy',
    title: 'Liability policy',
    kind: 'insurance',
    issuer: 'Example Insure',
    date: '2025-11-20',
    taxYear: 2025,
    tags: ['flat'],
    validUntil: '2026-07-15',
  }),
  doc({ id: 'old-card', kind: 'id', date: null, taxYear: null, validUntil: '2026-05-31' }),
  doc({ id: 'lost', date: '2026-05-01', fileExists: false }),
  doc({ id: 'unsorted', kind: null, issuer: null, date: '2024-01-02', taxYear: null }),
]

const filters = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over })
const ids = (over: Partial<Filters>): string[] =>
  filterDocs(DOCS, filters(over), TODAY).map((d) => d.id)

describe('search', () => {
  it('needs every word, in any of title, issuer, kind, subject, tags and summary', () => {
    const power = DOCS[0] as Doc
    expect(matchesQuery(power, 'POWER utility acme total')).toBe(true)
    expect(matchesQuery(power, 'power water')).toBe(false)
    expect(matchesQuery(doc({ id: 'x', subject: 'bicycle' }), 'bicycle')).toBe(true)
    expect(matchesQuery(power, '   ')).toBe(true)
  })
})

describe('filterDocs', () => {
  it('lists everything newest first, undated last', () => {
    expect(ids({})).toEqual(['lost', 'power', 'policy', 'unsorted', 'old-card'])
  })

  it('combines the filters', () => {
    expect(ids({ tag: 'flat' })).toEqual(['power', 'policy'])
    expect(ids({ tag: 'flat', taxYear: '2025' })).toEqual(['policy'])
    expect(ids({ year: 'undated' })).toEqual(['old-card'])
    expect(ids({ kind: 'invoice', issuer: 'Acme Energy', q: 'bill' })).toEqual(['power'])
  })

  it('filters by what needs attention', () => {
    expect(ids({ attention: 'expiry' })).toEqual(['policy', 'old-card'])
    expect(ids({ attention: 'missing' })).toEqual(['lost'])
    expect(ids({ attention: 'nokind' })).toEqual(['unsorted'])
    expect(ids({ attention: 'any' })).toEqual(['lost', 'policy', 'unsorted', 'old-card'])
  })
})

describe('facetOptions', () => {
  it('counts what a pick would leave: the other filters apply, its own does not', () => {
    const picked = filters({ kind: 'insurance', tag: 'flat' })
    expect(facetOptions(DOCS, 'kind', picked, TODAY)).toEqual([
      { value: 'insurance', count: 1 },
      { value: 'invoice', count: 1 },
    ])
    expect(facetOptions(DOCS, 'tag', picked, TODAY)).toEqual([{ value: 'flat', count: 1 }])
  })

  it('orders years newest first with undated last, the rest by count', () => {
    expect(facetOptions(DOCS, 'year', NO_FILTERS, TODAY).map((o) => o.value)).toEqual([
      '2026',
      '2025',
      '2024',
      'undated',
    ])
    expect(facetOptions(DOCS, 'issuer', NO_FILTERS, TODAY)[0]).toEqual({
      value: 'Acme Energy',
      count: 3,
    })
  })

  it('keeps a selected value that leaves nothing, so it can be cleared', () => {
    expect(facetOptions(DOCS, 'kind', filters({ kind: 'gone' }), TODAY)).toContainEqual({
      value: 'gone',
      count: 0,
    })
  })
})

describe('attention rules', () => {
  const reasons = (over: Partial<Doc>) =>
    attentionOf(doc({ id: 'a', ...over }), TODAY).map((r) => r.type)

  it('warns within 90 days and past, not later', () => {
    expect(daysUntil('2026-08-30', TODAY)).toBe(90)
    expect(reasons({ validUntil: '2026-08-30' })).toEqual(['expiring'])
    expect(reasons({ validUntil: '2026-08-31' })).toEqual([])
    expect(reasons({ validUntil: TODAY })).toEqual(['expiring'])
    expect(reasons({ validUntil: '2026-05-31' })).toEqual(['expired'])
    expect(reasons({ validUntil: 'unbefristet' })).toEqual([])
  })

  it('names a missing file and a note without a kind', () => {
    expect(reasons({ fileExists: false, kind: ' ' })).toEqual(['missing', 'nokind'])
  })

  it('counts each rule once per document', () => {
    expect(attentionCounts(DOCS, TODAY)).toEqual({ any: 4, expiry: 2, missing: 1, nokind: 1 })
  })
})

describe('links', () => {
  it('opens the note by its file name', () => {
    expect(obsidianUrl('2026-01-02-Acme & Co')).toBe(
      'obsidian://open?vault=brain&file=2026-01-02-Acme%20%26%20Co',
    )
  })

  it('names a download after the original', () => {
    expect(downloadName({ id: 'a', sharePath: 'Home/2026/a-scan.jpg' })).toBe('a-scan.jpg')
    expect(downloadName({ id: 'a', sharePath: null })).toBe('a.pdf')
    expect(isPdf({ sharePath: 'Home/a.PDF' })).toBe(true)
    expect(isPdf({ sharePath: 'Home/a.jpg' })).toBe(false)
  })

  it('knows whether anything is filtering', () => {
    expect(isFiltering(NO_FILTERS)).toBe(false)
    expect(isFiltering(filters({ attention: 'any' }))).toBe(true)
    expect(isFiltering(filters({ q: 'x' }))).toBe(true)
  })
})
