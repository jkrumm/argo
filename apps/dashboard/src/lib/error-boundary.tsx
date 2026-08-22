import { Alert, Button, Code, Container, Group, Stack, Text, Title } from '@mantine/core'
import { IconAlertTriangle, IconRefresh, IconRotate } from '@tabler/icons-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { VX } from 'basalt-ui/tokens'
import { HyperDX } from './hyperdx'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Body intentionally empty — HyperDX.attachToReactErrorBoundary (below)
    // patches this method to call recordException(error, { componentStack }),
    // which ties the exception to the active session and trace.
  }

  private reset = (): void => this.setState({ error: null })
  private reload = (): void => window.location.reload()

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const sessionId = HyperDX.getSessionId()

    return (
      <Container size="sm" pt={64} pb={64}>
        <Stack gap="lg">
          <Stack gap={4}>
            <Title order={2}>Something went wrong</Title>
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
            <Button leftSection={<IconRefresh size={16} />} onClick={this.reload}>
              Reload page
            </Button>
            <Button variant="default" leftSection={<IconRotate size={16} />} onClick={this.reset}>
              Try to recover
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
}

// HyperDX rewrites ErrorBoundary.prototype.componentDidCatch so that any caught
// error is forwarded to recordException with the React componentStack attribute.
// Preserves any existing componentDidCatch — safe to call once at module load.
HyperDX.attachToReactErrorBoundary(ErrorBoundary)
