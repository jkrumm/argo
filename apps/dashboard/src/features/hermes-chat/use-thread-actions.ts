import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { EdenFetchError } from '@elysiajs/eden'
import { unwrap } from 'basalt-ui'
import { emit } from 'basalt-ui/commands'
import { api } from '../../lib/eden'
import { hermesQueries } from '../../lib/queries/hermes'
import { notifyHermesChatError } from './hermes-transport'

// The verbs the API supports on a thread: pin (PATCH pinned), archive/unarchive (PATCH archived)
// and delete. There is no bulk endpoint, so `removeAll` deletes sequentially through the per-thread
// path and stops at the first failure, telling the user how far it got. Every verb resolves to
// whether it succeeded (callers navigate away only on success) and ends in an invalidate so the
// list adopts the server row; a delete also drops the thread from the local store, which only ever
// upserts.
export function useThreadActions({ onRemoved }: { onRemoved: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: hermesQueries.all() })

  async function guarded(
    run: () => Promise<void>,
    onError: (error: unknown) => void = notifyHermesChatError,
  ): Promise<boolean> {
    setBusy(true)
    try {
      await run()
      return true
    } catch (error) {
      onError(error)
      return false
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const patch = (id: string, body: { pinned?: boolean; archived?: boolean }) =>
    guarded(async () => {
      unwrap(await api.hermes.threads({ id }).patch(body))
    })

  // A 404 means the server no longer has the thread: it is gone either way, so drop it locally
  // (otherwise a server-gone thread would fail "Delete all" for good).
  const remove = async (id: string) => {
    const result = await api.hermes.threads({ id }).delete()
    if (result.error && !(result.error instanceof EdenFetchError && result.error.status === 404)) {
      throw result.error
    }
    onRemoved(id)
  }

  return {
    busy,
    pin: (id: string, pinned: boolean) => patch(id, { pinned }),
    setArchived: (id: string, archived: boolean) => patch(id, { archived }),
    remove: (id: string) => guarded(() => remove(id)),
    removeAll: (ids: readonly string[]) => {
      let deleted = 0
      return guarded(
        async () => {
          for (const id of ids) {
            await remove(id)
            deleted += 1
          }
        },
        (error) => {
          notifyHermesChatError(error)
          emit(
            'chat:error',
            { message: `Deleted ${deleted} of ${ids.length} untitled chats before it failed.` },
            { title: 'Delete stopped' },
          )
        },
      )
    },
  }
}
