import { useEffect, useRef } from 'react'
import type { AgentPart, ThreadRunState, TranscriptPart } from 'basalt-ui/agent'
import { useUiStore } from '../../lib/store'
import { isLiveRun } from './run-liveness'
import { useVoicePlayback } from './voice/voice-playback'

// Auto-speak a finished reply, deferred while backgrounded — the half of the per-thread voice hook
// that must not depend on which thread's view is open. One `ThreadSpeaker` is mounted per thread
// (chat-page.tsx), as the per-thread rows were before the list/thread split, so a reply that
// finishes in a thread nobody has open is still spoken in voice mode.

function joinTextParts(parts: readonly TranscriptPart[]): string {
  let out = ''
  for (const part of parts) {
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') out += part.text
  }
  return out
}

function useAutoSpeak({
  threadId,
  run,
}: {
  threadId: string
  run: ThreadRunState<AgentPart> | undefined
}) {
  const isStreaming = isLiveRun(run)
  const voiceMode = useUiStore((s) => s.voiceMode)
  const { readAloud } = useVoicePlayback()
  const voiceModeRef = useRef(voiceMode)
  useEffect(() => {
    voiceModeRef.current = voiceMode
  }, [voiceMode])

  // ── Voice: auto-speak a finished reply, deferred while backgrounded ──────────
  const lastLiveTextRef = useRef('')
  useEffect(() => {
    if (run) lastLiveTextRef.current = joinTextParts(run.parts)
  }, [run])

  const pendingSpeakRef = useRef<string | null>(null)
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    const justFinished = wasStreamingRef.current && !isStreaming
    wasStreamingRef.current = isStreaming
    if (!justFinished || !voiceModeRef.current) return
    const text = lastLiveTextRef.current.trim()
    if (!text) return
    // Auto-pause: while Argo is backgrounded, defer instead of speaking — the visibilitychange
    // effect below replays it on return.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      pendingSpeakRef.current = text
      return
    }
    void readAloud(`${threadId}:live`, text, { summarize: true, threadId })
  }, [isStreaming, readAloud, threadId])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const pending = pendingSpeakRef.current
      pendingSpeakRef.current = null
      if (!pending || !voiceModeRef.current) return
      void readAloud(`${threadId}:live`, pending, { summarize: true, threadId })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [readAloud, threadId])
}

/** Renders nothing; speaks the thread's finished reply while voice mode is on. */
export function ThreadSpeaker({
  threadId,
  run,
}: {
  threadId: string
  run: ThreadRunState<AgentPart> | undefined
}) {
  useAutoSpeak({ threadId, run })
  return null
}
