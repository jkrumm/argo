import {
  createRootRouteWithContext,
  Outlet,
  useMatchRoute,
  useNavigate,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import type { QueryClient } from '@tanstack/react-query'
import {
  AppShell,
  Box,
  Burger,
  Divider,
  Group,
  NavLink,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconActivity,
  IconBarbell,
  IconBox,
  IconBrandTeams,
  IconCalendar,
  IconChecklist,
  IconShoe,
  IconHeartbeat,
  IconMoon,
  IconSun,
} from '@tabler/icons-react'
import { format } from 'date-fns'
import type { MouseEvent } from 'react'
import { RefreshButton, TimerNavWidget, useTimerEngine } from '../components/timer-nav'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

const COMING_SOON = [
  { key: 'docker', label: 'Docker', icon: <IconBox size={18} /> },
  { key: 'monitoring', label: 'Monitoring', icon: <IconActivity size={18} /> },
  { key: 'tasks', label: 'Tasks', icon: <IconChecklist size={18} /> },
]

function RootLayout() {
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure()
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const matchRoute = useMatchRoute()
  const navigate = useNavigate()

  useTimerEngine()

  const isDark = colorScheme === 'dark'
  const isGarminActive = !!matchRoute({ to: '/garmin-health', fuzzy: true })
  const isStrengthActive = !!matchRoute({ to: '/strength-tracker', fuzzy: true })
  const isWalkingPadActive = !!matchRoute({ to: '/walking-pad', fuzzy: true })
  const isM365Active = !!matchRoute({ to: '/m365-explorer', fuzzy: true })
  const isCalendarActive = !!matchRoute({ to: '/calendar', fuzzy: true })

  function handleNavGarmin() {
    return (e: MouseEvent) => {
      e.preventDefault()
      closeMobile()
      void navigate({ to: '/garmin-health', search: { window: '30d' } })
    }
  }

  function handleNavM365() {
    return (e: MouseEvent) => {
      e.preventDefault()
      closeMobile()
      void navigate({ to: '/m365-explorer' })
    }
  }

  function handleNavCalendar() {
    return (e: MouseEvent) => {
      e.preventDefault()
      closeMobile()
      void navigate({
        to: '/calendar',
        search: { view: 'week', date: format(new Date(), 'yyyy-MM-dd') },
      })
    }
  }

  function handleNavWalkingPad() {
    return (e: MouseEvent) => {
      e.preventDefault()
      closeMobile()
      void navigate({ to: '/walking-pad', search: { window: '30d' } })
    }
  }

  function handleNavStrength() {
    return (e: MouseEvent) => {
      e.preventDefault()
      closeMobile()
      void navigate({
        to: '/strength-tracker',
        search: {
          window: 'all',
          tab: 'charts',
          exercises: 'bench_press,deadlift,squat,pull_ups',
        },
      })
    }
  }

  return (
    <AppShell
      h="100dvh"
      header={{ height: { base: 56, sm: 0 } }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding="md"
    >
      <AppShell.Header px="md" hiddenFrom="sm">
        <Group h="100%" gap="sm" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={mobileOpened}
              onClick={toggleMobile}
              size="sm"
              aria-label="Toggle navigation"
            />
            <Text fw={700}>Argo</Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <TimerNavWidget />
            <RefreshButton />
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <Stack gap={0} h="100%">
          <Group gap="xs" mb="lg" wrap="nowrap">
            <img
              src="/favicon.svg"
              alt="Argo"
              width={28}
              height={28}
              style={{ display: 'block' }}
            />
            <Text fw={700} fz="xl">
              Argo
            </Text>
          </Group>

          <NavLink
            component="a"
            href="/garmin-health"
            label="Garmin Health"
            leftSection={<IconHeartbeat size={18} />}
            active={isGarminActive}
            mb={4}
            onClick={handleNavGarmin()}
          />
          <NavLink
            component="a"
            href="/strength-tracker"
            label="Strength Tracker"
            leftSection={<IconBarbell size={18} />}
            active={isStrengthActive}
            mb={4}
            onClick={handleNavStrength()}
          />
          <NavLink
            component="a"
            href="/walking-pad"
            label="WalkingPad"
            leftSection={<IconShoe size={18} />}
            active={isWalkingPadActive}
            mb={4}
            onClick={handleNavWalkingPad()}
          />
          <NavLink
            component="a"
            href="/calendar"
            label="Calendar"
            leftSection={<IconCalendar size={18} />}
            active={isCalendarActive}
            mb={4}
            onClick={handleNavCalendar()}
          />
          <NavLink
            component="a"
            href="/m365-explorer"
            label="M365 Explorer"
            leftSection={<IconBrandTeams size={18} />}
            active={isM365Active}
            mb={4}
            onClick={handleNavM365()}
          />

          <Divider my="sm" />

          {COMING_SOON.map(({ key, label, icon }) => (
            <Tooltip key={key} label="Coming soon" position="right" withArrow>
              <Box>
                <NavLink label={label} leftSection={icon} disabled mb={4} />
              </Box>
            </Tooltip>
          ))}

          <Box style={{ flex: 1 }} />

          <Group gap="xs" wrap="nowrap" mb="sm">
            <TimerNavWidget />
            <Box style={{ flex: 1 }} />
            <RefreshButton />
          </Group>

          <Divider mb="sm" />

          <Tooltip
            label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            position="right"
            withArrow
          >
            <UnstyledButton
              onClick={toggleColorScheme}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 4,
                width: '100%',
              }}
            >
              {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
              <Text size="sm">{isDark ? 'Light Mode' : 'Dark Mode'}</Text>
            </UnstyledButton>
          </Tooltip>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>

      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </AppShell>
  )
}
