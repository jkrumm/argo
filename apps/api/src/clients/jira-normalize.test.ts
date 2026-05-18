import { describe, it, expect } from 'bun:test'
import { __test } from './jira.js'

const { normalizeLink } = __test

// Regression suite for the issuelink direction normalization. The trap is
// that Jira's response puts the OTHER issue in `outwardIssue` when THIS
// issue is the inward end (and vice versa) — we expose direction/phrase
// from THIS issue's perspective.

describe('normalizeLink — direction from THIS issue perspective', () => {
  // Real raw entry pulled from EP-17863 on the careerpartner tenant.
  // EP-17863 "is blocked by" EP-17587 — so on EP-17863's issuelinks the
  // OTHER side (EP-17587) sits in outwardIssue.
  const isBlockedByRaw = {
    id: '307635',
    type: { name: 'Blocks', outward: 'blocks', inward: 'is blocked by' },
    outwardIssue: {
      key: 'EP-17587',
      fields: {
        summary: '[LoA] Missing Scenarios UAT & Rollout',
        status: { name: 'Ready 4 Live', statusCategory: { key: 'indeterminate' } },
      },
    },
  }

  it('reads "is blocked by" when the other issue sits in outwardIssue', () => {
    const link = normalizeLink(isBlockedByRaw)
    expect(link).toMatchObject({
      type: 'Blocks',
      direction: 'inward',
      phrase: 'is blocked by',
      key: 'EP-17587',
      summary: '[LoA] Missing Scenarios UAT & Rollout',
      status: 'Ready 4 Live',
      statusCategory: 'in-progress',
    })
  })

  it('reads "blocks" when the other issue sits in inwardIssue', () => {
    const blocksRaw = {
      id: '99999',
      type: { name: 'Blocks', outward: 'blocks', inward: 'is blocked by' },
      inwardIssue: {
        key: 'EP-1',
        fields: {
          summary: 'thing',
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        },
      },
    }
    const link = normalizeLink(blocksRaw)
    expect(link).toMatchObject({
      type: 'Blocks',
      direction: 'outward',
      phrase: 'blocks',
      key: 'EP-1',
    })
  })

  it('reads symmetric Relates correctly from either side', () => {
    const fromInward = normalizeLink({
      type: { name: 'Relates', outward: 'relates to', inward: 'relates to' },
      inwardIssue: {
        key: 'EP-2',
        fields: { summary: 'x', status: { name: 'Done', statusCategory: { key: 'done' } } },
      },
    })
    expect(fromInward?.direction).toBe('outward')
    expect(fromInward?.phrase).toBe('relates to')

    const fromOutward = normalizeLink({
      type: { name: 'Relates', outward: 'relates to', inward: 'relates to' },
      outwardIssue: {
        key: 'EP-3',
        fields: { summary: 'y', status: { name: 'Done', statusCategory: { key: 'done' } } },
      },
    })
    expect(fromOutward?.direction).toBe('inward')
    expect(fromOutward?.phrase).toBe('relates to')
  })

  it('returns null when neither inwardIssue nor outwardIssue is present', () => {
    expect(normalizeLink({ type: { name: 'Blocks' } })).toBeNull()
  })
})
