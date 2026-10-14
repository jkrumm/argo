import { Alert, Button, Code, Container, Group, ScrollArea, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { PageTitle } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'

export function CrashFallback({ error: raw }: { error: unknown }) {
  const error = raw instanceof Error ? raw : new Error(String(raw))

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
          <ScrollArea.Autosize mah={280}>
            <Code block style={{ fontSize: VX.text.micro }}>
              {error.stack}
            </Code>
          </ScrollArea.Autosize>
        )}

        <Group gap="sm">
          <Button leftSection={<IconRefresh size={16} />} onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </Group>
      </Stack>
    </Container>
  )
}
