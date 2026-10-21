import { describe, expect, it } from 'bun:test'
import { parseMapShotState, parseShotState, shotFetcher } from './shot-state'

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

describe('parseMapShotState', () => {
  it('reads the two declared map states from `shot-map`', () => {
    expect(parseMapShotState('?tab=map&shot-map=loading')).toBe('loading')
    expect(parseMapShotState('?shot-map=error')).toBe('error')
  })

  it('ignores anything else, including the page-level `shot-state`', () => {
    expect(parseMapShotState('')).toBeNull()
    expect(parseMapShotState('?shot-map=empty')).toBeNull()
    expect(parseMapShotState('?shot-state=loading')).toBeNull()
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
