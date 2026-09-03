import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { emit } from 'basalt-ui/notifications'
import { getToken } from '../../../lib/auth'
import { useUiStore } from '../../../lib/store'
import { apiBase } from '../../../lib/api-base'
import { decodeAudioTitle, SILENT_WAV } from './audio-utils'

// Feature-wide TTS playback. ONE persistent <audio> element is shared across the
// feed composer and every open thread so that a `primePlayback()` call inside a
// user gesture (a mic tap on the landing composer) unlocks the same element the
// newly-opened thread will later auto-play through — the key to iOS autoplay
// working for voice chats started from the feed. Sharing one element also means
// only one message can play at a time, app-wide.
//
// TODO(animation): once we're fluent in framer-motion, animate the read-aloud
// control properly — a spring on the idle→loading→playing transition, an animated
// progress ring, and a tasteful enter/exit for the remaining-time readout. The
// current states are functional but static.

type ReadAloudOpts = { summarize?: boolean; threadId?: string }

type PlaySourceOpts = {
  title?: string | undefined
  threadId?: string | undefined
  startAt?: number | undefined
}

type VoicePlaybackValue = {
  /** Message id currently playing OR fetching audio, else null. */
  playingMessageId: string | null
  /** Thread id the current playback belongs to (from readAloud opts), else null. */
  playingThreadId: string | null
  /** True while fetching/decoding TTS, before audio actually starts (loading state). */
  isBuffering: boolean
  /** Playback progress of the current clip, 0..1. */
  progress: number
  /** Seconds left in the current clip. */
  remainingSec: number
  /** Absolute current playback position in seconds. */
  currentTimeSec: number
  /** Total duration of the current clip in seconds. */
  durationSec: number
  /** True when the audio element is actively playing. */
  isPlaying: boolean
  /** Current playback rate (0.75 / 1 / 1.25 / 1.5 / 2). */
  rate: number
  /** null = unknown, false = audio confirmed unavailable (503), true = working. */
  audioAvailable: boolean | null
  setAudioAvailable: (v: boolean) => void
  /** Unlock the audio element within a user gesture so later auto-play is allowed. */
  primePlayback: () => void
  /** Fetch + play TTS for a message. Calling it for the playing id stops (toggle/barge-in). */
  readAloud: (messageId: string, text: string, opts?: ReadAloudOpts) => Promise<void>
  /** Bind a direct URL to the shared element and play. Same-messageId call → resume, not restart. */
  playSource: (messageId: string, src: string, opts?: PlaySourceOpts) => Promise<void>
  /** Pause without resetting position (resumable). */
  pause: () => void
  /** Resume playback on the current element. */
  resume: () => Promise<void>
  /** Seek to an absolute time in seconds. */
  seek: (seconds: number) => void
  /** Set and persist the playback rate. */
  setRate: (rate: number) => void
  /** Stop any current playback. */
  stop: () => void
}

const VoicePlaybackContext = createContext<VoicePlaybackValue | null>(null)

export function useVoicePlayback(): VoicePlaybackValue {
  const ctx = useContext(VoicePlaybackContext)
  if (!ctx) throw new Error('useVoicePlayback must be used within a VoicePlaybackProvider')
  return ctx
}

