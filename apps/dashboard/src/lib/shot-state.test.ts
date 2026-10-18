import { describe, expect, it } from 'bun:test'
import { parseShotState, shotFetcher } from './shot-state'

describe('parseShotState', () => {
  it('reads the three declared states', () => {
    expect(parseShotState('?shot-state=empty')).toBe('empty')
    expect(parseShotState('?a=1&shot-state=loading')).toBe('loading')
    expect(parseShotState('?shot-state=error')).toBe('error')
  })

  it('ignores anything else', () => {
    expect(parseShotState('')).toBeNull()
    expect(parseShotState('?shot-state=hover')).toBeNull()
  })
})

describe('shotFetcher', () => {
  it('passes through with no state and under empty', () => {
    expect(shotFetcher(null)).toBe(fetch)
    expect(shotFetcher('empty')).toBe(fetch)
  })

  it('answers 503 under error', async () => {
    const response = await shotFetcher('error')('https://example.com/x')
    expect(response.status).toBe(503)
  })

  it('never settles under loading', async () => {
    const settled = await Promise.race([
      shotFetcher('loading')('https://example.com/x').then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 20)),
    ])
    expect(settled).toBe(false)
  })
})
