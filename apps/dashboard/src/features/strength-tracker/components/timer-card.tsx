import { useEffect, useRef, useState } from 'react'
import {
  ActionIcon,
  Box,
  Button,
  Divider,
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
import { notifications } from '@mantine/notifications'
import {
  IconCaretDownFilled,
  IconMusic,
  IconPencil,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconRotateClockwise2,
} from '@tabler/icons-react'
import { subscribeRestTimer } from './rest-timer-bus'

type TimerMode = 'rest' | 'interval'

const MODE_KEY = 'argo:timer:mode'
const REST_KEY = 'argo:rest-timer:duration'
const INTERVAL_KEY = 'argo:interval-timer:config'
const SOUND_KEY = 'argo:interval-timer:sound'

const REST_PRESETS_KEY = 'argo:rest-timer:presets'
const REST_SOUND_KEY = 'argo:rest-timer:sound'
const DEFAULT_REST_PRESETS = [120, 180, 240, 300]
const DEFAULT_REST = 240
const DEFAULT_REST_SOUND = { sound: 'boxingBell', volume: 0.8 }

const LEAD_IN = 20

type IntervalConfig = { work: number; rest: number; reps: number }
const DEFAULT_INTERVAL: IntervalConfig = { work: 30, rest: 15, reps: 8 }

type SoundConfig = { work: string; rest: string; volume: number }
const DEFAULT_SOUND: SoundConfig = { work: 'boxingBell', rest: 'bell', volume: 0.8 }

function formatClock(seconds: number): string {
  const mm = Math.floor(seconds / 60)
  const ss = seconds % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

function presetLabel(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${(seconds / 60).toFixed(1)}m`
}

function clampNum(value: number | string, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function readJson<T>(key: string, fallback: T, validate: (raw: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return validate(JSON.parse(raw) as unknown)
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* localStorage unavailable — ignore */
  }
}

// One shared AudioContext, created lazily on first play and reused. No audio
// files exist — every sound is synthesized from oscillators on demand, so there
// is nothing to load, cache, or preload.
let sharedCtx: AudioContext | null = null
function getCtx(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    sharedCtx ??= new Ctx()
    if (sharedCtx.state === 'suspended') void sharedCtx.resume()
    return sharedCtx
  } catch {
    return null
  }
}

type Voice = {
  freq: number
  start: number
  dur: number
  type?: OscillatorType
  gain?: number
  glideTo?: number
}

/** Schedule a set of voices through a shared gain + compressor. */
function playVoices(voices: Voice[], volume: number) {
  if (voices.length === 0 || volume <= 0) return
  const ctx = getCtx()
  if (!ctx) return
  const master = ctx.createGain()
  master.gain.value = Math.min(1, volume)
  const comp = ctx.createDynamicsCompressor()
  master.connect(comp).connect(ctx.destination)

  const t0 = ctx.currentTime
  for (const v of voices) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = v.type ?? 'sine'
    const s = t0 + v.start
    osc.frequency.setValueAtTime(v.freq, s)
    if (v.glideTo) osc.frequency.exponentialRampToValueAtTime(v.glideTo, s + v.dur)
    const peak = Math.max(0.0001, v.gain ?? 1)
    g.gain.setValueAtTime(0.0001, s)
    g.gain.exponentialRampToValueAtTime(peak, s + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, s + v.dur)
    osc.connect(g).connect(master)
    osc.start(s)
    osc.stop(s + v.dur + 0.05)
  }
}

/** Struck-resonator note: fundamental + inharmonic partials, higher ones decay faster. */
function struck(
  freq: number,
  start: number,
  dur: number,
  partials: [number, number][],
  type: OscillatorType = 'sine',
): Voice[] {
  return partials.map(([mult, gain]) => ({
    freq: freq * mult,
    start,
    dur: dur * Math.max(0.35, 1 / mult),
    type,
    gain,
  }))
}

const SOUND_OPTIONS: { value: string; label: string }[] = [
  { value: 'boxingBell', label: 'Boxing Bell' },
  { value: 'bell', label: 'Bell' },
  { value: 'chime', label: 'Chime (up)' },
  { value: 'chimeDown', label: 'Chime (down)' },
  { value: 'powerUp', label: 'Power Up' },
  { value: 'gong', label: 'Gong' },
  { value: 'off', label: 'Off' },
]

function soundVoices(value: string): Voice[] {
  const bellPartials: [number, number][] = [
    [1, 1],
    [2.4, 0.5],
    [3.9, 0.35],
    [5.3, 0.2],
  ]
  switch (value) {
    case 'boxingBell':
      return [...struck(620, 0, 1.1, bellPartials), ...struck(620, 0.16, 1.4, bellPartials)]
    case 'bell':
      return struck(523.25, 0, 1.8, [
        [1, 1],
        [2, 0.5],
        [2.76, 0.35],
        [5.4, 0.18],
      ])
    case 'chime':
      return [523.25, 659.25, 783.99].flatMap((n, i) =>
        struck(n, i * 0.14, 0.9, [
          [1, 0.9],
          [2, 0.3],
        ]),
      )
    case 'chimeDown':
      return [783.99, 659.25, 523.25].flatMap((n, i) =>
        struck(n, i * 0.14, 0.9, [
          [1, 0.9],
          [2, 0.3],
        ]),
      )
    case 'powerUp':
      return [523.25, 659.25, 783.99, 1046.5].map((n, i) => ({
        freq: n,
        start: i * 0.09,
        dur: 0.18,
        type: 'triangle' as const,
        gain: 0.9,
      }))
    case 'gong':
      return struck(146.83, 0, 2.4, [
        [1, 1],
        [1.5, 0.5],
        [2.3, 0.35],
        [3.8, 0.2],
        [5.1, 0.12],
      ])
    default:
      return []
  }
}

function playSound(value: string, volume: number) {
  playVoices(soundVoices(value), volume)
}

function playFinish(volume: number) {
  const voices = [523.25, 659.25, 783.99, 1046.5].flatMap((n, i) =>
    struck(n, i * 0.12, 0.9, [
      [1, 0.9],
      [2, 0.3],
    ]),
  )
  playVoices(voices, volume)
}

function TimerRing({
  pct,
  color,
  label,
  sublabel,
}: {
  pct: number
  color: string
  label: string
  sublabel?: string
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
          <Text ta="center" fw={700} size="xl" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {label}
          </Text>
        </Stack>
      }
    />
  )
}

function RestTimerPanel() {
  const [duration, setDuration] = useState(() =>
    readJson(REST_KEY, DEFAULT_REST, (raw) =>
      typeof raw === 'number' && raw > 0 && raw <= 3600 ? raw : DEFAULT_REST,
    ),
  )
  const [remaining, setRemaining] = useState(duration)
  const [running, setRunning] = useState(false)
  const [presets, setPresets] = useState(() =>
    readJson(REST_PRESETS_KEY, DEFAULT_REST_PRESETS, (raw) =>
      Array.isArray(raw) &&
      raw.length === DEFAULT_REST_PRESETS.length &&
      raw.every((n) => typeof n === 'number' && n > 0 && n <= 3600)
        ? (raw as number[])
        : DEFAULT_REST_PRESETS,
    ),
  )
  const [restSound, setRestSound] = useState(() =>
    readJson(REST_SOUND_KEY, DEFAULT_REST_SOUND, (raw) => {
      const r = raw as Partial<typeof DEFAULT_REST_SOUND> | null
      if (!r || typeof r !== 'object') return DEFAULT_REST_SOUND
      return {
        sound:
          typeof r.sound === 'string' && SOUND_OPTIONS.some((o) => o.value === r.sound)
            ? r.sound
            : DEFAULT_REST_SOUND.sound,
        volume: clampNum((r.volume ?? DEFAULT_REST_SOUND.volume) * 100, 0, 100, 60) / 100,
      }
    }),
  )
  const [editOpen, setEditOpen] = useState(false)
  const [soundOpen, setSoundOpen] = useState(false)
  const endAtRef = useRef<number | null>(null)
  const restSoundRef = useRef(restSound)

  useEffect(() => {
    writeJson(REST_KEY, duration)
  }, [duration])

  useEffect(() => {
    writeJson(REST_PRESETS_KEY, presets)
  }, [presets])

  useEffect(() => {
    restSoundRef.current = restSound
    writeJson(REST_SOUND_KEY, restSound)
  }, [restSound])

  useEffect(() => {
    if (!running) return
    let raf = 0
    const frame = () => {
      const endAt = endAtRef.current
      if (endAt === null) return
      const left = Math.max(0, (endAt - Date.now()) / 1000)
      if (left > 0) {
        setRemaining(left)
        raf = requestAnimationFrame(frame)
        return
      }
      endAtRef.current = null
      setRunning(false)
      setRemaining(0)
      playSound(restSoundRef.current.sound, restSoundRef.current.volume)
      notifications.show({
        color: 'teal',
        title: 'Rest done',
        message: 'Time for the next set.',
        autoClose: 5000,
      })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [running])

  const start = () => {
    const base = remaining > 0 ? remaining : duration
    endAtRef.current = Date.now() + base * 1000
    setRemaining(base)
    setRunning(true)
  }

  // Auto-start a fresh full-duration rest when the workout checklist checks a set.
  useEffect(() => {
    return subscribeRestTimer(() => {
      endAtRef.current = Date.now() + duration * 1000
      setRemaining(duration)
      setRunning(true)
    })
  }, [duration])

  const pause = () => {
    endAtRef.current = null
    setRunning(false)
  }

  const selectPreset = (seconds: number) => {
    endAtRef.current = null
    setRunning(false)
    setDuration(seconds)
    setRemaining(seconds)
  }

  const reset = () => {
    endAtRef.current = null
    setRunning(false)
    setRemaining(duration)
  }

  const updatePreset = (index: number, minutes: number) => {
    const seconds = clampNum(minutes * 60, 10, 3600, DEFAULT_REST)
    setPresets((prev) => prev.map((s, i) => (i === index ? seconds : s)))
  }

  const updateRestSound = (patch: Partial<typeof DEFAULT_REST_SOUND>) =>
    setRestSound((prev) => ({ ...prev, ...patch }))

  const done = remaining <= 0
  const pct = duration > 0 ? ((duration - remaining) / duration) * 100 : 0
  const ringColor = done ? 'red' : remaining <= 15 ? 'orange' : running ? 'teal' : 'gray'

  return (
    <Group align="center" wrap="nowrap" gap="md" w="100%">
      <TimerRing pct={pct} color={ringColor} label={formatClock(Math.ceil(remaining))} />
      <Stack gap="xs" style={{ flex: 1 }}>
        <Group gap={4} wrap="nowrap">
          {presets.map((seconds, i) => (
            <Button
              key={`${seconds}-${i}`}
              size="compact-xs"
              px={4}
              style={{ flex: 1 }}
              variant={duration === seconds ? 'filled' : 'default'}
              color="teal"
              onClick={() => selectPreset(seconds)}
            >
              {presetLabel(seconds)}
            </Button>
          ))}
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
        <Button
          fullWidth
          size="sm"
          variant={running ? 'light' : 'filled'}
          color={running ? 'gray' : 'teal'}
          leftSection={
            running ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />
          }
          onClick={running ? pause : start}
        >
          {running ? 'Pause' : done ? 'Restart' : 'Start'}
        </Button>
      </Stack>
    </Group>
  )
}

type Phase = { type: 'lead' | 'work' | 'rest'; dur: number; rep: number; totalReps: number }

function buildPhases(cfg: IntervalConfig): Phase[] {
  const phases: Phase[] = []
  if (LEAD_IN > 0) phases.push({ type: 'lead', dur: LEAD_IN, rep: 0, totalReps: cfg.reps })
  for (let r = 1; r <= cfg.reps; r++) {
    phases.push({ type: 'work', dur: cfg.work, rep: r, totalReps: cfg.reps })
    if (r < cfg.reps && cfg.rest > 0)
      phases.push({ type: 'rest', dur: cfg.rest, rep: r, totalReps: cfg.reps })
  }
  return phases
}

function phaseInfo(phase: Phase): { label: string; color: string } {
  if (phase.type === 'lead') return { label: 'Get Ready', color: 'gray' }
  if (phase.type === 'work')
    return { label: `Work · ${phase.rep}/${phase.totalReps}`, color: 'teal' }
  return { label: `Rest · ${phase.rep}/${phase.totalReps}`, color: 'indigo' }
}

const PHASE_BG: Record<Phase['type'], string> = {
  lead: 'var(--mantine-color-gray-5)',
  work: 'var(--mantine-color-teal-6)',
  rest: 'var(--mantine-color-indigo-5)',
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
            style={{
              flexGrow: p.dur,
              flexBasis: 0,
              height: '100%',
              borderRadius: 2,
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
              color={value === o.value ? 'teal' : 'gray'}
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
  const [config, setConfig] = useState(() =>
    readJson(INTERVAL_KEY, DEFAULT_INTERVAL, (raw) => {
      const r = raw as Partial<IntervalConfig> | null
      if (!r || typeof r !== 'object') return DEFAULT_INTERVAL
      return {
        work: clampNum(r.work ?? DEFAULT_INTERVAL.work, 5, 600, DEFAULT_INTERVAL.work),
        rest: clampNum(r.rest ?? DEFAULT_INTERVAL.rest, 0, 600, DEFAULT_INTERVAL.rest),
        reps: clampNum(r.reps ?? DEFAULT_INTERVAL.reps, 1, 30, DEFAULT_INTERVAL.reps),
      }
    }),
  )
  const [sound, setSound] = useState(() =>
    readJson(SOUND_KEY, DEFAULT_SOUND, (raw) => {
      const r = raw as Partial<SoundConfig> | null
      if (!r || typeof r !== 'object') return DEFAULT_SOUND
      const known = (v: unknown, fallback: string) =>
        typeof v === 'string' && SOUND_OPTIONS.some((o) => o.value === v) ? v : fallback
      return {
        work: known(r.work, DEFAULT_SOUND.work),
        rest: known(r.rest, DEFAULT_SOUND.rest),
        volume: clampNum((r.volume ?? DEFAULT_SOUND.volume) * 100, 0, 100, 50) / 100,
      }
    }),
  )
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [remaining, setRemaining] = useState(LEAD_IN)
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState(false)
  const [finished, setFinished] = useState(false)
  const [soundOpen, setSoundOpen] = useState(false)
  const endAtRef = useRef<number | null>(null)
  const phasesRef = useRef<Phase[]>([])
  const phaseIndexRef = useRef(0)
  const soundRef = useRef(sound)

  useEffect(() => {
    writeJson(INTERVAL_KEY, config)
  }, [config])

  useEffect(() => {
    soundRef.current = sound
    writeJson(SOUND_KEY, sound)
  }, [sound])

  useEffect(() => {
    if (active || finished) return
    setRemaining(LEAD_IN)
  }, [active, finished])

  useEffect(() => {
    if (!running) return
    let raf = 0
    const frame = () => {
      const endAt = endAtRef.current
      if (endAt === null) return
      const left = Math.max(0, (endAt - Date.now()) / 1000)
      if (left > 0) {
        setRemaining(left)
        raf = requestAnimationFrame(frame)
        return
      }
      const phases = phasesRef.current
      const next = phaseIndexRef.current + 1
      const nextPhase = phases[next]
      if (!nextPhase) {
        endAtRef.current = null
        setRunning(false)
        setActive(false)
        setFinished(true)
        setRemaining(0)
        playFinish(soundRef.current.volume)
        const rounds = phases.filter((p) => p.type === 'work').length
        notifications.show({
          color: 'teal',
          title: 'Interval done',
          message: `${rounds} rounds complete.`,
          autoClose: 5000,
        })
        return
      }
      phaseIndexRef.current = next
      endAtRef.current = Date.now() + nextPhase.dur * 1000
      setPhaseIndex(next)
      setRemaining(nextPhase.dur)
      const cfg = soundRef.current
      playSound(nextPhase.type === 'rest' ? cfg.rest : cfg.work, cfg.volume)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [running])

  const startFresh = () => {
    const phases = buildPhases(config)
    const first = phases[0]
    if (!first) return
    phasesRef.current = phases
    phaseIndexRef.current = 0
    endAtRef.current = Date.now() + first.dur * 1000
    setPhaseIndex(0)
    setRemaining(first.dur)
    setFinished(false)
    setActive(true)
    setRunning(true)
  }

  const resume = () => {
    endAtRef.current = Date.now() + remaining * 1000
    setRunning(true)
  }

  const pause = () => {
    endAtRef.current = null
    setRunning(false)
  }

  const reset = () => {
    endAtRef.current = null
    phaseIndexRef.current = 0
    setRunning(false)
    setActive(false)
    setFinished(false)
    setPhaseIndex(0)
    setRemaining(LEAD_IN)
  }

  const updateConfig = (patch: Partial<IntervalConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }))

  const updateSound = (patch: Partial<SoundConfig>) => setSound((prev) => ({ ...prev, ...patch }))

  const phase = active ? phasesRef.current[phaseIndex] : undefined
  const info = phase ? phaseInfo(phase) : undefined
  const phaseDur = phase?.dur ?? config.work
  const pct = finished
    ? 100
    : active && phaseDur > 0
      ? ((phaseDur - remaining) / phaseDur) * 100
      : 0
  const ringColor = finished ? 'red' : (info?.color ?? 'gray')
  const sublabel = finished ? 'Done' : (info?.label ?? 'Ready')

  const totalSecs = phasesRef.current.reduce((sum, p) => sum + p.dur, 0)
  const completedSecs = phasesRef.current.slice(0, phaseIndex).reduce((sum, p) => sum + p.dur, 0)
  const elapsedSecs = finished ? totalSecs : completedSecs + (phase ? phase.dur - remaining : 0)
  const totalFrac = totalSecs > 0 ? elapsedSecs / totalSecs : 0
  const totalPct = Math.min(100, Math.max(0, Math.round(totalFrac * 100)))
  const configSummary = `${LEAD_IN}s lead · ${config.work}/${config.rest}s · ${config.reps}×`

  const primaryLabel = running ? 'Pause' : active ? 'Resume' : 'Start'
  const onPrimary = running ? pause : active ? resume : startFresh

  return (
    <Group align="center" wrap="nowrap" gap="md" w="100%">
      <TimerRing
        pct={pct}
        color={ringColor}
        label={formatClock(Math.ceil(remaining))}
        sublabel={sublabel}
      />

      <Stack gap="xs" style={{ flex: 1 }}>
        {(active || finished) && (
          <Text size="xs" c="dimmed" ta="right">
            {configSummary}
          </Text>
        )}

        {(active || finished) && (
          <>
            <PhaseBar
              phases={phasesRef.current}
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
              color={running ? 'gray' : 'teal'}
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
            color="teal"
            leftSection={<IconPlayerPlayFilled size={16} />}
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
        )}
      </Stack>
    </Group>
  )
}

export function TimerCard() {
  const [mode, setMode] = useState<TimerMode>(() =>
    readJson<TimerMode>(MODE_KEY, 'rest', (raw) => (raw === 'interval' ? 'interval' : 'rest')),
  )

  useEffect(() => {
    writeJson(MODE_KEY, mode)
  }, [mode])

  return (
    <Paper withBorder p="md">
      <Stack gap="sm" align="center">
        <SegmentedControl
          fullWidth
          size="xs"
          w="100%"
          value={mode}
          onChange={(v) => setMode(v as TimerMode)}
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
