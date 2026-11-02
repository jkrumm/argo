import { describe, expect, it } from 'bun:test'
import { legacyNode, nodeValue, parseNode, toggleNode } from './flow-node'

describe('parseNode', () => {
  it('reads every node kind', () => {
    expect(parseNode('pool:iu')).toEqual({ kind: 'pool', account: 'iu' })
    expect(parseNode('sub:me2')).toEqual({ kind: 'sub', account: 'me2' })
    expect(parseNode('key:athena-team')).toEqual({ kind: 'key', iuKey: 'athena-team' })
    expect(parseNode('router')).toEqual({ kind: 'router' })
    expect(parseNode('demand:review')).toEqual({ kind: 'demand', workflow: 'review' })
  })

  it('keeps a colon inside a workflow name', () => {
    expect(parseNode('demand:a:b')).toEqual({ kind: 'demand', workflow: 'a:b' })
  })

  it('reads anything malformed or off the registry as no node', () => {
    for (const raw of [
      '',
      'pool:',
      'pool:nobody',
      'sub:all',
      'key:work',
      'demand:',
      'nope:iu',
      'iu',
    ]) {
      expect(parseNode(raw)).toBeNull()
    }
  })

  it('round-trips through nodeValue', () => {
    for (const raw of ['pool:me', 'sub:iu', 'key:personal', 'router', 'demand:otel']) {
      const node = parseNode(raw)
      expect(node === null ? null : nodeValue(node)).toBe(raw)
    }
  })
})

describe('toggleNode', () => {
  it('selects, switches and closes on the second click', () => {
    expect(toggleNode('', 'router')).toBe('router')
    expect(toggleNode('router', 'pool:iu')).toBe('pool:iu')
    expect(toggleNode('pool:iu', 'pool:iu')).toBe('')
  })
})

describe('legacyNode', () => {
  it('maps each retired tab to its node', () => {
    expect(legacyNode('overview')).toBe('')
    expect(legacyNode('credits')).toBe('pool:iu')
    expect(legacyNode('iu-sub')).toBe('sub:iu')
    expect(legacyNode('me-sub')).toBe('sub:me')
  })

  it('takes the old account or key when it is still on the registry', () => {
    expect(legacyNode('claude', { account: 'me' })).toBe('sub:me')
    expect(legacyNode('claude', { account: 'all' })).toBe('sub:iu')
    expect(legacyNode('claude', { account: 7 })).toBe('sub:iu')
    expect(legacyNode('iu-api', { iuKey: 'athena-team' })).toBe('key:athena-team')
    expect(legacyNode('iu-api', { iuKey: 'all' })).toBe('key:personal')
  })
})
