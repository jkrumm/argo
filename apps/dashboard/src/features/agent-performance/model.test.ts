import { describe, expect, it } from 'bun:test'
import {
  cleanBasis,
  fmtUsd,
  issueRows,
  laneOf,
  pct,
  precisionBasis,
  promptRows,
  pushedRecord,
  reviewBody,
  reviewForSummary,
  reviewJobTotal,
  reviewView,
  reviewSourceText,
  usageParts,
  reviewTotals,
  reviewWeekRows,
  runsByWeek,
  shortKey,
  spanLabel,
  splitSubagents,
  summarizeReview,
  summarySentence,
  tierSummaries,
  weekKeys,
  type ReviewGroupInput,
  type ReviewWeekInput,
  type SubagentInput,
} from './model'

// Wednesday 2026-11-04 12:00 UTC: the current ISO week starts Monday 2026-11-02.
const NOW = Date.parse('2026-11-04T12:00:00Z')

describe('weekKeys', () => {
  it('ends with the current Monday and walks back whole weeks', () => {
    expect(weekKeys(3, NOW)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02'])
  })

  it('treats Sunday as the end of the week', () => {
    expect(weekKeys(1, Date.parse('2026-11-08T23:00:00Z'))).toEqual(['2026-11-02'])
  })
})

const group = (key: string, overrides: Partial<ReviewGroupInput> = {}): ReviewGroupInput => ({
  key,
  jobs: 10,
  round1: { jobs: 10, clean: 5 },
  precision: { important: 0.5, nit: null },
  dispositions: {
    important: { fixed: 3, wrong: 1, intentional: 0, irrelevant: 0 },
    nit: null,
  },
  ...overrides,
})

describe('summarizeReview', () => {
  it('sums jobs and first rounds, recomputing the clean rate', () => {
    const s = summarizeReview([
      group('standard', { jobs: 10, round1: { jobs: 8, clean: 4 } }),
      group('standard', { jobs: 30, round1: { jobs: 12, clean: 11 } }),
    ])
    expect(s.jobs).toBe(40)
    expect(s.firstRounds).toBe(20)
    expect(s.clean).toBe(15)
    expect(s.cleanRate).toBe(0.75)
  })

  it('has no clean rate without first rounds', () => {
    expect(summarizeReview([group('x', { round1: null })]).cleanRate).toBeNull()
    expect(summarizeReview([]).cleanRate).toBeNull()
  })

  it('weights precision by judged findings', () => {
    const s = summarizeReview([
      group('a', {
        precision: { important: 1, nit: 0 },
        dispositions: { important: { fixed: 2 }, nit: { wrong: 2 } },
      }),
      group('b', {
        precision: { important: 0.5, nit: 0.5 },
        dispositions: { important: { fixed: 1, wrong: 1 }, nit: { fixed: 2, irrelevant: 2 } },
      }),
    ])
    expect(s.important).toEqual({ rate: 0.75, judged: 4 })
    expect(s.nit?.judged).toBe(6)
    expect(s.nit?.rate).toBeCloseTo(1 / 3)
  })

  it('does not count intentional or open dispositions as judged (agw denominator)', () => {
    const s = summarizeReview([
      group('a', {
        precision: { nit: 0.75 },
        dispositions: { nit: { fixed: 6, irrelevant: 2, intentional: 3, open: 2 } },
      }),
    ])
    expect(s.nit).toEqual({ rate: 0.75, judged: 8 })
  })

  it('is null precision when nothing was judged or the rate is null', () => {
    const s = summarizeReview([
      group('a', { precision: { important: null }, dispositions: { important: { fixed: 3 } } }),
      group('b', { precision: { nit: 0.4 }, dispositions: { nit: { fixed: 0 } } }),
    ])
    expect(s.important).toBeNull()
    expect(s.nit).toBeNull()
  })
})

const weeks: ReviewWeekInput[] = [
  {
    weekStart: '2026-10-19',
    groups: [group('light', { jobs: 4 }), group('deep', { jobs: 1 })],
  },
  { weekStart: '2026-11-02', groups: [group('standard', { jobs: 7 })] },
  { weekStart: '2026-08-03', groups: [group('standard', { jobs: 99 })] },
]

describe('reviewWeekRows', () => {
  it('fills missing weeks and tiers with zero jobs', () => {
    const rows = reviewWeekRows(weeks, weekKeys(3, NOW))
    expect(rows.map((r) => r.weekStart)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02'])
    expect(rows[0]?.jobs).toEqual({ light: 4, standard: 0, deep: 1 })
    expect(rows[1]?.jobs).toEqual({ light: 0, standard: 0, deep: 0 })
    expect(rows[2]?.jobs).toEqual({ light: 0, standard: 7, deep: 0 })
  })
})

describe('tierSummaries', () => {
  it('ignores weeks outside the window and tiers without jobs', () => {
    const s = tierSummaries(weeks, weekKeys(3, NOW))
    expect(s.map((t) => [t.tier, t.jobs])).toEqual([
      ['light', 4],
      ['standard', 7],
      ['deep', 1],
    ])
  })
})

describe('reviewTotals', () => {
  it('pools every group in the window', () => {
    const t = reviewTotals(weeks, weekKeys(3, NOW))
    expect(t.jobs).toBe(12)
    expect(t.cleanRate).toBe(0.5)
  })
})

describe('promptRows', () => {
  it('ranks fingerprints by jobs', () => {
    const rows = promptRows([group('aaa', { jobs: 3 }), group('bbb', { jobs: 12 })])
    expect(rows.map((r) => r.key)).toEqual(['bbb', 'aaa'])
  })
})

describe('formatting', () => {
  it('spells percentages and bases', () => {
    expect(pct(0.5204)).toBe('52%')
    expect(pct(null)).toBe('—')
    expect(cleanBasis({ clean: 51, firstRounds: 98 })).toBe('51 of 98 first rounds')
    expect(cleanBasis({ clean: 0, firstRounds: 0 })).toBe('')
    expect(precisionBasis({ rate: 0.5, judged: 12 })).toBe('of 12 judged')
    expect(precisionBasis(null)).toBe('')
  })

  it('shortens long keys only', () => {
    expect(shortKey('abcdef')).toBe('abcdef')
    expect(shortKey('abcdefghijklmnop')).toBe('abcdefghij…')
  })

  it('spells dollars', () => {
    expect(fmtUsd(1234.5)).toBe('$1,234.50')
    expect(fmtUsd(0.004)).toBe('<$0.01')
    expect(fmtUsd(0)).toBe('$0.00')
  })
})

describe('laneOf', () => {
  it('maps lanes and subagent types onto the six Issue lanes', () => {
    expect(laneOf('lead', 'lead')).toBe('lead')
    expect(laneOf('subagent', 'Explore')).toBe('Explore')
    expect(laneOf('subagent', 'implementer')).toBe('implementer')
    expect(laneOf('worker', 'reviewer')).toBe('reviewer')
    expect(laneOf('subagent', 'review-verifier')).toBe('reviewer')
    expect(laneOf('subagent', 'verifier')).toBe('verifier')
    expect(laneOf('subagent', 'general-purpose')).toBe('other')
  })
})

describe('issueRows', () => {
  const issue = {
    issueId: '42',
    repo: 'demo',
    firstTs: '2026-11-02T08:00:00.000Z',
    lastTs: '2026-11-03T09:00:00.000Z',
    runs: 5,
    requests: 80,
    costUsd: 10,
    lanes: [
      { lane: 'subagent', name: 'verifier', runs: 1, requests: 10, costUsd: 1 },
      { lane: 'lead', name: 'lead', runs: 1, requests: 40, costUsd: 6 },
      { lane: 'subagent', name: 'review-verifier', runs: 2, requests: 20, costUsd: 2 },
      { lane: 'worker', name: 'reviewer', runs: 1, requests: 10, costUsd: 1 },
    ],
  }

  it('titles with the repo, folds lanes in fixed order and sums per lane', () => {
    const [row] = issueRows([issue])
    expect(row?.title).toBe('#42 demo')
    expect(row?.lanes.map((l) => [l.lane, l.runs, l.costUsd])).toEqual([
      ['lead', 1, 6],
      ['reviewer', 3, 3],
      ['verifier', 1, 1],
    ])
  })

  it('drops the repo from the title when there is none', () => {
    expect(issueRows([{ ...issue, repo: null }])[0]?.title).toBe('#42')
  })

  it('keeps the API order', () => {
    const rows = issueRows([issue, { ...issue, issueId: '7' }])
    expect(rows.map((r) => r.issueId)).toEqual(['42', '7'])
  })
})

describe('spanLabel', () => {
  it('collapses a single day and spans several', () => {
    expect(spanLabel('2026-11-02T08:00:00Z', '2026-11-02T20:00:00Z')).toBe('2 Nov')
    expect(
      spanLabel('2026-11-02T08:00:00Z', '2026-11-04T20:00:00Z').replaceAll('\u00a0', ' '),
    ).toBe('2 Nov – 4 Nov')
    expect(spanLabel('nope', '2026-11-04T20:00:00Z')).toBe('—')
  })
})

const sub = (over: Partial<SubagentInput>): SubagentInput => ({
  kind: 'subagent',
  name: 'a',
  runs: 1,
  requests: 1,
  costUsd: 1,
  avgCostUsd: 1,
  ...over,
})

describe('splitSubagents', () => {
  it('separates workers from subagents, cost descending', () => {
    const { subagents, workers } = splitSubagents([
      sub({ name: 'cheap', costUsd: 1 }),
      sub({ kind: 'worker', name: 'implementer', costUsd: 5 }),
      sub({ name: 'dear', costUsd: 9 }),
    ])
    expect(subagents.map((r) => r.name)).toEqual(['dear', 'cheap'])
    expect(workers.map((r) => r.name)).toEqual(['implementer'])
  })
})

const row = (
  weekStart: string,
  name: string,
  runs: number,
  kind: 'subagent' | 'worker' = 'subagent',
) => ({ weekStart, kind, name, runs })

describe('runsByWeek', () => {
  const keys = weekKeys(2, NOW)

  it('keeps the top types and folds the tail into (other)', () => {
    const { series, weeks: out } = runsByWeek(
      [
        row('2026-10-26', 't1', 9),
        row('2026-10-26', 't2', 5),
        row('2026-11-02', 't2', 2),
        row('2026-11-02', 't3', 2),
        row('2026-11-02', 't4', 1),
      ],
      keys,
      2,
    )
    expect(series.map((s) => s.label)).toEqual(['t1', 't2', '(other)'])
    expect(out[1]?.runs).toEqual({ 'subagent:t2': 2, other: 3 })
    expect(out[0]?.runs).toEqual({ 'subagent:t1': 9, 'subagent:t2': 5 })
  })

  it('has no (other) series when nothing folds, and labels workers', () => {
    const { series } = runsByWeek([row('2026-11-02', 'implementer', 3, 'worker')], keys)
    expect(series).toEqual([
      { key: 'worker:implementer', label: 'implementer (worker)', other: false },
    ])
  })

  it('skips rows outside the window and keeps every week', () => {
    const { weeks: out } = runsByWeek([row('2026-01-05', 'x', 4)], keys)
    expect(out.map((w) => w.weekStart)).toEqual(keys)
    expect(out.every((w) => Object.keys(w.runs).length === 0)).toBe(true)
  })
})

describe('summarySentence', () => {
  const subagents = [
    sub({ runs: 10, costUsd: 4 }),
    sub({ kind: 'worker', name: 'implementer', runs: 3, costUsd: 6 }),
  ]

  it('says so when agw has not pushed review stats', () => {
    expect(summarySentence({ weeks: 8, subagents, review: null })).toBe(
      'Last 8 weeks: 10 subagent runs and 3 factory worker runs, $10.00 at list value. agw has not pushed review stats yet.',
    )
  })

  it('stays silent about reviews while they are unknown', () => {
    expect(summarySentence({ weeks: 8, subagents })).toBe(
      'Last 8 weeks: 10 subagent runs and 3 factory worker runs, $10.00 at list value.',
    )
  })

  it('reports review jobs and the clean rate', () => {
    expect(
      summarySentence({ weeks: 4, subagents, review: { jobs: 20, cleanRate: 0.5 } }),
    ).toContain('20 review jobs, 50% clean in the first round.')
  })

  it('names an empty window', () => {
    expect(
      summarySentence({ weeks: 4, subagents, review: { jobs: 0, cleanRate: null } }),
    ).toContain('No review jobs in the window.')
  })
})

describe('reviewForSummary', () => {
  const record = {
    receivedAt: '2026-11-04T11:00:00Z',
    snapshot: { weeks: [{ weekStart: '2026-11-02', groups: [{ key: 'light', jobs: 4 }] }] },
  }
  const keys = ['2026-11-02']

  it('totals the pushed weeks', () => {
    expect(reviewForSummary({ record, keys, emptyShot: false, succeeded: true })?.jobs).toBe(4)
  })

  it('is null when nothing was pushed, undefined while unknown', () => {
    expect(reviewForSummary({ record: null, keys, emptyShot: true, succeeded: false })).toBeNull()
    expect(reviewForSummary({ record: null, keys, emptyShot: false, succeeded: true })).toBeNull()
    expect(
      reviewForSummary({ record: null, keys, emptyShot: false, succeeded: false }),
    ).toBeUndefined()
  })
})

describe('reviewBody', () => {
  it('picks the section state', () => {
    expect(reviewBody(false, 0)).toBe('unpushed')
    expect(reviewBody(true, 0)).toBe('empty')
    expect(reviewBody(true, 3)).toBe('data')
  })
})

describe('reviewJobTotal', () => {
  it('sums every tier of every week', () => {
    const rows = reviewWeekRows(
      [
        {
          weekStart: '2026-11-02',
          groups: [
            { key: 'light', jobs: 1 },
            { key: 'deep', jobs: 2 },
          ],
        },
      ],
      ['2026-11-02'],
    )
    expect(reviewJobTotal(rows)).toBe(3)
  })
})

describe('reviewSourceText', () => {
  it('says when nothing was pushed', () => {
    expect(reviewSourceText(null, NOW)).toBe(
      'agw review stats --bucket week --by tier, not pushed yet',
    )
  })

  it('says how long ago it was pushed', () => {
    expect(reviewSourceText('2026-11-04T11:00:00Z', NOW)).toStartWith(
      'agw review stats --bucket week --by tier, pushed ',
    )
  })
})

describe('usageParts', () => {
  it('is empty while loading', () => {
    expect(usageParts(undefined)).toEqual({ issues: [], subagents: [], byWeek: [], costBasis: '' })
  })
})

describe('reviewView', () => {
  const keys = ['2026-11-02']

  it('is the not-pushed state without a record', () => {
    expect(reviewView(null, keys, NOW)).toMatchObject({ body: 'unpushed', prompts: [] })
  })

  it('derives the rows, tiers and prompts of a record', () => {
    const view = reviewView(
      {
        receivedAt: '2026-11-04T11:00:00Z',
        snapshot: {
          weeks: [{ weekStart: '2026-11-02', groups: [{ key: 'deep', jobs: 2 }] }],
          byPrompt: [{ key: 'abc', jobs: 2 }],
        },
      },
      keys,
      NOW,
    )
    expect(view.body).toBe('data')
    expect(view.tiers.map((t) => t.tier)).toEqual(['deep'])
    expect(view.prompts.map((p) => p.key)).toEqual(['abc'])
  })
})

describe('pushedRecord', () => {
  const latest = { receivedAt: 'x', snapshot: { weeks: [] } }

  it('returns the latest record unless the empty shot forces none', () => {
    expect(pushedRecord({ latest }, false)).toBe(latest)
    expect(pushedRecord({ latest }, true)).toBeNull()
    expect(pushedRecord({ latest: null }, false)).toBeNull()
    expect(pushedRecord(undefined, false)).toBeNull()
  })
})
