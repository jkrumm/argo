import { describe, expect, test } from 'bun:test'
import {
  coreGateDetail,
  coreGateFailure,
  coreMeterReading,
  hourlyTicks,
  hourlyTimeLabel,
  nightNote,
  closestNight,
  coreTransitFooter,
  countOffscreen,
  longestWindow,
  offscreenNightsText,
  nightShortfall,
  pageSummary,
  shortfallScale,
  shortfallShare,
  verdictHeadline,
  windowShare,
} from './formulas'
import type { Night, WindowResponse } from './types'

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

const outNight = (date: string, gate: number, reading: number): Night =>
  ({
    date,
    verdict: 'out',
    window: null,
    killers: [{ id: 'core-altitude', label: 'Core altitude', reason: 'r' }],
    gateCoreAltitude: reading,
    coreGateDeg: gate,
  }) as unknown as Night

const goNight = {
  date: '2026-06-13',
  verdict: 'good',
  window: { localStart: '23:10', localEnd: '01:40', minutes: 150 },
  killers: [],
  gateCoreAltitude: 20,
  coreGateDeg: 8,
} as unknown as Night

describe('verdictHeadline', () => {
  test('a GO night states its window once: day, clock range, length', () => {
    expect(verdictHeadline(goNight)).toBe('GO · Sat 13, 23:10–01:40 · 2h 30m')
  })

  test('a GO night without a window names the day only', () => {
    expect(verdictHeadline({ ...goNight, window: null })).toBe('GO · Sat 13')
  })

  test('a 0.0° gap falls back to the killer label, not "0.0° under the gate"', () => {
    expect(verdictHeadline(outNight('2026-06-13', 8, 8))).toBe('OUT · core altitude')
    expect(nightNote(outNight('2026-06-13', 8, 8))).toBe('core low')
  })

  test('an OUT night on the core gate states the gap', () => {
    expect(verdictHeadline(outNight('2026-06-13', 8, 4.1))).toBe('OUT · core 3.9° under the gate')
  })
})

describe('pageSummary', () => {
  const response = (nights: Night[], bestDate: string | null): WindowResponse =>
    ({
      nights,
      bestDate,
      bestWindow: nights.find((n) => n.window !== null)?.window ?? null,
      location: { name: 'Site' },
    }) as unknown as WindowResponse

  test('Tonight leaves the window to the verdict card', () => {
    const out = outNight('2026-06-14', 8, 4)
    const summary = pageSummary(response([goNight, out], '2026-06-13'), { withWindow: false })
    expect(summary.sentence).toBe('1 of 2 nights usable')
    expect(summary.facts).toEqual(['best Sat 13', '1 ruled out'])
  })

  test('Forecast states the GO window range, once', () => {
    const out = outNight('2026-06-14', 8, 4)
    const summary = pageSummary(response([goNight, out], '2026-06-13'), { withWindow: true })
    expect(summary.facts).toEqual(['best Sat 13, 23:10–01:40', '1 ruled out'])
    expect(summary.facts.join(' ').match(/23:10/g)).toHaveLength(1)
  })

  test('an all-out week names the night with the smallest gap, not the first', () => {
    const nights = [outNight('2026-06-13', 8, 4), outNight('2026-06-14', 8, 6)]
    const summary = pageSummary(response(nights, '2026-06-13'), { withWindow: false })
    expect(summary.sentence).toBe('No usable night in the next 2')
    expect(summary.facts).toEqual(['closest Sun 14'])
  })

  test('one night reads in the singular and takes the range from the marked night', () => {
    const summary = pageSummary(response([goNight], '2026-06-13'), { withWindow: true })
    expect(summary.sentence).toBe('1 of 1 night usable')
    expect(summary.facts).toEqual(['best Sat 13, 23:10–01:40'])
  })

  test('an all-out week with no degree gap says "first", as the API only gives the first night', () => {
    const dark = {
      ...outNight('2026-06-13', 8, 4),
      killers: [{ id: 'moon', label: 'Moon', reason: 'r' }],
    }
    const summary = pageSummary(response([dark], '2026-06-13'), { withWindow: false })
    expect(summary.facts).toEqual(['first Sat 13'])
  })
})

