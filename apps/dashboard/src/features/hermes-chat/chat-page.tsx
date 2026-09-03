import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Center, Loader, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Composer, ThreadFeed } from 'basalt-ui/agent-chat'
import type { ComposerHandle, ComposerSubmit } from 'basalt-ui/agent-chat'
import { useAgentThreadRuns } from 'basalt-ui/agent'
import type { AgentThread } from 'basalt-ui/agent'
import { hermesQueries } from '../../lib/queries/hermes'
import { useUiStore } from '../../lib/store'
import { HermesRow } from './hermes-row'
import { HERMES_CHAT_FEATURES } from './features'
import { useVoicePlayback } from './voice/voice-playback'
import { useVoiceRecorder } from './voice/use-voice-recorder'
import { VoiceControls } from './voice/voice-controls'
import { RecordingIndicator } from './voice/recording-indicator'
import { useHermesThreads } from './threads-store'
import {
  hermesTransport,
  notifyHermesChatError,
  resolveHermesOutcome,
  stopHermesThread,
  isRejectedTurnError,
} from './hermes-transport'

// Title/summary polling cadence (mirrors the old client's 1.5s×6 window): Hermes' auto-title pass
// is fire-and-forget AFTER a turn finishes, so it can land after the run-finish invalidate below
// has already fired once. Repeatedly invalidating the threads-list query is where a just-landed
// server title/summary reaches `thread.meta` (threads-store.ts's `mergeServerThreads`).
const TITLE_POLL_DELAY_MS = 1500
const TITLE_POLL_ATTEMPTS = 6

// Single-column Slack-style thread feed, chat-anchored: the feed scrolls with the
// newest thread at the BOTTOM (older scroll up), and a single composer is pinned to
// the bottom of the viewport. Typing there STARTS a new chat — `store.create()` mints
// a client id synchronously and `runs.start()` sends immediately: no async
// create-then-effect chain to race (see docs/HERMES-CHAT-V2.md, D-E). Continuing an
// existing thread uses that thread's own inline composer once expanded.

// Full-bleed chat surface: fill the whole main area and cancel AppShell.Main's `padding="md"`
// with a negative margin so the feed and composer sit flush to the edges (no inset frame).
const FILL_HEIGHT =
  'calc(100dvh - var(--app-shell-header-offset, 0rem) - var(--app-shell-footer-offset, 0rem))'
const BLEED_MARGIN = 'calc(var(--app-shell-padding) * -1)'

// The playback provider is lifted to the app root so the header widget and every thread
// share ONE <audio> element — the key to iOS autoplay surviving navigation. The page is
// just the feed now.
export function HermesChatPage() {
  return <HermesChatFeed />
}

function isPinned(thread: AgentThread): boolean {
  return thread.meta?.pinned === true
}

// `store.threads` is newest-first (the store's own contract). Argo renders bottom-anchored,
// chat-style (oldest at top, newest at the bottom, nearest the composer) — so the base order is
// reversed. Pinned threads are the app's own "prioritize this" affordance (PATCH .../pinned,
// driven out-of-band from the store per the brief), and get the position closest to the composer:
// the pinned cluster renders LAST (bottom), each cluster internally oldest→newest.
function orderedFeed(threads: readonly AgentThread[]): AgentThread[] {
  const pinned: AgentThread[] = []
  const rest: AgentThread[] = []
  for (const thread of threads) (isPinned(thread) ? pinned : rest).push(thread)
  return [...rest.toReversed(), ...pinned.toReversed()]
}

