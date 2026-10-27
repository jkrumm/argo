import { describe, expect, it } from 'bun:test'
import { unglue } from '../../lib/format'
import type { FlowRow, IuBudget } from '../../lib/queries/usage'
import {
  accountTitle,
  budgetReading,
  canSpendLine,
  capLine,
  capState,
  deltaDirection,
  fmtMoney,
  fmtUsdPerMillion,
  formatAge,
  loadFailure,
  freshnessBadge,
  freshness,
  paceFraction,
  quotaReading,
  quotaState,
  rankPairs,
  tokenTrio,
  toolSplits,
  cacheReadShare,
  usdPerMillion,
  type QuotaSample,
} from './budget-model'

const NOW = Date.parse('2026-10-26T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const H = 60 * MIN
const D = 24 * H

const plain = (s: string | null) => (s === null ? null : unglue(s))

describe('freshness', () => {
  it('is fresh up to and including 8 h, stale past it, dead past 48 h', () => {
    expect(freshness(ago(0), NOW)).toBe('fresh')
    expect(freshness(ago(8 * H), NOW)).toBe('fresh')
    expect(freshness(ago(8 * H + 1), NOW)).toBe('stale')
    expect(freshness(ago(48 * H), NOW)).toBe('stale')
    expect(freshness(ago(48 * H + 1), NOW)).toBe('dead')
  })

  it('a fetch stamped in the future is fresh, not negative age', () => {
    expect(freshness(new Date(NOW + H).toISOString(), NOW)).toBe('fresh')
  })

  it('no fetch, or an unreadable one, is empty', () => {
    expect(freshness(null, NOW)).toBe('empty')
    expect(freshness(undefined, NOW)).toBe('empty')
    expect(freshness('not a date', NOW)).toBe('empty')
  })
})

describe('state words', () => {
  it('capState: ok below 80 %, warn from 80 %, over strictly above 100 %', () => {
    expect(capState(399.99, 500)).toBe('ok')
    expect(capState(400, 500)).toBe('warn')
    expect(capState(500, 500)).toBe('warn')
    expect(capState(500.01, 500)).toBe('over')
    expect(capState(573, 500)).toBe('over')
  })

  it('quotaState uses the same words at 80 / 100', () => {
    expect(quotaState(79)).toBe('ok')
    expect(quotaState(80)).toBe('warn')
    expect(quotaState(100)).toBe('warn')
    expect(quotaState(101)).toBe('over')
  })
})

describe('paceFraction', () => {
  it('is the elapsed share of the 7 d window ending at the reset', () => {
    expect(paceFraction(new Date(NOW + 7 * D).toISOString(), NOW)).toBe(0)
    expect(paceFraction(new Date(NOW + 3.5 * D).toISOString(), NOW)).toBeCloseTo(0.5)
    expect(paceFraction(new Date(NOW).toISOString(), NOW)).toBe(1)
  })

  it('clamps: a reset already passed reads 1, one further than 7 d away reads 0', () => {
    expect(paceFraction(ago(2 * D), NOW)).toBe(1)
    expect(paceFraction(new Date(NOW + 10 * D).toISOString(), NOW)).toBe(0)
  })

  it('has no tick without a usable reset instant', () => {
    expect(paceFraction(null, NOW)).toBeNull()
    expect(paceFraction('nope', NOW)).toBeNull()
  })
})

describe('quotaReading', () => {
  const sample = (over: Partial<QuotaSample> = {}): QuotaSample => ({
    sampledAt: ago(5 * MIN),
    sevenDayPct: 71,
    sevenDayResetsAt: new Date(NOW + 2 * D + 4 * H).toISOString(),
    authOk: true,
    ...over,
  })

  it('no sample is no reading', () => {
    expect(quotaReading(null, NOW)).toMatchObject({
      status: 'no-reading',
      note: 'no reading',
      pct: null,
    })
    expect(quotaReading(undefined, NOW).status).toBe('no-reading')
  })

  it('a failed auth wins over a value and shows none', () => {
    expect(quotaReading(sample({ authOk: false }), NOW)).toMatchObject({
      status: 'auth-failed',
      note: 'auth failed',
      pct: null,
    })
  })

  it('a sample without a percentage is no reading, never 0 %', () => {
    expect(quotaReading(sample({ sevenDayPct: null }), NOW)).toMatchObject({
      status: 'no-reading',
      pct: null,
    })
  })

  it('reads ok up to 30 min, stale past it with the value kept', () => {
    expect(quotaReading(sample({ sampledAt: ago(30 * MIN) }), NOW).status).toBe('ok')
    const stale = quotaReading(sample({ sampledAt: ago(31 * MIN) }), NOW)
    expect(stale.status).toBe('stale')
    expect(plain(stale.note)).toBe('stale 31 min')
    expect(stale.pct).toBe(71)
    expect(plain(quotaReading(sample({ sampledAt: ago(3 * H) }), NOW).note)).toBe('stale 3 h')
  })

  it('carries state, pace and the reset countdown when ok', () => {
    const r = quotaReading(sample(), NOW)
    expect(r.note).toBeNull()
    expect(r.state).toBe('ok')
    expect(r.pace).toBeCloseTo((7 - 2 - 4 / 24) / 7)
    expect(plain(r.resets)).toBe('resets in 2 d 4 h')
    expect(quotaReading(sample({ sevenDayPct: 85 }), NOW).state).toBe('warn')
    expect(quotaReading(sample({ sevenDayPct: 104 }), NOW).state).toBe('over')
  })

  it('a reset already passed has no countdown and a full pace tick', () => {
    const r = quotaReading(sample({ sevenDayResetsAt: ago(H) }), NOW)
    expect(r.resets).toBeNull()
    expect(r.pace).toBe(1)
  })

  it('no reset instant: no countdown, no tick', () => {
    const r = quotaReading(sample({ sevenDayResetsAt: null }), NOW)
    expect(r.resets).toBeNull()
    expect(r.pace).toBeNull()
  })
})

describe('formatAge', () => {
  it('reads minutes, hours, days', () => {
    expect(plain(formatAge(12 * MIN))).toBe('12 min')
    expect(plain(formatAge(2 * H))).toBe('2 h')
    expect(plain(formatAge(47 * H))).toBe('47 h')
    expect(plain(formatAge(3 * D))).toBe('3 d')
  })

  it('rolls 59.6 min up to an hour instead of printing 60 min', () => {
    expect(plain(formatAge(59.6 * MIN))).toBe('1 h')
  })

  it('a bad duration is an em dash', () => {
    expect(formatAge(-1)).toBe('—')
    expect(formatAge(Number.NaN)).toBe('—')
  })
})

describe('money and vocabulary lines', () => {
  it('whole dollars, thousands separator, <$1 below one', () => {
    expect(fmtMoney(1234.4)).toBe('$1,234')
    expect(fmtMoney(0.3)).toBe('<$1')
    expect(fmtMoney(0)).toBe('$0')
  })

  it('a negative amount reads over by', () => {
    expect(fmtMoney(-65.59)).toBe('over by $66')
    expect(fmtMoney(-0.2)).toBe('over by <$1')
  })

  it('capLine prints spend, cap and percentage', () => {
    expect(plain(capLine(573, 500))).toBe('$573 / $500 (115 %)')
    expect(plain(capLine(0, 500))).toBe('$0 / $500 (0 %)')
  })

  it('canSpendLine flips to over by when negative', () => {
    expect(canSpendLine(12.4)).toBe('can spend today $12')
    expect(canSpendLine(0)).toBe('can spend today $0')
    expect(canSpendLine(-65.59)).toBe('over by $66')
  })

  it('loadFailure keeps a status and drops the raw body', () => {
    expect(
      loadFailure({ status: 404, value: 'NOT_FOUND' }, 'The quota service did not answer.').message,
    ).toBe('The quota service did not answer. (HTTP 404)')
    expect(loadFailure('NOT_FOUND', 'The quota service did not answer.').message).toBe(
      'The quota service did not answer.',
    )
  })
})

describe('budgetReading', () => {
  const budget = (over: Partial<IuBudget> = {}): IuBudget => ({
    limitUsd: 500,
    windowDays: 30,
    fetchedAt: ago(2 * H),
    windowFrom: '2026-09-27',
    windowTo: '2026-10-26',
    rolling30Usd: 588.14,
    canSpendTodayUsd: -65.59,
    burn7dUsdPerDay: 20,
    projected7dUsd: 697.45,
    daily: [],
    dropoffNext7: [],
    topModels: [],
    ...over,
  })

  it('an empty portal yields no figure: zeros are not headroom', () => {
    const r = budgetReading(
      budget({ fetchedAt: null, rolling30Usd: 0, canSpendTodayUsd: 500 }),
      NOW,
    )
    expect(r).toEqual({ freshness: 'empty', state: null, cap: null, canSpend: null, note: null })
  })

  it('over: error state, cap line and over by', () => {
    const r = budgetReading(budget(), NOW)
    expect(r.freshness).toBe('fresh')
    expect(r.state).toBe('over')
    expect(plain(r.cap)).toBe('$588 / $500 (118 %)')
    expect(r.canSpend).toBe('over by $66')
    expect(r.note).toBeNull()
  })

  it('stale keeps the value and names the fetch age', () => {
    const r = budgetReading(budget({ fetchedAt: ago(9 * H) }), NOW)
    expect(r.freshness).toBe('stale')
    expect(r.state).toBe('over')
    expect(plain(r.note)).toBe('stale · fetched 9 h')
  })

  it('dead carries the login command', () => {
    const r = budgetReading(budget({ fetchedAt: ago(3 * D) }), NOW)
    expect(r.freshness).toBe('dead')
    expect(r.note).toContain('make iu-portal-login')
  })

  it('ok and warn follow the cap', () => {
    expect(budgetReading(budget({ rolling30Usd: 100, canSpendTodayUsd: 400 }), NOW).state).toBe(
      'ok',
    )
    expect(budgetReading(budget({ rolling30Usd: 450, canSpendTodayUsd: 50 }), NOW).state).toBe(
      'warn',
    )
  })
})

describe('deltaDirection', () => {
  it('ignores sub-dollar noise', () => {
    expect(deltaDirection(31)).toBe('up')
    expect(deltaDirection(-12)).toBe('down')
    expect(deltaDirection(0.4)).toBe('flat')
    expect(deltaDirection(Number.NaN)).toBe('flat')
  })
})

describe('token accounting', () => {
  const classes = { input: 10, output: 20, cacheRead: 300, cacheWrite: 40, reasoning: 5 }

  it('fresh is input + output + cache-write + reasoning, processed adds cache-read', () => {
    expect(tokenTrio(classes)).toEqual({ fresh: 75, cacheRead: 300, processed: 375 })
  })

  it('cache-read share is of everything processed; null without tokens', () => {
    expect(cacheReadShare(classes)).toBeCloseTo(0.8)
    expect(
      cacheReadShare({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }),
    ).toBeNull()
  })

  it('$ per 1 M tokens', () => {
    expect(usdPerMillion(2, 4_000_000)).toBeCloseTo(0.5)
    expect(usdPerMillion(2, 0)).toBeNull()
    expect(fmtUsdPerMillion(0.5)).toBe('$0.50')
    expect(fmtUsdPerMillion(0.001)).toBe('<$0.01')
    expect(fmtUsdPerMillion(0)).toBe('$0.00')
    expect(fmtUsdPerMillion(null)).toBe('—')
  })
})

const flow = (over: Partial<FlowRow> & Pick<FlowRow, 'subTool' | 'model'>): FlowRow => ({
  source: 'agent-gateway-iu',
  cost: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  calls: 1,
  ...over,
})

const OCR = flow({
  subTool: 'review_ocr',
  model: 'deepseek-v4.1-flash',
  cost: 197,
  input: 210e6,
  output: 120e6,
  cacheRead: 3.5e9,
  calls: 900,
})
const ADVERSARY = flow({
  subTool: 'review:adversary',
  model: 'gpt-5.6-terra',
  cost: 86,
  input: 25e6,
  output: 2e6,
  cacheRead: 1e6,
  calls: 40,
})

describe('rankPairs', () => {
  it('an empty flow ranks nothing', () => {
    expect(rankPairs([], 'cost')).toEqual({ rows: [], total: 0 })
  })

  it('ranks by cost in the spend lens, with tokens as the muted figure', () => {
    const { rows, total } = rankPairs([ADVERSARY, OCR], 'cost')
    expect(rows.map((r) => r.label)).toEqual([
      'review_ocr · deepseek-v4.1-flash',
      'review:adversary · gpt-5.6-terra',
    ])
    expect(total).toBe(283)
    expect(rows[0]?.value).toBe(197)
    expect(rows[0]?.secondary).toBe(210e6 + 120e6 + 3.5e9)
    expect(rows[0]?.cacheReadShare).toBeCloseTo(3.5e9 / (3.5e9 + 330e6))
  })

  it('ranks by every token class incl. cache-read in the tokens lens, cost as the muted figure', () => {
    const { rows } = rankPairs([ADVERSARY, OCR], 'tokens')
    expect(rows[0]?.subTool).toBe('review_ocr')
    expect(rows[0]?.secondary).toBe(197)
  })

  it('merges the same pair across sources', () => {
    const { rows } = rankPairs(
      [
        flow({ subTool: 'worker', model: 'm', source: 'a', cost: 3, calls: 2 }),
        flow({ subTool: 'worker', model: 'm', source: 'b', cost: 4, calls: 5 }),
      ],
      'cost',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ value: 7, calls: 7, pairs: 1 })
  })

  it('names a missing model (unknown model) and keeps its call count', () => {
    const { rows } = rankPairs([flow({ subTool: 'x', model: '', cost: 5, calls: 736 })], 'cost')
    expect(rows[0]).toMatchObject({
      model: '(unknown model)',
      label: 'x · (unknown model)',
      calls: 736,
    })
  })

  it('keeps zero-cost pairs (unpriced) instead of dropping them', () => {
    const { rows } = rankPairs([OCR, flow({ subTool: 'x', model: '', calls: 736 })], 'cost')
    expect(rows.map((r) => r.subTool)).toEqual(['review_ocr', 'x'])
  })

  it('folds the tail past top into one Other row that keeps the total whole', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      flow({ subTool: `t${i}`, model: 'm', cost: 15 - i }),
    )
    const { rows, total } = rankPairs(many, 'cost')
    expect(rows).toHaveLength(13)
    const other = rows.at(-1)
    expect(other).toMatchObject({ label: 'Other', pairs: 3, value: 3 + 2 + 1 })
    expect(total).toBe(120)
  })

  it('exactly top pairs add no Other row', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      flow({ subTool: `t${i}`, model: 'm', cost: 1 }),
    )
    expect(rankPairs(rows, 'cost').rows).toHaveLength(12)
  })

  it('the API fold row joins Other even when nothing else folds', () => {
    const { rows, total } = rankPairs(
      [OCR, flow({ source: 'other', subTool: 'other', model: 'other', cost: 9 })],
      'cost',
    )
    expect(rows.map((r) => r.label)).toEqual(['review_ocr · deepseek-v4.1-flash', 'Other'])
    expect(total).toBe(206)
  })

  it('breaks ties on the label, so the order is stable', () => {
    const { rows } = rankPairs(
      [flow({ subTool: 'b', model: 'm', cost: 1 }), flow({ subTool: 'a', model: 'm', cost: 1 })],
      'cost',
    )
    expect(rows.map((r) => r.subTool)).toEqual(['a', 'b'])
  })
})

