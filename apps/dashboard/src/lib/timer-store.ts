import { create } from 'zustand'
import { emit } from 'basalt-ui/notifications'
import {
  buildPhases,
  clampNum,
  DEFAULT_INTERVAL,
  DEFAULT_REST,
  DEFAULT_REST_PRESETS,
  DEFAULT_REST_SOUND,
  DEFAULT_SOUND,
  INTERVAL_KEY,
  LEAD_IN,
  MODE_KEY,
  playFinish,
  playSound,
  readJson,
  REST_KEY,
  REST_PRESETS_KEY,
  REST_SOUND_KEY,
  SOUND_KEY,
  SOUND_OPTIONS,
  writeJson,
  type IntervalConfig,
  type Phase,
  type RestSound,
  type SoundConfig,
  type TimerMode,
} from '../features/strength-tracker/components/timer-core'

// Live timer state lives here (not in the timer-card component) so a running
// timer survives route changes and can be shown in the app header. Config
// (durations, presets, sounds, mode) is read from and written back to the same
// localStorage keys the card used, so existing settings carry over. The
// countdown engine (`tick`) runs app-level — see useTimerEngine in __root.

const knownSound = (v: unknown, fallback: string) =>
  typeof v === 'string' && SOUND_OPTIONS.some((o) => o.value === v) ? v : fallback

const initMode = readJson<TimerMode>(MODE_KEY, 'rest', (raw) =>
  raw === 'interval' ? 'interval' : 'rest',
)
const initRestDuration = readJson(REST_KEY, DEFAULT_REST, (raw) =>
  typeof raw === 'number' && raw > 0 && raw <= 3600 ? raw : DEFAULT_REST,
)
const initRestPresets = readJson(REST_PRESETS_KEY, DEFAULT_REST_PRESETS, (raw) =>
  Array.isArray(raw) &&
  raw.length === DEFAULT_REST_PRESETS.length &&
  raw.every((n) => typeof n === 'number' && n > 0 && n <= 3600)
    ? (raw as number[])
    : DEFAULT_REST_PRESETS,
)
const initRestSound = readJson<RestSound>(REST_SOUND_KEY, DEFAULT_REST_SOUND, (raw) => {
  const r = raw as Partial<RestSound> | null
  if (!r || typeof r !== 'object') return DEFAULT_REST_SOUND
  return {
    sound: knownSound(r.sound, DEFAULT_REST_SOUND.sound),
    volume: clampNum((r.volume ?? DEFAULT_REST_SOUND.volume) * 100, 0, 100, 60) / 100,
  }
})
const initIntervalConfig = readJson<IntervalConfig>(INTERVAL_KEY, DEFAULT_INTERVAL, (raw) => {
  const r = raw as Partial<IntervalConfig> | null
  if (!r || typeof r !== 'object') return DEFAULT_INTERVAL
  return {
    work: clampNum(r.work ?? DEFAULT_INTERVAL.work, 5, 600, DEFAULT_INTERVAL.work),
    rest: clampNum(r.rest ?? DEFAULT_INTERVAL.rest, 0, 600, DEFAULT_INTERVAL.rest),
    reps: clampNum(r.reps ?? DEFAULT_INTERVAL.reps, 1, 30, DEFAULT_INTERVAL.reps),
  }
})
const initIntervalSound = readJson<SoundConfig>(SOUND_KEY, DEFAULT_SOUND, (raw) => {
  const r = raw as Partial<SoundConfig> | null
  if (!r || typeof r !== 'object') return DEFAULT_SOUND
  return {
    work: knownSound(r.work, DEFAULT_SOUND.work),
    rest: knownSound(r.rest, DEFAULT_SOUND.rest),
    volume: clampNum((r.volume ?? DEFAULT_SOUND.volume) * 100, 0, 100, 50) / 100,
  }
})

type TimerState = {
  mode: TimerMode
  setMode: (mode: TimerMode) => void

  // ── Rest timer ──
  restDuration: number
  restPresets: number[]
  restSound: RestSound
  restEndAt: number | null
  restRemaining: number
  restRunning: boolean
  setRestSound: (patch: Partial<RestSound>) => void
  setRestPreset: (index: number, seconds: number) => void
  selectRestPreset: (seconds: number) => void
  startRest: () => void
  /** Fresh full-duration rest, ignoring any paused remainder (set-check auto-start). */
  autoStartRest: () => void
  pauseRest: () => void
  resetRest: () => void

  // ── Interval timer ──
  intervalConfig: IntervalConfig
  intervalSound: SoundConfig
  intervalPhases: Phase[]
  intervalPhaseIndex: number
  intervalEndAt: number | null
  intervalRemaining: number
  intervalRunning: boolean
  intervalActive: boolean
  intervalFinished: boolean
  setIntervalConfig: (patch: Partial<IntervalConfig>) => void
  setIntervalSound: (patch: Partial<SoundConfig>) => void
  startInterval: () => void
  resumeInterval: () => void
  pauseInterval: () => void
  resetInterval: () => void

  /** One countdown step — driven by the app-level RAF loop while a timer runs. */
  tick: () => void
}

