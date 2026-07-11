import { ActionIcon, Box, Group, Text } from '@mantine/core'
import { IconCopy, IconRefresh, IconX } from '@tabler/icons-react'
import { useRouter } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
import { emit } from 'basalt-ui/notifications'
import { ThemeLabControls } from 'basalt-ui/theme-lab'

/**
 * DevToolsPanel — DEV-only bottom drawer hosting the in-app tooling (Router · Query · Theme lab).
 *
 * The launchers no longer float in the corner: they live in the sidebar's Settings menu
 * (App-shell → Settings → DevTools), which drives the `tool` prop here. This component only
 * renders the active panel. The persisted theme-lab overrides are re-applied at boot in main.tsx
 * (`applyOverrides(loadOverrides())`, before the first paint) — not here.
 */
export type DevTool = 'router' | 'query' | 'theme'

const TOOL_TITLE: Record<DevTool, string> = {
  router: 'Router Devtools',
  query: 'Query Devtools',
  theme: 'Theme Lab',
}

export function DevToolsPanel({ tool, onClose }: { tool: DevTool | null; onClose: () => void }) {
  const router = useRouter()

  if (tool === null) return null

  return (
    <Box
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: '42vh',
        zIndex: 400,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--mantine-color-body)',
        borderTop: '1px solid var(--mantine-color-default-border)',
        boxShadow: 'var(--mantine-shadow-lg)',
      }}
    >
      <Group
        justify="space-between"
        px="sm"
        py={6}
        style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
      >
        <Text size="xs" fw={600} tt="uppercase" c="dimmed">
          {TOOL_TITLE[tool]}
        </Text>
        <ActionIcon
          variant="subtle"
          size="sm"
          color="gray"
          onClick={onClose}
          aria-label="Close devtools"
        >
          <IconX size={15} />
        </ActionIcon>
      </Group>
      <Box style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tool === 'router' && (
          <TanStackRouterDevtoolsPanel
            router={router}
            isOpen
            setIsOpen={onClose}
            style={{ height: '100%' }}
          />
        )}
        {tool === 'query' && (
          <ReactQueryDevtoolsPanel onClose={onClose} style={{ height: '100%' }} />
        )}
        {tool === 'theme' && (
          <Box p="md">
            <ThemeLabControls
              copyIcon={<IconCopy size={15} />}
              resetIcon={<IconRefresh size={15} />}
              onCopy={() => emit('dev:info', { message: 'Theme overrides copied as JSON' })}
            />
          </Box>
        )}
      </Box>
    </Box>
  )
}
