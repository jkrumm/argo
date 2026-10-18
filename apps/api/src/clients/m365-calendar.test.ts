import { describe, expect, it } from 'bun:test'
import { normalizeEvent } from './m365.js'

const base = {
  id: 'e1',
  subject: 'Sync',
  start: { dateTime: '2026-10-12T09:00:00.0000000' },
  end: { dateTime: '2026-10-12T10:00:00.0000000' },
}

describe('normalizeEvent — isCancelled', () => {
  it('carries Graph isCancelled through', () => {
    expect(normalizeEvent({ ...base, isCancelled: true }).isCancelled).toBe(true)
    expect(normalizeEvent({ ...base, isCancelled: false }).isCancelled).toBe(false)
  })

  it('defaults to false when Graph omits the field', () => {
    expect(normalizeEvent(base).isCancelled).toBe(false)
  })
})
