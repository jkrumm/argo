import { createRootRouteWithContext, Link, Outlet, useMatchRoute } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { NavLink as MantineNavLink, Text, useMantineColorScheme } from '@mantine/core'
import {
  IconActivity,
  IconArchive,
  IconBarbell,
  IconBook,
  IconBox,
  IconBrandTeams,
  IconCalendar,
  IconChartHistogram,
  IconCheck,
  IconChecklist,
  IconDatabase,
  IconDeviceDesktop,
  IconHeartbeat,
  IconMessageChatbot,
  IconMoon,
  IconPalette,
  IconRoute,
  IconRulerMeasure,
  IconServer,
  IconShoe,
  IconSun,
} from '@tabler/icons-react'
import { format } from 'date-fns'
import { useCallback, useEffect, useState } from 'react'
import { BasaltShell, NavCountBadge } from 'basalt-ui'
import type {
  BreadcrumbLinkRenderer,
  NavLinkRenderer,
  SettingsMenuItem,
  SidebarSection,
} from 'basalt-ui'
import { RefreshButton, TimerNavWidget, useTimerEngine } from '../components/timer-nav'
import { useSidebarBadges } from '../components/app-shell/use-sidebar-badges'
import { HermesVoiceButton } from '../features/hermes-chat/hermes-voice-button'
import { HermesWidget } from '../features/hermes-chat/hermes-widget'
import { VoicePlaybackProvider } from '../features/hermes-chat/voice/voice-playback'
import { DevToolsPanel, type DevTool } from '../components/dev-dock'
import { registerColorSchemeSetter } from '../lib/color-scheme-bridge'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

const ICON = 18

const THEME_OPTIONS = [
  { value: 'auto', label: 'System', icon: <IconDeviceDesktop size={16} /> },
  { value: 'light', label: 'Light', icon: <IconSun size={16} /> },
  { value: 'dark', label: 'Dark', icon: <IconMoon size={16} /> },
] as const

/**
 * Static router destination for every navigable nav item, keyed by `SidebarItem.key`. Feeds
 * `renderNavLink` below — a real TanStack `<Link>` per item, carrying each page's default search
 * params (so `MakeRequiredSearchParams` stays satisfied on routes with required search state).
 * `calendar`'s `date` is a thunk (re-evaluated by the Link at click time) so "today" never goes
 * stale across a long-lived tab.
 */
const NAV_TARGETS: Record<
  string,
  { to: string; search?: Record<string, unknown> | (() => Record<string, unknown>) }
> = {
  'hermes-chat': { to: '/hermes-chat' },
  calendar: {
    to: '/calendar',
    search: () => ({ view: 'week', date: format(new Date(), 'yyyy-MM-dd') }),
  },
  garmin: { to: '/garmin-health', search: { window: '30d' } },
  strength: {
    to: '/strength-tracker',
    search: { window: 'all', tab: 'charts', exercises: 'bench_press,deadlift,squat,pull_ups' },
  },
  'body-composition': { to: '/body-composition', search: { window: '90d' } },
  walkingpad: { to: '/walking-pad', search: { window: '30d' } },
  reading: { to: '/reading' },
  usage: {
    to: '/usage-tracking',
    search: { range: '30d', grain: 'day', costGroupBy: 'source', tokensGroupBy: 'sub_tool' },
  },
  m365: { to: '/m365-explorer' },
}

