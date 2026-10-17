// Set before any Date is built so the DST case below runs in a zone that has one.
process.env.TZ = 'Europe/Berlin'

import { describe, expect, test } from 'bun:test'
import type { CalendarEventPayload } from '../../lib/queries/calendar'
import {
  addDays,
  agendaSummary,
  allDayEvents,
  bookedBySourceClass,
  bookedMinOnDay,
  isCancelled,
  agendaDay,
  dayHeadLabel,
  displayTitle,
  eventsOnDay,
  dayLoad,
  longestFreeBlock,
  nextEvent,
  queryFromKey,
  tasksDue,
  weekBookedMin,
  weekKeys,
  weekWindow,
  WEEK_WINDOW_FALLBACK,
  type CalendarItem,
} from './derive'

// 2026-10-14 is a Wednesday; its Monday-start week is 12–18 Oct.
const D = '2026-10-14'

function ev(
  id: string,
  start: string,
  end: string,
  payload: Partial<CalendarEventPayload> = {},
): CalendarItem {
  return {
    id,
    title: `{title ${id}}`,
    start,
    end,
    payload: { source: 'm365', sourceClass: 'work', ...payload },
  }
}

const at = (day: string, hm: string) => `${day} ${hm}:00`

describe('weekKeys / addDays', () => {
  test('Monday-start week of a midweek day', () => {
    expect(weekKeys(D)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ])
  })
  test('a Sunday belongs to the week that ends on it', () => {
    expect(weekKeys('2026-10-18')[0]).toBe('2026-10-12')
  })
  test('day arithmetic is calendar arithmetic across DST changes and year ends', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  test('a week spanning the spring DST change still has 7 distinct consecutive days', () => {
    const keys = weekKeys('2026-03-29')
    expect(new Set(keys).size).toBe(7)
    expect(keys[0]).toBe('2026-03-23')
    expect(keys[6]).toBe('2026-03-29')
  })
})

describe('booked hours', () => {
  const events = [
    ev('a', at(D, '09:00'), at(D, '10:00')),
    ev('b', at(D, '09:30'), at(D, '11:00'), { source: 'google', sourceClass: 'personal' }),
    ev('c', at(D, '14:00'), at(D, '15:30')),
  ]
  test('overlaps count once in the day load', () => {
    expect(bookedMinOnDay(events, D)).toBe(120 + 90)
  })
  test('day load carries the event count', () => {
    const load = dayLoad(events, weekKeys(D))
    expect(load.find((d) => d.key === D)).toEqual({ key: D, bookedMin: 210, count: 3 })
    expect(load.find((d) => d.key === '2026-10-13')).toEqual({
      key: '2026-10-13',
      bookedMin: 0,
      count: 0,
    })
  })
  test('week total is the sum of the day loads', () => {
    expect(weekBookedMin(events, weekKeys(D))).toBe(210)
  })
  test('split attributes a shared minute once, so Work + Personal is the booked total', () => {
    const split = bookedBySourceClass(events, weekKeys(D))
    expect(split).toEqual({ work: 150, personal: 60 })
    expect(split.work + split.personal).toBe(weekBookedMin(events, weekKeys(D)))
  })
  test('an incomplete load is unknown, never zero', () => {
    const load = dayLoad(events, weekKeys(D), true)
    expect(load.every((d) => d.bookedMin === null && d.count === null)).toBe(true)
  })
  test('all-day items and tasks never book time', () => {
    const items = [
      ev('d', `${D} 00:00:00`, `${addDays(D, 1)} 00:00:00`, { isAllDay: true }),
      ev('t', `${D} 00:00:00`, `${addDays(D, 1)} 00:00:00`, { source: 'ticktick', isAllDay: true }),
    ]
    expect(bookedMinOnDay(items, D)).toBe(0)
  })
  test('an event across midnight is split between both days', () => {
    const night = [ev('n', at(D, '23:00'), at(addDays(D, 1), '01:00'))]
    expect(bookedMinOnDay(night, D)).toBe(60)
    expect(bookedMinOnDay(night, addDays(D, 1))).toBe(60)
  })
})

