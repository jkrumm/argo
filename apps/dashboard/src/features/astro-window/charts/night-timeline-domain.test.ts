import { describe, expect, it } from 'bun:test'
import type { HourlyPoint } from '../types'
import { timelineDomain } from './night-timeline-domain'

const point = (core: number | null, moon: number | null, sun: number | null = -30) =>
  ({ coreAltitude: core, moonAltitude: moon, sunAltitude: sun }) as unknown as HourlyPoint

describe('timelineDomain', () => {
  it('keeps 20 on a low night', () => {
    expect(timelineDomain([point(12, 5), point(18, -3)])).toEqual([-20, 20])
  })
  it('rounds a moon peak up to the next 10', () => {
    expect(timelineDomain([point(10, 34.2), point(5, 20)])).toEqual([-20, 40])
  })
  it('keeps 20 when core and moon are both under 20', () => {
    expect(timelineDomain([point(19.9, 19.9)])).toEqual([-20, 20])
  })
  it('keeps an exact multiple of 10 as is', () => {
    expect(timelineDomain([point(10, 30)])).toEqual([-20, 30])
  })
  it('ignores null samples', () => {
    expect(timelineDomain([point(null, null), point(null, 25)])).toEqual([-20, 30])
    expect(timelineDomain([])).toEqual([-20, 20])
  })
})
