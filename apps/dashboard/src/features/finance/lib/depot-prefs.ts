import { createPersistedState } from 'basalt-ui/state'

/** The built-in tabs the owner hid, on this device. Nothing of his is stored for them, so hiding is a preference. */
const useHiddenStored = createPersistedState<string[]>({
  key: 'depot-hidden-tabs',
  version: 1,
  initial: [],
})

export function useHiddenTabs(): [string[], (id: string, hidden: boolean) => void] {
  const [hidden, setHidden] = useHiddenStored()
  return [
    hidden,
    (id, hide) =>
      setHidden(hide ? [...hidden.filter((h) => h !== id), id] : hidden.filter((h) => h !== id)),
  ]
}

/** Whether the text labels of horizontal and vertical lines show on the depot chart, for every instrument. On by default. */
export const useLineLabels = createPersistedState<boolean>({
  key: 'depot-line-labels',
  version: 1,
  initial: true,
})

/** Whether the CBBI line shows under the Bitcoin chart. On by default. */
export const useCbbiLine = createPersistedState<boolean>({
  key: 'depot-cbbi-line',
  version: 1,
  initial: true,
})