describe('longestFreeBlock (08:00–18:00)', () => {
  test('an empty day is the whole window', () => {
    const block = longestFreeBlock([], D)
    expect(block?.minutes).toBe(600)
  })
  test('picks the longest gap', () => {
    const events = [
      ev('a', at(D, '09:00'), at(D, '10:00')),
      ev('b', at(D, '12:00'), at(D, '13:00')),
    ]
    // gaps: 08–09 (60), 10–12 (120), 13–18 (300)
    const block = longestFreeBlock(events, D)
    expect(block?.minutes).toBe(300)
    expect(block?.start.getHours()).toBe(13)
    expect(block?.end.getHours()).toBe(18)
  })
  test('overlapping events do not open a phantom gap', () => {
    const events = [
      ev('a', at(D, '08:00'), at(D, '12:00')),
      ev('b', at(D, '09:00'), at(D, '10:00')),
      ev('c', at(D, '13:00'), at(D, '18:00')),
    ]
    expect(longestFreeBlock(events, D)?.minutes).toBe(60)
  })
  test('an event spanning the window start is clipped to it', () => {
    const events = [ev('a', at(D, '06:00'), at(D, '09:00'))]
    const block = longestFreeBlock(events, D)
    expect(block?.start.getHours()).toBe(9)
    expect(block?.minutes).toBe(540)
  })
  test('an event spanning the window end is clipped to it', () => {
    const events = [ev('a', at(D, '16:00'), at(addDays(D, 1), '02:00'))]
    expect(longestFreeBlock(events, D)?.minutes).toBe(480)
  })
  test('fully booked is null, never a zero block', () => {
    expect(longestFreeBlock([ev('a', at(D, '07:00'), at(D, '19:00'))], D)).toBeNull()
  })
  test('notBefore drops the gap already behind us', () => {
    const now = new Date(2026, 9, 14, 15, 0, 0)
    expect(longestFreeBlock([], D, now)?.minutes).toBe(180)
    expect(longestFreeBlock([], D, new Date(2026, 9, 14, 19, 0, 0))).toBeNull()
  })
  test('a start with seconds rounds up so the length matches the printed times', () => {
    const block = longestFreeBlock([], D, new Date(2026, 9, 14, 15, 0, 20))
    expect(block?.start.getMinutes()).toBe(1)
    expect(block?.start.getSeconds()).toBe(0)
    expect(block?.minutes).toBe(179)
    expect(longestFreeBlock([], D, new Date(2026, 9, 14, 15, 0, 0))?.minutes).toBe(180)
  })
  test('all-day items do not take free time', () => {
    const allDay = [ev('d', `${D} 00:00:00`, `${addDays(D, 1)} 00:00:00`, { isAllDay: true })]
    expect(longestFreeBlock(allDay, D)?.minutes).toBe(600)
  })
})

describe('weekWindow', () => {
  const keys = weekKeys(D)
  test('no timed events falls back', () => {
    expect(weekWindow([], keys)).toEqual(WEEK_WINDOW_FALLBACK)
  })
  test('all-day items alone fall back', () => {
    const allDay = [ev('d', `${D} 00:00:00`, `${addDays(D, 1)} 00:00:00`, { isAllDay: true })]
    expect(weekWindow(allDay, keys)).toEqual(WEEK_WINDOW_FALLBACK)
  })
  test('earliest start − 1 h to latest end + 1 h', () => {
    const events = [
      ev('a', at(D, '09:30'), at(D, '10:30')),
      ev('b', at(D, '15:00'), at(D, '16:15')),
    ]
    expect(weekWindow(events, keys)).toEqual({ startH: 8, endH: 18 })
  })
  test('clamps to 07–22', () => {
    const events = [
      ev('a', at(D, '05:00'), at(D, '06:00')),
      ev('b', at(D, '22:00'), at(D, '23:30')),
    ]
    expect(weekWindow(events, keys)).toEqual({ startH: 7, endH: 22 })
  })
  test('a late-only event never yields an empty window', () => {
    const w = weekWindow([ev('a', at(D, '23:00'), at(D, '23:30'))], keys)
    expect(w.endH).toBeGreaterThan(w.startH)
  })
  test('events outside the week do not widen it', () => {
    const far = [ev('a', at('2026-11-02', '06:00'), at('2026-11-02', '07:00'))]
    expect(weekWindow(far, keys)).toEqual(WEEK_WINDOW_FALLBACK)
  })
})