describe('toolSplits', () => {
  it('splits into four classes with reasoning inside output', () => {
    const [ocr] = toolSplits([{ ...OCR, reasoning: 5e6, cacheWrite: 7e6 }])
    expect(ocr).toMatchObject({
      subTool: 'review_ocr',
      cacheRead: 3.5e9,
      cacheWrite: 7e6,
      freshInput: 210e6,
      output: 125e6,
      noCacheData: false,
    })
    expect(ocr?.processed).toBe(3.5e9 + 7e6 + 210e6 + 125e6)
    expect(ocr?.cacheReadShare).toBeCloseTo(3.5e9 / ocr!.processed)
    expect(ocr?.usdPerMillion).toBeCloseTo((197 / ocr!.processed) * 1e6)
  })

  it('shows the fresh-input story: low cache share on the adversary lane', () => {
    const rows = toolSplits([
      ADVERSARY,
      {
        ...ADVERSARY,
        subTool: 'review:adversary',
        source: 'other-source',
        input: 5e6,
        cacheRead: 0,
      },
    ])
    expect(rows[0]?.cacheReadShare).toBeCloseTo(1e6 / 33e6)
  })

  it('sums one tool across models and sources', () => {
    const rows = toolSplits([
      flow({ subTool: 'review', model: 'a', input: 2e6, cacheRead: 2e6, cost: 1 }),
      flow({ subTool: 'review', model: 'b', input: 1e6, cacheRead: 1e6, cost: 2 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ freshInput: 3e6, cacheRead: 3e6, cost: 3 })
  })

  it('ranks by processed tokens', () => {
    const rows = toolSplits([ADVERSARY, OCR])
    expect(rows.map((r) => r.subTool)).toEqual(['review_ocr', 'review:adversary'])
  })

  it('folds tools under 1 M tokens into Other', () => {
    const rows = toolSplits([
      OCR,
      flow({ subTool: 'tiny', model: 'm', input: 400_000, cost: 1 }),
      flow({ subTool: 'tiny2', model: 'm', input: 500_000, cost: 2 }),
    ])
    expect(rows.map((r) => r.subTool)).toEqual(['review_ocr', 'Other'])
    expect(rows[1]).toMatchObject({ freshInput: 900_000, cost: 3 })
  })

  it('keeps ten tools and folds the rest', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      flow({ subTool: `t${i}`, model: 'm', input: (20 - i) * 1e6, cacheRead: 1e6 }),
    )
    const rows = toolSplits(many)
    expect(rows).toHaveLength(11)
    expect(rows.at(-1)?.subTool).toBe('Other')
  })

  it('flags a tool that recorded no cache tokens instead of reporting 0 %', () => {
    const [audio] = toolSplits([
      flow({
        source: 'audio-gateway',
        subTool: 'tts',
        model: 'm',
        input: 3e6,
        output: 1e6,
        cost: 4,
      }),
    ])
    expect(audio).toMatchObject({ noCacheData: true, cacheReadShare: null })
    expect(audio?.usdPerMillion).toBeCloseTo(1)
  })

  it('an empty flow has no tools', () => {
    expect(toolSplits([])).toEqual([])
  })

  it('the API fold row lands in Other', () => {
    const rows = toolSplits([
      OCR,
      flow({ source: 'other', subTool: 'other', model: 'other', input: 5e6 }),
    ])
    expect(rows.map((r) => r.subTool)).toEqual(['review_ocr', 'Other'])
  })
})

