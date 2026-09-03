import { Alert, Button, Code, Container, Group, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { BasaltErrorBoundary, PageTitle } from 'basalt-ui'
import type { BasaltErrorContext } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import { HyperDX } from './hyperdx'

export function CrashFallback({ error: raw }: { error: unknown }) {
  const error = raw instanceof Error ? raw : new Error(String(raw))
  const sessionId = HyperDX.getSessionId()

  return (
    <Container size="sm" pt={64} pb={64}>
      <Stack gap="lg">
        <Stack gap={4}>
          <PageTitle title="Something went wrong" />
          <Text c="dimmed" size="sm">
            The page hit an unexpected error and was unloaded to keep the app stable.
          </Text>
        </Stack>

        <Alert
          color="red"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title={error.name || 'Error'}
        >
          <Text size="sm">{error.message || 'Unknown error'}</Text>
        </Alert>

        {import.meta.env.DEV && error.stack && (
          // theme-allow raw-scroll-container — crash-fallback stack trace: renders when something upstream broke, so it stays a plain scrollable node rather than depending on ScrollArea/theme context that may itself be implicated.
          <Code block style={{ fontSize: VX.text.micro, maxHeight: 280, overflow: 'auto' }}>
            {error.stack}
          </Code>
        )}

        <Group gap="sm">
          <Button leftSection={<IconRefresh size={16} />} onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </Group>

        {sessionId && (
          <Text size="xs" c="dimmed">
            Reported. Session: <Code>{sessionId}</Code>
          </Text>
        )}
      </Stack>
    </Container>
  )
}

export function reportCrash(error: unknown, ctx: BasaltErrorContext): void {
  // oxlint-disable-next-line no-console
  console.error('[basalt]', ctx, error)
}

// HyperDX patches the exported class so that any caught error is forwarded to
// recordException with the React componentStack attribute.
HyperDX.attachToReactErrorBoundary(BasaltErrorBoundary)
