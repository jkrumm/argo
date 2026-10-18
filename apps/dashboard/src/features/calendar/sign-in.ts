import type { SourceClass } from '../../lib/queries/calendar'

/** The next step for a source whose sign-in failed: a link the owner follows, or a command the owner runs. */
export type SignInStep =
  | { kind: 'link'; url: string; label: string }
  | { kind: 'command'; hint: string; command: string }

/** A sign-in failure is the API's 503 "not authenticated" answer: a refetch cannot fix it. */
export function isAuthError(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'status' in error && error.status === 503
}

export function failureReason(error: unknown, source: string): string {
  if (isAuthError(error)) return 'token expired.'
  if (error instanceof Error) return error.message
  return `could not load ${source} events.`
}

/** Google re-authorizes in the browser; the Microsoft 365 grant is re-seeded from the laptop. */
const STEPS: Record<SourceClass, SignInStep> = {
  personal: { kind: 'link', url: '/api/oauth/google/init', label: 'Re-authorize' },
  work: { kind: 'command', hint: 'Re-seed on the laptop:', command: 'bun m365:auth:prod' },
}

/** The step for a failed source, or none when the failure is not a sign-in failure. */
export function signInStep(source: SourceClass, error: unknown): SignInStep | undefined {
  return isAuthError(error) ? STEPS[source] : undefined
}
