import { createFileRoute, redirect } from '@tanstack/react-router'
import { getToken, safeRedirect } from '../lib/auth'
import { LoginPage } from '../lib/auth-gate'

export const Route = createFileRoute('/login')({
  // An unsafe or missing `redirect` is dropped, never rejected: the page still has to render.
  validateSearch: (search: { redirect?: unknown }): { redirect?: string | undefined } => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: ({ search }) => {
    if (!getToken()) return
    // `to` takes a pathname only, so the validated same-origin target is split into its parts. The
    // cast is at `redirect`'s boundary: a runtime path cannot satisfy the typed route union.
    const target = new URL(search.redirect ?? '/', 'http://redirect.invalid')
    throw redirect({
      to: target.pathname,
      search: Object.fromEntries(target.searchParams),
      hash: target.hash.slice(1),
    } as never)
  },
  component: LoginRoute,
})

function LoginRoute() {
  return <LoginPage redirectTo={Route.useSearch().redirect} />
}
