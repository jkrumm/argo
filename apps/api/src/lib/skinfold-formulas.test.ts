import { describe, it, expect } from 'bun:test'
import {
  sessionAverage,
  trailingRatePerWeek,
  classifySkinfoldDirection,
} from './skinfold-formulas.js'

describe('sessionAverage', () => {
  it('averages readings and rounds to 1 decimal', () => {
    expect(sessionAverage([{ value_mm: 12 }, { value_mm: 15 }])).toBe(13.5)
    expect(sessionAverage([{ value_mm: 10 }, { value_mm: 11 }, { value_mm: 12 }])).toBe(11)
  })

  it('handles a single reading', () => {
    expect(sessionAverage([{ value_mm: 20.3 }])).toBe(20.3)
  })
})

describe('trailingRatePerWeek', () => {
  it('detects a steady decrease across 28 days as mm/week negative', () => {
    const points = [
      { date: '2025-01-01', value: 20 },
      { date: '2025-01-15', value: 18 },
      { date: '2025-01-29', value: 16 },
    ]
    const rate = trailingRatePerWeek(points)
    expect(rate).not.toBeNull()
    expect(rate!).toBeLessThan(0)
  })

  it('detects a steady increase as mm/week positive', () => {
    const points = [
      { date: '2025-01-01', value: 14 },
      { date: '2025-01-15', value: 16 },
      { date: '2025-01-29', value: 18 },
    ]
    const rate = trailingRatePerWeek(points)
    expect(rate).not.toBeNull()
    expect(rate!).toBeGreaterThan(0)
  })

  it('returns near-zero rate for flat readings', () => {
    const points = [
      { date: '2025-01-01', value: 15 },
      { date: '2025-01-15', value: 15 },
      { date: '2025-01-29', value: 15 },
    ]
    const rate = trailingRatePerWeek(points)
    expect(rate).toBe(0)
  })

  it('returns null for a single point (insufficient data)', () => {
    expect(trailingRatePerWeek([{ date: '2025-01-01', value: 15 }])).toBeNull()
  })

  it('returns null when span is under 3 days', () => {
    const points = [
      { date: '2025-01-01', value: 15 },
      { date: '2025-01-02', value: 14 },
    ]
    expect(trailingRatePerWeek(points)).toBeNull()
  })

  it('falls back to all-time slope when trailing 28d window has < 2 points', () => {
    const points = [
      { date: '2025-01-01', value: 20 },
      { date: '2025-01-05', value: 18 },
      { date: '2026-06-01', value: 10 },
    ]
    const rate = trailingRatePerWeek(points)
    expect(rate).not.toBeNull()
  })
})

describe('classifySkinfoldDirection', () => {
  it('classifies negative rates as reducing', () => {
    expect(classifySkinfoldDirection(-0.5)).toBe('reducing')
  })

  it('classifies positive rates as increasing', () => {
    expect(classifySkinfoldDirection(0.5)).toBe('increasing')
  })

  it('classifies |rate| < 0.1 as stable', () => {
    expect(classifySkinfoldDirection(0.05)).toBe('stable')
    expect(classifySkinfoldDirection(-0.05)).toBe('stable')
    expect(classifySkinfoldDirection(0)).toBe('stable')
  })

  it('classifies null as stable', () => {
    expect(classifySkinfoldDirection(null)).toBe('stable')
  })
})
