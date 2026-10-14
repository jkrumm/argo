import { afterEach, describe, expect, it } from 'bun:test'
import { AuthRequiredError, clearToken, requireToken, useAuthStore } from './auth'

afterEach(() => clearToken())

describe('requireToken', () => {
  it('throws AuthRequiredError without a token, so no child loader runs', () => {
    clearToken()
    expect(() => requireToken()).toThrow(AuthRequiredError)
  })

  it('passes once a token is set', () => {
    useAuthStore.getState().setToken('t')
    expect(() => requireToken()).not.toThrow()
  })
})