// `useAgentThreadRuns`'s mount-time reconcile effect (the resume-after-reload path) now
// RE-SWEEPS whenever `store.hydrated` flips true (basalt 1.29 — MIGRATING.md's R3), not just at
// mount, so both hooks below are called UNCONDITIONALLY (rules-of-hooks) and only the RENDER is
// gated on hydration, below — no more separate mount-delaying wrapper component.
function HermesChatFeed() {
  const store = useHermesThreads()
  const queryClient = useQueryClient()
  const {
    runs,
    start,
    stop: stopRun,
  } = useAgentThreadRuns({
    transport: (threadId) => hermesTransport.forThread(threadId),
    store,
    resolveOutcome: resolveHermesOutcome,
    onError: ({ threadId, error }) => {
      if (isRejectedTurnError(error)) store.removeLastUserMessage(threadId)
      notifyHermesChatError(error)
    },
  })

  // D-A: always ask the server first and inspect `stopped` before touching local state.
  // `stopped: true` → the server genuinely aborted generation — run the local stop (keeps
  // whatever partial parts arrived, marks the turn 'stopped'). `stopped: false` (turn already
  // complete, or a network failure) → do nothing locally; the live stream — if still connected —
  // runs to its own real end, so nothing already generated is discarded or mislabeled.
  async function handleStop(threadId: string) {
    const result = await stopHermesThread(threadId)
    if (result?.stopped) stopRun(threadId)
  }

  // A thread's run entry is deleted from `runs` the moment it finishes (basalt's documented
  // contract — see UseAgentThreadRunsReturn's doc). That transition is the trigger to (a)
  // invalidate the thread's independent messages query so the just-persisted final message
  // replaces the optimistic overlay (see hermes-row.tsx / threads-store.ts's `mergeOptimisticMessages`
  // for why the store's own `thread.messages` is deliberately just that overlay, not the full
  // transcript), and (b) start polling the threads list for the server's async title/summary.
  const prevRunningRef = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const nowRunning = new Set(runs.keys())
    for (const id of prevRunningRef.current) {
      if (nowRunning.has(id)) continue
      void queryClient.invalidateQueries({ queryKey: hermesQueries.messages(id).queryKey })
      let attempts = 0
      const poll = (): void => {
        attempts += 1
        void queryClient.invalidateQueries({ queryKey: hermesQueries.all() })
        if (attempts < TITLE_POLL_ATTEMPTS) setTimeout(poll, TITLE_POLL_DELAY_MS)
      }
      setTimeout(poll, TITLE_POLL_DELAY_MS)
    }
    prevRunningRef.current = nowRunning
  }, [runs, queryClient])

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const composerRef = useRef<ComposerHandle>(null)

  // After an F5 mid-turn, `useAgentThreadRuns`'s mount-time reconcile resumes the live stream
  // (see hermes-transport.ts / basalt's own doc) but nothing else about the page changes — the row
  // stays collapsed with no visible cue besides the plain elapsed-time label. Auto-open the one
  // thread that's already streaming as of the FIRST hydration, so a resumed turn isn't silently
  // invisible until the user happens to click it. Same "one-time sweep of whatever was persisted"
  // contract as before, now keyed on `store.hydrated` flipping true instead of raw mount — this
  // component's hooks all run before the store has actually loaded (see the doc above), so a
  // mount-only `[]` effect would see an empty `store.threads` here. The `expandedId !== null` guard
  // means it never overrides an already-expanded row either (e.g. a `hermesIntent` `open` that
  // raced it).
  useEffect(() => {
    if (!store.hydrated || expandedId !== null) return
    const streaming = store.threads.filter((thread) => thread.status === 'streaming')
    if (streaming.length === 1 && streaming[0]) setExpandedId(streaming[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.hydrated])

  function startChatWith(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const id = store.create()
    setExpandedId(id)
    start(id, trimmed)
  }

  function handleComposerSubmit({ text }: ComposerSubmit) {
    startChatWith(text)
  }

  // Cross-app intent from the header widget: a `draft` seeds + starts a new chat, an `open`
  // expands the targeted thread. Keyed on the intent so it runs once per dispatch;
  // `consumeHermesIntent` reads-and-clears so it never re-fires.
  const hermesIntent = useUiStore((s) => s.hermesIntent)
  const consumeHermesIntent = useUiStore((s) => s.consumeHermesIntent)
  useEffect(() => {
    if (!hermesIntent) return
    const intent = consumeHermesIntent()
    if (!intent) return
    if (intent.type === 'draft') startChatWith(intent.text)
    else setExpandedId(intent.threadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hermesIntent])

  // ── Voice: master toggle + dictation that starts a chat ──────────────────────
  const voiceMode = useUiStore((s) => s.voiceMode)
  const toggleVoiceMode = useUiStore((s) => s.toggleVoiceMode)
  const { audioAvailable, setAudioAvailable, primePlayback } = useVoicePlayback()

  // Mirror voice mode into a ref for the recorder's async onResult. Assigned in render
  // (no effect) to avoid a frame of staleness.
  const voiceModeRef = useRef(voiceMode)
  voiceModeRef.current = voiceMode

  const {
    isRecording,
    isTranscribing,
    recordingMs,
    toggle: toggleRecording,
  } = useVoiceRecorder({
    setAudioAvailable,
    onPrime: primePlayback,
    onResult: (transcript) => {
      // Voice mode: dictation immediately starts a new chat (the new thread inherits
      // voice mode from the shared store and speaks its reply). Otherwise fill the
      // composer's draft so it can be reviewed before sending.
      if (voiceModeRef.current) startChatWith(transcript)
      else composerRef.current?.insertText(transcript)
    },
  })

  function toggleThread(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  if (!store.hydrated) {
    if (store.error !== undefined) {
      return (
        <Center h={FILL_HEIGHT}>
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="red"
            title="Couldn't load threads"
            maw={420}
          >
            {store.error instanceof Error ? store.error.message : 'Failed to load Hermes threads.'}
          </Alert>
        </Center>
      )
    }
    return (
      <Center h={FILL_HEIGHT}>
        <Loader />
      </Center>
    )
  }

  const ordered = orderedFeed(store.threads)

  return (
    <Stack h={FILL_HEIGHT} gap={0} style={{ margin: BLEED_MARGIN }}>
      <Box style={{ flex: 1, minHeight: 0 }}>
        {ordered.length === 0 ? (
          <Center h="100%">
            <Text c="dimmed" size="sm" ta="center" py="xl">
              No threads yet. Type below to start.
            </Text>
          </Center>
        ) : (
          <ThreadFeed
            threads={ordered}
            activeId={null}
            onSelect={() => {}}
            anchor="end"
            renderRow={(thread) => (
              <HermesRow
                thread={thread}
                expanded={thread.id === expandedId}
                onToggle={() => toggleThread(thread.id)}
                run={runs.get(thread.id)}
                onSend={(text) => start(thread.id, text)}
                onStop={() => void handleStop(thread.id)}
              />
            )}
          />
        )}
      </Box>

      <Box
        p="sm"
        style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
      >
        {isRecording && <RecordingIndicator recordingMs={recordingMs} />}
        <Composer
          ref={composerRef}
          onSubmit={handleComposerSubmit}
          draftKey="hermes-new-chat"
          placeholder={
            voiceMode ? 'Talk or type — starts a new chat…' : 'Message Hermes — starts a new chat…'
          }
          rightSection={
            HERMES_CHAT_FEATURES.audioTranscription ? (
              <VoiceControls
                voiceMode={voiceMode}
                onToggleVoiceMode={toggleVoiceMode}
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                audioAvailable={audioAvailable}
                onMicClick={toggleRecording}
              />
            ) : undefined
          }
        />
      </Box>
    </Stack>
  )
}
