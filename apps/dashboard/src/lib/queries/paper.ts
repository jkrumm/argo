import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { api } from '../eden'

type DataOf<T extends Promise<{ data: unknown }>> = NonNullable<Awaited<T>['data']>

export type ScanStatus = DataOf<ReturnType<typeof api.paper.scan.status.get>>
export type Inbox = DataOf<ReturnType<typeof api.paper.inbox.get>>
export type ReviewEntry = Inbox['review'][number]
export type DocsIndex = DataOf<ReturnType<typeof api.paper.docs.get>>
export type ScanMode = 'feeder' | 'fronts' | 'backs' | 'flatbed' | 'more'
export type DecideBody = NonNullable<
  Parameters<ReturnType<typeof api.paper.inbox>['decide']['post']>[0]
>

/** A running scan is polled every 2 s; an idle page re-reads now and then (a scan may start elsewhere). */
const SCANNING_MS = 2000
const IDLE_MS = 15_000

export const isScanning = (status: ScanStatus | undefined): boolean =>
  status?.progress != null || status?.pending?.scanning === true

/** The API's own words for a failed call (`{ error }`), else a plain fallback. */
export function paperError(error: unknown): string {
  const value = (error as { value?: { error?: unknown } } | null)?.value
  if (typeof value?.error === 'string') return value.error
  return error instanceof Error ? error.message : 'The call failed'
}

export const paperQueries = {
  all: () => ['paper'] as const,
  scanStatus: () =>
    queryOptions({
      queryKey: [...paperQueries.all(), 'scan-status'] as const,
      queryFn: async () => unwrap(await api.paper.scan.status.get()),
      refetchInterval: (query) => (isScanning(query.state.data) ? SCANNING_MS : IDLE_MS),
    }),
  inbox: () =>
    queryOptions({
      queryKey: [...paperQueries.all(), 'inbox'] as const,
      queryFn: async () => unwrap(await api.paper.inbox.get()),
      refetchInterval: 60_000,
    }),
  /** The document index: where the review form's suggestions (kinds, issuers) come from. */
  index: () =>
    queryOptions({
      queryKey: [...paperQueries.all(), 'docs-index'] as const,
      queryFn: async () => unwrap(await api.paper.docs.get({ query: { limit: 1000 } })),
      staleTime: 10 * 60_000,
    }),
}

/** The scanner moves only on these calls, and only from a person's tap. */
export function useScanCalls() {
  const queryClient = useQueryClient()
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: paperQueries.scanStatus().queryKey })
  const settle = { onSettled: refresh }
  return {
    start: useMutation({
      mutationFn: async (mode: ScanMode) => unwrap(await api.paper.scan.start.post({ mode })),
      ...settle,
    }),
    submit: useMutation({
      mutationFn: async (force: boolean) => unwrap(await api.paper.scan.submit.post({ force })),
      onSettled: async () => {
        await refresh()
        await queryClient.invalidateQueries({ queryKey: paperQueries.inbox().queryKey })
      },
    }),
    discard: useMutation({
      mutationFn: async () => unwrap(await api.paper.scan.discard.post()),
      ...settle,
    }),
  }
}

/** Decide one review file; the item leaves the list at once, the pipeline files it on its next run. */
export function useDecide() {
  const queryClient = useQueryClient()
  const key = paperQueries.inbox().queryKey
  return useMutation({
    mutationFn: async ({ name, body }: { name: string; body: DecideBody }) =>
      unwrap(await api.paper.inbox({ name }).decide.post(body)),
    onSuccess: (_result, { name }) => {
      queryClient.setQueryData<Inbox>(
        key,
        (inbox) => inbox && { ...inbox, review: inbox.review.filter((item) => item.name !== name) },
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
