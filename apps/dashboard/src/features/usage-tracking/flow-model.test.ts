import { describe, expect, it } from 'bun:test'
import type { InsightsResponse } from '../../lib/queries/usage'
import { DEMAND, PACE, ROUTER } from './flow-fixtures'
import {
  agwOnKey,
  agwReading,
  cacheShare,
  lastRequestNote,
  coldCaller,
  costPerRun,
  demandTotals,
  factsOf,
  fmtAxisUsd,
  fmtDay,
  fmtInstant,
  fmtRate,
  fmtUsd,
  insightsPeriodOf,
  insightsView,
  iuByCause,
  laneLabel,
  originKnown,
  PURPOSES,
  purposeSegments,
  picksByReason,
  picksByTarget,
  picksPerDay,
  poolReading,
  poolTitle,
  reportAgeNote,
  routerNotes,
  routerTotals,
  verdictOf,
  workflowRow,
} from './flow-model'

const text = (parts: readonly { text: string }[]) => parts.map((p) => p.text).join('')
const NOW = new Date(PACE.asOf).getTime()

describe('money and dates', () => {
  it('whole dollars from ten up, cents under ten, <$1 below one, thousands separated', () => {
    expect(fmtUsd(0)).toBe('$0')
    expect(fmtUsd(0.4)).toBe('<$1')
    expect(fmtUsd(3.256)).toBe('$3.26')
    expect(fmtUsd(9.999)).toBe('$10.00')
    expect(fmtUsd(88.43)).toBe('$88')
    expect(fmtUsd(1380)).toBe('$1,380')
    expect(fmtUsd(null)).toBe('—')
    expect(fmtUsd(Number.NaN)).toBe('—')
    expect(fmtUsd(-66)).toBe('−$66')
  })

  it('an axis tick keeps its cents under ten and never reads <$1', () => {
    expect(fmtAxisUsd(0)).toBe('$0')
    expect(fmtAxisUsd(0.5)).toBe('$0.50')
    expect(fmtAxisUsd(2)).toBe('$2.00')
    expect(fmtAxisUsd(1500)).toBe('$1,500')
  })

  it('a rate reads per day', () => {
    expect(fmtRate(8.65)).toBe('$8.65/d')
    expect(fmtRate(85)).toBe('$85/d')
    expect(fmtRate(null)).toBe('—')
  })

  it('days and instants are UTC', () => {
    expect(fmtDay('2026-11-04T23:59:00.000Z')).toBe('4 Nov')
    expect(fmtDay('2026-11-12')).toBe('12 Nov')
    expect(fmtInstant('2026-11-02T16:00:00.000Z')).toBe('2 Nov 16:00 UTC')
    expect(fmtDay('nonsense')).toBe('—')
  })
})

describe('verdictOf', () => {
  it('over pace: dry date, days before the first renewal, the pool that renews, thin', () => {
    const v = verdictOf(PACE)
    expect(text(v.sentence)).toBe(
      'Credit runs dry on 4 Nov at today’s rate, 16 days before iu renews.',
    )
    expect(v.sentence.find((p) => p.tone === 'warn')?.text).toBe('dry on 4 Nov')
    expect(v.badge).toBe('Over pace')
    expect(v.thin).toBe('rate from 16 h')
    expect(v.asOf).toBe('state now, 2 Nov 16:00 UTC')
  })

  it('the IU clause is independent and inks past one dollar', () => {
    expect(verdictOf(PACE).iuClause).toEqual({ text: 'Claude on IU since the cutover: $0.' })
    const warn = verdictOf({ ...PACE, claudeOnIuUsd: 12.4 }).iuClause
    expect(warn).toEqual({ text: 'Claude on IU since the cutover: $12.', tone: 'warn' })
    expect(verdictOf({ ...PACE, claudeOnIuUsd: 0.9 }).iuClause.tone).toBeUndefined()
  })

  it('under: names the credit that expires unspent and when, without the warn ink', () => {
    const pools = PACE.pools.map((p) =>
      p.account === 'me'
        ? { ...p, projection: { ...p.projection, dryAt: null, unspentAtEndUsd: 69.09 } }
        : p,
    )
    const v = verdictOf({ ...PACE, verdict: 'under', spill: null, thin: false, pools })
    expect(text(v.sentence)).toBe('Credit expires unspent: ≈ $69 on 27 Nov.')
    expect(v.sentence.some((p) => p.tone === 'warn')).toBe(false)
    expect(v.thin).toBeNull()
  })

  it('on pace and no pool read as plain sentences', () => {
    expect(text(verdictOf({ ...PACE, verdict: 'on-pace', spill: null }).sentence)).toBe(
      'Credit is on pace to be spent before it expires.',
    )
    expect(text(verdictOf({ ...PACE, verdict: 'no-pool', spill: null }).sentence)).toBe(
      'No credit pool enabled.',
    )
  })
})

