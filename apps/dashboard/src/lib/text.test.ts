import { describe, expect, it } from 'bun:test'
import { firstClause, lastWhitespace, leadClauses, flatten, stripShortcodes } from './text'

describe('stripShortcodes', () => {
  it('keeps the text of a bracketed shortcode and drops bare ones', () => {
    expect(stripShortcodes(':white_check_mark: {service} recovered')).toBe('{service} recovered')
    expect(stripShortcodes('[red_circle: {service} down]')).toBe('{service} down')
  })
  it('leaves colon identifiers alone', () => {
    expect(stripShortcodes('job m365:auth:prod at 10:30:45')).toBe('job m365:auth:prod at 10:30:45')
  })
})

describe('capitalised bracket text', () => {
  it('keeps a bracketed real word', () => {
    expect(stripShortcodes('[Note: rollout paused] now')).toBe('[Note: rollout paused] now')
    expect(stripShortcodes('[blocker] Deploy')).toBe('[blocker] Deploy')
  })
})

describe('stripShortcodes in feed rows', () => {
  it('unwraps the bracketed form and drops bare shortcodes', () => {
    expect(stripShortcodes('[red_circle: build failed]')).toBe('build failed')
    expect(stripShortcodes(':warning: disk  almost full')).toBe('disk almost full')
    expect(stripShortcodes('standup at 10:30:45')).toBe('standup at 10:30:45')
    expect(stripShortcodes('ran bun m365:auth:prod')).toBe('ran bun m365:auth:prod')
    expect(stripShortcodes('agent:main:slack:group:X')).toBe('agent:main:slack:group:X')
    expect(stripShortcodes('see http://x:y')).toBe('see http://x:y')
    expect(stripShortcodes('shipped :rocket: today')).toBe('shipped today')
  })
})

describe('flatten whitespace', () => {
  it('flattens whitespace', () => {
    expect(flatten('  a \n b\t c ')).toBe('a b c')
  })
})

describe('firstClause', () => {
  it('cuts at a dash, a sentence stop, a semicolon or an opening bracket', () => {
    expect(firstClause('Fix the build — retry loop')).toBe('Fix the build')
    expect(firstClause('Disk full on {host}. Cleanup needed')).toBe('Disk full on {host}')
    expect(firstClause('Rotate keys; then restart')).toBe('Rotate keys')
    expect(firstClause('Deploy stalled (3 retries)')).toBe('Deploy stalled')
  })
  it('keeps a title with no stop whole and leaves dots inside a token alone', () => {
    expect(firstClause('  Upgrade   a.b.c to 2 ')).toBe('Upgrade a.b.c to 2')
    expect(firstClause('')).toBe('')
  })
})

describe('flatten', () => {
  it('collapses whitespace but keeps a no-break space between a number and its unit', () => {
    expect(flatten('  waiting \n 5\u00a0m   ago ')).toBe('waiting 5\u00a0m ago')
    expect(stripShortcodes(':x: 5\u00a0m  ago')).toBe('5\u00a0m ago')
  })
})

describe('leadClauses', () => {
  it('takes the first n clauses, and the whole text past the last stop', () => {
    expect(leadClauses('Disk full — host a — retry', 2)).toBe('Disk full — host a')
    expect(leadClauses('Disk full — host a', Infinity)).toBe('Disk full — host a')
    expect(leadClauses('Disk full', 2)).toBe('Disk full')
  })
  it('ignores a stop with nothing before it', () => {
    expect(leadClauses('. Disk full — host a', 1)).toBe('Disk full')
    expect(firstClause('— — —')).toBe('')
    expect(firstClause('')).toBe('')
  })
})

describe('lastWhitespace', () => {
  it('finds the last whitespace of any kind', () => {
    expect(lastWhitespace('one two')).toBe(3)
    expect(lastWhitespace('one\ttwo\nthree')).toBe(7)
    expect(lastWhitespace('single')).toBe(-1)
  })
})
