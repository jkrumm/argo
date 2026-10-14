import { Button, Container, PasswordInput, Stack, Text } from '@mantine/core'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { PageTitle } from 'basalt-ui'
import { fieldKey, inputProps, useBasaltForm } from 'basalt-ui/forms'
import { z } from 'zod'
import { getToken, safeRedirect, useAuthStore } from '../lib/auth'

const TokenSchema = z.object({
  token: z.string().trim().min(1, 'API token is required'),
})

export const Route = createFileRoute('/login')({
  // An unsafe or missing `redirect` is dropped, never rejected: the page still has to render.
  validateSearch: (search: { redirect?: unknown }): { redirect?: string | undefined } => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: ({ search }) => {
    if (getToken()) throw redirect({ to: search.redirect ?? '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const { redirect: target } = Route.useSearch()
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
          {/* theme-allow in-body-page-title — shell-less surface */}
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
