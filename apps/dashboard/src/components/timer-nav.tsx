import { useEffect } from 'react'
import { ActionIcon, Button, Tooltip } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconClock, IconRefresh } from '@tabler/icons-react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTimerStore } from '../lib/timer-store'
import { subscribeRestTimer } from '../features/strength-tracker/components/rest-timer-bus'
import { formatClock, phaseInfo } from '../features/strength-tracker/components/timer-core'

/**
 * Runs the timer countdown engine at app level so a started timer keeps ticking
 * (and fires its completion sound + notification) regardless of which page is
 * mounted. Mount exactly once, in the root layout.
 */
export function useTimerEngine() {
  const restRunning = useTimerStore((s) => s.restRunning)
  const intervalRunning = useTimerStore((s) => s.intervalRunning)
  const tick = useTimerStore((s) => s.tick)

  useEffect(() => {
    if (!restRunning && !intervalRunning) return
    let raf = 0
    const frame = () => {
      tick()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [restRunning, intervalRunning, tick])

  // Auto-start a fresh rest when the workout checklist checks a set.
  useEffect(() => subscribeRestTimer(() => useTimerStore.getState().autoStartRest()), [])
}

/** Compact running-timer pill for the nav. Renders nothing while idle. */
export function TimerNavWidget() {
  const navigate = useNavigate()
  const isWide = useMediaQuery('(min-width: 48em)')
  const restRunning = useTimerStore((s) => s.restRunning)
  const restRemaining = useTimerStore((s) => s.restRemaining)
  const intervalRunning = useTimerStore((s) => s.intervalRunning)
  const intervalRemaining = useTimerStore((s) => s.intervalRemaining)
  const intervalActive = useTimerStore((s) => s.intervalActive)
  const phases = useTimerStore((s) => s.intervalPhases)
  const phaseIndex = useTimerStore((s) => s.intervalPhaseIndex)

  if (!restRunning && !intervalRunning) return null

  const phase = intervalRunning && intervalActive ? phases[phaseIndex] : undefined
  const info = phase ? phaseInfo(phase) : undefined
  const color = intervalRunning ? (info?.color ?? 'teal') : 'teal'
  const label = intervalRunning ? (info?.label ?? 'Interval') : 'Rest'
  const remaining = intervalRunning ? intervalRemaining : restRemaining

  return (
    <Tooltip label="Open timer controls" withArrow>
      <Button
        size="compact-sm"
        radius="sm"
        variant="light"
        color={color}
        leftSection={<IconClock size={15} />}
        styles={{ label: { fontVariantNumeric: 'tabular-nums' } }}
        onClick={() =>
          void navigate({
            to: '/strength-tracker',
            search: {
              window: 'all',
              tab: isWide ? 'charts' : 'train',
              exercises: 'bench_press,deadlift,squat,pull_ups',
            },
          })
        }
      >
        {formatClock(Math.ceil(remaining))} · {label}
      </Button>
    </Tooltip>
  )
}

/**
 * Soft refresh for mobile / installed PWA, where there's no browser reload and
 * pull-to-refresh is disabled. Refetches every active query (keeps the app shell
 * and scroll position) and spins while data is in flight.
 */
export function RefreshButton() {
  const queryClient = useQueryClient()
  const fetching = useIsFetching() > 0

  return (
    <Tooltip label="Refresh data" withArrow>
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label="Refresh data"
        loading={fetching}
        onClick={() => void queryClient.invalidateQueries()}
      >
        <IconRefresh size={18} />
      </ActionIcon>
    </Tooltip>
  )
}
