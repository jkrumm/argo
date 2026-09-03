import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ActionIcon,
  Box,
  Group,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from '@mantine/core'
import { IconSettings } from '@tabler/icons-react'
import { NumberPad, formatNumber, parseBuffer, useNumberBuffer } from './number-pad'
import {
  addPlate,
  availableDenominations,
  decompose,
  removePlate,
  totalFor,
  type Decomposition,
  type LoadingConfig,
  type LoadingMode,
  type PlateLoad,
} from '../../../lib/plate-math'
import { createPersistedState } from 'basalt-ui/state'
import { useGyms } from '../../../lib/queries/gym'
import cls from './weight-popover.module.css'

export interface WeightPopoverProps {
  value: number
  onChange: (weightKg: number) => void
  loadingMode: LoadingMode
  /** Which bar this exercise uses (from the gym profile's per-exercise config). */
  barId: string
  /** Picking a different bar here persists it for the exercise, not just this set. */
  onBarChange?: ((barId: string) => void) | undefined
  opened: boolean
  onClose: () => void
  /**
   * The keystroke that opened the popover, when it was opened by typing a digit
   * on the trigger. Seeds the buffer so the first digit isn't swallowed.
   */
  seedDigit?: string | null
  /** Fires after a keypad commit — caller focuses the reps input. */
  onCommit?: () => void
  /** Fires when the gear icon is tapped — caller owns the gym-settings modal. */
  onOpenSettings?: (() => void) | undefined
  children: ReactNode
}

type View = 'keypad' | 'plates'

/**
 * Which view the popover reopens on. Someone lifting on a barbell wants the plate calculator every
 * set, not one tap away every set — so the last view they chose is the one they get back. A UI
 * preference, so it lives in localStorage rather than in the gym profile (which is equipment) or
 * the URL.
 */
const useWeightView = createPersistedState<View>({
  key: 'strength-weight-view',
  version: 1,
  initial: 'keypad',
})