describe('nextEvent / agendaSummary', () => {
  const now = new Date(2026, 9, 14, 11, 0, 0)
  const events = [
    ev('past', at(D, '09:00'), at(D, '10:00')),
    ev('soon', at(D, '11:20'), at(D, '12:00')),
    ev('later', at(D, '15:00'), at(D, '16:00')),
  ]
  test('the next event counts whole minutes, rounded up', () => {
    const next = nextEvent(events, now)
    expect(next?.event.id).toBe('soon')
    expect(next?.inMin).toBe(20)
    expect(nextEvent(events, new Date(2026, 9, 14, 11, 19, 30))?.inMin).toBe(1)
  })
  test('none left is null', () => {
    expect(nextEvent(events, new Date(2026, 9, 14, 17, 0, 0))).toBeNull()
  })
  test('today lists the whole day, past meetings included', () => {
    const s = agendaSummary(events, now)
    expect(s.todayCount).toBe(3)
    expect(s.todayBookedMin).toBe(60 + 40 + 60)
  })
  test('summary figures come from the same derivation as the strip', () => {
    const s = agendaSummary(events, now)
    expect(s.weekKeys).toEqual(weekKeys(D))
    expect(s.weekBookedMin).toBe(s.todayBookedMin)
    expect(s.weekBookedMin).toBe(
      dayLoad(events, s.weekKeys).reduce((a, d) => a + (d.bookedMin ?? 0), 0),
    )
  })
  test('a source that has not answered makes every figure unknown, not zero', () => {
    const s = agendaSummary(events, now, new Set(['work']))
    expect(s.incomplete).toBe(true)
    expect(s.todayCount).toBeNull()
    expect(s.todayBookedMin).toBeNull()
    expect(s.weekBookedMin).toBeNull()
    expect(s.next).toBeNull()
  })
})

describe('queryFromKey', () => {
  test('agenda and week start on the Monday of their week', () => {
    expect(queryFromKey('agenda', '2026-01-01', D)).toBe('2026-10-12')
    expect(queryFromKey('week', '2026-10-18', D)).toBe('2026-10-12')
  })
  test('month starts on the Monday of the first week of the month', () => {
    // 2026-10-01 is a Thursday.
    expect(queryFromKey('month', '2026-10-20', D)).toBe('2026-09-28')
  })
  test('a Monday selection fetches the week before, so the phone window keeps its Sunday', () => {
    expect(queryFromKey('week', '2026-10-12', D)).toBe('2026-10-05')
    expect(queryFromKey('week', '2026-10-13', D)).toBe('2026-10-12')
  })
})

describe('allDayEvents', () => {
  test('a multi-day all-day item covers each of its days but not the exclusive end', () => {
    const e = ev('d', '2026-10-13 00:00:00', '2026-10-15 00:00:00', { isAllDay: true })
    expect(allDayEvents([e], '2026-10-13')).toHaveLength(1)
    expect(allDayEvents([e], '2026-10-14')).toHaveLength(1)
    expect(allDayEvents([e], '2026-10-15')).toHaveLength(0)
  })
  test('tasks are not all-day events', () => {
    const t = ev('t', `${D} 00:00:00`, `${addDays(D, 1)} 00:00:00`, {
      source: 'ticktick',
      isAllDay: true,
    })
    expect(allDayEvents([t], D)).toHaveLength(0)
  })
})

const task = (id: string, due: string, priority: number, project = '{project}') =>
  ev(id, `${due} 00:00:00`, `${addDays(due, 1)} 00:00:00`, {
    source: 'ticktick',
    sourceClass: undefined,
    isAllDay: true,
    priority,
    projectName: project,
  })

describe('tasksDue', () => {
  test('overdue and within the horizon, soonest first, High before Medium on a tie', () => {
    const out = tasksDue(
      [
        task('far', '2026-10-30', 5),
        task('med', D, 3),
        task('high', D, 5),
        task('late', '2026-10-10', 0),
      ],
      D,
    )
    expect(out.map((t) => t.id)).toEqual(['late', 'high', 'med'])
    expect(out[0]?.overdue).toBe(true)
    expect(out[1]).toMatchObject({ tone: 'bad', label: 'High' })
    expect(out[2]).toMatchObject({ tone: 'warn', label: 'Medium' })
  })
  test('Low and unprioritised tasks are neutral and unlabeled', () => {
    const out = tasksDue([task('a', D, 1), task('b', D, 0)], D)
    expect(out.every((t) => t.tone === 'neutral' && t.label === null)).toBe(true)
  })
  test('meetings are never tasks', () => {
    expect(tasksDue([ev('m', at(D, '09:00'), at(D, '10:00'))], D)).toEqual([])
  })
})