function RootLayout() {
  const matchRoute = useMatchRoute()
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const [devTool, setDevTool] = useState<DevTool | null>(null)

  useTimerEngine()
  const badges = useSidebarBadges()

  // Bridges the live setColorScheme setter to lib/commands.tsx's theme:* commands, which run
  // outside the React tree (Spotlight) and have no hook access of their own.
  useEffect(() => {
    registerColorSchemeSetter(setColorScheme)
    return () => registerColorSchemeSetter(null)
  }, [setColorScheme])

  const isGarminActive = !!matchRoute({ to: '/garmin-health', fuzzy: true })
  const isStrengthActive = !!matchRoute({ to: '/strength-tracker', fuzzy: true })
  const isBodyCompositionActive = !!matchRoute({ to: '/body-composition', fuzzy: true })
  const isWalkingPadActive = !!matchRoute({ to: '/walking-pad', fuzzy: true })
  const isReadingActive = !!matchRoute({ to: '/reading', fuzzy: true })
  const isM365Active = !!matchRoute({ to: '/m365-explorer', fuzzy: true })
  const isHermesChatActive = !!matchRoute({ to: '/hermes-chat', fuzzy: true })
  const isCalendarActive = !!matchRoute({ to: '/calendar', fuzzy: true })
  const isUsageActive = !!matchRoute({ to: '/usage-tracking', fuzzy: true })

  // Router-agnostic seam: BasaltShell/AppSidebar never import a router primitive — this renders
  // each nav row through a real TanStack `<Link>` (NAV_TARGETS above), so `active` detection above
  // stays the single source of truth and default search params survive per-route.
  const renderNavLink = useCallback<NavLinkRenderer>((item, { active }) => {
    const target = NAV_TARGETS[item.key]
    if (!target) {
      // Disabled placeholders (Docker/Monitoring/Tasks) carry no destination — render inert.
      return <MantineNavLink label={item.label} leftSection={item.icon} disabled />
    }
    return (
      <MantineNavLink
        component={Link}
        to={target.to as never}
        {...(target.search !== undefined && { search: target.search as never })}
        label={item.label}
        leftSection={item.icon}
        rightSection={item.badge}
        active={active}
      />
    )
  }, [])

  /** Renders breadcrumb parent segments as client-side TanStack Links (argo has no nested items
   * today, so this never actually fires — wired for parity with the shipped contract). */
  const renderBreadcrumbLink = useCallback<BreadcrumbLinkRenderer>(
    (href, label) => (
      <Text size="sm" c="dimmed" truncate component={Link} to={href as never}>
        {label}
      </Text>
    ),
    [],
  )

  const sections: SidebarSection[] = [
    {
      label: 'Assistant',
      icon: <IconMessageChatbot size={ICON} />,
      items: [
        {
          key: 'hermes-chat',
          label: 'Hermes Chat',
          short: 'Hermes',
          icon: <IconMessageChatbot size={ICON} />,
          href: '/hermes-chat',
          active: isHermesChatActive,
        },
        {
          key: 'calendar',
          label: 'Calendar',
          short: 'Calendar',
          mobile: true,
          icon: <IconCalendar size={ICON} />,
          href: '/calendar',
          active: isCalendarActive,
          badge: <NavCountBadge count={badges.calendar} />,
        },
      ],
    },
    {
      label: 'Health',
      icon: <IconHeartbeat size={ICON} />,
      items: [
        {
          key: 'garmin',
          label: 'Garmin Health',
          short: 'Garmin',
          mobile: true,
          icon: <IconHeartbeat size={ICON} />,
          href: '/garmin-health',
          active: isGarminActive,
        },
        {
          key: 'strength',
          label: 'Strength Tracker',
          short: 'Strength',
          mobile: true,
          icon: <IconBarbell size={ICON} />,
          href: '/strength-tracker',
          active: isStrengthActive,
        },
        {
          key: 'body-composition',
          label: 'Body Composition',
          short: 'Body',
          mobile: true,
          icon: <IconRulerMeasure size={ICON} />,
          href: '/body-composition',
          active: isBodyCompositionActive,
        },
        {
          key: 'walkingpad',
          label: 'WalkingPad',
          short: 'Walk',
          mobile: true,
          icon: <IconShoe size={ICON} />,
          href: '/walking-pad',
          active: isWalkingPadActive,
        },
        {
          key: 'reading',
          label: 'Reading',
          short: 'Reading',
          mobile: true,
          icon: <IconBook size={ICON} />,
          href: '/reading',
          active: isReadingActive,
        },
      ],
    },
    {
      label: 'System',
      icon: <IconServer size={ICON} />,
      items: [
        {
          key: 'usage',
          label: 'Usage Tracking',
          icon: <IconChartHistogram size={ICON} />,
          href: '/usage-tracking',
          active: isUsageActive,
        },
        { key: 'docker', label: 'Docker', icon: <IconBox size={ICON} />, disabled: true },
        {
          key: 'monitoring',
          label: 'Monitoring',
          icon: <IconActivity size={ICON} />,
          disabled: true,
        },
        { key: 'tasks', label: 'Tasks', icon: <IconChecklist size={ICON} />, disabled: true },
      ],
    },
    {
      label: 'Other',
      icon: <IconArchive size={ICON} />,
      collapsible: true,
      defaultCollapsed: true,
      mobileTab: false,
      items: [
        {
          key: 'm365',
          label: 'M365 Explorer',
          icon: <IconBrandTeams size={ICON} />,
          href: '/m365-explorer',
          active: isM365Active,
          badge: <NavCountBadge count={badges.m365} />,
        },
      ],
    },
  ]

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
        sections={sections}
        renderNavLink={renderNavLink}
        renderBreadcrumbLink={renderBreadcrumbLink}
        globalActions={
          <>
            <HermesVoiceButton />
            <HermesWidget />
            <TimerNavWidget />
            <RefreshButton />
          </>
        }
        settingsMenuItems={settingsMenuItems}
        storageKey="argo-sidebar"
      >
        <Outlet />
      </BasaltShell>
      {import.meta.env.DEV && <DevToolsPanel tool={devTool} onClose={() => setDevTool(null)} />}
    </VoicePlaybackProvider>
  )
}
