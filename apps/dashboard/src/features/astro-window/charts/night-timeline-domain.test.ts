import { describe, expect, it } from 'bun:test'
import type { HourlyPoint } from '../types'
import { plotSeries } from './night-timeline-chart'
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
  it('ignores the sun, which stays clipped at the top', () => {
    expect(timelineDomain([point(12, 10, 35)])).toEqual([-20, 20])
  })
  it('ignores null samples', () => {
    expect(timelineDomain([point(null, null), point(null, 25)])).toEqual([-20, 30])
    expect(timelineDomain([])).toEqual([-20, 20])
  })
  it('keeps a float-noisy multiple of 10 as is', () => {
    expect(timelineDomain([point(30.000000000000004, 10)])).toEqual([-20, 30])
  })
})

describe('plotSeries', () => {
  const value = (key: string, d: HourlyPoint, domain: [number, number]) =>
    plotSeries(domain)
      .find((s) => s.key === key)!
      .getValue(d)

  it('clips the sun at 20 even when a high moon lifts the domain', () => {
    const d = point(12, 34, 30)
    const domain = timelineDomain([d])
    expect(domain).toEqual([-20, 40])
    expect(value('sun', d, domain)).toBeNull()
    expect(value('moon', d, domain)).toBe(34)
  })
})
