import { describe, expect, test } from 'bun:test'
import { createDraftWriter } from './draft-writer'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('createDraftWriter', () => {
  test('keeps a pending write per exercise', async () => {
    const sent: string[] = []
    const w = createDraftWriter<number>(async (id, d) => {
      sent.push(`${id}:${d}`)
    }, 10)
    w.push('a', 1)
    w.push('b', 2)
    w.push('a', 3)
    await sleep(40)
    expect(sent.toSorted()).toEqual(['a:3', 'b:2'])
    expect(w.isIdle()).toBe(true)
  })

  test('flush sends everything pending at once', async () => {
    const sent: string[] = []
    const w = createDraftWriter<number>(async (id, d) => {
      sent.push(`${id}:${d}`)
    }, 1_000)
    w.push('a', 1)
    w.push('b', 2)
    w.flush()
    await sleep(5)
    expect(sent).toEqual(['a:1', 'b:2'])
  })

  test('runs saves one at a time, in order', async () => {
    const log: string[] = []
    let active = 0
    const w = createDraftWriter<number>(async (id, d) => {
      active += 1
      expect(active).toBe(1)
      log.push(`start ${id}:${d}`)
      await sleep(15)
      log.push(`end ${id}:${d}`)
      active -= 1
    }, 1_000)
    w.push('a', 1)
    w.push('b', 2)
    w.flush()
    await sleep(60)
    expect(log).toEqual(['start a:1', 'end a:1', 'start b:2', 'end b:2'])
  })

  test('cancel drops an unsent write; a failed save does not stall the queue', async () => {
    const sent: string[] = []
    const w = createDraftWriter<number>(async (id, d) => {
      sent.push(`${id}:${d}`)
      if (id === 'a') throw new Error('boom')
    }, 1_000)
    w.push('a', 1)
    w.push('b', 2)
    w.push('c', 3)
    w.cancel('c')
    w.flush()
    await sleep(10)
    expect(sent).toEqual(['a:1', 'b:2'])
    expect(w.isIdle()).toBe(true)
  })

  test('run queues behind in-flight saves', async () => {
    const log: string[] = []
    const w = createDraftWriter<number>(async () => {
      await sleep(10)
      log.push('save')
    }, 1_000)
    w.push('a', 1)
    w.flush()
    w.run(async () => {
      log.push('delete')
    })
    await sleep(40)
    expect(log).toEqual(['save', 'delete'])
  })
})
