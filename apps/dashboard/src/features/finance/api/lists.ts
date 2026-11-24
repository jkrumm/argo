import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { financeGet, financeWrite } from './client'
import { DEPOT_KEY } from './queries'
import type { SearchHit, WatchList } from './types'

const LISTS_KEY = [...DEPOT_KEY, 'lists'] as const
const WATCHLIST_KEY = [...DEPOT_KEY, 'watchlist'] as const

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
    queryFn: () => financeGet<SearchHit[]>('/market/search', { q: term, limit: 12 }),
    enabled: term.length >= 2,
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  })
}

type ListDelete = { deleted: number }

/**
 * The watchlist writes (`POST /finance/api/market/lists…`). A write answers the whole list, which replaces
 * it in the cache at once; the watchlist rows refetch behind it. Failures throw: the caller reports them.
 */
export function useListWrites() {
  const queryClient = useQueryClient()

  const replaceList = (list: WatchList) =>
    queryClient.setQueryData<WatchList[]>(LISTS_KEY, (old) => {
      if (old === undefined) return [list]
      if (!old.some((l) => l.id === list.id)) return [...old, list]
      return old.map((l) => (l.id === list.id ? list : l))
    })

  const settle = async (list: WatchList) => {
    replaceList(list)
    await queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY })
    await queryClient.invalidateQueries({ queryKey: LISTS_KEY })
    return list
  }

  const write = async (path: string, body: object): Promise<WatchList> =>
    settle(await financeWrite<WatchList>(path, body))

  return {
    createList: (name: string) => write('/market/lists', { name }),
    renameList: (id: number, name: string) => write(`/market/lists/${id}`, { name }),
    async deleteList(id: number): Promise<void> {
      await financeWrite<ListDelete>(`/market/lists/${id}/delete`, {})
      queryClient.setQueryData<WatchList[]>(LISTS_KEY, (old) => old?.filter((l) => l.id !== id))
      await queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY })
      await queryClient.invalidateQueries({ queryKey: LISTS_KEY })
    },
    addEntry: (listId: number, entry: { symbol: string; display_name?: string }) =>
      write(`/market/lists/${listId}/entries`, entry),
    renameEntry: (listId: number, symbol: string, display_name: string | null) =>
      write(`/market/lists/${listId}/entries/${encodeURIComponent(symbol)}`, { display_name }),
    removeEntry: (listId: number, symbol: string) =>
      write(`/market/lists/${listId}/entries/${encodeURIComponent(symbol)}/delete`, {}),
  }
}
