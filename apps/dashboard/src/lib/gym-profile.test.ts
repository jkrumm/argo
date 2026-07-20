import { describe, expect, it } from 'bun:test'
import {
  canRemoveProfile,
  loadingFor,
  resolveActiveProfile,
  slugify,
  uniqueId,
} from './gym-profile'
import type { GymProfile } from './gym-profile'

const profile = (id: string, overrides: Partial<GymProfile> = {}): GymProfile => ({
  id,
  name: id,
  bars: [
    { id: 'olympic', name: 'Olympic Barbell', weight_kg: 20 },
    { id: 'ez', name: 'EZ Curl Bar', weight_kg: 7.5 },
  ],
  plates: [],
  defaultBarId: 'olympic',
  exercises: {},
  ...overrides,
})

// ── slugify ───────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Home Gym')).toBe('home-gym')
  })

  it('strips leading/trailing separators from punctuation', () => {
    expect(slugify('  !!Crossfit Box!!  ')).toBe('crossfit-box')
  })

  it('collapses runs of non-alphanumeric characters', () => {
    expect(slugify('Gold--Gym!!')).toBe('gold-gym')
  })

  it('falls back to "gym" for names with no alphanumeric characters', () => {
    expect(slugify('!!!')).toBe('gym')
    expect(slugify('')).toBe('gym')
  })
})

// ── uniqueId ──────────────────────────────────────────────────────────────

describe('uniqueId', () => {
  it('uses the plain slug when there is no collision', () => {
    expect(uniqueId('Home Gym', [])).toBe('home-gym')
  })

  it('appends -2 on a single collision', () => {
    expect(uniqueId('Home Gym', ['home-gym'])).toBe('home-gym-2')
  })

  it('keeps incrementing the suffix past existing collisions', () => {
    expect(uniqueId('Home Gym', ['home-gym', 'home-gym-2', 'home-gym-3'])).toBe('home-gym-4')
  })

  it('does not collide with an unrelated id sharing the base as a prefix', () => {
    expect(uniqueId('Home', ['home', 'home-gym'])).toBe('home-2')
  })
})

// ── resolveActiveProfile ────────────────────────────────────────────────────

describe('resolveActiveProfile', () => {
  it('returns the matching profile when activeId is valid', () => {
    const profiles = [profile('a'), profile('b')]
    expect(resolveActiveProfile('b', profiles).id).toBe('b')
  })

  it('falls back to the first profile when activeId is stale', () => {
    const profiles = [profile('a'), profile('b')]
    expect(resolveActiveProfile('deleted', profiles).id).toBe('a')
  })

  it('falls back to HOME when the profile list is empty', () => {
    expect(resolveActiveProfile('anything', []).id).toBe('home')
  })
})

// ── canRemoveProfile ─────────────────────────────────────────────────────────

describe('canRemoveProfile', () => {
  it('refuses to remove the last remaining profile', () => {
    expect(canRemoveProfile([profile('a')])).toBe(false)
  })

  it('allows removal when more than one profile exists', () => {
    expect(canRemoveProfile([profile('a'), profile('b')])).toBe(true)
  })

  it('refuses removal on an empty list', () => {
    expect(canRemoveProfile([])).toBe(false)
  })
})

// ── loadingFor ───────────────────────────────────────────────────────────────

describe('loadingFor', () => {
  it('degrades an unconfigured exercise to free rather than guessing a barbell', () => {
    expect(loadingFor(profile('a'), 'bench_press').mode).toBe('free')
  })

  it('returns the configured mode and bar', () => {
    const gym = profile('a', { exercises: { curl: { mode: 'barbell', barId: 'ez' } } })
    expect(loadingFor(gym, 'curl')).toEqual({ mode: 'barbell', barId: 'ez' })
  })

  it('falls back to the profile default bar when the entry names none', () => {
    const gym = profile('a', { exercises: { squat: { mode: 'barbell' } } })
    expect(loadingFor(gym, 'squat').barId).toBe('olympic')
  })

  // A bar deleted in gym settings must not leave an exercise pointing at nothing —
  // that would silently compute the loading with barWeight 0.
  it('resolves a stale bar reference to a bar that still exists', () => {
    const gym = profile('a', { exercises: { squat: { mode: 'barbell', barId: 'removed' } } })
    expect(loadingFor(gym, 'squat').barId).toBe('olympic')
  })

  it('resolves a stale profile default too', () => {
    const gym = profile('a', {
      defaultBarId: 'removed',
      exercises: { squat: { mode: 'barbell' } },
    })
    expect(loadingFor(gym, 'squat').barId).toBe('olympic')
  })
})
