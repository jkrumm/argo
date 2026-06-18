import {
  createRootRouteWithContext,
  Outlet,
  useMatchRoute,
  useNavigate,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { AppShell, Badge, Divider } from '@mantine/core'
import { useDisclosure, useHotkeys } from '@mantine/hooks'
import {
  IconActivity,
  IconArchive,
  IconBarbell,
  IconBook,
  IconBox,
  IconBrandTeams,
  IconCalendar,
  IconChartHistogram,
  IconChecklist,
  IconHeartbeat,
  IconMessageChatbot,
  IconServer,
  IconShoe,
} from '@tabler/icons-react'
import { format } from 'date-fns'
import { useState, type MouseEvent } from 'react'
import { useTimerEngine } from '../components/timer-nav'
import { AppSidebar, type SidebarSection } from '../components/app-shell/app-sidebar'
import { useSidebarBadges } from '../components/app-shell/use-sidebar-badges'
import { MobileNav, type MobileNavSection } from '../components/app-shell/app-mobile-nav'
import { AppBreadcrumbs } from '../components/app-shell/app-breadcrumbs'
import { GlobalActions } from '../components/app-shell/global-actions'
import { PageActionsOutlet, PageHeaderProvider } from '../components/app-shell/page-header'
import { VoicePlaybackProvider } from '../features/hermes-chat/voice/voice-playback'
import { DevToolsPanel, type DevTool } from '../components/dev-dock'
import { useUiStore } from '../lib/store'
import classes from '../components/app-shell/app-header.module.css'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

const ICON = 18

/**
 * Nav count pill. Kept maximally restrained ("ink earns its color", DESIGN.md): no background, no
 * border, no accent — just quiet neutral text. Rendered only when > 0; auto-hidden in the collapsed
 * icon-rail (the right-section is display:none there).
 */
function navBadge(count: number) {
  return count > 0 ? (
    <Badge size="sm" variant="transparent" color="gray" radius="sm">
      {count}
    </Badge>
  ) : undefined
}

function RootLayout() {
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure()
  const matchRoute = useMatchRoute()
  const navigate = useNavigate()
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const [devTool, setDevTool] = useState<DevTool | null>(null)

  useTimerEngine()
  useHotkeys([['mod+B', toggleSidebar]])
  const badges = useSidebarBadges()

  const isGarminActive = !!matchRoute({ to: '/garmin-health', fuzzy: true })
  const isStrengthActive = !!matchRoute({ to: '/strength-tracker', fuzzy: true })
  const isWalkingPadActive = !!matchRoute({ to: '/walking-pad', fuzzy: true })
  const isReadingActive = !!matchRoute({ to: '/reading', fuzzy: true })
  const isM365Active = !!matchRoute({ to: '/m365-explorer', fuzzy: true })
  const isHermesChatActive = !!matchRoute({ to: '/hermes-chat', fuzzy: true })
  const isCalendarActive = !!matchRoute({ to: '/calendar', fuzzy: true })
  const isUsageActive = !!matchRoute({ to: '/usage-tracking', fuzzy: true })

  // Typed navigation stays here (route + search literals). Each handler also closes the mobile
  // drawer. The presentational sidebar just renders the resolved sections.
  const go = (run: () => void) => (e: MouseEvent) => {
    e.preventDefault()
    closeMobile()
    run()
  }

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
          onClick: go(() => void navigate({ to: '/hermes-chat' })),
        },
        {
          key: 'calendar',
          label: 'Calendar',
          short: 'Calendar',
          mobile: true,
          icon: <IconCalendar size={ICON} />,
          href: '/calendar',
          active: isCalendarActive,
          badge: navBadge(badges.calendar),
          onClick: go(
            () =>
              void navigate({
                to: '/calendar',
                search: { view: 'week', date: format(new Date(), 'yyyy-MM-dd') },
              }),
          ),
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
          onClick: go(() => void navigate({ to: '/garmin-health', search: { window: '30d' } })),
        },
        {
          key: 'strength',
          label: 'Strength Tracker',
          short: 'Strength',
          mobile: true,
          icon: <IconBarbell size={ICON} />,
          href: '/strength-tracker',
          active: isStrengthActive,
          onClick: go(
            () =>
              void navigate({
                to: '/strength-tracker',
                search: {
                  window: 'all',
                  tab: 'charts',
                  exercises: 'bench_press,deadlift,squat,pull_ups',
                },
              }),
          ),
        },
        {
          key: 'walkingpad',
          label: 'WalkingPad',
          short: 'Walk',
          mobile: true,
          icon: <IconShoe size={ICON} />,
          href: '/walking-pad',
          active: isWalkingPadActive,
          onClick: go(() => void navigate({ to: '/walking-pad', search: { window: '30d' } })),
        },
        {
          key: 'reading',
          label: 'Reading',
          short: 'Reading',
          mobile: true,
          icon: <IconBook size={ICON} />,
          href: '/reading',
          active: isReadingActive,
          onClick: go(() => void navigate({ to: '/reading' })),
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
          onClick: go(
            () =>
              void navigate({
                to: '/usage-tracking',
                search: {
                  range: '30d',
                  grain: 'day',
                  costGroupBy: 'source',
                  tokensGroupBy: 'sub_tool',
                },
              }),
          ),
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
          badge: navBadge(badges.m365),
          onClick: go(() => void navigate({ to: '/m365-explorer' })),
        },
      ],
    },
  ]

  const activeCrumb = sections
    .flatMap((s) => s.items.map((it) => ({ section: s.label, page: it.label, active: it.active })))
    .find((x) => x.active)

  // Mobile bottom-nav: one tab per (non-`mobileTab:false`) section, each raising a bottom sheet
  // of that section's destinations. The full grouped drawer stays the "More" target.
  const mobileSections: MobileNavSection[] = sections
    .filter((s) => s.mobileTab !== false)
    .map((s) => ({
      key: s.label,
      label: s.label,
      icon: s.icon,
      active: s.items.some((i) => i.active),
      items: s.items.map((i) => ({
        key: i.key,
        label: i.label,
        icon: i.icon,
        href: i.href,
        active: i.active,
        onClick: i.onClick,
      })),
    }))

  return (
    <VoicePlaybackProvider>
      <PageHeaderProvider>
        <AppShell
          h="100dvh"
          layout="alt"
          header={{ height: { base: 108, sm: 56 } }}
          navbar={{
            width: { base: 240, sm: sidebarCollapsed ? 72 : 240 },
            breakpoint: 'sm',
            collapsed: { mobile: !mobileOpened },
          }}
          footer={{ height: { base: 56, sm: 0 } }}
          padding="md"
        >
          <AppShell.Header px="md">
            <div className={classes.bar}>
              <div className={classes.lead}>
                <AppBreadcrumbs section={activeCrumb?.section} page={activeCrumb?.page} />
              </div>
              <PageActionsOutlet className={classes.pageActions} />
              <Divider
                orientation="vertical"
                visibleFrom="sm"
                style={{ alignSelf: 'stretch', height: 'auto' }}
              />
              <GlobalActions className={classes.global} />
            </div>
          </AppShell.Header>

          <AppShell.Navbar p="md">
            <AppSidebar
              sections={sections}
              collapsed={sidebarCollapsed}
              onToggleCollapse={toggleSidebar}
              onClose={closeMobile}
              onOpenDevTool={import.meta.env.DEV ? setDevTool : undefined}
            />
          </AppShell.Navbar>

          <AppShell.Main>
            <Outlet />
          </AppShell.Main>

          <AppShell.Footer hiddenFrom="sm" p={0}>
            <MobileNav sections={mobileSections} onOpenMore={toggleMobile} />
          </AppShell.Footer>

          {import.meta.env.DEV && <DevToolsPanel tool={devTool} onClose={() => setDevTool(null)} />}
        </AppShell>
      </PageHeaderProvider>
    </VoicePlaybackProvider>
  )
}