describe('closestNight', () => {
  test('picks the smallest shortfall and ignores usable nights', () => {
    const nights = [outNight('2026-06-13', 8, 4), outNight('2026-06-14', 8, 6), goNight]
    expect(closestNight(nights)?.date).toBe('2026-06-14')
  })

  test('ranks on the unrounded gap: 3.96° beats 3.99° though both show 4.0°', () => {
    const a = outNight('2026-06-13', 8, 4.01)
    const b = outNight('2026-06-14', 8, 4.04)
    expect(closestNight([a, b])?.date).toBe('2026-06-14')
  })

  test('null when no night has a degree gap', () => {
    expect(closestNight([goNight])).toBeNull()
  })
})

describe('countOffscreen', () => {
  test('counts cells ending past the scroller edge, in one coordinate space', () => {
    expect(countOffscreen([80, 170, 260, 350], 300, 1)).toBe(1)
  })

  test('a cell within the tolerance of the edge counts as visible', () => {
    expect(countOffscreen([300.5], 300, 1)).toBe(0)
  })
})

describe('offscreenNightsText', () => {
  test('pluralises, and builds the visible cue and the spoken suffix together', () => {
    expect(offscreenNightsText(0)).toEqual({ visible: '', spoken: '' })
    expect(offscreenNightsText(1)).toEqual({
      visible: '1 more night →',
      spoken: '1 more night off-screen',
    })
    expect(offscreenNightsText(6).spoken).toBe('6 more nights off-screen')
  })
})

describe('coreTransitFooter', () => {
  test('is the transit altitude only, even with a dark stretch', () => {
    const night = { maxCoreAltitude: 24.1, darkMinutes: 300 } as unknown as Night
    expect(coreTransitFooter(night)).toBe('24.1° at transit')
  })

  test("a daylight transit (no dark stretch) is never called the night's best", () => {
    const night = { maxCoreAltitude: 24.1, darkMinutes: 0 } as unknown as Night
    expect(coreTransitFooter(night)).toBe('24.1° at transit')
  })
})

describe('night shortfall', () => {
  const nights = [outNight('2026-06-13', 8, 4), outNight('2026-06-14', 8, 6), goNight]

  test('only a night out on the core gate has a degree gap', () => {
    expect(nightShortfall(nights[0]!)).toBe(4)
    expect(nightShortfall(goNight)).toBeNull()
  })

  test('the scale is the largest gap, so nights differ visibly', () => {
    expect(shortfallScale(nights)).toBe(4)
    expect(shortfallShare(nights[0]!, 4)).toBe(1)
    expect(shortfallShare(nights[1]!, 4)).toBe(0.5)
    expect(shortfallShare(goNight, 4)).toBeNull()
  })

  test('a tiny shortfall keeps a visible floor and a bad scale draws nothing', () => {
    const tiny = outNight('2026-06-13', 8, 7.96)
    expect(shortfallShare(tiny, 4)).toBeGreaterThan(0)
    expect(shortfallShare(nights[0]!, 0)).toBeNull()
  })

  test('the scale never drops under 1°', () => {
    expect(shortfallScale([goNight])).toBe(1)
  })
})

describe('window share', () => {
  const longNight = { ...goNight, window: { ...goNight.window!, minutes: 300 } } as Night

  test('usable nights differ on one shared scale, the longest window filling it', () => {
    const longest = longestWindow([goNight, longNight])
    expect(longest).toBe(300)
    expect(windowShare(longNight, longest)).toBe(1)
    expect(windowShare(goNight, longest)).toBe(0.5)
  })

  test('an empty window has no share', () => {
    expect(
      windowShare({ ...goNight, window: { ...goNight.window!, minutes: 0 } } as Night, 300),
    ).toBeNull()
  })

  test('an out night or a night without a window has no share', () => {
    expect(windowShare(outNight('2026-06-13', 8, 4), 300)).toBeNull()
    expect(windowShare({ ...goNight, window: null }, 300)).toBeNull()
  })
})
