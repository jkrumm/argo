import { describe, expect, it } from 'bun:test'
import { failureReason, isAuthError, signInStep } from './sign-in'

describe('signInStep', () => {
  const authError = { status: 503 }
  it('sends Google to the browser re-authorization', () => {
    expect(signInStep('personal', authError)).toEqual({
      kind: 'link',
      url: '/api/oauth/google/init',
      label: 'Re-authorize',
    })
  })
  it('gives Microsoft 365 the re-seed command, not a link', () => {
    expect(signInStep('work', authError)).toEqual({
      kind: 'command',
      hint: 'Re-seed on the laptop:',
      command: 'bun m365:auth:prod',
    })
  })
  it('has no step for a failure that is not a sign-in failure', () => {
    expect(signInStep('work', new Error('boom'))).toBeUndefined()
    expect(signInStep('personal', { status: 500 })).toBeUndefined()
    expect(signInStep('work', null)).toBeUndefined()
  })
})

describe('failureReason', () => {
  it('names a sign-in failure, then the error message, then the source', () => {
    expect(isAuthError({ status: 503 })).toBe(true)
    expect(failureReason({ status: 503 }, 'Google')).toBe('token expired.')
    expect(failureReason(new Error('boom'), 'Google')).toBe('boom')
    expect(failureReason('x', 'Google')).toBe('could not load Google events.')
  })
})