describe('factsOf', () => {
  const cells = Object.fromEntries(factsOf(PACE, NOW).map((c) => [c.key, c]))

  it('credit left sums the enabled pools and names the pool that is not enabled', () => {
    expect(cells['left']?.value).toBe('$182')
    expect(cells['left']?.footer).toContain('of $300 enabled')
    expect(cells['left']?.footer).toContain('me2 not enabled')
  })

  it('the pace to spend it all is the sum of the pools’ required rates', () => {
    expect(cells['required']?.value).toBe('$8.65/d')
    expect(cells['required']?.footer).toBe('iu $4.82 · me $3.83')
  })

  it('production on credit takes the warn ink when over pace, evals stay apart', () => {
    expect(cells['production']?.value).toBe('$85/d')
    expect(cells['production']?.tone).toBe('warn')
    expect(cells['production']?.footer).toBe('evals $11/d apart')
  })

  it('Claude on IU since the cutover is the pace figure, all by design while none reached it', () => {
    expect(cells['iu']?.caption).toBe('IU since the cutover')
    expect(cells['iu']?.value).toBe('$0')
    expect(cells['iu']?.footer).toBe('no fallback · all by design')
    expect(cells['iu']?.tone).toBeUndefined()
    const some = factsOf({ ...PACE, claudeOnIuUsd: 0.5 }, NOW).find((c) => c.key === 'iu')
    expect(some?.value).toBe('<$1')
    expect(some?.footer).toBe('fallback or Claude Code shaped')
    expect(some?.tone).toBeUndefined()
    const claude = factsOf({ ...PACE, claudeOnIuUsd: 5 }, NOW).find((c) => c.key === 'iu')
    expect(claude?.value).toBe('$5.00')
    expect(claude?.tone).toBe('warn')
  })

  it('the personal key states the cap and when it falls under, in the bad ink once over', () => {
    expect(cells['key']?.value).toBe('$578')
    expect(cells['key']?.tone).toBe('bad')
    expect(cells['key']?.footer).toBe('of $500 cap · under it around 12 Nov')
    const none = factsOf({ ...PACE, personalKey: { ...PACE.personalKey, fetchedAt: null } }, NOW)
    expect(none.find((c) => c.key === 'key')?.value).toBe('—')
    expect(none.find((c) => c.key === 'key')?.footer).toBe('no portal report yet')
  })

  it('a provider report older than six hours is named beside credit left', () => {
    expect(reportAgeNote(PACE, NOW)).toBeNull()
    const later = NOW + 8 * 3_600_000
    expect(reportAgeNote(PACE, later)).toBe('provider report 9\u00a0h old')
    expect(factsOf(PACE, later).find((c) => c.key === 'left')?.footer).toContain(
      'provider report 9\u00a0h old',
    )
  })

  it('no pool enabled reads a dash, not zero', () => {
    const none = factsOf(
      { ...PACE, verdict: 'no-pool', pools: PACE.pools.filter((p) => !p.enabled) },
      NOW,
    )
    expect(none.find((c) => c.key === 'left')?.value).toBe('—')
    expect(none.find((c) => c.key === 'required')?.value).toBe('—')
  })
})

