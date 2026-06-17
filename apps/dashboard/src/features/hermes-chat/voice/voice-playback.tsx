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
import { notifications } from '@mantine/notifications'
import { getToken } from '../../../lib/auth'
import { apiBase } from '../transport'
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
  /** null = unknown, false = audio confirmed unavailable (503), true = working. */
  audioAvailable: boolean | null
  setAudioAvailable: (v: boolean) => void
  /** Unlock the audio element within a user gesture so later auto-play is allowed. */
  primePlayback: () => void
  /** Fetch + play TTS for a message. Calling it for the playing id stops (toggle/barge-in). */
  readAloud: (messageId: string, text: string, opts?: ReadAloudOpts) => Promise<void>
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
  const [audioAvailable, setAudioAvailableState] = useState<boolean | null>(null)

  const audioElRef = useRef<HTMLAudioElement | null>(null)
  // Mirrors playingMessageId so async playback can re-check the latest value after
  // an await — the closed-over state would be stale if the user stopped meanwhile.
  // Assigned in render (no effect) to avoid a frame of staleness.
  const playingMessageIdRef = useRef<string | null>(null)
  playingMessageIdRef.current = playingMessageId

  const setAudioAvailable = useCallback((v: boolean) => setAudioAvailableState(v), [])

  const resetPlayback = useCallback(() => {
    setPlayingMessageId(null)
    setPlayingThreadId(null)
    setIsBuffering(false)
    setProgress(0)
    setRemainingSec(0)
  }, [])

  const getPlaybackEl = useCallback((): HTMLAudioElement => {
    if (!audioElRef.current) {
      const el = new Audio()
      // Audio actually started → leave the loading state.
      el.addEventListener('playing', () => setIsBuffering(false))
      el.addEventListener('timeupdate', () => {
        const d = el.duration
        if (Number.isFinite(d) && d > 0) {
          setProgress(el.currentTime / d)
          setRemainingSec(Math.max(0, d - el.currentTime))
        }
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
  }, [resetPlayback])

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
            notifications.show({
              title: 'Audio unavailable',
              message: 'Text-to-speech is not configured.',
              color: 'red',
            })
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
      audioAvailable,
      setAudioAvailable,
      primePlayback,
      readAloud,
      stop,
    }),
    [
      playingMessageId,
      playingThreadId,
      isBuffering,
      progress,
      remainingSec,
      audioAvailable,
      setAudioAvailable,
      primePlayback,
      readAloud,
      stop,
    ],
  )

  return <VoicePlaybackContext.Provider value={value}>{children}</VoicePlaybackContext.Provider>
}
