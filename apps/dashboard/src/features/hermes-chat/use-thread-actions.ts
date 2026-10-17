import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { api } from '../../lib/eden'
import { hermesMutations, hermesQueries } from '../../lib/queries/hermes'
import { notifyHermesChatError } from './hermes-transport'

// The verbs the API supports on a thread: pin (PATCH pinned), archive (PATCH archived) and delete.
// There is no bulk endpoint, so `removeAll` deletes sequentially through the per-thread path and
// stops at the first failure. Every verb ends in an invalidate so the list adopts the server row;
// a delete also drops the thread from the local store, which only ever upserts.
export function useThreadActions({ onRemoved }: { onRemoved: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: hermesQueries.all() })

  async function guarded(run: () => Promise<void>) {
    setBusy(true)
    try {
      await run()
    } catch (error) {
      notifyHermesChatError(error)
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const patch = (id: string, body: { pinned?: boolean; archived?: boolean }) =>
    guarded(async () => {
      unwrap(await api.hermes.threads({ id }).patch(body))
    })

  const remove = async (id: string) => {
    await hermesMutations.deleteThread().mutationFn(id)
    onRemoved(id)
  }

  return {
    busy,
    pin: (id: string, pinned: boolean) => patch(id, { pinned }),
    archive: (id: string) => patch(id, { archived: true }),
    remove: (id: string) => guarded(() => remove(id)),
    removeAll: (ids: readonly string[]) =>
      guarded(async () => {
        for (const id of ids) await remove(id)
      }),
  }
}
