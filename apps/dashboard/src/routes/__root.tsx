import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { useMantineColorScheme } from '@mantine/core'
import {
  IconCheck,
  IconDatabase,
  IconDeviceDesktop,
  IconMoon,
  IconPalette,
  IconRoute,
  IconSun,
} from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useLocalStorage } from '@mantine/hooks'
import { BasaltShell, ThemeToggle } from 'basalt-ui'
import { NotificationBell } from 'basalt-ui/notifications'
import type { SettingsMenuItem } from 'basalt-ui'
import { useNav } from 'basalt-ui/router-tanstack'
import { RefreshButton, TimerNavWidget, useTimerEngine } from '../components/timer-nav'
import { useSidebarBadges } from '../components/app-shell/use-sidebar-badges'
import { HermesVoiceButton } from '../features/hermes-chat/hermes-voice-button'
import { HermesWidget } from '../features/hermes-chat/hermes-widget'
import { VoicePlaybackProvider } from '../features/hermes-chat/voice/voice-playback'
import { DevToolsPanel, type DevTool } from '../components/dev-dock'
import { registerColorSchemeSetter } from '../lib/color-scheme-bridge'
import { registerSidebarToggle } from '../lib/sidebar-bridge'
import { NAV } from '../lib/nav'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

const THEME_OPTIONS = [
  { value: 'auto', label: 'System', icon: <IconDeviceDesktop size={16} /> },
  { value: 'light', label: 'Light', icon: <IconSun size={16} /> },
  { value: 'dark', label: 'Dark', icon: <IconMoon size={16} /> },
] as const

function RootLayout() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const [devTool, setDevTool] = useState<DevTool | null>(null)

  useTimerEngine()
  const badges = useSidebarBadges()

  // The whole navigation — sidebar sections, active state, per-destination TanStack anchors and
  // the mobile bar — resolved from the single definition in `lib/nav.tsx`. Badge keys autocomplete
  // from that definition, so a renamed destination is a compile error here.
  const nav = useNav(NAV, { badges: { calendar: badges.calendar, m365: badges.m365 } })

  // Bridges the live setColorScheme setter to lib/commands.tsx's theme:* commands, which run
  // outside the React tree (Spotlight) and have no hook access of their own.
  useEffect(() => {
    registerColorSchemeSetter(setColorScheme)
    return () => registerColorSchemeSetter(null)
  }, [setColorScheme])

  // Controlled sidebar collapse (BasaltShell's controlled seam) — persistence stays on the same
  // 'argo-sidebar' key the shell used internally, and the Mod+B command drives it via the bridge.
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage<boolean>({
    key: 'argo-sidebar',
    defaultValue: false,
  })
  useEffect(() => {
    registerSidebarToggle(() => setSidebarCollapsed((c) => !c))
    return () => registerSidebarToggle(null)
  }, [setSidebarCollapsed])

  // Theme lives in the sidebar Settings menu (not basalt's globalActions `ThemeToggle`) — the
  // Settings row only renders when `settingsMenuItems` is non-empty, and it also carries the
  // `brand.version` label, so keeping Theme here preserves that footer version display in
  // production (where the DevTools entries below are absent). The active option's icon swaps to a
  // checkmark — basalt's `SettingsMenuItem` has no dedicated "active" slot (a flat `Menu.Item`
  // list, no nested submenus like the old hand-rolled sidebar), so this is the closest available
  // affordance. See migration report for the full shell-gap note.
  const settingsMenuItems: SettingsMenuItem[] = [
    ...THEME_OPTIONS.map((o) => ({
      key: `theme-${o.value}`,
      label: o.label,
      icon: colorScheme === o.value ? <IconCheck size={16} /> : o.icon,
      onClick: () => setColorScheme(o.value),
    })),
    ...(import.meta.env.DEV
      ? [
          {
            key: 'devtools-router',
            label: 'Router',
            icon: <IconRoute size={16} />,
            onClick: () => setDevTool('router'),
          },
          {
            key: 'devtools-query',
            label: 'Query',
            icon: <IconDatabase size={16} />,
            onClick: () => setDevTool('query'),
          },
          {
            key: 'devtools-theme',
            label: 'Theme Lab',
            icon: <IconPalette size={16} />,
            onClick: () => setDevTool('theme'),
          },
        ]
      : []),
  ]

  return (
    <VoicePlaybackProvider>
      <BasaltShell
        brand={{ name: 'Argo', logoSrc: '/favicon.svg', version: __APP_VERSION__ }}
        {...nav}
        globalActions={
          <>
            <HermesVoiceButton />
            <HermesWidget />
            <TimerNavWidget />
            <RefreshButton />
            <NotificationBell />
            <ThemeToggle />
          </>
        }
        settingsMenuItems={settingsMenuItems}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      >
        <Outlet />
      </BasaltShell>
      {import.meta.env.DEV && <DevToolsPanel tool={devTool} onClose={() => setDevTool(null)} />}
    </VoicePlaybackProvider>
  )
}
