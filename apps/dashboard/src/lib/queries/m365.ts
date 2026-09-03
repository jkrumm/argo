import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'

export type LabelKind = 'chat' | 'channel'

export type LabelUpsertBody = {
  sourceId: string
  kind: LabelKind
  label: string
  displayName?: string | null
  notes?: string | null
}

export const m365Queries = {
  all: () => ['m365'] as const,

  teams: () =>
    queryOptions({
      queryKey: [...m365Queries.all(), 'teams'] as const,
      queryFn: async () => unwrap(await api.m365.teams.get()),
      // Teams membership rarely changes — give it a generous staleTime.
      staleTime: 5 * 60_000,
    }),

  channels: (teamId: string) =>
    queryOptions({
      queryKey: [...m365Queries.all(), 'teams', teamId, 'channels'] as const,
      queryFn: async () => unwrap(await api.m365.teams({ teamId }).channels.get()),
      staleTime: 5 * 60_000,
      enabled: teamId.length > 0,
    }),

  channelMessages: (teamId: string, channelId: string, top = 20) =>
    queryOptions({
      queryKey: [...m365Queries.all(), 'channels', teamId, channelId, 'messages', top] as const,
      queryFn: async () =>
        unwrap(
          await api.m365.teams({ teamId }).channels({ channelId }).messages.get({
            query: { top },
          }),
        ),
      staleTime: 30_000,
      enabled: teamId.length > 0 && channelId.length > 0,
    }),

  chats: (top = 50) =>
    queryOptions({
      queryKey: [...m365Queries.all(), 'chats', top] as const,
      queryFn: async () => unwrap(await api.m365.chats.get({ query: { top } })),
      staleTime: 60_000,
    }),

  chatMessages: (chatId: string, top = 20) =>
    queryOptions({
      queryKey: [...m365Queries.all(), 'chats', chatId, 'messages', top] as const,
      queryFn: async () =>
        unwrap(await api.m365.chats({ chatId }).messages.get({ query: { top } })),
      staleTime: 30_000,
      enabled: chatId.length > 0,
    }),

  labels: (label?: string) =>
    queryOptions({
      queryKey: [...m365Queries.all(), 'labels', label ?? null] as const,
      queryFn: async () => unwrap(await api.m365.labels.get({ query: label ? { label } : {} })),
      staleTime: 10_000,
    }),

  important: (params: { label?: string; top?: number; limit?: number }) =>
    queryOptions({
      queryKey: [...m365Queries.all(), 'important', params] as const,
      queryFn: async () => unwrap(await api.m365.important.get({ query: params })),
      staleTime: 30_000,
    }),
}

export const m365Mutations = {
  upsertLabel: () => ({
    mutationFn: (body: LabelUpsertBody) => api.m365.labels.post(body).then(unwrap),
  }),
  deleteLabel: () => ({
    mutationFn: (sourceId: string) => api.m365.labels({ sourceId }).delete().then(unwrap),
  }),
  renameTag: () => ({
    mutationFn: ({ tag, to }: { tag: string; to: string }) =>
      api.m365.tags({ tag }).patch({ to }).then(unwrap),
  }),
  deleteTag: () => ({
    mutationFn: (tag: string) => api.m365.tags({ tag }).delete().then(unwrap),
  }),
}
