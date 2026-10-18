import { describe, expect, test } from 'bun:test'
import {
  coreGateDetail,
  coreGateFact,
  coreGateFailure,
  coreMeterReading,
  hourlyTicks,
  hourlyTimeLabel,
  nightNote,
  closestNight,
  coreTransitFooter,
  fmtDegrees,
  countOffscreen,
  longestWindow,
  offscreenNightsText,
  nightShortfall,
  pageSummary,
  gateBar,
  gateBarScale,
  lowCloudRuinous,
  gateRows,
  moonGateDetail,
  coreGaugeMax,
  drawsGateBar,
  darknessDetail,
  nightBar,
  limitingFactor,
  verdictFacts,
  verdictHeadline,
  verdictStatus,
  verdictTone,
  skyCellFooter,
  cloudHeadline,
  minutesToHours,
  withFacts,
  windowFact,
  lowCloudStat,
  cloudFooter,
  flatLayersNote,
  fmtPercent,
  headlineFirstDate,
  headlineNight,
  withheldLines,
  peakMonth,
  nextUsableText,
  gateMissText,
  compassWord,
  fmtAzimuth,
  windowShare,
} from './formulas'
import { CORE_UNIT } from './constants'
import type { HourlyPoint, Night, WindowResponse } from './types'

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
    expect(nightNote(night)).toBe('2\u00a0h 30\u00a0min')
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
  const failed = (cause: string | undefined, reason = 'api prose') =>
    ({
      killers: [{ id: 'core-altitude', label: 'Core altitude', reason, cause }],
      gateCoreAltitude: 5,
      coreGateDeg: 12,
    }) as unknown as Night
  test('branches on the API cause tag, with no figure', () => {
    expect(coreGateDetail(failed('ridge'))).toBe('the skyline raised the gate')
    expect(coreGateDetail(failed('floor'))).toBe('stayed too low above the horizon')
    expect(coreGateDetail(failed('never-rises'))).toBe('never rises while it is dark')
  })
  test('an unknown or missing cause shows the API reason verbatim', () => {
    expect(coreGateDetail(failed('something-new', 'core is sad'))).toBe('core is sad')
    expect(coreGateDetail(failed(undefined, 'core is sad'))).toBe('core is sad')
  })
  test('a clearing night says so', () => {
    const night = { killers: [], gateCoreAltitude: 12, coreGateDeg: 8 } as unknown as Night
    expect(coreGateDetail(night)).toBe('clears the gate')
  })
  test('no dark stretch', () => {
    const night = { killers: [], gateCoreAltitude: null, coreGateDeg: null } as unknown as Night
    expect(coreGateDetail(night)).toBe('no astronomical night')
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
    expect(verdictHeadline(goNight)).toBe('Sat 13, 23:10–01:40 · 2\u00a0h 30\u00a0min')
  })

  test('a GO night without a window names the day only', () => {
    expect(verdictHeadline({ ...goNight, window: null })).toBe('Sat 13')
  })

  test('a 0.0° gap falls back to the killer label, not "0.0° under the gate"', () => {
    expect(verdictHeadline(outNight('2026-06-13', 8, 8))).toBe('core altitude')
    expect(nightNote(outNight('2026-06-13', 8, 8))).toBe('core low')
  })

  test('an OUT night on the core gate states the gap', () => {
    expect(verdictHeadline(outNight('2026-06-13', 8, 4.1))).toBe('core 3.9° under its gate')
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
  const summaryOf = (
    data: WindowResponse,
    { forecast, selectedDate }: { forecast: boolean; selectedDate: string },
  ) =>
    pageSummary(data, {
      withWindow: forecast,
      marked: headlineNight(data, { forecast, selectedDate }),
      firstDate: headlineFirstDate(data, { selectedDate }),
    })

  test('Tonight leaves the window to the verdict card', () => {
    const out = outNight('2026-06-14', 8, 4)
    const summary = summaryOf(response([goNight, out], '2026-06-13'), {
      forecast: false,
      selectedDate: '2026-06-14',
    })
    expect(summary.sentence).toBe('1 of 2 nights usable')
    expect(summary.facts).toEqual(['best Sat 13', '1 ruled out'])
  })

  test('Forecast states the GO window range, once', () => {
    const out = outNight('2026-06-14', 8, 4)
    const summary = summaryOf(response([goNight, out], '2026-06-13'), {
      forecast: true,
      selectedDate: '2026-06-14',
    })
    expect(summary.facts).toEqual(['best Sat 13, 23:10–01:40', '1 ruled out'])
    expect(summary.facts.join(' ').match(/23:10/g)).toHaveLength(1)
  })

  test('Forecast keeps the window of a selected best night: no card states it there', () => {
    const out = outNight('2026-06-14', 8, 4)
    const summary = summaryOf(response([goNight, out], '2026-06-13'), {
      forecast: true,
      selectedDate: '2026-06-13',
    })
    expect(summary.facts).toEqual(['best Sat 13, 23:10–01:40', '1 ruled out'])
  })

  test('Tonight drops a selected best night: the verdict card states its day and window', () => {
    const out = outNight('2026-06-14', 8, 4)
    const summary = summaryOf(response([goNight, out], '2026-06-13'), {
      forecast: false,
      selectedDate: '2026-06-13',
    })
    expect(summary.facts).toEqual(['1 ruled out'])
  })

  test('an all-out week names the night with the smallest gap, not the first', () => {
    const nights = [outNight('2026-06-13', 8, 4), outNight('2026-06-14', 8, 6)]
    const summary = summaryOf(response(nights, '2026-06-13'), {
      forecast: false,
      selectedDate: '2026-06-13',
    })
    expect(summary.sentence).toBe('No usable night in the next 2 nights')
    expect(summary.facts).toEqual(['closest Sun 14, core 2.0° under its gate'])
  })

  test('a selected closest night is not restated on either tab', () => {
    const nights = [outNight('2026-06-13', 8, 4), outNight('2026-06-14', 8, 6)]
    for (const forecast of [false, true]) {
      const summary = summaryOf(response(nights, '2026-06-13'), {
        forecast,
        selectedDate: '2026-06-14',
      })
      expect(summary.facts).toEqual([])
    }
  })

  test('one night reads in the singular and takes the range from the marked night', () => {
    const summary = summaryOf(response([goNight], '2026-06-13'), {
      forecast: true,
      selectedDate: '2026-06-20',
    })
    expect(summary.sentence).toBe('1 of 1 night usable')
    expect(summary.facts).toEqual(['best Sat 13, 23:10–01:40'])
  })

  test('an all-out week with no degree gap says "first", as the API only gives the first night', () => {
    const dark = {
      ...outNight('2026-06-13', 8, 4),
      killers: [{ id: 'moon', label: 'Moon', reason: 'r' }],
    }
    const data = response([dark], '2026-06-13')
    expect(summaryOf(data, { forecast: false, selectedDate: '2026-06-14' }).facts).toEqual([
      'first Sat 13',
    ])
  })

  test('"first" is not restated when that night is the selected one', () => {
    const dark = {
      ...outNight('2026-06-13', 8, 4),
      killers: [{ id: 'moon', label: 'Moon', reason: 'r' }],
    }
    const data = response([dark], '2026-06-13')
    expect(summaryOf(data, { forecast: false, selectedDate: '2026-06-13' }).facts).toEqual([])
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

describe('night shortfall and gate bar', () => {
  const nights = [outNight('2026-06-13', 8, 4), outNight('2026-06-14', 8, 6), goNight]

  test('only a night out on the core gate has a degree gap', () => {
    expect(nightShortfall(nights[0]!)).toBe(4)
    expect(nightShortfall(goNight)).toBeNull()
  })

  test('the bar draws the reading against the gate tick on one shared scale', () => {
    expect(gateBarScale(nights)).toBe(8)
    expect(nightBar(nights[0]!, { gateScale: 8, longest: 0 })).toEqual({ fill: 0.5, gate: 1 })
    expect(nightBar(nights[1]!, { gateScale: 8, longest: 0 })).toEqual({ fill: 0.75, gate: 1 })
    expect(gateBar(goNight, 8)).toBeNull()
    expect(nightBar(goNight, { gateScale: 8, longest: 300 })).toEqual({ fill: 0.5, gate: null })
  })

  test('a reading under 0° keeps a hairline and a bad scale draws nothing', () => {
    const deep = outNight('2026-12-13', 8, -20)
    expect(gateBar(deep, 8)?.fill).toBeGreaterThan(0)
    expect(gateBar(nights[0]!, 0)).toBeNull()
  })

  test('the scale never drops under 1°', () => {
    expect(gateBarScale([goNight])).toBe(1)
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

describe('verdictStatus', () => {
  test('a usable night carries its own tier word, a ruled-out night OUT', () => {
    expect(verdictStatus(goNight)).toEqual({ word: 'Good', color: verdictTone('good') })
    expect(verdictStatus({ ...goNight, verdict: 'poor' } as Night).word).toBe('Poor')
    expect(verdictStatus({ ...goNight, verdict: 'marginal' } as Night).word).toBe('Marginal')
    expect(verdictStatus(outNight('2026-06-13', 8, 4))).toEqual({
      word: 'OUT',
      color: verdictTone('out'),
    })
  })
})

describe('gateMissText', () => {
  test('names the core shortfall, else the first killer', () => {
    expect(gateMissText(outNight('2026-06-13', 8, 4.1))).toBe('core 3.9° under its gate')
    expect(gateMissText(outNight('2026-06-13', 8, 8))).toBe('core altitude')
  })
})

describe('azimuth words', () => {
  test('8-point compass, wrapping at north', () => {
    expect(compassWord(0)).toBe('N')
    expect(compassWord(359)).toBe('N')
    expect(compassWord(200)).toBe('S')
    expect(compassWord(225)).toBe('SW')
    expect(compassWord(-90)).toBe('W')
  })

  test('carries the unit and the word', () => {
    expect(fmtAzimuth(179.6)).toBe('az 180° S')
    expect(fmtAzimuth(359.7)).toBe('az 0° N')
  })
})

describe('nextUsableText', () => {
  const later = { ...goNight, date: '2026-06-20' } as Night
  test('names the first usable night after the selected one, with its window', () => {
    const out = outNight('2026-06-13', 8, 4)
    expect(nextUsableText([out, later], out.date)).toBe('next usable Sat 20, 2\u00a0h 30\u00a0min')
  })

  test('says so when none of the nights ahead is usable', () => {
    const out = outNight('2026-06-13', 8, 4)
    expect(nextUsableText([out, outNight('2026-06-14', 8, 5)], out.date)).toBe(
      'no later night is usable',
    )
  })
})

describe('windowFact', () => {
  test('a GO night states length and range; an OUT night with no window states the missed gate', () => {
    expect(windowFact(goNight, { withMiss: true })).toEqual({
      value: '2\u00a0h 30\u00a0min',
      period: 'shooting window 23:10–01:40',
    })
    expect(windowFact(outNight('2026-06-13', 8, 4.1), { withMiss: true })).toEqual({
      value: 'No window',
      period: 'core 3.9° under its gate',
    })
  })

  test('on Tonight the verdict card owns the miss, so the timeline does not repeat it', () => {
    expect(windowFact(outNight('2026-06-13', 8, 4.1), { withMiss: false })).toEqual({
      value: 'No window',
      period: 'no stretch passes every gate',
    })
  })

  test('a usable night with no window never reads "ruled out"', () => {
    expect(windowFact({ ...goNight, window: null } as Night, { withMiss: true })).toEqual({
      value: 'No window',
      period: 'none within the dark',
    })
  })
})

const footerOf = (stat: ReturnType<typeof lowCloudStat>) =>
  stat === null ? null : cloudFooter(stat)

describe('lowCloudStat', () => {
  const night = (cloudLow: number | null, scored = true) =>
    ({
      weather: { cloudLow, cloudMid: null, cloudHigh: null },
      window: scored ? {} : null,
    }) as unknown as Night

  test('the scored window mean with the limit tick', () => {
    expect(lowCloudStat(night(62.4), 55)).toEqual({
      value: '62\u00a0%',
      unit: 'low cloud',
      basis: 'shooting-window mean',
      layers: [],
      reading: 62,
      target: 55,
    })
  })
  test('mid and high layers lead the footer, floored like the low value', () => {
    const n = {
      weather: { cloudLow: 10, cloudMid: 20.9, cloudHigh: 30 },
      window: {},
    } as unknown as Night
    expect(footerOf(lowCloudStat(n, 55))).toBe(
      'shooting-window mean · mid\u00a020\u00a0% · high\u00a030\u00a0%',
    )
  })
  test('floors, so a reading never shows at the limit while the engine says under', () => {
    expect(lowCloudStat(night(54.4), 55)?.reading).toBe(54)
    expect(lowCloudStat(night(54.6), 55)?.reading).toBe(54)
    expect(lowCloudStat(night(55), 55)?.reading).toBe(55)
  })
  test('0 % is a value, not a missing reading', () => {
    expect(lowCloudStat(night(0), 55)?.value).toBe('0\u00a0%')
  })
  test('no shooting window: the dark-hours mean, no tick', () => {
    expect(lowCloudStat(night(12, false), 55)).toMatchObject({
      basis: 'dark-hours mean',
      reading: 12,
      target: null,
    })
  })
  test('a layer that is null or absent is left out, never NaN', () => {
    const n = (weather: object) => ({ weather, window: {} }) as unknown as Night
    expect(footerOf(lowCloudStat(n({ cloudLow: 10, cloudMid: null, cloudHigh: 30 }), 55))).toBe(
      'shooting-window mean · high\u00a030\u00a0%',
    )
    expect(footerOf(lowCloudStat(n({ cloudLow: 10 }), 55))).toBe('shooting-window mean')
    expect(footerOf(lowCloudStat(n({ cloudLow: 10, cloudMid: 0, cloudHigh: 5 }), 55))).toBe(
      'shooting-window mean · mid\u00a00\u00a0% · high\u00a05\u00a0%',
    )
  })
  test('the ` · ` between phrases is a plain space (may wrap); each pair is glued', () => {
    const stat = lowCloudStat(
      { weather: { cloudLow: 1, cloudMid: 2, cloudHigh: 3 }, window: {} } as unknown as Night,
      55,
    )
    const footer = stat === null ? '' : cloudFooter(stat)
    expect(footer.split(' · ')).toHaveLength(3)
    expect(footer).toContain(' · mid\u00a02\u00a0% · high\u00a03\u00a0%')
  })
  test('no limit in the response: no tick', () => {
    expect(lowCloudStat(night(30), undefined)?.target).toBeNull()
  })
  test('no reading, no stat', () => {
    expect(lowCloudStat(night(null), 55)).toBeNull()
  })
})

describe('peakMonth', () => {
  test('picks the month with the most minutes, skipping gaps', () => {
    expect(peakMonth([1, null, 2.5, 1.5])).toEqual({ monthIndex: 2, hours: 2.5 })
    expect(peakMonth([])).toBeNull()
  })
})

describe('windowFact on a moon-gated night', () => {
  test('the timeline draws the API window, so it is stated together with the missed gate', () => {
    const moonOut = {
      ...goNight,
      verdict: 'out',
      killers: [{ id: 'moon', label: 'Moon', reason: 'r' }],
    } as unknown as Night
    expect(windowFact(moonOut, { withMiss: true })).toEqual({
      value: '2\u00a0h 30\u00a0min',
      period: '23:10–01:40 · moon',
    })
    expect(windowFact(moonOut, { withMiss: false }).period).toBe('shooting window 23:10–01:40')
  })
})

describe('one headline gate', () => {
  const killer = (id: string, label: string) => ({ id, label, reason: 'r' })
  const both = (order: string[]) =>
    ({
      ...outNight('2026-06-13', 8, 4.1),
      killers: order.map((id) =>
        id === 'moon' ? killer('moon', 'Moon') : killer('core-altitude', 'Core altitude'),
      ),
    }) as unknown as Night

  test('the core gap headlines whichever order the API lists the killers in', () => {
    for (const order of [
      ['moon', 'core-altitude'],
      ['core-altitude', 'moon'],
    ]) {
      expect(gateMissText(both(order))).toBe('core 3.9° under its gate')
    }
  })

  test('a core killer with a gap that rounds to 0.0° still headlines', () => {
    const night = {
      ...both(['moon', 'core-altitude']),
      gateCoreAltitude: 7.98,
      coreGateDeg: 8,
    } as Night
    expect(gateMissText(night)).toBe('core 0.0° under its gate')
  })

  test('with no core gap the first killer headlines', () => {
    const night = {
      ...goNight,
      verdict: 'out',
      killers: [killer('moon', 'Moon'), killer('darkness', 'Darkness')],
    } as unknown as Night
    expect(gateMissText(night)).toBe('moon')
  })
})

describe('nextUsableText looks only at later nights', () => {
  test('earlier nights are not "the next"', () => {
    const nights = [
      outNight('2026-06-12', 8, 4),
      outNight('2026-06-13', 8, 4),
      outNight('2026-06-14', 8, 4),
    ]
    expect(nextUsableText(nights, '2026-06-13')).toBe('no later night is usable')
    expect(nextUsableText(nights, '2026-06-14')).toBe('no later night in this range')
  })
})

describe('sky cell footer', () => {
  test('sky: the threshold, dome and transparency', () => {
    expect(skyCellFooter({ domePenaltyMag: 1.04, transparency: 3 })).toBe(
      'dark ≥ 21.6\u00a0mag/arcsec² · town\u00a0glow\u00a0+1.04\u00a0mag · transparency\u00a03/8,\u00a0lower\u00a0clearer',
    )
    expect(skyCellFooter({ domePenaltyMag: null, transparency: null })).toBe(
      'dark ≥ 21.6\u00a0mag/arcsec² · town\u00a0glow\u00a0— · transparency\u00a0—,\u00a0lower\u00a0clearer',
    )
  })
})

describe('cloudHeadline', () => {
  test('two glued phrases around a separator', () => {
    const stat = lowCloudStat(
      { ...goNight, window: null, weather: { cloudLow: 40 } } as unknown as Night,
      undefined,
    )!
    expect(cloudHeadline(stat)).toEqual({
      value: '40\u00a0%',
      unit: 'low\u00a0cloud',
      period: '· dark-hours\u00a0mean',
    })
  })
})

describe('minutesToHours and withFacts', () => {
  test('one decimal, gaps stay gaps', () => {
    expect(minutesToHours(95)).toBe(1.6)
    expect(minutesToHours(undefined)).toBeNull()
  })

  test('withFacts spreads nothing for a missing fact', () => {
    expect(withFacts(null)).toEqual({})
    expect(withFacts({ value: '1' })).toEqual({ facts: { value: '1' } })
  })
})

describe('lowCloudRuinous', () => {
  const night = (ruinous: boolean | undefined, cloudLow: number | null = 62.4) =>
    ({
      ...goNight,
      weather: { cloudLow },
      factors: [{ id: 'cloud-low', label: 'Low cloud', value: 0.1, ruinous }],
    }) as unknown as Night

  test('true when the API calls the factor ruinous', () => {
    expect(lowCloudRuinous(night(true))).toBe(true)
  })

  test('no row unless the API says ruinous, nor without a scored value', () => {
    expect(lowCloudRuinous(night(false))).toBe(false)
    expect(lowCloudRuinous(night(undefined))).toBe(false)
    expect(lowCloudRuinous(night(true, null))).toBe(false)
    expect(
      lowCloudRuinous({ ...goNight, factors: [], weather: { cloudLow: 62 } } as unknown as Night),
    ).toBe(false)
  })
})

describe('moonGateDetail', () => {
  const night = (killers: Night['killers'], darkMinutes = 300) =>
    ({ killers, darkMinutes, window: null, moon: { illumination: 0.456 } }) as unknown as Night

  test('a failed gate with a window states the moon peak from the number, not the prose', () => {
    const n = {
      ...night([{ id: 'moon', label: 'Moon', reason: 'prose' }]),
      window: { maxMoonAltitude: 12.34 },
    } as unknown as Night
    expect(moonGateDetail(n, 0.25, [])).toBe('up to 12.3° during the window')
  })
  test('a failed gate without a window states the moon peak over the dark hours, not the prose', () => {
    const hourly = [
      { astroDark: true, moonAltitude: 20.04 },
      { astroDark: true, moonAltitude: 31.26 },
      { astroDark: false, moonAltitude: 60 },
    ] as unknown as HourlyPoint[]
    expect(
      moonGateDetail(night([{ id: 'moon', label: 'Moon', reason: 'moon 46% lit' }]), 0.25, hourly),
    ).toBe('up to 31.3° while it is dark')
  })
  test('a failed gate never quotes the API prose: no dark sample is stated, not guessed', () => {
    const killer = night([{ id: 'moon', label: 'Moon', reason: 'moon 46% illuminated' }])
    expect(moonGateDetail(killer, 0.25, [])).toBe('no dark sample')
    const day = [{ astroDark: false, moonAltitude: 30 }] as unknown as HourlyPoint[]
    expect(moonGateDetail(killer, 0.25, day)).toBe('no dark sample')
  })
  test('a moon exactly on the horizon is not "below" it', () => {
    const edge = [{ astroDark: true, moonAltitude: 0 }] as unknown as HourlyPoint[]
    const killer = night([{ id: 'moon', label: 'Moon', reason: 'moon 46% illuminated' }])
    expect(moonGateDetail(killer, 0.25, edge)).toBe('on the horizon while it is dark')
  })
  test('a failed gate whose dark samples all have the moon down says so', () => {
    const below = [{ astroDark: true, moonAltitude: -5 }] as unknown as HourlyPoint[]
    const killer = night([{ id: 'moon', label: 'Moon', reason: 'moon 46% illuminated' }])
    expect(moonGateDetail(killer, 0.25, below)).toBe('below the horizon while it is dark')
  })
  test('a pass under the limit says so in words', () => {
    expect(moonGateDetail(night([]), 0.5, [])).toBe('under limit')
  })
})

describe('gateRows', () => {
  const night = {
    ...goNight,
    darkMinutes: 300,
    moon: { illumination: 0.1 },
    weather: { cloudLow: 70, cloudMid: null, cloudHigh: null },
    killers: [],
    factors: [{ id: 'cloud-low', label: 'Low cloud', value: 0, ruinous: true }],
  } as unknown as Night

  test('pass or fail comes from the killers only; low cloud is a factor row, not a gate', () => {
    const rows = gateRows(night, 0.25, [])
    expect(rows.map((r) => [r.key, r.state, r.tone])).toEqual([
      ['darkness', 'passed', 'good'],
      ['core-altitude', 'passed', 'good'],
      ['moon', 'passed', 'good'],
      ['cloud-low', 'ruinous', 'neutral'],
    ])
  })

  test('low cloud that limits the score gets its row without being ruinous', () => {
    const limiting = {
      ...night,
      factors: [{ id: 'cloud-low', label: 'Low cloud', value: 0.4 }],
    } as unknown as Night
    expect(gateRows(limiting, 0.25, []).at(-1)).toMatchObject({
      key: 'cloud-low',
      state: 'limits the score',
      detail: '70\u00a0%',
    })
  })

  test('a scored night whose low cloud is neither ruinous nor limiting still shows the cloud it rests on', () => {
    const fine = {
      ...night,
      factors: [{ id: 'cloud-low', label: 'Low cloud', value: 0.95 }],
    } as unknown as Night
    expect(gateRows(fine, 0.25, []).at(-1)).toMatchObject({
      key: 'cloud-low',
      state: 'not limiting',
      tone: 'neutral',
      detail: '70\u00a0%',
    })
  })

  test('a scored night with no cloud factor has no cloud row', () => {
    const noFactor = { ...night, factors: [] } as unknown as Night
    expect(gateRows(noFactor, 0.25, []).map((r) => r.key)).not.toContain('cloud-low')
  })

  test('a ruled-out night still shows the cloud figure the API sends, as not scored', () => {
    const gated = { ...night, verdict: 'out', factors: [] } as unknown as Night
    expect(gateRows(gated, 0.25, []).at(-1)).toMatchObject({
      key: 'cloud-low',
      state: 'not scored',
      tone: 'neutral',
      detail: '70\u00a0%',
    })
  })

  test('a failed gate flips its row alone', () => {
    const out = {
      ...night,
      killers: [{ id: 'moon', label: 'Moon', reason: 'r' }],
      window: null,
      factors: [],
    } as unknown as Night
    expect(gateRows(out, 0.25, []).map((r) => r.state)).toEqual(['passed', 'passed', 'failed'])
  })
})

describe('limitingFactor', () => {
  test('returns the factor id with its label and percent', () => {
    const night = {
      factors: [
        { id: 'transparency', label: 'Transparency', value: 0.9 },
        { id: 'cloud-low', label: 'Low cloud', value: 0.1 },
      ],
    } as unknown as Night
    expect(limitingFactor(night)).toEqual({ id: 'cloud-low', label: 'Low cloud', pct: 10 })
  })
})

describe('verdictFacts', () => {
  test('an OUT night names its day and the next usable night, no gate list', () => {
    const out = outNight('2026-06-13', 8, 4)
    expect(verdictFacts(out, [out])).toEqual(['Sat 13', 'no later night in this range'])
  })

  test('a usable night names its limiting factor unless the low-cloud row already does', () => {
    // low cloud, ruinous or merely limiting, has its own verdict-card row, so the facts line leaves it out
    const base = {
      ...goNight,
      score: 61,
      weather: { cloudLow: 70 },
    }
    const night = (ruinous: boolean) =>
      ({
        ...base,
        factors: [{ id: 'cloud-low', label: 'Low cloud', weight: 5, value: 0.1, ruinous }],
      }) as unknown as Night
    expect(verdictFacts(night(false), [night(false)])).toEqual(['score 61/100'])
    expect(verdictFacts(night(true), [night(true)])).toEqual(['score 61/100'])
  })
})

describe('moon gate row on a pass', () => {
  const passed = (maxMoonAltitude: number, windowNull = false) =>
    ({
      killers: [],
      darkMinutes: 300,
      moon: { illumination: 0.96 },
      window: windowNull
        ? null
        : { maxMoonAltitude, start: '2026-01-01T20:00:00Z', end: '2026-01-01T22:00:00Z' },
    }) as unknown as Night
  const sample = (time: string, moonBehindTerrain: boolean) =>
    ({ time, moonBehindTerrain }) as unknown as HourlyPoint

  test('below the horizon through the window', () => {
    expect(moonGateDetail(passed(-10), 0.25, [])).toBe('over limit, below horizon')
  })
  test('behind the skyline when a window sample says so', () => {
    const hourly = [sample('2026-01-01T21:00:00Z', true)]
    expect(moonGateDetail(passed(12), 0.25, hourly)).toBe('over limit, behind skyline')
  })
  test('a behind-terrain sample outside the window does not count', () => {
    const hourly = [sample('2026-01-01T23:00:00Z', true)]
    expect(moonGateDetail(passed(12), 0.25, hourly)).toBe('over limit')
  })
  test('no window, or no field that says why: over limit alone', () => {
    expect(moonGateDetail(passed(0, true), 0.25, [])).toBe('over limit')
    expect(moonGateDetail(passed(12), 0.25, [])).toBe('over limit')
  })
})

describe('gateRows with no astronomical night', () => {
  test('core and moon are n/a and neutral; darkness carries the failure', () => {
    const night = {
      ...goNight,
      darkMinutes: 0,
      moon: { illumination: 0.1 },
      weather: { cloudLow: null },
      killers: [{ id: 'darkness', label: 'Darkness', reason: 'no night' }],
      factors: [],
    } as unknown as Night
    expect(gateRows(night, 0.25, []).map((r) => [r.key, r.state, r.tone])).toEqual([
      ['darkness', 'failed', 'warn'],
      ['core-altitude', 'n/a', 'neutral'],
      ['moon', 'n/a', 'neutral'],
    ])
    expect(darknessDetail(night)).toBe('no night')
  })

  test('the ruinous low-cloud row is neutral, never the failed-gate tone', () => {
    const night = {
      ...goNight,
      darkMinutes: 300,
      moon: { illumination: 0.1 },
      weather: { cloudLow: 70 },
      killers: [],
      factors: [{ id: 'cloud-low', label: 'Low cloud', value: 0, ruinous: true }],
    } as unknown as Night
    expect(gateRows(night, 0.25, []).at(-1)?.tone).toBe('neutral')
  })
})

describe('core gauge and gate bar', () => {
  test('the gauge domain widens to a gate above the usual scale', () => {
    expect(coreGaugeMax(8)).toBe(30)
    expect(coreGaugeMax(34)).toBe(34)
  })

  test('only an out night with a reading and a gate draws a gate bar', () => {
    expect(drawsGateBar(outNight('2026-06-13', 8, 4))).toBe(true)
    expect(drawsGateBar(goNight)).toBe(false)
    expect(drawsGateBar({ ...outNight('2026-06-13', 8, 4), coreGateDeg: null } as Night)).toBe(
      false,
    )
  })
})

describe('coreGateFact', () => {
  test('the panorama states the same degrees as the Core cell for the same night', () => {
    const night = { ...goNight, gateCoreAltitude: 12.34, coreGateDeg: 9.8 } as Night
    const cell = coreMeterReading(night)!
    expect(coreGateFact(night)?.value).toBe(fmtDegrees(cell.reading))
    expect(coreGateFact(night)).toEqual({
      value: '12.3°',
      unit: `${CORE_UNIT}, needs > 9.8°`,
    })
  })
  test('no dark stretch, no fact', () => {
    expect(
      coreGateFact({ ...goNight, gateCoreAltitude: null, coreGateDeg: null } as Night),
    ).toBeNull()
  })
})

describe('cloud percent and flat layers', () => {
  test('one floored, glued spelling', () => {
    expect(fmtPercent(20.9)).toBe('20\u00a0%')
    expect(fmtPercent(0)).toBe('0\u00a0%')
  })
  const hourly = (mid: (number | null)[], high: (number | null)[]) =>
    mid.map((m, i) => ({ cloudMid: m, cloudHigh: high[i] })) as unknown as HourlyPoint[]
  test('a layer that holds one value all night is stated once; a varying one is not', () => {
    expect(flatLayersNote(hourly([12, 12, 12], [0, 5, 0]))).toBe('mid\u00a012\u00a0% all night')
    expect(flatLayersNote(hourly([12, 12], [0, 0]))).toBe(
      'mid\u00a012\u00a0% all night · high\u00a00\u00a0% all night',
    )
  })
  test('no flat layer, or a layer with a gap, states nothing', () => {
    expect(flatLayersNote(hourly([1, 2], [3, 4]))).toBeNull()
    expect(flatLayersNote(hourly([null, null], [5, null]))).toBeNull()
    expect(flatLayersNote([])).toBeNull()
  })
})

describe('withheldLines', () => {
  const gated = (killers: Night['killers']) => ({ killers }) as unknown as Night

  test('killers that all have a gate row get the one generic line', () => {
    const night = gated([
      { id: 'core-altitude', label: 'Core altitude', reason: 'r' },
      { id: 'moon', label: 'Moon', reason: 'r' },
    ])
    expect(withheldLines(night)).toEqual(['Score withheld on a ruled-out night'])
  })

  test('an unknown killer keeps its own label and reason visible', () => {
    const night = gated([
      { id: 'moon', label: 'Moon', reason: 'moon is up' },
      { id: 'smoke', label: 'Smoke', reason: 'plume overhead' },
    ])
    expect(withheldLines(night)).toEqual([
      'Score withheld',
      'Moon: moon is up',
      'Smoke: plume overhead',
    ])
  })
})
