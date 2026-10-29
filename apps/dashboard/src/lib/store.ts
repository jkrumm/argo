import { create } from 'zustand'

// A one-shot navigation intent handed from the global Hermes widget to the chat
// page: either prefill the composer with a draft, or open an existing thread.
// Consumed once on arrival and cleared — never persisted (it's transient routing).
export type HermesIntent = { type: 'draft'; text: string } | { type: 'open'; threadId: string }

type UiState = {
  hermesIntent: HermesIntent | null
  setHermesIntent: (i: HermesIntent) => void
  // Returns the current intent then clears it, so the chat page consumes it once.
  consumeHermesIntent: () => HermesIntent | null
}

// The store used to persist `voiceMode` / `playbackRate` under `argo-ui`. Nothing durable is
// left, so it no longer persists; drop the orphaned key from browsers that still carry it.
if (typeof localStorage !== 'undefined') localStorage.removeItem('argo-ui')

export const useUiStore = create<UiState>()((set, get) => ({
  hermesIntent: null,
  setHermesIntent: (i) => set({ hermesIntent: i }),
  consumeHermesIntent: () => {
    const current = get().hermesIntent
    if (current) set({ hermesIntent: null })
    return current
  },
}))
