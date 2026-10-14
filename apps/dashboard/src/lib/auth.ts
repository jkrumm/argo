import { create } from 'zustand'
import { redirect } from '@tanstack/react-router'
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

// Dev-only auto-auth: seed the bearer from VITE_DEV_API_TOKEN so the login route never blocks local
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

const isControlChar = (c: string): boolean => {
  const code = c.charCodeAt(0)
  return code < 0x20 || code === 0x7f
}

/**
 * Accepts only a same-origin relative path (`/a/b?c=d#e`): one leading slash, no scheme, no
 * authority (`//host`), no backslash tricks (`/\\host` is read as `//host` by browsers), no control
 * characters. Anything else, and `/login` itself (a redirect loop), yields `undefined` so callers
 * fall back to `/`.
 */
export function safeRedirect(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined
  if (raw.includes('\\') || [...raw].some(isControlChar)) return undefined
  const probe = new URL(raw, 'http://redirect.invalid')
  if (probe.origin !== 'http://redirect.invalid') return undefined
  // Dot segments can normalise to `//host`; judge, and return, the normalised form.
  if (probe.pathname.startsWith('//')) return undefined
  if (/^\/login\/*$/.test(probe.pathname)) return undefined
  return probe.pathname + probe.search + probe.hash
}

/**
 * Root-route `beforeLoad` guard. A parent's `beforeLoad` settles before any child loader starts, so
 * redirecting here keeps every loader from firing unauthenticated at boot, and the first paint is
 * already `/login` — no frame of the authenticated shell. `/login` itself is exempt.
 */
export function requireToken(location: { pathname: string; href: string }): void {
  if (location.pathname === '/login' || getToken()) return
  throw redirect({ to: '/login', search: { redirect: safeRedirect(location.href) } })
}
