import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type AuthState = {
  token: string | null
  setToken: (token: string) => void
  clearToken: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      setToken: (token) => set({ token }),
      clearToken: () => set({ token: null }),
    }),
    { name: 'argo-auth' },
  ),
)

export const getToken = (): string | null => useAuthStore.getState().token
export const clearToken = (): void => useAuthStore.getState().clearToken()

// Dev-only auto-auth: seed the bearer from VITE_DEV_API_TOKEN so the AuthGate never blocks local
// dev or screenshot validation. Runs once at module load; only when no token is already persisted
// (a manually-entered token still wins). Inert in prod — the DEV guard and the absence of the var
// in prod builds both prevent it.
if (import.meta.env.DEV && import.meta.env.VITE_DEV_API_TOKEN && !useAuthStore.getState().token) {
  useAuthStore.getState().setToken(import.meta.env.VITE_DEV_API_TOKEN)
}

export function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  return status === 401
}

/** Thrown by `requireToken` so the root route's `errorComponent` can show the token prompt. */
export class AuthRequiredError extends Error {
  constructor() {
    super('API token required')
    this.name = 'AuthRequiredError'
  }
}

/**
 * Root-route `beforeLoad` guard. A parent's `beforeLoad` settles before any child loader starts, so
 * throwing here keeps every loader from firing unauthenticated at boot; entering a token reloads the
 * page (`TokenPrompt`), which re-runs the guard with a token present.
 */
export function requireToken(): void {
  if (!getToken()) throw new AuthRequiredError()
}