/** A gradient stop as a color-mix-safe percentage, clamped to 0-100. */
function stop(value: number): string {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`
}

/**
 * Plate geometry: a denomination's rank in the rack drives both its height and how much neutral it
 * mixes in, so weight reads at a glance without spending a hue on it.
 *
 * The ramp is sqrt-eased rather than linear because real racks are top-heavy — a 15/10/5/2.5/1.25/0.5
 * set puts four denominations in the bottom sixth of the range, and a linear map collapses them into
 * indistinguishable slivers. sqrt lifts the light end back into legibility while keeping the 15
 * clearly the tallest.
 */
function plateStyle(weight_kg: number, denomWeights: number[]): CSSProperties {
  const min = Math.min(...denomWeights)
  const max = Math.max(...denomWeights)
  const t = min === max ? 0.6 : Math.sqrt((weight_kg - min) / (max - min))
  const tone = 14 + t * 30
  return {
    '--plate-height': `${Math.round(34 + t * 46)}px`,
    '--plate-tone-hi': stop(tone - 9),
    '--plate-tone': stop(tone),
    '--plate-tone-lo': stop(tone + 13),
  } as CSSProperties
}

function hintFor(result: Decomposition): string {
  if (result.reason === 'below-bar') return 'below bar weight'
  if (result.reason === 'unreachable') return 'exceeds available plates'
  return `closest loadable: ${formatNumber(result.total)} kg`
}

/**
 * Weight-entry popover for a set-editor row: a calculator-style numpad for typing a weight, plus
 * a plate-loading view that decomposes/builds a target onto the active gym's real bar + plate
 * inventory (`plate-math.ts`). Mounted inline in a set row, so it never listens globally — key
 * handling is scoped to the open dropdown.
 */
export function WeightPopover({
  value,
  onChange,
  loadingMode,
  barId,
  onBarChange,
  opened,
  onClose,
  seedDigit,
  onCommit,
  onOpenSettings,
  children,
}: WeightPopoverProps) {
  const { active } = useGyms()
  const [preferredView, setPreferredView] = useWeightView()
  const [view, setView] = useState<View>('keypad')
  const pad = useNumberBuffer()
  const [plates, setPlates] = useState<PlateLoad[]>([])
  const [target, setTarget] = useState(0)
  // Set when a seeded decomposition couldn't hit the requested target exactly. It
  // describes that one seeding moment, so any manual plate edit clears it — the
  // user is now building the loading by hand and the seed no longer describes it.
  const [seedHint, setSeedHint] = useState<string | null>(null)
  const [lastAdded, setLastAdded] = useState<number | null>(null)
  const [wasOpened, setWasOpened] = useState(opened)

  // The accent highlight on a freshly-added plate is transient — clear it after a brief hold.
  useEffect(() => {
    if (lastAdded === null) return undefined
    const timer = setTimeout(() => setLastAdded(null), 800)
    return () => clearTimeout(timer)
  }, [lastAdded])

  const selectedBar = active.bars.find((bar) => bar.id === barId)
  const config: LoadingConfig = {
    mode: loadingMode,
    barWeight: loadingMode === 'barbell' ? (selectedBar?.weight_kg ?? 0) : 0,
    stock: active.plates,
  }

  // Reseed everything each time the popover transitions to open — never on `value` changes while
  // already open. Adjusting state during render on a prop transition (rather than useEffect) avoids
  // an extra render pass and a stale-closure dependency array for a reset that only cares about
  // `opened`. It sits below `config` because the plates restore needs it.
  //
  // Opened by typing a digit: that keystroke IS the buffer, and the next digit appends to it.
  // Opened by tap/click: the buffer shows the current weight, and the next digit replaces it.
  if (opened !== wasOpened) {
    setWasOpened(opened)
    if (opened) {
      const typed = seedDigit ?? null
      const seeded = typed ?? formatNumber(value)
      pad.reset(seeded, typed === null)
      // Typing a digit is an unambiguous request for the keypad, whatever view was remembered.
      const restored = loadingMode === 'free' || typed !== null ? 'keypad' : preferredView
      setView(restored)
      if (restored === 'plates') {
        const seedTarget = parseBuffer(seeded)
        setTarget(seedTarget)
        // propagate: false — merely restoring the remembered view must not rewrite the set. An
        // unloadable weight shows its hint and waits; only touching a plate commits a new total.
        seedPlates(seedTarget, config, false)
      }
    }
  }

  function commit(nextValue: number) {
    onChange(Math.max(0, nextValue))
    onCommit?.()
    onClose()
  }

  /**
   * `propagate` is false only for the restore-on-open path: an explicit switch into the plates
   * view is a user action, so pushing the achievable total upward is right (it stops an unloadable
   * typed weight from being stored), but reopening the popover is not.
   */
  function seedPlates(seed: number, seedConfig: LoadingConfig, propagate = true) {
    const result = decompose(seed, seedConfig)
    setPlates(result.plates)
    setSeedHint(result.exact ? null : hintFor(result))
    if (propagate) onChange(result.total)
  }

  function openPlatesView() {
    const seed = parseBuffer(pad.buffer)
    setTarget(seed)
    seedPlates(seed, config)
    setView('plates')
    setPreferredView('plates')
  }

  /** Leaving the plates view carries the loading it built back into the keypad. */
  function openKeypadView() {
    pad.reset(formatNumber(totalFor(plates, config)), true)
    setView('keypad')
    setPreferredView('keypad')
  }

  function handleBarChange(nextBarId: string) {
    const nextBar = active.bars.find((bar) => bar.id === nextBarId)
    onBarChange?.(nextBarId)
    seedPlates(target, { ...config, barWeight: nextBar?.weight_kg ?? 0 })
  }

  function handleAddPlate(weight_kg: number) {
    const next = addPlate(plates, weight_kg, config)
    setPlates(next)
    setSeedHint(null)
    setLastAdded(weight_kg)
    onChange(totalFor(next, config))
  }

  function handleRemovePlate(weight_kg: number) {
    const next = removePlate(plates, weight_kg)
    setPlates(next)
    setSeedHint(null)
    onChange(totalFor(next, config))
  }

  const total = totalFor(plates, config)
  const allDenoms = active.plates.map((plate) => plate.weight_kg).toSorted((a, b) => b - a)
  const availableWeights = availableDenominations(plates, config)
  const denomHeights = allDenoms.length > 0 ? allDenoms : plates.map((plate) => plate.weight_kg)
  const plateInstances = plates.flatMap((load) =>
    Array.from({ length: load.count }, (_, i) => ({
      weight_kg: load.weight_kg,
      key: `${load.weight_kg}-${i}`,
    })),
  )

  return (
    <Popover
      width="min(320px, calc(100vw - 2rem))"
      position="bottom"
      withArrow
      shadow="md"
      trapFocus
      opened={opened}
      onChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Popover.Target>{children}</Popover.Target>

      <Popover.Dropdown
        p="sm"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose()
            return
          }
          if (view !== 'keypad') return
          if (event.key === 'Enter') {
            commit(parseBuffer(pad.buffer))
            return
          }
          if (event.key === 'Backspace') {
            pad.pressDigit('⌫')
            return
          }
          if (/^[0-9]$/.test(event.key)) {
            pad.pressDigit(event.key)
            return
          }
          if (event.key === '.') {
            pad.pressDigit('.')
          }
        }}
      >
        <Stack gap="sm">
          {/* The view switch lives above both views rather than inside the keypad: the plate
              calculator is the point of this popover, and a one-way button buried in one view
              never reads as a mode you can move between.
              A `free` exercise has no second view — but it still needs the gear, since settings
              is the only place to promote it to barbell/single (unconfigured lifts start free). */}
          {(loadingMode !== 'free' || onOpenSettings !== undefined) && (
            <Group gap={6} wrap="nowrap">
              {loadingMode === 'free' ? (
                <Box flex={1} />
              ) : (
                <SegmentedControl
                  size="xs"
                  flex={1}
                  value={view}
                  onChange={(next) => (next === 'plates' ? openPlatesView() : openKeypadView())}
                  data={[
                    { label: 'Keypad', value: 'keypad' },
                    { label: 'Plates', value: 'plates' },
                  ]}
                />
              )}
              {/* Only offered when the caller owns a settings modal — a gear that
                  does nothing is worse than no gear. */}
              {onOpenSettings !== undefined && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={onOpenSettings}
                  aria-label="Gym settings"
                >
                  <IconSettings size={16} />
                </ActionIcon>
              )}
            </Group>
          )}

          {view === 'keypad' ? (
            <NumberPad
              buffer={pad.buffer}
              unit="kg"
              decimal
              stepBy={0.5}
              onDigit={pad.pressDigit}
              onStep={(delta) => pad.step(delta, 0)}
              onConfirm={() => commit(parseBuffer(pad.buffer))}
            />
          ) : (
            <Stack gap="sm">
              <Group justify="center">
                <Text component="span" className={cls['plateTotal']}>
                  {formatNumber(total)} kg
                </Text>
              </Group>

              {seedHint !== null && (
                <Text component="span" size="xs" className={cls['hint']}>
                  {seedHint}
                </Text>
              )}

              {loadingMode === 'barbell' &&
                active.bars.length > 0 &&
                (active.bars.length <= 3 ? (
                  <SegmentedControl
                    value={barId}
                    onChange={handleBarChange}
                    data={active.bars.map((bar) => ({ label: bar.name, value: bar.id }))}
                    fullWidth
                  />
                ) : (
                  <Select
                    value={barId}
                    onChange={(next) => next && handleBarChange(next)}
                    data={active.bars.map((bar) => ({ label: bar.name, value: bar.id }))}
                    allowDeselect={false}
                  />
                ))}

              <Stack gap={4}>
                <Text component="span" size="xs" className={cls['sideLabel']}>
                  {loadingMode === 'barbell' ? 'per side' : 'total'}
                </Text>
                {/* Assembled in flow, inboard end first: weight pill → shaft → collar → plates →
                    sleeve → cap. The sleeve absorbs the leftover width, so the loaded stack always
                    butts against the collar and the empty sleeve shows what's left to load. */}
                <Box className={cls['barStage']}>
                  {loadingMode === 'barbell' && (
                    <>
                      <Box className={cls['barWeightPill']}>
                        <Text component="span" className={cls['barEndLabel']}>
                          {formatNumber(config.barWeight)}
                        </Text>
                      </Box>
                      <Box className={`${cls['metal']} ${cls['shaftInner']}`} />
                    </>
                  )}
                  <Box className={cls['collar']} />
                  <Box className={cls['plateGroup']}>
                    {plateInstances.map(({ weight_kg, key }) => (
                      <button
                        key={key}
                        type="button"
                        className={cls['plate']}
                        data-highlight={lastAdded === weight_kg}
                        style={plateStyle(weight_kg, denomHeights)}
                        onClick={() => handleRemovePlate(weight_kg)}
                        aria-label={`Remove ${weight_kg} kg plate`}
                      >
                        <span className={cls['plateLabel']}>{weight_kg}</span>
                      </button>
                    ))}
                  </Box>
                  {plateInstances.length === 0 && (
                    <Text component="span" className={cls['emptyBar']}>
                      {loadingMode === 'barbell' ? 'bar only' : 'no weight'}
                    </Text>
                  )}
                  {loadingMode === 'barbell' && (
                    <Box className={`${cls['metal']} ${cls['sleeve']}`} />
                  )}
                </Box>
              </Stack>

              <Stack gap={4}>
                <Text component="span" size="xs" c="dimmed">
                  Add Plates
                </Text>
                <Group gap={6}>
                  {allDenoms.map((weight_kg) => (
                    <button
                      key={weight_kg}
                      type="button"
                      className={cls['denomChip']}
                      disabled={!availableWeights.includes(weight_kg)}
                      onClick={() => handleAddPlate(weight_kg)}
                    >
                      {weight_kg}
                    </button>
                  ))}
                </Group>
              </Stack>
            </Stack>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
