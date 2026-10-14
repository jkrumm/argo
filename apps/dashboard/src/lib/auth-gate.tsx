import { Outlet, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useAuthStore } from './auth'

/**
 * The root component's branch: `/login` renders bare (no sidebar, badge or timer queries — none of
 * the shell mounts), every other route renders `children` (the shell) only while a token exists.
 * `beforeLoad` covers boot and navigation; this covers the token being cleared mid-session (a 401),
 * when `beforeLoad` does not re-run — it renders nothing for that frame instead of an
 * unauthenticated shell, and the 401 handler's redirect lands on `/login`.
 */
export function ShellGate({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const onLogin = useRouterState({ select: (s) => s.location.pathname === '/login' })
  if (onLogin) return <Outlet />
  return token ? <>{children}</> : null
}
