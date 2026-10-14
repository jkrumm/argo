import { Button, Container, PasswordInput, Stack, Text } from '@mantine/core'
import { Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { PageTitle } from 'basalt-ui'
import { fieldKey, inputProps, useBasaltForm } from 'basalt-ui/forms'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { useAuthStore } from './auth'

const TokenSchema = z.object({
  token: z.string().trim().min(1, 'API token is required'),
})

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

/** The `/login` page body. Lives here, not in `routes/`, because it is a shell-less surface: the
 * `in-body-page-title` guard wants `PageTitle` there, and only a path outside `routes/` says so. */
export function LoginPage({ redirectTo: target }: { redirectTo: string | undefined }) {
  const router = useRouter()
  const setToken = useAuthStore((s) => s.setToken)
  const form = useBasaltForm({
    initialValues: { token: '' },
    schema: TokenSchema,
  })

  return (
    <Container size="xs" pt={120} pb={64}>
      <Stack gap="lg">
        <Stack gap={4}>
          <PageTitle title="Argo" />
          <Text c="dimmed" size="sm">
            Enter your API bearer token to continue. It's stored in this browser's localStorage and
            reused on every request.
          </Text>
        </Stack>
        <form
          onSubmit={form.onSubmit(({ token }) => {
            setToken(token.trim())
            router.history.push(target ?? '/')
          })}
        >
          <Stack gap="sm">
            <PasswordInput
              label="API token"
              placeholder="Bearer token"
              autoComplete="current-password"
              key={fieldKey(form, 'token')}
              {...inputProps(form, 'token')}
            />
            <Button type="submit">Sign in</Button>
          </Stack>
        </form>
      </Stack>
    </Container>
  )
}