describe('DST day (Europe/Berlin)', () => {
  test('elapsed time, not wall-clock difference, books the day', () => {
    // 2026-03-29: 02:00 → 03:00 is skipped, so 01:00 → 04:00 is 2 h elapsed. The runner's zone
    // decides whether the jump applies; the expectation is always the real elapsed time.
    const elapsed = new Date(2026, 2, 29, 4, 0).getTime() - new Date(2026, 2, 29, 1, 0).getTime()
    const events = [ev('a', '2026-03-29 01:00:00', '2026-03-29 04:00:00')]
    expect(bookedMinOnDay(events, '2026-03-29')).toBe(elapsed / 60_000)
    expect(dayLoad(events, weekKeys('2026-03-29')).filter((d) => d.count > 0)).toHaveLength(1)
  })
})

const cancelled = (id: string, prefix: string, start: string, end: string): CalendarItem => ({
  ...ev(id, start, end),
  title: `${prefix} {title ${id}}`,
})

describe('cancelled meetings', () => {
  test('the detector knows the M365 prefixes and nothing else', () => {
    for (const prefix of ['Abgesagt:', 'Canceled:', 'Cancelled:', 'abgesagt :'])
      expect(isCancelled(cancelled('x', prefix, `${D} 09:00:00`, `${D} 10:00:00`))).toBe(true)
    expect(isCancelled(ev('y', `${D} 09:00:00`, `${D} 10:00:00`))).toBe(false)
    expect(
      isCancelled({ ...ev('z', `${D} 09:00:00`, `${D} 10:00:00`), title: 'Canceled lunch' }),
    ).toBe(false)
  })
  test('one derivation owns rows, count and booked time', () => {
    const events = [
      ev('a', `${D} 09:00:00`, `${D} 10:00:00`),
      cancelled('b', 'Abgesagt:', `${D} 13:00:00`, `${D} 14:00:00`),
    ]
    const day = agendaDay(events, D)
    expect(day.rows.map((r) => r.cancelled)).toEqual([false, true])
    expect(day.count).toBe(1)
    expect(day.bookedMin).toBe(60)
    expect(eventsOnDay(events, D)).toHaveLength(1)
    expect(nextEvent(events, new Date(2026, 9, 14, 11, 0))).toBeNull()
  })
  test('the row title drops the prefix and the meta says Cancelled once', () => {
    const day = agendaDay([cancelled('b', 'Canceled:', `${D} 13:00:00`, `${D} 14:00:00`)], D)
    expect(day.rows[0]?.title).toBe('{title b}')
    expect(day.rows[0]?.meta).toBe('Cancelled · Work')
    expect(displayTitle(cancelled('c', 'Abgesagt:', `${D} 13:00:00`, `${D} 14:00:00`))).toBe(
      '{title c}',
    )
  })
  test('a bare prefix title keeps a placeholder', () => {
    const bare: CalendarItem = { ...ev('p', `${D} 09:00:00`, `${D} 10:00:00`), title: 'Cancelled:' }
    expect(displayTitle(bare)).toBe('Untitled meeting')
  })
  test('a day of only cancelled meetings reads "all cancelled"', () => {
    const fmt = (m: number) => `${m}m`
    const only = agendaDay([cancelled('b', 'Abgesagt:', `${D} 13:00:00`, `${D} 14:00:00`)], D)
    expect(dayHeadLabel(only, fmt)).toBe('all cancelled')
    expect(dayHeadLabel(only, fmt, 1)).toBe('no meetings')
    expect(dayHeadLabel(agendaDay([], D), fmt)).toBe('no meetings')
    expect(dayHeadLabel(agendaDay([ev('a', `${D} 09:00:00`, `${D} 10:00:00`)], D), fmt)).toBe(
      '1 event · 60m',
    )
  })
  test('cancelled all-day events are not listed', () => {
    const allDay = (title: string): CalendarItem => ({
      ...ev('d', `${D} 00:00:00`, `${addDays(D, 1)} 00:00:00`),
      title,
      payload: { source: 'm365', sourceClass: 'work', isAllDay: true },
    })
    expect(allDayEvents([allDay('Abgesagt: x'), allDay('x')], D)).toHaveLength(1)
  })
})
