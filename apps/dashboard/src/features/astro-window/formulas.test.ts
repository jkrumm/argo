import { describe, expect, test } from 'bun:test'
import {
  coreGateDetail,
  coreGateFailure,
  coreMeterReading,
  hourlyTicks,
  hourlyTimeLabel,
  nightNote,
} from './formulas'
import type { Night } from './types'

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

describe('nightNote', () => {
  const base = {
    verdict: 'out',
    window: null,
    killers: [{ id: 'core-altitude', label: 'Core altitude', reason: 'r' }],
    gateCoreAltitude: 4.2,
    coreGateDeg: 8,
    moon: { illumination: 0.5, phase: 90, rise: null, set: null },
  } as unknown as Night

  test('a night out on the core gate states how far it fell short', () => {
    expect(nightNote(base)).toBe('3.8° short')
  })

  test('a night out on another gate names its killer', () => {
    const night = { ...base, killers: [{ id: 'darkness', label: 'Darkness', reason: 'r' }] }
    expect(nightNote(night)).toBe('no dark')
  })

  test('a usable night shows its window length', () => {
    const night = {
      ...base,
      verdict: 'good',
      killers: [],
      window: { minutes: 150 },
    } as unknown as Night
    expect(nightNote(night)).toBe('2h 30m')
  })
})

describe('coreGateFailure', () => {
  const night = (killers: { id: string }[]) => ({ killers }) as unknown as Night
  test('true only when the core-altitude gate ruled the night out', () => {
    expect(coreGateFailure(night([{ id: 'core-altitude' }]))).toBe(true)
    expect(coreGateFailure(night([{ id: 'moon' }]))).toBe(false)
    expect(coreGateFailure(night([]))).toBe(false)
  })
})

describe('coreMeterReading', () => {
  test('a night that clears the gate still carries its reading and gate', () => {
    const night = { killers: [], gateCoreAltitude: 12.4, coreGateDeg: 8 } as unknown as Night
    expect(coreMeterReading(night)).toEqual({ reading: 12.4, gate: 8 })
  })
  test('no dark stretch, no reading', () => {
    const night = { killers: [], gateCoreAltitude: null, coreGateDeg: null } as unknown as Night
    expect(coreMeterReading(night)).toBeNull()
  })
})

describe('coreGateDetail', () => {
  const failed = (reason: string) =>
    ({
      killers: [{ id: 'core-altitude', label: 'Core altitude', reason }],
      gateCoreAltitude: 5,
      coreGateDeg: 12,
    }) as unknown as Night
  test('a ridge-blocked night keeps the API reason that names the ridge', () => {
    expect(coreGateDetail(failed('core below the 12° ridge gate'))).toBe(
      'core below the 12° ridge gate',
    )
  })
  test('a clearing night says so', () => {
    const night = { killers: [], gateCoreAltitude: 12, coreGateDeg: 8 } as unknown as Night
    expect(coreGateDetail(night)).toBe('clears the gate')
  })
})
