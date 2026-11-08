import { describe, expect, test } from 'bun:test'
import { CRON_TIMEZONE, cronOptions, tracedTick } from './traced-tick.js'

describe('tracedTick', () => {
  test('runs fn', async () => {
    let ran = false
    await tracedTick('t', {}, async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  test('rethrows fn errors', async () => {
    await expect(
      tracedTick('t', {}, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})

describe('cronOptions', () => {
  test('sets timezone and a catch handler that does not throw', () => {
    const opts = cronOptions('x')
    expect(opts.timezone).toBe(CRON_TIMEZONE)
    const handler = opts.catch as (e: unknown, job: unknown) => void
    expect(() => handler(new Error('e'), {})).not.toThrow()
  })
})