describe('poolReading', () => {
  const [iu, me, me2] = PACE.pools

  it('names a pool by its payer and plan', () => {
    expect(poolTitle('iu')).toBe('IU credit · Ultra')
    expect(poolTitle('me2')).toBe('Me2 credit · Max')
  })

  it('reads expiry, pace needed, dry date and the lead on an even pace', () => {
    const r = iu === undefined ? null : poolReading(iu, PACE.asOf)
    expect(r?.line).toBe(
      'expires 21 Nov · 18 d · needs $4.82/d · dry 3 Nov · $30 ahead of even pace',
    )
    expect(r?.leftUsd).toBe(88.43)
    expect(r?.evenSpentUsd).toBe(82)
    expect(r?.outsideUsd).toBe(56.11)
    expect(r?.throughUsd).toBeCloseTo(55.46, 2)
  })

  it('a pool the router has not reached yet says when it starts drawing', () => {
    const r = me === undefined ? null : poolReading(me, PACE.asOf)
    expect(
      r?.line.startsWith('expires 27 Nov · 24 d · needs $3.83/d · draws from 3 Nov · dry 4 Nov'),
    ).toBe(true)
    expect(r?.line.endsWith('behind even pace')).toBe(true)
  })

  it('a pool that is not enabled has no balance and says why', () => {
    const r = me2 === undefined ? null : poolReading(me2, PACE.asOf)
    expect(r?.enabled).toBe(false)
    expect(r?.leftUsd).toBeNull()
    expect(r?.note).toBe('not enabled · key not claimed · cycle unknown')
  })
})

describe('router node totals', () => {
  it('count picks and refusals, and the card’s IU dollars are the detail’s', () => {
    const totals = routerTotals(ROUTER)
    expect(totals.picks).toBe(2719)
    expect(totals.refused).toBe(0)
    const causes = iuByCause(ROUTER.iu)
    expect(totals.iuUsd).toBeCloseTo(
      causes.reduce((acc, c) => acc + c.usd, 0),
      6,
    )
    expect(totals.iuUsd).toBeCloseTo(3.273, 3)
  })

  it('groups picks by target and by reason, most first', () => {
    expect(picksByTarget(ROUTER.picks)).toEqual([
      { target: 'iu', n: 1979 },
      { target: 'me', n: 723 },
      { target: 'iu-api', n: 17 },
    ])
    expect(picksByReason(ROUTER.picks, 'iu').map((r) => r.reason)).toEqual([
      'bound',
      'soonest expiry',
    ])
    expect(picksByReason(ROUTER.picks).at(0)).toEqual({ reason: 'bound', n: 1658 })
  })

  it('every cause is present, Claude work on IU warns once it carries a dollar', () => {
    const causes = iuByCause(ROUTER.iu)
    expect(causes.map((c) => c.cause)).toEqual([
      'design',
      'eval',
      'claude-code',
      'forced',
      'credit-fallback',
      'route-fallback',
    ])
    expect(causes.filter((c) => c.warn).map((c) => c.cause)).toEqual(['claude-code'])
  })

  it('days are ascending and sum to the totals', () => {
    const days = picksPerDay(ROUTER.picks)
    expect(days.map((d) => d.day)).toEqual(['2026-11-01', '2026-11-02'])
    const sum = days.reduce((acc, d) => acc + Object.values(d.values).reduce((a, b) => a + b, 0), 0)
    expect(sum).toBe(routerTotals(ROUTER).picks)
  })

  it('says what is unverified or unmeasured', () => {
    expect(routerNotes(ROUTER)).toEqual([
      'Route fallback is not measured yet: agw does not mark it, so it reads as zero.',
    ])
    expect(routerNotes({ ...ROUTER, picksAvailable: false, routeFallbackMeasured: true })).toEqual([
      'The picks table is not readable: the IU causes are unverified.',
    ])
  })

  it('names the caller with volume and almost no cache read', () => {
    const rows = ROUTER.cache.map((c) => ({ key: `${c.caller}|${c.target}`, ...c }))
    expect(coldCaller(rows)?.caller).toBe('agw direct')
    expect(coldCaller(rows.filter((r) => r.caller !== 'agw direct'))).toBeNull()
  })
})

