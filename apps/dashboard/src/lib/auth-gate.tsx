import { Button, Container, PasswordInput, Stack, Text, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import type { ReactNode } from 'react'
import { useAuthStore } from './auth'

type Props = { children: ReactNode }

export function AuthGate({ children }: Props) {
  const token = useAuthStore((s) => s.token)
  if (token) return <>{children}</>
  return <TokenPrompt />
}

function TokenPrompt() {
  const setToken = useAuthStore((s) => s.setToken)
  const form = useForm({
    initialValues: { token: '' },
    validate: {
      token: (value) => (value.trim().length === 0 ? 'API token is required' : null),
    },
  })

  return (
    <Container size="xs" pt={120} pb={64}>
      <Stack gap="lg">
        <Stack gap={4}>
          <Title order={2}>Argo</Title>
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
              {...form.getInputProps('token')}
            />
            <Button type="submit">Sign in</Button>
          </Stack>
        </form>
      </Stack>
    </Container>
  )
}