describe('accountTitle', () => {
  it('names the registry accounts with their plan', () => {
    expect(accountTitle('iu')).toBe('iu 20x')
    expect(accountTitle('me')).toBe('me 5x')
  })

  it('an account outside the registry reads as its id', () => {
    expect(accountTitle('zz')).toBe('zz')
  })
})

describe('freshnessBadge', () => {
  it('names the age of the fetch, in warn then bad ink once it is stale or dead', () => {
    expect(freshnessBadge(ago(2 * H), NOW)).toMatchObject({ tone: 'muted' })
    expect(plain(freshnessBadge(ago(2 * H), NOW)?.text ?? null)).toBe('fresh · 2 h')
    expect(freshnessBadge(ago(9 * H), NOW)).toMatchObject({ tone: 'warn' })
    expect(plain(freshnessBadge(ago(9 * H), NOW)?.text ?? null)).toBe('stale · fetched 9 h')
    expect(freshnessBadge(ago(3 * D), NOW)).toMatchObject({ tone: 'bad' })
    expect(plain(freshnessBadge(ago(3 * D), NOW)?.text ?? null)).toBe('dead · fetched 3 d')
  })

  it('has no badge without a fetch', () => {
    expect(freshnessBadge(null, NOW)).toBeNull()
  })
})
