import { describe, expect, it } from 'bun:test'
import { softBreaks, stripShortcodes } from './text'

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

describe('softBreaks', () => {
  it('breaks a long identifier after its separators, never inside a word', () => {
    const id = 'tests_integration_workouts_summary_test'
    const broken = softBreaks(id)
    expect(broken.replaceAll('​', '')).toBe(id)
    expect(broken).toContain('tests_​integration_​')
  })

  it('leaves ordinary prose and short tokens alone', () => {
    expect(softBreaks('Run the checks again, then merge.')).toBe(
      'Run the checks again, then merge.',
    )
    expect(softBreaks('a_b')).toBe('a_b')
  })
})
