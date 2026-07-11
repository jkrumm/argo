import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// A one-shot navigation intent handed from the global Hermes widget to the chat
// page: either prefill the composer with a draft, or open an existing thread.
// Consumed once on arrival and cleared — never persisted (it's transient routing).
export type HermesIntent = { type: 'draft'; text: string } | { type: 'open'; threadId: string }

type UiState = {
  // Hermes Chat voice mode: when on, dictated messages auto-send and replies are
  // spoken back (a short summary). Persisted so the master toggle survives reloads
  // and is shared across the feed composer and every open thread.
  voiceMode: boolean
  setVoiceMode: (v: boolean) => void
  toggleVoiceMode: () => void
  hermesIntent: HermesIntent | null
  setHermesIntent: (i: HermesIntent) => void
  // Returns the current intent then clears it, so the chat page consumes it once.
  consumeHermesIntent: () => HermesIntent | null
  // Show active tool names/emojis in the "working…" pill during streaming.
  // When off, the pill shows only a quiet "working…" + spinner. Persisted.
  showToolProgress: boolean
  setShowToolProgress: (v: boolean) => void
  toggleShowToolProgress: () => void
  // Persisted playback rate for the podcast audio player (0.75/1/1.25/1.5/2).
  playbackRate: number
  setPlaybackRate: (v: number) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      voiceMode: false,
      setVoiceMode: (v) => set({ voiceMode: v }),
      toggleVoiceMode: () => set((s) => ({ voiceMode: !s.voiceMode })),
      hermesIntent: null,
      setHermesIntent: (i) => set({ hermesIntent: i }),
      consumeHermesIntent: () => {
        const current = get().hermesIntent
        if (current) set({ hermesIntent: null })
        return current
      },
      showToolProgress: true,
      setShowToolProgress: (v) => set({ showToolProgress: v }),
      toggleShowToolProgress: () => set((s) => ({ showToolProgress: !s.showToolProgress })),
      playbackRate: 1,
      setPlaybackRate: (v) => set({ playbackRate: v }),
    }),
    {
      name: 'argo-ui',
      // Only the durable UI prefs persist — hermesIntent is transient routing state.
      partialize: (s) => ({
        voiceMode: s.voiceMode,
        showToolProgress: s.showToolProgress,
        playbackRate: s.playbackRate,
      }),
    },
  ),
)