export function VoicePlaybackProvider({ children }: { children: ReactNode }) {
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  const [playingThreadId, setPlayingThreadId] = useState<string | null>(null)
  const [isBuffering, setIsBuffering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [remainingSec, setRemainingSec] = useState(0)
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [durationSec, setDurationSec] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [rate, setRateState] = useState(1)
  const [audioAvailable, setAudioAvailableState] = useState<boolean | null>(null)

  // Read persisted playback rate from store on mount
  const storedRate = useUiStore((s) => s.playbackRate)
  const setPlaybackRate = useUiStore((s) => s.setPlaybackRate)

  const audioElRef = useRef<HTMLAudioElement | null>(null)
  // Mirrors playingMessageId so async playback can re-check the latest value after
  // an await — the closed-over state would be stale if the user stopped meanwhile.
  // Assigned in render (no effect) to avoid a frame of staleness.
  const playingMessageIdRef = useRef<string | null>(null)
  playingMessageIdRef.current = playingMessageId

  // Track the current duration for seek clamping (mirrors durationSec state, no extra re-renders)
  const durationRef = useRef(0)

  const setAudioAvailable = useCallback((v: boolean) => setAudioAvailableState(v), [])

  const resetPlayback = useCallback(() => {
    setPlayingMessageId(null)
    setPlayingThreadId(null)
    setIsBuffering(false)
    setProgress(0)
    setRemainingSec(0)
    setCurrentTimeSec(0)
    setDurationSec(0)
    setIsPlaying(false)
    durationRef.current = 0
  }, [])

  const updatePositionState = useCallback((el: HTMLAudioElement) => {
    if (!('mediaSession' in navigator)) return
    const d = el.duration
    if (!Number.isFinite(d) || d <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        position: Math.min(el.currentTime, d),
        playbackRate: el.playbackRate,
      })
    } catch {
      /* best-effort */
    }
  }, [])

  const getPlaybackEl = useCallback((): HTMLAudioElement => {
    if (!audioElRef.current) {
      const el = new Audio()

      // Metadata loaded → update duration + MediaSession position
      el.addEventListener('loadedmetadata', () => {
        const d = el.duration
        if (Number.isFinite(d) && d > 0) {
          durationRef.current = d
          setDurationSec(d)
          updatePositionState(el)
        }
      })

      // Audio actually started → leave the loading state.
      el.addEventListener('playing', () => {
        setIsBuffering(false)
        setIsPlaying(true)
      })

      el.addEventListener('pause', () => setIsPlaying(false))
      el.addEventListener('play', () => setIsPlaying(true))

      // Waiting for more data (buffering mid-stream)
      el.addEventListener('waiting', () => setIsBuffering(true))
      el.addEventListener('canplay', () => setIsBuffering(false))

      el.addEventListener('timeupdate', () => {
        const d = el.duration
        if (Number.isFinite(d) && d > 0) {
          setProgress(el.currentTime / d)
          setRemainingSec(Math.max(0, d - el.currentTime))
          setCurrentTimeSec(el.currentTime)
          updatePositionState(el)
        }
      })

      el.addEventListener('ratechange', () => {
        updatePositionState(el)
      })

      // Release the object URL when playback finishes or errors — readAloud only
      // revokes the PREVIOUS src when a new one is set, so without this the last
      // played blob would linger in memory until the next play or unmount.
      const onDone = () => {
        if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src)
        resetPlayback()
      }
      el.addEventListener('ended', onDone)
      el.addEventListener('error', onDone)
      audioElRef.current = el
    }
    return audioElRef.current
  }, [resetPlayback, updatePositionState])

  // Sync the persisted rate into local state on first render
  useEffect(() => {
    setRateState(storedRate)
  }, [storedRate])

  const primePlayback = useCallback(() => {
    const el = getPlaybackEl()
    el.src = SILENT_WAV
    void el
      .play()
      .then(() => el.pause())
      .catch(() => {})
  }, [getPlaybackEl])

  const stop = useCallback(() => {
    audioElRef.current?.pause()
    resetPlayback()
  }, [resetPlayback])

  const pause = useCallback(() => {
    audioElRef.current?.pause()
    // Do NOT call resetPlayback — this is a resumable pause.
  }, [])

  const resume = useCallback(async () => {
    const el = audioElRef.current
    if (!el) return
    try {
      await el.play()
    } catch {
      /* best-effort */
    }
  }, [])

  const seek = useCallback(
    (seconds: number) => {
      const el = audioElRef.current
      if (!el) return
      const d = durationRef.current
      const clamped = Math.max(0, d > 0 ? Math.min(seconds, d) : seconds)
      el.currentTime = clamped
      setCurrentTimeSec(clamped)
      if (d > 0) {
        setProgress(clamped / d)
        setRemainingSec(Math.max(0, d - clamped))
      }
      updatePositionState(el)
    },
    [updatePositionState],
  )

  const setRate = useCallback(
    (newRate: number) => {
      const el = audioElRef.current
      if (el) el.playbackRate = newRate
      setRateState(newRate)
      setPlaybackRate(newRate)
    },
    [setPlaybackRate],
  )

  const playSource = useCallback(
    async (messageId: string, src: string, opts?: PlaySourceOpts) => {
      const el = getPlaybackEl()

      // Same messageId already active → treat as resume (not restart)
      if (playingMessageIdRef.current === messageId) {
        if (!el.paused) return
        try {
          await el.play()
        } catch {
          /* best-effort */
        }
        return
      }

      el.pause()
      setPlayingMessageId(messageId)
      setPlayingThreadId(opts?.threadId ?? null)
      setIsBuffering(true)
      setProgress(0)
      setRemainingSec(0)
      setCurrentTimeSec(0)
      setDurationSec(0)
      durationRef.current = 0

      // Apply current rate
      const currentRate = useUiStore.getState().playbackRate
      el.playbackRate = currentRate
      setRateState(currentRate)

      // If a startAt is requested, apply it once metadata loads
      if (opts?.startAt && opts.startAt > 0) {
        const startAt = opts.startAt
        const onMeta = () => {
          // Only apply if this is still the same playback session
          if (playingMessageIdRef.current !== messageId) return
          const d = el.duration
          if (d > 0 && startAt < d * 0.98) {
            el.currentTime = startAt
          }
          el.removeEventListener('loadedmetadata', onMeta)
        }
        el.addEventListener('loadedmetadata', onMeta)
      }

      el.src = src

      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: opts?.title ?? 'Hermes Podcast',
            artist: 'Hermes',
          })
          navigator.mediaSession.setActionHandler('play', () => void el.play())
          navigator.mediaSession.setActionHandler('pause', () => el.pause())
          navigator.mediaSession.setActionHandler('stop', () => stop())
          navigator.mediaSession.setActionHandler('seekto', (e) => {
            if (e.seekTime !== null && e.seekTime !== undefined) seek(e.seekTime)
          })
          navigator.mediaSession.setActionHandler('seekforward', (e) => {
            seek(el.currentTime + (e.seekOffset ?? 10))
          })
          navigator.mediaSession.setActionHandler('seekbackward', (e) => {
            seek(el.currentTime - (e.seekOffset ?? 10))
          })
        } catch {
          /* media session is best-effort */
        }
      }

      setAudioAvailableState(true)
      try {
        await el.play()
      } catch {
        // Stale guard: if user navigated away, resetPlayback already called
        if (playingMessageIdRef.current === messageId) resetPlayback()
      }
    },
    [getPlaybackEl, resetPlayback, seek, stop],
  )

  const readAloud = useCallback(
    async (messageId: string, text: string, opts?: ReadAloudOpts) => {
      const el = getPlaybackEl()
      el.pause()
      // Calling it for the currently-active message → just stop (toggle / barge-in).
      if (playingMessageIdRef.current === messageId) {
        resetPlayback()
        return
      }
      setPlayingMessageId(messageId)
      setPlayingThreadId(opts?.threadId ?? null)
      setIsBuffering(true)
      setProgress(0)
      setRemainingSec(0)
      setCurrentTimeSec(0)
      setDurationSec(0)
      durationRef.current = 0
      try {
        const token = getToken()
        const res = await fetch(`${apiBase}/ai/v1/audio/speech`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ input: text, ...(opts?.summarize ? { summarize: true } : {}) }),
        })
        if (!res.ok) {
          if (res.status === 503) {
            setAudioAvailableState(false)
            emit(
              'chat:error',
              { message: 'Text-to-speech is not configured.' },
              { title: 'Audio unavailable' },
            )
          }
          resetPlayback()
          return
        }
        const title = decodeAudioTitle(res.headers.get('x-audio-title'))
        const blob = await res.blob()
        // User stopped or switched playback during the fetch → drop this stale result.
        if (playingMessageIdRef.current !== messageId) return
        if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src)
        el.src = URL.createObjectURL(blob)
        // Lock-screen / background playback controls — playback keeps running when
        // the device is locked or the PWA is backgrounded (works on iOS + Android).
        if ('mediaSession' in navigator) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: title || 'Hermes',
              artist: 'Hermes',
            })
            navigator.mediaSession.setActionHandler('play', () => void el.play())
            navigator.mediaSession.setActionHandler('pause', () => el.pause())
            navigator.mediaSession.setActionHandler('stop', () => stop())
          } catch {
            /* media session is best-effort */
          }
        }
        setAudioAvailableState(true)
        await el.play()
      } catch {
        resetPlayback()
      }
    },
    [getPlaybackEl, resetPlayback, stop],
  )

  // Pause + release the audio element on unmount of the whole chat feature.
  useEffect(() => {
    return () => {
      const el = audioElRef.current
      if (el) {
        el.pause()
        if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src)
        audioElRef.current = null
      }
    }
  }, [])

  const value = useMemo<VoicePlaybackValue>(
    () => ({
      playingMessageId,
      playingThreadId,
      isBuffering,
      progress,
      remainingSec,
      currentTimeSec,
      durationSec,
      isPlaying,
      rate,
      audioAvailable,
      setAudioAvailable,
      primePlayback,
      readAloud,
      playSource,
      pause,
      resume,
      seek,
      setRate,
      stop,
    }),
    [
      playingMessageId,
      playingThreadId,
      isBuffering,
      progress,
      remainingSec,
      currentTimeSec,
      durationSec,
      isPlaying,
      rate,
      audioAvailable,
      setAudioAvailable,
      primePlayback,
      readAloud,
      playSource,
      pause,
      resume,
      seek,
      setRate,
      stop,
    ],
  )

  return <VoicePlaybackContext.Provider value={value}>{children}</VoicePlaybackContext.Provider>
}
