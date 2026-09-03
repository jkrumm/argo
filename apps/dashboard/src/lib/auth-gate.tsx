import { Button, Container, PasswordInput, Stack, Text } from '@mantine/core'
import { PageTitle } from 'basalt-ui'
import { fieldKey, inputProps, useBasaltForm } from 'basalt-ui/forms'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { useAuthStore } from './auth'

type Props = { children: ReactNode }

const TokenSchema = z.object({
  token: z.string().trim().min(1, 'API token is required'),
})

export function AuthGate({ children }: Props) {
  const token = useAuthStore((s) => s.token)
  if (token) return <>{children}</>
  return <TokenPrompt />
}

function TokenPrompt() {
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
            window.location.reload()
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
