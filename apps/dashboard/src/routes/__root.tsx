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
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { BasaltShell, ThemeToggle } from 'basalt-ui'
import { SyncButton } from 'basalt-ui/controls'
import { NotificationBell } from 'basalt-ui/notifications'
import type { GlobalAction, SettingsMenuItem } from 'basalt-ui'
import { useNav } from 'basalt-ui/router-tanstack'
import { useSidebarCollapsed } from '../lib/sidebar-collapsed'
import { TimerNavWidget, useTimerEngine } from '../components/timer-nav'
import { useSidebarBadges } from '../components/app-shell/use-sidebar-badges'
import { useSidebarBlocks } from '../components/app-shell/use-sidebar-blocks'
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
  const queryClient = useQueryClient()
  const anyFetching = useIsFetching() > 0

  useTimerEngine()
  const badges = useSidebarBadges()
  const sidebarBlocks = useSidebarBlocks()

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

  // Controlled sidebar collapse (BasaltShell's controlled seam). The Mod+B command drives it
  // through the bridge; persistence is `createPersistedState`, the same mechanism the shell's own
  // uncontrolled path moved to at basalt-ui 1.21.0 — see `lib/sidebar-collapsed.ts`.
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed()
  useEffect(() => {
    registerSidebarToggle(() => setSidebarCollapsed(!sidebarCollapsed))
    return () => registerSidebarToggle(null)
  }, [sidebarCollapsed, setSidebarCollapsed])

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

  /*
   * `GlobalAction[]`, not a `ReactNode` fragment (basalt-ui 1.26.0): basalt owns the mobile
   * projection, so every `mobile` below is a real decision rather than something the shell guesses.
   *
   * A `'more'` node is mounted a SECOND time inside the header's single kebab, so anything holding
   * live local state rides the bar instead: the timer widget (its own engine state, and it renders
   * null when idle), the notification bell, and the Hermes widget (a local `input` value — two
   * mounts would be two half-typed prompts). Hermes VOICE is safe to double-mount because its
   * state lives in `VoicePlaybackProvider` above the shell.
   *
   * Theme is `'hidden'`: the three theme rows are already in the sidebar settings menu below, and
   * a second entry in the kebab would be the same control twice.
   */
  const globalActions: GlobalAction[] = [
    { key: 'timer', node: <TimerNavWidget />, mobile: 'bar' },
    { key: 'bell', node: <NotificationBell />, mobile: 'bar' },
    { key: 'hermes-widget', node: <HermesWidget />, mobile: 'bar' },
    { key: 'hermes-voice', node: <HermesVoiceButton />, mobile: 'more' },
    {
      key: 'sync',
      // `scope: 'global'` is icon-only at every viewport — the same shape the local
      // `RefreshButton` had, now with basalt's spinner, tooltip and accessible name.
      node: (
        <SyncButton
          scope="global"
          label="Refresh data"
          syncing={anyFetching}
          onSync={() => void queryClient.invalidateQueries()}
        />
      ),
      mobile: 'more',
    },
    { key: 'theme', node: <ThemeToggle />, mobile: 'hidden' },
  ]

  return (
    <VoicePlaybackProvider>
      <BasaltShell
        brand={{ name: 'Argo', logoSrc: '/favicon.svg', version: __APP_VERSION__ }}
        {...nav}
        globalActions={globalActions}
        sidebarBlocks={sidebarBlocks}
        settingsMenuItems={settingsMenuItems}
        // The three theme rows are CONTROLS, not destinations, so the ≤3 flat-footer rule reads
        // them wrong — a radio group flattened into the footer is a widget pile. Force the menu.
        settingsMenu="menu"
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      >
        <Outlet />
      </BasaltShell>
      {import.meta.env.DEV && <DevToolsPanel tool={devTool} onClose={() => setDevTool(null)} />}
    </VoicePlaybackProvider>
  )
}
