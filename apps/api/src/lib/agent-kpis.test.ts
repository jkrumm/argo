import { describe, it, expect } from 'bun:test'
import {
  mondayOf,
  shapeByWeek,
  shapeIssues,
  shapeSubagents,
  weekStartOf,
  windowStart,
} from './agent-kpis.js'

describe('week math', () => {
  it('puts Sunday 23:59:59Z in the old week and Monday 00:00Z in the new one', () => {
    expect(weekStartOf(new Date('2026-11-01T23:59:59Z'))).toBe('2026-10-26')
    expect(weekStartOf(new Date('2026-11-02T00:00:00Z'))).toBe('2026-11-02')
    expect(mondayOf(new Date('2026-11-01T23:59:59Z')).toISOString()).toBe(
      '2026-10-26T00:00:00.000Z',
    )
  })

  it('windowStart includes the current partial week', () => {
    const now = new Date('2026-11-06T10:00:00Z') // Friday
    expect(windowStart(1, now).toISOString()).toBe('2026-11-02T00:00:00.000Z')
    expect(windowStart(8, now).toISOString()).toBe('2026-09-14T00:00:00.000Z')
  })

  it('windowStart on a Monday 00:00Z starts that same day for one week', () => {
    expect(windowStart(1, new Date('2026-11-02T00:00:00Z')).toISOString()).toBe(
      '2026-11-02T00:00:00.000Z',
    )
  })
})

describe('shaping', () => {
  it('returns empty shapes for empty input', () => {
    expect(shapeSubagents([])).toEqual([])
    expect(shapeByWeek([])).toEqual([])
    expect(shapeIssues([], [])).toEqual([])
  })

  it('orders subagents by cost, coerces driver strings and survives zero runs', () => {
    const rows = shapeSubagents([
      { kind: 'worker', name: 'reviewer', runs: '0', requests: '0', cost: null },
      { kind: 'subagent', name: 'Explore', runs: '4', requests: '40', cost: '2' },
      { kind: 'subagent', name: 'plan', runs: 1, requests: 3, cost: 5 },
    ])
    expect(rows.map((r) => r.name)).toEqual(['plan', 'Explore', 'reviewer'])
    expect(rows[1]).toEqual({
      kind: 'subagent',
      name: 'Explore',
      runs: 4,
      requests: 40,
      costUsd: 2,
      avgCostUsd: 0.5,
    })
    expect(rows[2]!.avgCostUsd).toBe(0)
  })

  it('orders weeks ascending, cost desc within a week', () => {
    const rows = shapeByWeek([
      { week_start: '2026-11-02', kind: 'worker', name: 'a', runs: 1, requests: 1, cost: 1 },
      { week_start: '2026-10-26', kind: 'worker', name: 'a', runs: 1, requests: 1, cost: 1 },
      { week_start: '2026-11-02', kind: 'subagent', name: 'b', runs: 1, requests: 1, cost: 3 },
    ])
    expect(rows.map((r) => `${r.weekStart}/${r.name}`)).toEqual([
      '2026-10-26/a',
      '2026-11-02/b',
      '2026-11-02/a',
    ])
  })

  it('attaches lanes to their issue, newest issue first, capped by the limit', () => {
    const issue = (id: string, last: string) => ({
      issue_id: id,
      repo: null,
      first_ts: last,
      last_ts: last,
      runs: 2,
      requests: 5,
      cost: 1.5,
    })
    const out = shapeIssues(
      [
        issue('1', '2026-11-01T00:00:00.000Z'),
        issue('2', '2026-11-03T00:00:00.000Z'),
        issue('3', '2026-11-02T00:00:00.000Z'),
      ],
      [
        { issue_id: '2', lane: 'lead', name: 'lead', runs: 1, requests: 2, cost: 0.5 },
        { issue_id: '2', lane: 'subagent', name: 'Explore', runs: 1, requests: 3, cost: 1 },
      ],
      2,
    )
    expect(out.map((i) => i.issueId)).toEqual(['2', '3'])
    expect(out[0]!.lanes.map((l) => l.lane)).toEqual(['subagent', 'lead'])
    expect(out[1]!.lanes).toEqual([])
  })
})
