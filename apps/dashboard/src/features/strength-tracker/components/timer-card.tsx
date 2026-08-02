import { useState, type ReactNode } from 'react'
import { VX } from 'basalt-ui/tokens'
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Flex,
  Group,
  Input,
  NumberInput,
  Paper,
  Popover,
  RingProgress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Text,
} from '@mantine/core'
import {
  IconBarbell,
  IconCaretDownFilled,
  IconMusic,
  IconPencil,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconRotateClockwise2,
} from '@tabler/icons-react'
import { SERIES } from '../../../lib/series'
import { useTimerStore } from '../../../lib/timer-store'
import {
  clampNum,
  DEFAULT_INTERVAL,
  DEFAULT_REST,
  formatClock,
  LEAD_IN,
  phaseInfo,
  playSound,
  presetLabel,
  SOUND_OPTIONS,
  type Phase,
} from './timer-core'

function TimerRing({
  pct,
  color,
  label,
  sublabel,
  flipIcon,
  flipped = false,
}: {
  pct: number
  color: string
  label: string
  sublabel?: string
  /** When set, the clock face card-flips to this icon while `flipped` is true. */
  flipIcon?: ReactNode
  flipped?: boolean
}) {
  return (
    <RingProgress
      size={150}
      thickness={10}
      roundCaps
      sections={[{ value: pct, color }]}
      label={
        <Stack gap={0} align="center">
          {sublabel && (
            <Text size="xs" c="dimmed" fw={500} ta="center">
              {sublabel}
            </Text>
          )}
          {flipIcon ? (
            <div style={{ perspective: 500 }}>
              <div
                style={{
                  position: 'relative',
                  width: 96,
                  height: 38,
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                }}
              >
                <Flex
                  pos="absolute"
                  inset={0}
                  align="center"
                  justify="center"
                  style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                >
                  <Text
                    ta="center"
                    fw={700}
                    size="xl"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {label}
                  </Text>
                </Flex>
                <Flex
                  pos="absolute"
                  inset={0}
                  align="center"
                  justify="center"
                  style={{
                    color: `var(--mantine-color-${color}-6)`,
                    transform: 'rotateY(180deg)',
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                  }}
                >
                  {flipIcon}
                </Flex>
              </div>
            </div>
          ) : (
            <Text ta="center" fw={700} size="xl" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {label}
            </Text>
          )}
        </Stack>
      }
    />
  )
}

function RestTimerPanel() {
  const duration = useTimerStore((s) => s.restDuration)
  const remaining = useTimerStore((s) => s.restRemaining)
  const running = useTimerStore((s) => s.restRunning)
  const presets = useTimerStore((s) => s.restPresets)
  const restSound = useTimerStore((s) => s.restSound)
  const selectPreset = useTimerStore((s) => s.selectRestPreset)
  const setRestPreset = useTimerStore((s) => s.setRestPreset)
  const updateRestSound = useTimerStore((s) => s.setRestSound)
  const start = useTimerStore((s) => s.startRest)
  const pause = useTimerStore((s) => s.pauseRest)
  const reset = useTimerStore((s) => s.resetRest)

  const [editOpen, setEditOpen] = useState(false)
  const [soundOpen, setSoundOpen] = useState(false)

  const updatePreset = (index: number, minutes: number) =>
    setRestPreset(index, clampNum(minutes * 60, 10, 3600, DEFAULT_REST))

  const done = remaining <= 0
  const pct = duration > 0 ? ((duration - remaining) / duration) * 100 : 0
  const ringColor = done ? 'green' : remaining <= 15 ? 'orange' : running ? 'blue' : 'gray'

  return (
    <Flex direction={{ base: 'column', sm: 'row' }} align="center" gap="md" w="100%">
      <TimerRing
        pct={pct}
        color={ringColor}
        label={formatClock(Math.ceil(remaining))}
        flipIcon={<IconBarbell size={34} stroke={1.8} />}
        flipped={done}
      />
      <Stack gap="xs" w="100%" miw={0} style={{ flex: 1 }}>
        <Group gap={4} wrap="nowrap">
          {presets.map((seconds, i) => (
            <Button
              key={`${seconds}-${i}`}
              size="compact-xs"
              px={4}
              style={{ flex: 1 }}
              variant={duration === seconds ? 'filled' : 'default'}
              color="blue"
              onClick={() => selectPreset(seconds)}
            >
              {presetLabel(seconds)}
            </Button>
          ))}
        </Group>
        <Group gap={4} wrap="nowrap">
          <Button
            style={{ flex: 1 }}
            size="sm"
            variant={running ? 'light' : 'filled'}
            color={running ? 'gray' : 'blue'}
            leftSection={
              running ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />
            }
            onClick={running ? pause : start}
          >
            {running ? 'Pause' : done ? 'Restart' : 'Start'}
          </Button>
          <Popover
            opened={editOpen}
            onChange={setEditOpen}
            position="bottom-end"
            withArrow
            shadow="md"
          >
            <Popover.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => setEditOpen((o) => !o)}
                aria-label="Edit presets"
              >
                <IconPencil size={16} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap="xs" w={180}>
                <Text size="xs" fw={600}>
                  Edit presets
                </Text>
                <SimpleGrid cols={2} spacing="xs">
                  {presets.map((seconds, i) => (
                    <NumberInput
                      key={`edit-${i}`}
                      size="xs"
                      min={0.5}
                      max={60}
                      step={0.5}
                      suffix=" m"
                      value={seconds / 60}
                      onChange={(v) => updatePreset(i, typeof v === 'number' ? v : Number(v))}
                    />
                  ))}
                </SimpleGrid>
              </Stack>
            </Popover.Dropdown>
          </Popover>
          <Popover
            opened={soundOpen}
            onChange={setSoundOpen}
            position="bottom-end"
            withArrow
            shadow="md"
          >
            <Popover.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => setSoundOpen((o) => !o)}
                aria-label="Edit sound"
              >
                <IconMusic size={16} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap="xs" w={210}>
                <Text size="xs" c="dimmed">
                  Volume
                </Text>
                <Slider
                  size="sm"
                  value={Math.round(restSound.volume * 100)}
                  onChange={(v) => updateRestSound({ volume: v / 100 })}
                  onChangeEnd={(v) => playSound(restSound.sound, v / 100)}
                />
                <Divider />
                <SoundPicker
                  title="Completion sound"
                  value={restSound.sound}
                  volume={restSound.volume}
                  onSelect={(v) => updateRestSound({ sound: v })}
                />
              </Stack>
            </Popover.Dropdown>
          </Popover>
          <ActionIcon variant="subtle" color="gray" onClick={reset} aria-label="Reset timer">
            <IconRotateClockwise2 size={16} />
          </ActionIcon>
        </Group>
      </Stack>
    </Flex>
  )
}

