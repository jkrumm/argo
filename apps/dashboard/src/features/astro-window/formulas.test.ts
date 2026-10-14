import { describe, expect, test } from 'bun:test'
import { hourlyTicks, hourlyTimeLabel } from './formulas'

// Europe/Berlin fall-back night 2026-10-25: 02:00 and 02:30 local occur twice (CEST, then CET).
const FALL_BACK = [
  { time: '2026-10-24T23:30:00.000Z', localTime: '01:30' },
  { time: '2026-10-25T00:00:00.000Z', localTime: '02:00' },
  { time: '2026-10-25T00:30:00.000Z', localTime: '02:30' },
  { time: '2026-10-25T01:00:00.000Z', localTime: '02:00' },
  { time: '2026-10-25T01:30:00.000Z', localTime: '02:30' },
  { time: '2026-10-25T02:00:00.000Z', localTime: '03:00' },
]

describe('hourlyTimeLabel', () => {
  test('labels every sample by instant, including both fall-back 02:00s', () => {
    const label = hourlyTimeLabel(FALL_BACK)
    expect(FALL_BACK.map((d) => label(new Date(d.time)))).toEqual(FALL_BACK.map((d) => d.localTime))
  })

  test('keys stay unique across the fall-back night', () => {
    const keys = new Set(FALL_BACK.map((d) => new Date(d.time).getTime()))
    expect(keys.size).toBe(FALL_BACK.length)
  })

  test('an instant that is not a sample has no label', () => {
    expect(hourlyTimeLabel(FALL_BACK)(new Date('2026-10-25T00:10:00.000Z'))).toBe('')
  })
})

describe('hourlyTicks', () => {
  test('keeps on-the-hour samples only, both fall-back 02:00s included', () => {
    expect(hourlyTicks(FALL_BACK).map((d) => d.toISOString())).toEqual([
      '2026-10-25T00:00:00.000Z',
      '2026-10-25T01:00:00.000Z',
      '2026-10-25T02:00:00.000Z',
    ])
  })

  test('thins to at most `max` ticks', () => {
    const day = Array.from({ length: 48 }, (_, i) => ({
      time: new Date(Date.UTC(2026, 5, 1, 0, i * 30)).toISOString(),
      localTime: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
    }))
    expect(hourlyTicks(day, 7).length).toBeLessThanOrEqual(7)
  })

  test('no samples, no ticks', () => {
    expect(hourlyTicks([])).toEqual([])
  })
})
