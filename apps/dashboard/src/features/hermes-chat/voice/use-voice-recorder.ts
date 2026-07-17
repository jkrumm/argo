import { useCallback, useEffect, useRef, useState } from 'react'
import { emit } from 'basalt-ui/notifications'
import { getToken } from '../../../lib/auth'
import { apiBase } from '../transport'
import { mimeToExt, pickRecordingMime } from './audio-utils'

type UseVoiceRecorderOpts = {
  /** Called with the transcript once STT returns. Caller decides what to do with it. */
  onResult: (text: string, durationMs: number) => void
  /** Invoked at record start, inside the user gesture, e.g. to prime playback for iOS. */
  onPrime?: () => void
  /** Reports audio backend availability: false on a 503, true on a successful transcription. */
  setAudioAvailable?: (v: boolean) => void
}

export type VoiceRecorder = {
  isRecording: boolean
  isTranscribing: boolean
  recordingMs: number
  /** Start if idle, stop if recording. */
  toggle: () => void
  stop: () => void
}

// Encapsulates the browser side of speech-to-text: getUserMedia → MediaRecorder →
// POST /ai/v1/audio/transcriptions, with a live level meter, elapsed timer and a
// best-effort screen wake lock. The transcript is handed back via `onResult`; this
// hook is deliberately ignorant of voice mode so both composers can reuse it.
export function useVoiceRecorder(opts: UseVoiceRecorderOpts): VoiceRecorder {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [recordingMs, setRecordingMs] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingStartRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep callbacks in refs so the recorder handlers stay stable across renders.
  const cbRef = useRef(opts)
  cbRef.current = opts

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const finishRecording = useCallback(async (chunks: Blob[], durationMs: number, mime: string) => {
    setIsTranscribing(true)
    try {
      const type = mime || 'audio/webm'
      const blob = new Blob(chunks, { type })
      const form = new FormData()
      form.append('file', blob, `recording.${mimeToExt(type)}`)
      const token = getToken()
      const res = await fetch(`${apiBase}/ai/v1/audio/transcriptions`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      })
      if (!res.ok) {
        if (res.status === 503) {
          cbRef.current.setAudioAvailable?.(false)
          emit(
            'chat:error',
            { message: 'Speech-to-text is not configured.' },
            { title: 'Audio unavailable' },
          )
        } else {
          // Any other non-OK status used to return silently — the user saw the
          // recording stop with nothing in the box and no idea why.
          emit(
            'chat:error',
            { message: `The speech service returned an error (${res.status}).` },
            { title: 'Transcription failed' },
          )
        }
        return
      }
      const json = (await res.json()) as { text?: string }
      const transcript = (json.text ?? '').trim()
      cbRef.current.setAudioAvailable?.(true)
      if (!transcript) {
        emit(
          'chat:warning',
          { message: "Didn't catch anything — try speaking again." },
          { title: 'Nothing transcribed' },
        )
        return
      }
      cbRef.current.onResult(transcript, durationMs)
    } catch {
      emit(
        'chat:error',
        { message: 'Could not transcribe audio.' },
        { title: 'Transcription failed' },
      )
    } finally {
      setIsTranscribing(false)
    }
  }, [])

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }, [])

  const start = useCallback(async () => {
    // Unlock playback within the user gesture so voice mode can auto-play the reply
    // later (iOS autoplay policy). No-op when already unlocked.
    cbRef.current.onPrime?.()
    if (!navigator.mediaDevices?.getUserMedia) {
      emit(
        'chat:error',
        { message: 'Your browser does not support audio recording.' },
        { title: 'Microphone unavailable' },
      )
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickRecordingMime()
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      const chunks: Blob[] = []
      recordingStartRef.current = Date.now()

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        const elapsed = Date.now() - recordingStartRef.current
        stopTimer()
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        void wakeLockRef.current?.release().catch(() => {})
        wakeLockRef.current = null
        void finishRecording(chunks, elapsed, recorder.mimeType || mime)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
      setRecordingMs(0)
      timerRef.current = setInterval(
        () => setRecordingMs(Date.now() - recordingStartRef.current),
        200,
      )

      // Best-effort: keep the screen awake while recording. Browsers suspend mic
      // capture once the page is hidden, so foreground-with-screen-on is the
      // realistic ceiling — the wake lock just stops the screen auto-sleeping.
      try {
        wakeLockRef.current = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        /* wake lock is non-essential */
      }
    } catch {
      emit(
        'chat:error',
        { message: 'Could not access your microphone.' },
        { title: 'Microphone unavailable' },
      )
    }
  }, [finishRecording, stopTimer])

  const toggle = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') stop()
    else void start()
  }, [start, stop])

  // Tear down any in-flight recording resources on unmount.
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (timerRef.current) clearInterval(timerRef.current)
      void wakeLockRef.current?.release().catch(() => {})
    }
  }, [])

  return { isRecording, isTranscribing, recordingMs, toggle, stop }
}
