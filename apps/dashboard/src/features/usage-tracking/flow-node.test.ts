import { describe, expect, it } from 'bun:test'
import { nodeValue, parseNode, toggleNode } from './flow-node'

describe('parseNode', () => {
  it('reads every node kind', () => {
    expect(parseNode('router')).toEqual({ kind: 'router' })
    expect(parseNode('demand:review')).toEqual({ kind: 'demand', workflow: 'review' })
  })

  it('keeps a colon inside a workflow name', () => {
    expect(parseNode('demand:a:b')).toEqual({ kind: 'demand', workflow: 'a:b' })
  })

  it('reads anything malformed or retired as no node, never throwing', () => {
    // pool:, sub: and key: were the Supply column's nodes; an old link ignores them.
    for (const raw of ['', 'pool:iu', 'sub:me2', 'key:athena-team', 'demand:', 'nope:iu', 'iu']) {
      expect(parseNode(raw)).toBeNull()
    }
  })

  it('round-trips through nodeValue', () => {
    for (const raw of ['router', 'demand:otel']) {
      const node = parseNode(raw)
      expect(node === null ? null : nodeValue(node)).toBe(raw)
    }
  })
})

describe('toggleNode', () => {
  it('selects, switches and closes on the second click', () => {
    expect(toggleNode('', 'router')).toBe('router')
    expect(toggleNode('router', 'demand:review')).toBe('demand:review')
    expect(toggleNode('demand:review', 'demand:review')).toBe('')
  })
})
