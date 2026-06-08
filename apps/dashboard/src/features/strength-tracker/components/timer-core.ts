// Pure timer building blocks — keys, defaults, types, small helpers, the phase
// model, and the synthesized-sound engine. Shared by the global timer store
// (which runs the countdown engine app-level) and the timer-card UI, so neither
// has to import the other.

export type TimerMode = 'rest' | 'interval'

export const MODE_KEY = 'argo:timer:mode'
export const REST_KEY = 'argo:rest-timer:duration'
export const INTERVAL_KEY = 'argo:interval-timer:config'
export const SOUND_KEY = 'argo:interval-timer:sound'
export const REST_PRESETS_KEY = 'argo:rest-timer:presets'
export const REST_SOUND_KEY = 'argo:rest-timer:sound'

export const DEFAULT_REST_PRESETS = [120, 180, 240, 300]
export const DEFAULT_REST = 240

export type RestSound = { sound: string; volume: number }
export const DEFAULT_REST_SOUND: RestSound = { sound: 'boxingBell', volume: 0.8 }

export const LEAD_IN = 20

export type IntervalConfig = { work: number; rest: number; reps: number }
export const DEFAULT_INTERVAL: IntervalConfig = { work: 30, rest: 15, reps: 8 }

export type SoundConfig = { work: string; rest: string; volume: number }
export const DEFAULT_SOUND: SoundConfig = { work: 'boxingBell', rest: 'bell', volume: 0.8 }

export function formatClock(seconds: number): string {
  const mm = Math.floor(seconds / 60)
  const ss = seconds % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

export function presetLabel(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${(seconds / 60).toFixed(1)}m`
}

export function clampNum(
  value: number | string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function readJson<T>(key: string, fallback: T, validate: (raw: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return validate(JSON.parse(raw) as unknown)
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* localStorage unavailable — ignore */
  }
}

// ── Sound engine ─────────────────────────────────────────────────────────────
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

export const SOUND_OPTIONS: { value: string; label: string }[] = [
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

export function playSound(value: string, volume: number) {
  playVoices(soundVoices(value), volume)
}

export function playFinish(volume: number) {
  const voices = [523.25, 659.25, 783.99, 1046.5].flatMap((n, i) =>
    struck(n, i * 0.12, 0.9, [
      [1, 0.9],
      [2, 0.3],
    ]),
  )
  playVoices(voices, volume)
}

// ── Interval phase model ─────────────────────────────────────────────────────

export type Phase = { type: 'lead' | 'work' | 'rest'; dur: number; rep: number; totalReps: number }

export function buildPhases(cfg: IntervalConfig): Phase[] {
  const phases: Phase[] = []
  if (LEAD_IN > 0) phases.push({ type: 'lead', dur: LEAD_IN, rep: 0, totalReps: cfg.reps })
  for (let r = 1; r <= cfg.reps; r++) {
    phases.push({ type: 'work', dur: cfg.work, rep: r, totalReps: cfg.reps })
    if (r < cfg.reps && cfg.rest > 0)
      phases.push({ type: 'rest', dur: cfg.rest, rep: r, totalReps: cfg.reps })
  }
  return phases
}

export function phaseInfo(phase: Phase): { label: string; color: string } {
  if (phase.type === 'lead') return { label: 'Get Ready', color: 'gray' }
  if (phase.type === 'work')
    return { label: `Work · ${phase.rep}/${phase.totalReps}`, color: 'blue' }
  return { label: `Rest · ${phase.rep}/${phase.totalReps}`, color: 'orange' }
}
