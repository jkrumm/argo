import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { financeGet, financeWrite } from './client'
import { DEPOT_KEY } from './queries'
import type {
  Backfill,
  BoardEntry,
  SearchHit,
  WatchBoard,
  WatchList,
  WatchListWrite,
} from './types'
import { movedEntries } from '../lib/depot-nav'

const LISTS_KEY = [...DEPOT_KEY, 'lists'] as const
const WATCHLIST_KEY = [...DEPOT_KEY, 'watchlist'] as const
const BOARD_KEY = [...DEPOT_KEY, 'board'] as const

/** Every watchlist of the market store, in order. Answers while the vault is locked. */
export const useLists = () =>
  useQuery({
    queryKey: LISTS_KEY,
    queryFn: () => financeGet<WatchList[]>('/market/lists'),
    staleTime: 60_000,
  })

/** Instruments, coins and series that match `q`; the caller debounces it. Nothing is fetched under two characters. */
export const useSearch = (q: string) => {
  const term = q.trim()
  return useQuery({
    queryKey: [...DEPOT_KEY, 'search', term],
    queryFn: () => financeGet<SearchHit[]>('/market/search', { q: term, limit: 20 }),
    enabled: term.length >= 2,
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  })
}

/**
 * The key figures of the entries of one or more lists (day to year, distance from the high), each symbol once, in the
 * order the lists give them. The depot and crypto boards read every list and keep the rows they need.
 */
export function useBoards(listIds: readonly number[]) {
  const boards = useQueries({
    queries: listIds.map((id) => ({
      queryKey: [...BOARD_KEY, id],
      queryFn: () => financeGet<WatchBoard>(`/market/lists/${id}/board`),
      staleTime: 60_000,
    })),
  })
  const seen = new Set<string>()
  const entries: BoardEntry[] = []
  for (const board of boards) {
    for (const entry of board.data?.entries ?? []) {
      if (seen.has(entry.symbol)) continue
      seen.add(entry.symbol)
      entries.push(entry)
    }
  }
  const failure = boards.find((board) => board.error !== null)?.error ?? null
  return {
    entries,
    /** The boards as one query for a table: no data until every board answered. */
    query: {
      data: boards.some((board) => board.isPending) ? undefined : entries,
      isError: failure !== null,
      error: failure,
      fetchStatus: boards.some((board) => board.isFetching)
        ? ('fetching' as const)
        : ('idle' as const),
      refetch: () => Promise.all(boards.map((board) => board.refetch())),
    },
  }
}

/**
 * Where the history load of an ISIN stands. It polls while the service is loading and stops at `done` or
 * `failed`; the moment bars exist the lists, the watchlist and the candles refetch, so the entry turns into a chart.
 * `missing` says the row has no bars yet.
 */
export function useBackfill(symbol: string | null, missing: boolean) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: [...DEPOT_KEY, 'backfill', symbol],
    queryFn: () => financeGet<Backfill>('/market/backfill', { symbol: symbol ?? undefined }),
    enabled: symbol !== null,
    staleTime: 0,
    refetchInterval: (q) =>
      q.state.data?.state === 'queued' || q.state.data?.state === 'running' ? 1500 : false,
  })
  const state = query.data?.state
  const was = useRef(state)
  useEffect(() => {
    const finished = state === 'done' && (was.current !== 'done' || missing)
    was.current = state
    if (!finished || symbol === null) return
    void queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY })
    void queryClient.invalidateQueries({ queryKey: LISTS_KEY })
    void queryClient.invalidateQueries({ queryKey: BOARD_KEY })
    void queryClient.invalidateQueries({ queryKey: [...DEPOT_KEY, 'candles'] })
  }, [state, missing, symbol, queryClient])
  return query
}

type ListDelete = { deleted: number }

/**
 * The watchlist writes (`POST /finance/api/market/lists…`). A write answers the whole list, which replaces
 * it in the cache at once; the watchlist rows refetch behind it. A move shows at once and settles on the
 * answer. Failures throw: the caller reports them.
 */
export function useListWrites() {
  const queryClient = useQueryClient()

  const replaceList = (list: WatchList) =>
    queryClient.setQueryData<WatchList[]>(LISTS_KEY, (old) => {
      if (old === undefined) return [list]
      if (!old.some((l) => l.id === list.id)) return [...old, list]
      return old.map((l) => (l.id === list.id ? list : l))
    })

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY })
    await queryClient.invalidateQueries({ queryKey: LISTS_KEY })
    await queryClient.invalidateQueries({ queryKey: BOARD_KEY })
  }

  const settle = async <T extends WatchList>(list: T): Promise<T> => {
    replaceList(list)
    await refresh()
    return list
  }

  const write = async <T extends WatchList = WatchList>(path: string, body: object): Promise<T> =>
    settle(await financeWrite<T>(path, body))

  /** Lists are re-read when a move failed, so the cache never keeps an order the service refused. */
  const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (failure) {
      await queryClient.invalidateQueries({ queryKey: LISTS_KEY })
      throw failure
    }
  }

  return {
    createList: (name: string) => write('/market/lists', { name }),
    renameList: (id: number, name: string) => write(`/market/lists/${id}`, { name }),
    moveList: (id: number, position: number) =>
      guarded(() => write(`/market/lists/${id}`, { position })),
    async deleteList(id: number): Promise<void> {
      await financeWrite<ListDelete>(`/market/lists/${id}/delete`, {})
      queryClient.setQueryData<WatchList[]>(LISTS_KEY, (old) => old?.filter((l) => l.id !== id))
      await refresh()
    },
    addEntry: (listId: number, entry: { symbol: string; display_name?: string }) =>
      write<WatchListWrite>(`/market/lists/${listId}/entries`, entry),
    renameEntry: (listId: number, symbol: string, display_name: string | null) =>
      write(`/market/lists/${listId}/entries/${encodeURIComponent(symbol)}`, { display_name }),
    moveEntry: (listId: number, symbol: string, position: number) => {
      queryClient.setQueryData<WatchList[]>(LISTS_KEY, (old) =>
        old?.map((l) =>
          l.id === listId ? { ...l, entries: movedEntries(l.entries, symbol, position) } : l,
        ),
      )
      return guarded(() =>
        write(`/market/lists/${listId}/entries/${encodeURIComponent(symbol)}`, { position }),
      )
    },
    removeEntry: (listId: number, symbol: string) =>
      write(`/market/lists/${listId}/entries/${encodeURIComponent(symbol)}/delete`, {}),
  }
}
