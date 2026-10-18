import { describe, expect, test } from 'bun:test'

// The module's eden client reads `window.location` at import time; bun test has no DOM.
Object.assign(globalThis, { window: { location: { origin: 'http://localhost' } } })
const { googleToEvents, m365ToEvents } = await import('./calendar')

const raw = (title: string, extra: Record<string, unknown> = {}) => ({
  id: 'e',
  title,
  start: '2026-10-14T09:00:00Z',
  end: '2026-10-14T10:00:00Z',
  ...extra,
})

describe('isCancelled mapping', () => {
  test('the API field wins when present', () => {
    expect(m365ToEvents([raw('{title}', { isCancelled: true })])[0]?.payload?.isCancelled).toBe(
      true,
    )
    expect(
      m365ToEvents([raw('Canceled: {title}', { isCancelled: false })])[0]?.payload?.isCancelled,
    ).toBe(false)
  })

  test('an API without the field falls back to the title prefix', () => {
    for (const prefix of ['Abgesagt:', 'Canceled:', 'Cancelled:'])
      expect(m365ToEvents([raw(`${prefix} {title}`)])[0]?.payload?.isCancelled).toBe(true)
    expect(m365ToEvents([raw('{title}')])[0]?.payload?.isCancelled).toBe(false)
    expect(googleToEvents([raw('{title}')])[0]?.payload?.isCancelled).toBe(false)
  })
})
