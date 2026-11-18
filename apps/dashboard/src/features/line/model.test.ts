import { describe, expect, it } from 'bun:test'
import {
  durationText,
  formatLoss,
  formatUptime,
  median,
  outageZones,
  targetLabel,
  verdict,
} from './model'

describe('formatUptime', () => {
  it('truncates rather than rounds up, so a real outage never reads 100', () => {
    expect(formatUptime(99.996)).toBe('99.99')
    expect(formatUptime(99.931)).toBe('99.93')
    expect(formatUptime(100)).toBe('100')
  })
})

describe('formatLoss', () => {
  it('keeps a real loss visible and a clean window at 0', () => {
    expect(formatLoss(0)).toBe('0')
    expect(formatLoss(0.004)).toBe('<0.01')
    expect(formatLoss(0.081)).toBe('0.08')
    expect(formatLoss(null)).toBe('—')
  })
})

describe('outageZones', () => {
  it('widens a sub-pixel outage to the minimum share of the axis, centred, in ms', () => {
    const [zone] = outageZones(
      [{ start: 5000, end: 5030, ongoing: false }],
      0,
      10_000,
      'fill',
      0.01,
    )
    expect(zone).toEqual({ from: 4_965_000, to: 5_065_000, fill: 'fill' })
  })

  it('leaves a long outage as it is and clamps to the axis', () => {
    const zones = outageZones(
      [
        { start: 1000, end: 3000, ongoing: false },
        { start: 9990, end: 10_000, ongoing: true },
      ],
      0,
      10_000,
      'f',
      0.001,
    )
    expect(zones[0]).toMatchObject({ from: 1_000_000, to: 3_000_000 })
    expect(zones[1]?.to).toBe(10_000_000)
  })
})

describe('verdict', () => {
  const NOW = 1_000_000_000
  it('is quiet when up, warns when stale, is bad when down', () => {
    expect(verdict('up', NOW / 1000 - 20, null, NOW).tone).toBeUndefined()
    expect(verdict('stale', NOW / 1000 - 3600, null, NOW)).toMatchObject({
      word: 'No data',
      tone: 'warn',
    })
    expect(verdict('down', NOW / 1000, NOW / 1000 - 600, NOW)).toMatchObject({
      word: 'Down',
      tone: 'bad',
    })
  })
})

describe('median', () => {
  it('takes the middle, the mean of the middle two, and null for nothing', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('labels', () => {
  it('names the router and falls back to the raw target', () => {
    expect(targetLabel('gateway')).toBe('Router')
    expect(targetLabel('unknown-target')).toBe('unknown-target')
    expect(durationText(420)).toContain('7')
  })
})
