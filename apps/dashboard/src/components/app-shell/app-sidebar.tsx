import {
  ActionIcon,
  Box,
  Divider,
  Group,
  Menu,
  NavLink,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from '@mantine/core'
import {
  IconCheck,
  IconDatabase,
  IconDeviceDesktop,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMoon,
  IconPalette,
  IconRoute,
  IconSettings,
  IconSun,
  IconTools,
  IconX,
} from '@tabler/icons-react'
import type { MouseEvent, ReactNode } from 'react'
import { RefreshButton } from '../timer-nav'
import type { DevTool } from '../dev-dock'
import classes from './app-sidebar.module.css'

/**
 * Presentational app sidebar — a collapsible icon-rail with grouped nav sections, a brand header
 * (logo + collapse/close toggle), and a footer theme selector (System / Light / Dark + version).
 * Route coupling (active detection, typed navigation) and the collapse store stay in `__root.tsx`,
 * which feeds resolved `sections` + `collapsed`/`onToggleCollapse`/`onClose` here.
 *
 * Collapse is desktop-only: the rail styling is gated behind a `min-width: sm` media query so the
 * mobile drawer always shows full labels regardless of the persisted `collapsed` flag. The close
 * button is mobile-only (`hiddenFrom="sm"`); the collapse chevron is desktop-only (`visibleFrom`).
 * See DESIGN.md (Components) + docs/MANTINE-THEMING.md §8.2.
 */

export type SidebarItem = {
  key: string
  label: string
  /** Short label for the mobile bottom-nav; falls back to `label`. */
  short?: string
  /** Whether this destination appears in the mobile bottom-nav. */
  mobile?: boolean
  icon: ReactNode
  href?: string
  active?: boolean
  disabled?: boolean
  onClick?: (e: MouseEvent) => void
  badge?: ReactNode
}

export type SidebarSection = { label: string; items: SidebarItem[] }

type AppSidebarProps = {
  sections: SidebarSection[]
  collapsed: boolean
  onToggleCollapse: () => void
  onClose: () => void
  /** DEV-only: open an in-app devtool panel from the Settings menu. Omitted in production. */
  onOpenDevTool?: (tool: DevTool) => void
}

const THEME_OPTIONS = [
  { value: 'auto', label: 'System', icon: <IconDeviceDesktop size={16} /> },
  { value: 'light', label: 'Light', icon: <IconSun size={16} /> },
  { value: 'dark', label: 'Dark', icon: <IconMoon size={16} /> },
] as const

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      component="div"
      px="xs"
      mb={4}
      size="xs"
      fw={600}
      c="dimmed"
      tt="uppercase"
      className={classes.sectionLabel}
      style={{ letterSpacing: '0.06em' }}
    >
      {children}
    </Text>
  )
}

export function AppSidebar({
  sections,
  collapsed,
  onToggleCollapse,
  onClose,
  onOpenDevTool,
}: AppSidebarProps) {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const current = THEME_OPTIONS.find((o) => o.value === colorScheme) ?? THEME_OPTIONS[0]

  const DEV_TOOLS = [
    { value: 'router', label: 'Router', icon: <IconRoute size={16} /> },
    { value: 'query', label: 'Query', icon: <IconDatabase size={16} /> },
    { value: 'theme', label: 'Theme', icon: <IconPalette size={16} /> },
  ] as const

  return (
    <Stack gap={0} h="100%" className={classes.root} data-collapsed={collapsed || undefined}>
      <Group className={classes.brand} h={36} mb="md" px="xs" gap="sm" wrap="nowrap">
        <Group className={classes.brandLead} gap="sm" wrap="nowrap">
          <img src="/favicon.svg" alt="Argo" width={26} height={26} style={{ display: 'block' }} />
          <Text fw={700} fz="lg">
            Argo
          </Text>
        </Group>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="md"
          visibleFrom="sm"
          className={classes.collapseBtn}
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpand size={18} />
          ) : (
            <IconLayoutSidebarLeftCollapse size={18} />
          )}
        </ActionIcon>
      </Group>

      <Stack gap="lg" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {sections.map((section) => (
          <Stack key={section.label} gap={2}>
            <SectionLabel>{section.label}</SectionLabel>
            {section.items.map((item) =>
              item.disabled ? (
                <Tooltip key={item.key} label="Coming soon" position="right" withArrow>
                  <Box>
                    <NavLink
                      classNames={{ root: classes.link }}
                      label={item.label}
                      leftSection={item.icon}
                      disabled
                    />
                  </Box>
                </Tooltip>
              ) : (
                <Tooltip
                  key={item.key}
                  label={item.label}
                  position="right"
                  withArrow
                  disabled={!collapsed}
                >
                  <NavLink
                    classNames={{ root: classes.link }}
                    component="a"
                    href={item.href}
                    label={item.label}
                    leftSection={item.icon}
                    rightSection={item.badge}
                    active={item.active}
                    onClick={item.onClick}
                  />
                </Tooltip>
              ),
            )}
          </Stack>
        ))}
      </Stack>

      <Divider my="sm" mx="-md" />
      <Group gap="xs" wrap="nowrap">
        <Menu position="top-start" withArrow shadow="md" width={200} zIndex={500}>
          <Menu.Target>
            <UnstyledButton className={classes.footerBtn} aria-label="Settings">
              <IconSettings size={16} />
              <Text className={classes.footerText} size="sm">
                Settings
              </Text>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item leftSection={current.icon}>Theme</Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                {THEME_OPTIONS.map((o) => (
                  <Menu.Item
                    key={o.value}
                    leftSection={o.icon}
                    rightSection={colorScheme === o.value ? <IconCheck size={14} /> : null}
                    onClick={() => setColorScheme(o.value)}
                  >
                    {o.label}
                  </Menu.Item>
                ))}
              </Menu.Sub.Dropdown>
            </Menu.Sub>

            {onOpenDevTool && (
              <Menu.Sub>
                <Menu.Sub.Target>
                  <Menu.Sub.Item leftSection={<IconTools size={16} />}>DevTools</Menu.Sub.Item>
                </Menu.Sub.Target>
                <Menu.Sub.Dropdown>
                  {DEV_TOOLS.map((t) => (
                    <Menu.Item
                      key={t.value}
                      leftSection={t.icon}
                      onClick={() => onOpenDevTool(t.value)}
                    >
                      {t.label}
                    </Menu.Item>
                  ))}
                </Menu.Sub.Dropdown>
              </Menu.Sub>
            )}

            <Menu.Divider />
            <Menu.Label>Argo v{__APP_VERSION__}</Menu.Label>
          </Menu.Dropdown>
        </Menu>
        <Group gap={2} wrap="nowrap" hiddenFrom="sm">
          <RefreshButton />
          <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Close navigation">
            <IconX size={18} />
          </ActionIcon>
        </Group>
      </Group>
    </Stack>
  )
}
