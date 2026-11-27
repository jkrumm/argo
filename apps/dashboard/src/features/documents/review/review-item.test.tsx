import { describe, expect, it } from 'bun:test'
import type { ReviewEntry } from '../../../lib/queries/paper'
import { renderMarkup } from '../test-render'
import { ReviewItem } from './review-item'

const noop = () => undefined

/** Synthetic entries; no real file name, issuer or reason. */
const split: ReviewEntry = {
  name: 'synthetic-stack.pdf',
  mtime: Date.now() - 3 * 3600_000,
  reason: 'looks like several documents in one scan',
  proposal: {
    kind: null,
    date: null,
    split: {
      documents: 5,
      ranges: ['1-8', '9', '10-11', '12-13', '14-15'],
      starts: [9, 10, 12, 14],
    },
  },
  sides: null,
  sideOf: null,
}

const bare: ReviewEntry = {
  name: 'synthetic-unknown.pdf',
  mtime: Date.now() - 60_000,
  reason: null,
  proposal: null,
  sides: null,
  sideOf: null,
}

const render = (
  item: ReviewEntry,
  over: { byHand?: boolean; pdf?: boolean; error?: string } = {},
) =>
  renderMarkup(
    <ReviewItem
      item={item}
      busy={false}
      error={over.error ?? null}
      suggestions={{ kinds: ['invoice'], issuers: [] }}
      onDecide={noop}
      initiallyByHand={over.byHand ?? false}
      initiallyPdf={over.pdf ?? false}
    />,
  )

describe('Review item', () => {
  it('with a proposal: one tap accepts the split, one tap makes one document', async () => {
    const html = await render(split)
    expect(html).toContain('Proposal: 5 documents: pages 1-8, 9, 10-11, 12-13, 14-15')
    expect(html).toContain('Accept proposal')
    expect(html).toContain('One document')
    expect(html).toContain('Held because: looks like several documents in one scan')
    expect(html).toContain('3 hours ago')
  })

  it('without a proposal: no accept button, the reason is missing in words', async () => {
    const html = await render(bare)
    expect(html).not.toContain('Accept proposal')
    expect(html).toContain('The pipeline has no proposal.')
    expect(html).toContain('The pipeline did not say why it holds this file.')
    expect(html).toContain('One document')
  })

  it('by hand: the split points are prefilled from the proposal', async () => {
    const html = await render(split, { byHand: true })
    expect(html).toContain('value="9, 10, 12, 14"')
    expect(html).toContain('Kind')
    expect(html).toContain('Issuer')
    expect(html).toContain('Title')
  })

  it('by hand without a split: kind and date are prefilled', async () => {
    const html = await render(
      { ...bare, proposal: { kind: 'invoice', date: '2026-11-02', split: null } },
      { byHand: true },
    )
    expect(html).toContain('value="invoice"')
    expect(html).toContain('value="2026-11-02"')
    expect(html).toContain('Proposal: One document: invoice, 2026-11-02')
    expect(html).toContain('Accept proposal')
  })

  it('a refused decision shows the API words', async () => {
    const html = await render(split, { error: 'the pipeline is filing right now' })
    expect(html).toContain('the pipeline is filing right now')
  })
})