export const useTimerStore = create<TimerState>()((set, get) => ({
  mode: initMode,
  setMode: (mode) => {
    writeJson(MODE_KEY, mode)
    set({ mode })
  },

  restDuration: initRestDuration,
  restPresets: initRestPresets,
  restSound: initRestSound,
  restEndAt: null,
  restRemaining: initRestDuration,
  restRunning: false,
  setRestSound: (patch) => {
    const restSound = { ...get().restSound, ...patch }
    writeJson(REST_SOUND_KEY, restSound)
    set({ restSound })
  },
  setRestPreset: (index, seconds) => {
    const restPresets = get().restPresets.map((s, i) => (i === index ? seconds : s))
    writeJson(REST_PRESETS_KEY, restPresets)
    set({ restPresets })
  },
  selectRestPreset: (seconds) => {
    writeJson(REST_KEY, seconds)
    set({ restEndAt: null, restRunning: false, restDuration: seconds, restRemaining: seconds })
  },
  startRest: () => {
    const { restRemaining, restDuration } = get()
    const base = restRemaining > 0 ? restRemaining : restDuration
    set({ restEndAt: Date.now() + base * 1000, restRemaining: base, restRunning: true })
  },
  autoStartRest: () => {
    const { restDuration } = get()
    set({
      restEndAt: Date.now() + restDuration * 1000,
      restRemaining: restDuration,
      restRunning: true,
    })
  },
  pauseRest: () => set({ restEndAt: null, restRunning: false }),
  resetRest: () => set({ restEndAt: null, restRunning: false, restRemaining: get().restDuration }),

  intervalConfig: initIntervalConfig,
  intervalSound: initIntervalSound,
  intervalPhases: [],
  intervalPhaseIndex: 0,
  intervalEndAt: null,
  intervalRemaining: LEAD_IN,
  intervalRunning: false,
  intervalActive: false,
  intervalFinished: false,
  setIntervalConfig: (patch) => {
    const intervalConfig = { ...get().intervalConfig, ...patch }
    writeJson(INTERVAL_KEY, intervalConfig)
    set({ intervalConfig })
  },
  setIntervalSound: (patch) => {
    const intervalSound = { ...get().intervalSound, ...patch }
    writeJson(SOUND_KEY, intervalSound)
    set({ intervalSound })
  },
  startInterval: () => {
    const phases = buildPhases(get().intervalConfig)
    const first = phases[0]
    if (!first) return
    set({
      intervalPhases: phases,
      intervalPhaseIndex: 0,
      intervalEndAt: Date.now() + first.dur * 1000,
      intervalRemaining: first.dur,
      intervalFinished: false,
      intervalActive: true,
      intervalRunning: true,
    })
  },
  resumeInterval: () =>
    set({ intervalEndAt: Date.now() + get().intervalRemaining * 1000, intervalRunning: true }),
  pauseInterval: () => set({ intervalEndAt: null, intervalRunning: false }),
  resetInterval: () =>
    set({
      intervalEndAt: null,
      intervalPhaseIndex: 0,
      intervalRunning: false,
      intervalActive: false,
      intervalFinished: false,
      intervalRemaining: LEAD_IN,
    }),

  tick: () => {
    const s = get()
    const now = Date.now()

    if (s.restRunning && s.restEndAt !== null) {
      const left = Math.max(0, (s.restEndAt - now) / 1000)
      if (left > 0) {
        set({ restRemaining: left })
      } else {
        set({ restRunning: false, restEndAt: null, restRemaining: 0 })
        playSound(s.restSound.sound, s.restSound.volume)
        emit(
          'timer:done',
          { message: 'Time for the next set.' },
          { title: 'Rest done', autoClose: 5000 },
        )
      }
    }

    if (s.intervalRunning && s.intervalEndAt !== null) {
      const left = Math.max(0, (s.intervalEndAt - now) / 1000)
      if (left > 0) {
        set({ intervalRemaining: left })
      } else {
        const next = s.intervalPhaseIndex + 1
        const nextPhase = s.intervalPhases[next]
        if (!nextPhase) {
          set({
            intervalRunning: false,
            intervalEndAt: null,
            intervalActive: false,
            intervalFinished: true,
            intervalRemaining: 0,
          })
          playFinish(s.intervalSound.volume)
          const rounds = s.intervalPhases.filter((p) => p.type === 'work').length
          emit(
            'timer:done',
            { message: `${rounds} rounds complete.` },
            { title: 'Interval done', autoClose: 5000 },
          )
        } else {
          set({
            intervalPhaseIndex: next,
            intervalEndAt: now + nextPhase.dur * 1000,
            intervalRemaining: nextPhase.dur,
          })
          playSound(
            nextPhase.type === 'rest' ? s.intervalSound.rest : s.intervalSound.work,
            s.intervalSound.volume,
          )
        }
      }
    }
  },
}))
