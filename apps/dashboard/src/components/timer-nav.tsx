import { useEffect } from 'react'
import { Button, Tooltip } from '@mantine/core'
import { IconClock } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useSizeClass } from 'basalt-ui'
import { useTimerStore } from '../lib/timer-store'
import { strengthStore } from '../lib/window-stores'
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
    let backstop: ReturnType<typeof setTimeout> | undefined
    // rAF stops in a hidden tab, so a timeout aimed at the next end keeps the alarm on time;
    // visibilitychange catches up the moment the tab is shown again.
    const arm = () => {
      clearTimeout(backstop)
      const {
        restRunning: rest,
        restEndAt,
        intervalRunning: interval,
        intervalEndAt,
      } = useTimerStore.getState()
      const ends = [rest ? restEndAt : null, interval ? intervalEndAt : null].filter(
        (t): t is number => t !== null,
      )
      if (ends.length === 0) return
      backstop = setTimeout(
        () => {
          tick()
          arm()
        },
        Math.max(0, Math.min(...ends) - Date.now()),
      )
    }
    const frame = () => {
      tick()
      raf = requestAnimationFrame(frame)
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      tick()
      arm()
    }
    raf = requestAnimationFrame(frame)
    arm()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(backstop)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [restRunning, intervalRunning, tick])

  // Auto-start a fresh rest when the workout checklist checks a set.
  useEffect(() => subscribeRestTimer(() => useTimerStore.getState().autoStartRest()), [])
}

/** Compact running-timer pill for the nav. Renders nothing while idle. */
export function TimerNavWidget() {
  const navigate = useNavigate()
  const isWide = useSizeClass() !== 'compact'
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
  const color = intervalRunning ? (info?.color ?? 'blue') : 'blue'
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
            // The store owns every one of these params, so its own thunk states the defaults —
            // only `tab` is this call site's business (`exercises` is now an ARRAY on the URL).
            search: () => ({
              ...strengthStore.linkSearch(),
              tab: isWide ? ('charts' as const) : ('train' as const),
            }),
          })
        }
      >
        {formatClock(Math.ceil(remaining))} · {label}
      </Button>
    </Tooltip>
  )
}
