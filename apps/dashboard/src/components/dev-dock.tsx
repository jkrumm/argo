import {
  ActionIcon,
  Affix,
  Box,
  Group,
  Popover,
  Stack,
  Text,
  Tooltip,
  useMatches,
} from '@mantine/core'
import { IconDatabase, IconPalette, IconRoute, IconX } from '@tabler/icons-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
import { ThemeLabControls } from './theme-lab-panel'
import { applyOverrides, loadOverrides } from '../lib/theme-lab'

/**
 * DevDock — DEV-only consolidated launcher for all in-app tooling, bottom-right.
 *
 * Replaces the separate floating buttons each devtool shipped (which piled up in the same
 * corner and hid the theme lab). One vertical stack: Router · Query devtools render in a
 * shared bottom drawer; the theme lab opens as a popover. Rendered only under import.meta.env.DEV.
 */
type Tool = 'router' | 'query'

export function DevDock() {
  const [tool, setTool] = useState<Tool | null>(null)
  const [themeOpen, setThemeOpen] = useState(false)
  const router = useRouter()

  // Re-apply persisted theme-lab overrides once on load (independent of the popover lifecycle).
  useEffect(() => {
    applyOverrides(loadOverrides())
  }, [])

  const toggle = (t: Tool) => setTool((cur) => (cur === t ? null : t))

  // Lift the dock above the mobile bottom-nav (56px) + drawer footer so it never sits on top of the
  // "Menu" tab or the drawer's close button; sits in the corner on desktop where there's no bottom-nav.
  const dockBottom = useMatches({ base: 72, sm: 20 })

  return (
    <>
      {tool !== null && (
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
              {tool === 'router' ? 'Router Devtools' : 'Query Devtools'}
            </Text>
            <ActionIcon
              variant="subtle"
              size="sm"
              color="gray"
              onClick={() => setTool(null)}
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
                setIsOpen={() => setTool(null)}
                style={{ height: '100%' }}
              />
            )}
            {tool === 'query' && (
              <ReactQueryDevtoolsPanel onClose={() => setTool(null)} style={{ height: '100%' }} />
            )}
          </Box>
        </Box>
      )}

      <Affix position={{ bottom: dockBottom, right: 20 }} zIndex={401}>
        <Stack gap={8} align="center">
          <DockButton
            label="Router devtools"
            active={tool === 'router'}
            onClick={() => toggle('router')}
          >
            <IconRoute size={20} />
          </DockButton>
          <DockButton
            label="Query devtools"
            active={tool === 'query'}
            onClick={() => toggle('query')}
          >
            <IconDatabase size={20} />
          </DockButton>
          <Popover
            opened={themeOpen}
            onChange={setThemeOpen}
            position="left-end"
            withArrow
            shadow="md"
            trapFocus={false}
          >
            <Popover.Target>
              <ActionIcon
                size={42}
                radius="xl"
                variant="filled"
                color="blue"
                onClick={() => setThemeOpen((o) => !o)}
                aria-label="Open theme lab"
                title="Theme lab (dev)"
                style={{ boxShadow: 'var(--mantine-shadow-md)' }}
              >
                <IconPalette size={22} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown p="sm">
              <ThemeLabControls />
            </Popover.Dropdown>
          </Popover>
        </Stack>
      </Affix>
    </>
  )
}

function DockButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip label={label} position="left">
      <ActionIcon
        size={42}
        radius="xl"
        variant={active ? 'filled' : 'default'}
        color={active ? 'blue' : 'gray'}
        onClick={onClick}
        aria-label={label}
        style={{ boxShadow: 'var(--mantine-shadow-sm)' }}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  )
}
