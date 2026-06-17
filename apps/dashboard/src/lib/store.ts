import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// A one-shot navigation intent handed from the global Hermes widget to the chat
// page: either prefill the composer with a draft, or open an existing thread.
// Consumed once on arrival and cleared — never persisted (it's transient routing).
export type HermesIntent = { type: 'draft'; text: string } | { type: 'open'; threadId: string }

type UiState = {
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebar: () => void
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
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
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
    }),
    {
      name: 'argo-ui',
      // Only the durable UI prefs persist — hermesIntent is transient routing state.
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, voiceMode: s.voiceMode }),
    },
  ),
)