describe('demand node totals', () => {
  it('a workflow row’s dollars are what its detail header reads', () => {
    const row = workflowRow(DEMAND, 'review')
    expect(row?.usd).toBe(54.91)
    expect(workflowRow(DEMAND, 'nope')).toBeUndefined()
  })

  it('production is everything that is not an eval', () => {
    const t = demandTotals(DEMAND)
    expect(t.usd).toBe(58.86)
    expect(t.evalUsd).toBeCloseTo(2.8, 6)
    expect(t.productionUsd).toBeCloseTo(56.06, 6)
  })

  it('cost per run and cache share are absent without a run or tokens', () => {
    const [review, otel] = DEMAND.rows
    expect(review === undefined ? null : costPerRun(review)).toBeCloseTo(0.7844, 3)
    expect(otel === undefined ? 0 : costPerRun(otel)).toBeNull()
    expect(review === undefined ? null : cacheShare(review)).toBeCloseTo(0.75, 6)
  })

  it('who asked agw is unknown while every row is unset', () => {
    const unset = { ...DEMAND, rows: DEMAND.rows.map((r) => ({ ...r, key: '(unset)' })) }
    expect(originKnown(unset)).toBe(false)
    expect(originKnown(DEMAND)).toBe(true)
  })

  it('a lane key reads as words', () => {
    expect(laneLabel('wave_mother')).toBe('wave mother')
  })
})

describe('agwOnKey', () => {
  const bucket = (iso: string, usd: number | null) => ({
    bucket: iso,
    groups: { 'agent-workflows': usd, hermes: 5 },
  })
  const CUTOVER = Date.parse('2026-11-02T00:26:00Z')

  it('sums agw since the cutover and names the last hour agw billed the key', () => {
    const r = agwOnKey(
      [
        bucket('2026-11-01T06:00:00Z', 2),
        bucket('2026-11-02T08:00:00Z', 3),
        bucket('2026-11-02T09:00:00Z', 0),
      ],
      CUTOVER,
    )
    expect(r).toEqual({ sinceUsd: 3, lastRowAt: '2026-11-02T08:00:00Z' })
  })

  it('counts the hour that holds the cutover, and nothing that ended before it', () => {
    const r = agwOnKey(
      [
        bucket('2026-11-01T23:00:00Z', 7),
        bucket('2026-11-02T00:00:00Z', 4),
        bucket('2026-11-02T01:00:00Z', 1),
      ],
      CUTOVER,
    )
    expect(r.sinceUsd).toBe(5)
    expect(r.lastRowAt).toBe('2026-11-02T01:00:00Z')
  })

  it('a bucket of unknown cost is a row, a zero-filled hour is not', () => {
    const r = agwOnKey(
      [
        bucket('2026-11-02T05:00:00Z', 2),
        bucket('2026-11-02T06:00:00Z', null),
        bucket('2026-11-02T07:00:00Z', 0),
      ],
      CUTOVER,
    )
    expect(r).toEqual({ sinceUsd: 2, lastRowAt: '2026-11-02T06:00:00Z' })
  })

  it('a key agw has left reads zero', () => {
    expect(agwOnKey([bucket('2026-10-30T06:00:00Z', 9)], CUTOVER)).toEqual({
      sinceUsd: 0,
      lastRowAt: '2026-10-30T06:00:00Z',
    })
    expect(agwOnKey([], CUTOVER)).toEqual({ sinceUsd: 0, lastRowAt: null })
  })
})

describe('purposeSegments', () => {
  it('covers every purpose, so the bar sums to the row', () => {
    expect([...PURPOSES]).toEqual(['prod', 'verify', 'eval', 'other'])
    const row = {
      ...(DEMAND.rows[0] as (typeof DEMAND.rows)[number]),
      usd: 10,
      byPurpose: { prod: 6, verify: 1, eval: 2, other: 1 },
    }
    const segments = purposeSegments(row)
    expect(segments.map((x) => x.key)).toEqual(['prod', 'verify', 'eval', 'other'])
    expect(segments.reduce((acc, x) => acc + x.usd, 0)).toBe(row.usd)
  })

  it('drops purposes with no cost', () => {
    const row = { ...(DEMAND.rows[1] as (typeof DEMAND.rows)[number]) }
    expect(purposeSegments(row).map((x) => x.key)).toEqual(['prod', 'eval'])
  })
})

