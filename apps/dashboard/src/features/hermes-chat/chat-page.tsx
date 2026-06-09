import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ActionIcon, Box, Group, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { IconSend } from '@tabler/icons-react'
import { hermesMutations, hermesQueries, type HermesThread } from '../../lib/queries/hermes'
import { ThreadFeedRow } from './thread-feed-row'

// Single-column Slack-style thread feed, chat-anchored: the feed scrolls with the
// newest thread at the BOTTOM (older scroll up), and a single composer is pinned to
// the bottom of the viewport. Typing there STARTS a new chat — it creates a thread and
// auto-sends the message (no separate "new chat" click). Continuing an existing thread
// uses that thread's own inline composer once expanded.
// See docs/HERMES-CHAT-PRD.md + ChatWireframe.svg.

// Full-bleed chat surface: fill the whole main area and cancel AppShell.Main's `padding="md"`
// with a negative margin so the feed and composer sit flush to the edges (no inset frame).
const FILL_HEIGHT =
  'calc(100dvh - var(--app-shell-header-offset, 0rem) - var(--app-shell-footer-offset, 0rem))'
const BLEED_MARGIN = 'calc(var(--app-shell-padding) * -1)'

export function HermesChatPage() {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  // Seed message per freshly-created thread — consumed once by its ChatConversation.
  const [seeds, setSeeds] = useState<Record<string, string>>({})
  const pendingSeedRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data } = useSuspenseQuery(hermesQueries.threads('active'))
  const threads = data.data

  function scrollToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const create = useMutation({
    ...hermesMutations.createThread(),
    onSuccess: (thread: HermesThread) => {
      queryClient.setQueryData(hermesQueries.threads('active').queryKey, (old) =>
        old ? { data: [thread, ...old.data], total: old.total + 1 } : { data: [thread], total: 1 },
      )
      const seed = pendingSeedRef.current
      pendingSeedRef.current = null
      if (seed) setSeeds((prev) => ({ ...prev, [thread.id]: seed }))
      setExpandedId(thread.id)
      requestAnimationFrame(() => requestAnimationFrame(scrollToBottom))
    },
  })

  const remove = useMutation(hermesMutations.deleteThread())

  // Start pinned to the newest (bottom) thread, chat-style.
  useEffect(() => {
    scrollToBottom()
  }, [])

  // One-shot cleanup of empty/abandoned threads on load: a thread that never received a turn
  // still has `updated_at === created_at` (message persistence bumps updated_at). Threads
  // created this session always carry a seed message, so they're never caught here.
  const cleanedRef = useRef(false)
  useEffect(() => {
    if (cleanedRef.current) return
    cleanedRef.current = true
    const empties = threads.filter((t) => t.updated_at === t.created_at)
    if (empties.length === 0) return
    const emptyIds = new Set(empties.map((t) => t.id))
    queryClient.setQueryData(hermesQueries.threads('active').queryKey, (old) =>
      old
        ? {
            data: old.data.filter((t) => !emptyIds.has(t.id)),
            total: Math.max(0, old.total - empties.length),
          }
        : old,
    )
    void Promise.allSettled(empties.map((t) => remove.mutateAsync(t.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startChat() {
    const text = input.trim()
    if (!text || create.isPending) return
    setInput('')
    pendingSeedRef.current = text
    create.mutate({})
  }

  function consumeSeed(id: string) {
    setSeeds((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function toggleThread(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // Newest-first from the API → render reversed so the newest sits at the bottom.
  const ordered = threads.toReversed()

  return (
    <Stack h={FILL_HEIGHT} gap={0} style={{ margin: BLEED_MARGIN }}>
      <Box ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Stack gap={0} mih="100%" justify="flex-end">
          {ordered.length === 0 ? (
            <Text c="dimmed" size="sm" ta="center" py="xl">
              No threads yet. Type below to start.
            </Text>
          ) : (
            ordered.map((thread) => (
              <ThreadFeedRow
                key={thread.id}
                thread={thread}
                expanded={thread.id === expandedId}
                onToggle={() => toggleThread(thread.id)}
                autoSendText={seeds[thread.id]}
                onAutoSent={() => consumeSeed(thread.id)}
              />
            ))
          )}
        </Stack>
      </Box>

      <Box
        p="sm"
        style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
      >
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Textarea
            flex={1}
            autosize
            minRows={1}
            maxRows={6}
            placeholder="Message Hermes — starts a new chat…"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                startChat()
              }
            }}
          />
          <Tooltip label="Start chat" withArrow>
            <ActionIcon
              size={36}
              variant="filled"
              onClick={startChat}
              loading={create.isPending}
              disabled={!input.trim()}
              aria-label="Start new chat"
            >
              <IconSend size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>
    </Stack>
  )
}
