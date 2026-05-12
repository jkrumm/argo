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
  IconChecklist,
  IconHeartbeat,
  IconMoon,
  IconSun,
} from '@tabler/icons-react'
import type { MouseEvent } from 'react'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

const COMING_SOON = [
  { key: 'docker', label: 'Docker', icon: <IconBox size={18} /> },
  { key: 'monitoring', label: 'Monitoring', icon: <IconActivity size={18} /> },
  { key: 'tasks', label: 'Tasks', icon: <IconChecklist size={18} /> },
]

function RootLayout() {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure()
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const matchRoute = useMatchRoute()
  const navigate = useNavigate()

  const isDark = colorScheme === 'dark'
  const isGarminActive = !!matchRoute({ to: '/garmin-health', fuzzy: true })
  const isStrengthActive = !!matchRoute({ to: '/strength-tracker', fuzzy: true })

  function handleNavGarmin() {
    return (e: MouseEvent) => {
      e.preventDefault()
      void navigate({ to: '/garmin-health', search: { window: '30d' } })
    }
  }

  function handleNavStrength() {
    return (e: MouseEvent) => {
      e.preventDefault()
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
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding="md"
    >
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

          <Divider my="sm" />

          {COMING_SOON.map(({ key, label, icon }) => (
            <Tooltip key={key} label="Coming soon" position="right" withArrow>
              <Box>
                <NavLink label={label} leftSection={icon} disabled mb={4} />
              </Box>
            </Tooltip>
          ))}

          <Box style={{ flex: 1 }} />

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
        <Group hiddenFrom="sm" mb="md">
          <Burger opened={mobileOpened} onClick={toggleMobile} size="sm" />
          <Text fw={700}>Argo</Text>
        </Group>
        <Outlet />
      </AppShell.Main>

      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </AppShell>
  )
}
