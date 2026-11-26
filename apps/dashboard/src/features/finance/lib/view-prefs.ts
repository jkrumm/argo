import { createPersistedState } from 'basalt-ui/state'

/** What the owner chose for one instrument's chart; unset means the default for its kind. */
export type ViewPrefs = {
  log?: boolean
  volume?: boolean
  currency?: 'USD' | 'EUR'
  /** `direct`: ING Direkthandel's own daily bars instead of the exchange's. */
  venue?: 'exchange' | 'direct'
}

type Stored = Record<string, ViewPrefs>

/** Per instrument, on this device: the price scale, the turnover pane, the venue and the currency of a dollar chart. No vault data, only which chart he likes. */
const useStored = createPersistedState<Stored>({
  key: 'depot-view',
  version: 1,
  initial: {},
})

/** The chart view of one instrument and the setter for a part of it. */
export function useViewPrefs(isin: string): [ViewPrefs, (patch: ViewPrefs) => void] {
  const [stored, setStored] = useStored()
  return [
    stored[isin] ?? {},
    (patch) => setStored({ ...stored, [isin]: { ...stored[isin], ...patch } }),
  ]
}
