import { describe, it, expect } from 'bun:test'
import { computeCost } from './ai-usage.js'

// Pure cost-computation tests — no DB required (unlike the recordAiUsage()
// integration suite in routes/ai.test.ts, which needs live Postgres).

describe('computeCost()', () => {
  it('prices deepseek-v4.1-flash at the 2026-09-13 measured rate', () => {
    const { cost_usd, cost_source } = computeCost('deepseek-v4.1-flash', 1_000_000, 0, 1_000_000)
    // 1M uncached input @ $0.50 + 1M output @ $1.50
    expect(cost_usd).toBeCloseTo(0.5 + 1.5, 10)
    expect(cost_source).toBe('computed')
  })

  it('prices glm-5.3-flash at its measured rate', () => {
    const { cost_usd } = computeCost('glm-5.3-flash', 1_000_000, 0, 1_000_000)
    expect(cost_usd).toBeCloseTo(0.15 + 0.5, 10)
  })

  it('prices cached tokens at the cached rate, uncached at the input rate', () => {
    // 500k cached + 500k uncached, deepseek-v4.1-flash: cachedInput $0.05, input $0.50
    const { cost_usd } = computeCost('deepseek-v4.1-flash', 500_000, 500_000, 0)
    expect(cost_usd).toBeCloseTo((500_000 * 0.5 + 500_000 * 0.05) / 1_000_000, 10)
  })

  it('falls back to the input rate for cached tokens when a model has no cachedInput entry', () => {
    // deepseek-v4-flash has no cachedInput — cached and uncached tokens cost the same.
    const cached = computeCost('deepseek-v4-flash', 0, 1_000_000, 0)
    const uncached = computeCost('deepseek-v4-flash', 1_000_000, 0, 0)
    expect(cached.cost_usd).toBeCloseTo(uncached.cost_usd!, 10)
  })

  it('returns null cost and cost_source "none" for an unrated model', () => {
    const { cost_usd, cost_source } = computeCost('some-audio-model', 100, 0, 100)
    expect(cost_usd).toBeNull()
    expect(cost_source).toBe('none')
  })

  it('keeps retired model ids priced for historical rows', () => {
    const { cost_usd, cost_source } = computeCost('deepseek-v4-pro', 1_000_000, 0, 1_000_000)
    expect(cost_usd).toBeCloseTo(0.435 + 0.87, 10)
    expect(cost_source).toBe('computed')
  })
})