describe('insights strip', () => {
  const item = (id: string, rank: number, thin = false) => ({
    id,
    rank,
    node: 'router',
    sentence: `sentence ${id}`,
    facts: {},
    usdMoved: 10 - rank,
    thin,
  })
  const data = (over: Partial<InsightsResponse>): InsightsResponse => ({
    asOf: PACE.asOf,
    period: '7d',
    items: [],
    unavailable: [],
    ...over,
  })

  it('the page range maps onto the periods the endpoint offers', () => {
    expect(insightsPeriodOf('7d')).toBe('7d')
    expect(['30d', '90d', 'all'].map((r) => insightsPeriodOf(r as '30d'))).toEqual([
      '30d',
      '30d',
      '30d',
    ])
  })

  it('ranks the items, at most five, and has no note while items are shown and every source was read', () => {
    const v = insightsView(data({ items: [3, 1, 2, 5, 4, 6].map((n) => item(`i${n}`, n)) }))
    expect(v.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5])
    expect(v.note).toBeNull()
  })

  it('says nothing stands out only when nothing is empty and nothing unread', () => {
    expect(insightsView(data({})).note).toBe('Nothing stands out.')
  })

  it('names the sources that could not be read instead, even over an empty list', () => {
    const v = insightsView(
      data({ unavailable: ['pace', 'iu-budget:personal', 'iu-budget:athena-team'] }),
    )
    expect(v.items).toEqual([])
    expect(v.note).toBe('Could not read the credit pace, the IU personal key, the athena-team key.')
  })

  it('keeps the items that fired beside the unread note', () => {
    const v = insightsView(data({ items: [item('a', 1, true)], unavailable: ['router'] }))
    expect(v.items.map((i) => i.id)).toEqual(['a'])
    expect(v.note).toBe('Could not read the router.')
  })
})

describe('lastRequestNote', () => {
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()

  it('stays silent while the newest gateway row is within 30 min, or there is none', () => {
    expect(lastRequestNote(at(2), NOW)).toBeNull()
    expect(lastRequestNote(at(30), NOW)).toBeNull()
    expect(lastRequestNote(null, NOW)).toBeNull()
  })

  it('reads the age once the newest row is older than 30 min', () => {
    expect(lastRequestNote(at(31), NOW)).toBe('last request 31\u00a0min ago')
    expect(lastRequestNote(at(180), NOW)).toBe('last request 3\u00a0h ago')
    expect(lastRequestNote(at(3 * 24 * 60), NOW)).toBe('last request 3\u00a0d ago')
  })

  it('reads the fixture as fresh at the spec instant', () => {
    expect(lastRequestNote(ROUTER.lastRequestAt, NOW)).toBeNull()
  })
})

describe('agwReading', () => {
  const NOW = Date.parse('2026-11-02T14:00:00Z')

  it('bills only while an agw row is newer than 6 h', () => {
    expect(agwReading('2026-11-02T09:00:00Z', NOW)).toEqual({ state: 'bills' })
  })

  it('a key agw left hours ago reads quiet, not as still billed', () => {
    expect(agwReading('2026-11-02T08:00:00Z', NOW)).toEqual({ state: 'quiet' })
    expect(agwReading('2026-11-01T06:00:00Z', NOW)).toEqual({ state: 'quiet' })
  })

  it('no agw row at all is its own reading', () => {
    expect(agwReading(null, NOW)).toEqual({ state: 'none' })
  })
})

describe('agwOnKey past the hourly window', () => {
  const hour = (iso: string, usd: number) => ({
    bucket: iso,
    groups: { 'agent-workflows': usd },
  })
  const day = (iso: string, usd: number) => ({
    bucket: iso,
    groups: { 'agent-workflows': usd },
  })
  it('adds the whole days before the first hourly bucket, from the cutover day on', () => {
    const r = agwOnKey(
      [hour('2026-10-10T00:00:00Z', 1), hour('2026-10-10T01:00:00Z', 2)],
      Date.parse('2026-10-05T12:00:00Z'),
      [
        day('2026-10-04', 100),
        day('2026-10-05', 10),
        day('2026-10-09', 20),
        day('2026-10-10', 999),
      ],
    )
    expect(r.sinceUsd).toBe(33)
    expect(r.lastRowAt).toBe('2026-10-10T01:00:00Z')
  })
})
