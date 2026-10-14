import { afterEach, describe, expect, it } from 'bun:test'
import { isRedirect } from '@tanstack/react-router'
import { clearToken, requireToken, safeRedirect, useAuthStore } from './auth'

afterEach(() => clearToken())

const at = (href: string) => ({ pathname: href.split(/[?#]/)[0] ?? href, href })

function thrownBy(fn: () => void): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return undefined
}

describe('requireToken', () => {
  it('redirects to /login carrying the original path + search, so no child loader runs', () => {
    const e = thrownBy(() => requireToken(at('/strength?range=30d')))
    expect(isRedirect(e)).toBe(true)
    const opts = (e as { options: { to: string; search: { redirect?: string } } }).options
    expect(opts.to).toBe('/login')
    expect(opts.search.redirect).toBe('/strength?range=30d')
  })

  it('drops an unsafe original href instead of carrying it', () => {
    const e = thrownBy(() => requireToken(at('//evil.example/x')))
    const opts = (e as { options: { search: { redirect?: string } } }).options
    expect(opts.search.redirect).toBeUndefined()
  })

  it('never redirects /login to itself', () => {
    expect(() => requireToken(at('/login?redirect=%2Fa'))).not.toThrow()
  })

  it('passes once a token is set', () => {
    useAuthStore.getState().setToken('t')
    expect(() => requireToken(at('/agents'))).not.toThrow()
  })
})

describe('safeRedirect', () => {
  it.each(['/', '/agents', '/strength?range=30d', '/a/b?x=1#h', '/a//b', '/a?next=//evil.example'])(
    'accepts %s',
    (p) => expect(safeRedirect(p)).toBe(p),
  )

  it.each([
    '//evil.example',
    '//evil.example/path',
    '///evil.example',
    '/\\evil.example',
    '/\\/evil.example',
    'https://evil.example',
    'http://evil.example/',
    'javascript:alert(1)',
    'evil.example',
    'agents',
    '',
    '/\tevil',
    '/\n/evil.example',
    '/login',
    '/login?redirect=%2Fx',
    undefined,
    null,
    42,
  ])('rejects %p', (p) => expect(safeRedirect(p)).toBeUndefined())

  it('rejects a non-string array', () => expect(safeRedirect(['/a'])).toBeUndefined())
})