const PHASE_BG: Record<Phase['type'], string> = {
  lead: VX.neutral,
  work: SERIES.timerWork,
  rest: SERIES.timerRest,
}

function PhaseBar({
  phases,
  phaseIndex,
  markerPct,
  finished,
}: {
  phases: Phase[]
  phaseIndex: number
  markerPct: number
  finished: boolean
}) {
  if (phases.length === 0) return null

  return (
    <Box w="100%">
      <Box style={{ position: 'relative', height: 12 }}>
        <IconCaretDownFilled
          size={14}
          style={{
            position: 'absolute',
            bottom: 0,
            left: `${markerPct}%`,
            transform: 'translateX(-50%)',
            color: 'var(--mantine-color-text)',
          }}
        />
      </Box>
      <Group gap={2} wrap="nowrap" w="100%" style={{ height: 12 }}>
        {phases.map((p, i) => (
          <Box
            key={`${p.type}-${p.rep}-${i}`}
            bdrs={2}
            style={{
              flexGrow: p.dur,
              flexBasis: 0,
              height: '100%',
              background: PHASE_BG[p.type],
              opacity: !finished && i > phaseIndex ? 0.3 : 1,
            }}
          />
        ))}
      </Group>
    </Box>
  )
}

function SoundPicker({
  title,
  value,
  volume,
  onSelect,
}: {
  title: string
  value: string
  volume: number
  onSelect: (value: string) => void
}) {
  return (
    <Stack gap={4}>
      <Text size="xs" fw={500}>
        {title}
      </Text>
      <ScrollArea.Autosize mah={120}>
        <Stack gap={2}>
          {SOUND_OPTIONS.map((o) => (
            <Button
              key={o.value}
              fullWidth
              size="compact-xs"
              justify="flex-start"
              variant={value === o.value ? 'light' : 'subtle'}
              color={value === o.value ? 'blue' : 'gray'}
              onClick={() => {
                onSelect(o.value)
                playSound(o.value, volume)
              }}
            >
              {o.label}
            </Button>
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  )
}

function IntervalTimerPanel() {
  const config = useTimerStore((s) => s.intervalConfig)
  const sound = useTimerStore((s) => s.intervalSound)
  const phases = useTimerStore((s) => s.intervalPhases)
  const phaseIndex = useTimerStore((s) => s.intervalPhaseIndex)
  const remaining = useTimerStore((s) => s.intervalRemaining)
  const running = useTimerStore((s) => s.intervalRunning)
  const active = useTimerStore((s) => s.intervalActive)
  const finished = useTimerStore((s) => s.intervalFinished)
  const updateConfig = useTimerStore((s) => s.setIntervalConfig)
  const updateSound = useTimerStore((s) => s.setIntervalSound)
  const startFresh = useTimerStore((s) => s.startInterval)
  const resume = useTimerStore((s) => s.resumeInterval)
  const pause = useTimerStore((s) => s.pauseInterval)
  const reset = useTimerStore((s) => s.resetInterval)

  const [soundOpen, setSoundOpen] = useState(false)

  const phase = active ? phases[phaseIndex] : undefined
  const info = phase ? phaseInfo(phase) : undefined
  const phaseDur = phase?.dur ?? config.work
  const pct = finished
    ? 100
    : active && phaseDur > 0
      ? ((phaseDur - remaining) / phaseDur) * 100
      : 0
  const ringColor = finished ? 'red' : (info?.color ?? 'gray')
  const sublabel = finished ? 'Done' : (info?.label ?? 'Ready')

  const totalSecs = phases.reduce((sum, p) => sum + p.dur, 0)
  const completedSecs = phases.slice(0, phaseIndex).reduce((sum, p) => sum + p.dur, 0)
  const elapsedSecs = finished ? totalSecs : completedSecs + (phase ? phase.dur - remaining : 0)
  const totalFrac = totalSecs > 0 ? elapsedSecs / totalSecs : 0
  const totalPct = Math.min(100, Math.max(0, Math.round(totalFrac * 100)))
  const configSummary = `${LEAD_IN}s lead · ${config.work}/${config.rest}s · ${config.reps}×`

  const primaryLabel = running ? 'Pause' : active ? 'Resume' : 'Start'
  const onPrimary = running ? pause : active ? resume : startFresh

  return (
    <Flex direction={{ base: 'column', sm: 'row' }} align="center" gap="md" w="100%">
      <TimerRing
        pct={pct}
        color={ringColor}
        label={formatClock(Math.ceil(remaining))}
        sublabel={sublabel}
      />

      <Stack gap="xs" w="100%" miw={0} style={{ flex: 1 }}>
        {(active || finished) && (
          <Text size="xs" c="dimmed" ta="right">
            {configSummary}
          </Text>
        )}

        {(active || finished) && (
          <>
            <PhaseBar
              phases={phases}
              phaseIndex={phaseIndex}
              markerPct={totalFrac * 100}
              finished={finished}
            />
            <Text size="xs" c="dimmed" fw={500} ta="right">
              {totalPct}% complete
            </Text>
          </>
        )}

        {!active && !finished && (
          <SimpleGrid cols={2} spacing="xs">
            <NumberInput
              label="Work"
              size="xs"
              min={5}
              max={600}
              suffix=" s"
              value={config.work}
              onChange={(v) => updateConfig({ work: clampNum(v, 5, 600, DEFAULT_INTERVAL.work) })}
            />
            <NumberInput
              label="Rest"
              size="xs"
              min={0}
              max={600}
              suffix=" s"
              value={config.rest}
              onChange={(v) => updateConfig({ rest: clampNum(v, 0, 600, DEFAULT_INTERVAL.rest) })}
            />
            <NumberInput
              label="Rounds"
              size="xs"
              min={1}
              max={30}
              value={config.reps}
              onChange={(v) => updateConfig({ reps: clampNum(v, 1, 30, DEFAULT_INTERVAL.reps) })}
            />
            <Input.Wrapper label="Sound" size="xs">
              <Popover
                opened={soundOpen}
                onChange={setSoundOpen}
                position="bottom-end"
                withArrow
                shadow="md"
              >
                <Popover.Target>
                  <Button
                    fullWidth
                    size="xs"
                    variant="default"
                    leftSection={<IconMusic size={14} />}
                    onClick={() => setSoundOpen((o) => !o)}
                  >
                    Adjust
                  </Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap="xs" w={210}>
                    <Text size="xs" c="dimmed">
                      Volume
                    </Text>
                    <Slider
                      size="sm"
                      value={Math.round(sound.volume * 100)}
                      onChange={(v) => updateSound({ volume: v / 100 })}
                      onChangeEnd={(v) => playSound(sound.work, v / 100)}
                    />
                    <Divider />
                    <SoundPicker
                      title="Work signal"
                      value={sound.work}
                      volume={sound.volume}
                      onSelect={(v) => updateSound({ work: v })}
                    />
                    <SoundPicker
                      title="Rest signal"
                      value={sound.rest}
                      volume={sound.volume}
                      onSelect={(v) => updateSound({ rest: v })}
                    />
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            </Input.Wrapper>
          </SimpleGrid>
        )}

        {active || finished ? (
          <Group gap="xs" w="100%" wrap="nowrap">
            <Button
              size="sm"
              style={{ flex: 1 }}
              variant={running ? 'light' : 'filled'}
              color={running ? 'gray' : 'blue'}
              leftSection={
                running ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />
              }
              onClick={onPrimary}
            >
              {primaryLabel}
            </Button>
            <Button size="sm" variant="default" color="gray" onClick={reset}>
              Reset
            </Button>
          </Group>
        ) : (
          <Button
            fullWidth
            size="sm"
            variant="filled"
            color="blue"
            leftSection={<IconPlayerPlayFilled size={16} />}
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
        )}
      </Stack>
    </Flex>
  )
}

export function TimerCard() {
  const mode = useTimerStore((s) => s.mode)
  const setMode = useTimerStore((s) => s.setMode)

  return (
    <Paper py="xs" px="sm">
      <Stack gap="sm" align="center">
        <SegmentedControl
          fullWidth
          size="xs"
          w="100%"
          value={mode}
          onChange={(v) => setMode(v as 'rest' | 'interval')}
          data={[
            { label: 'Rest Timer', value: 'rest' },
            { label: 'Interval Timer', value: 'interval' },
          ]}
        />
        {mode === 'rest' ? <RestTimerPanel /> : <IntervalTimerPanel />}
      </Stack>
    </Paper>
  )
}
