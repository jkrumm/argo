import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { allocateForms, type Gap, type GapForm } from './model'

/**
 * Reading order of the page's gap surfaces: the strip's cells, then the chart cards top to bottom.
 * The first surface in this order that shows a data gap prints the cadence sentence once.
 */
export const GAP_ORDER = {
  recovery: 0,
  load: 1,
  fitness: 2,
  acwrChart: 10,
  recoveryChart: 11,
  sleepChart: 12,
  bodyBatteryChart: 13,
  stressChart: 14,
  activitiesChart: 15,
  activityScoreChart: 16,
} as const

type Entries = ReadonlyMap<number, Gap>

/** The gaps the page's surfaces currently show, by reading order; each surface sets and clears its own. */
function createLedger() {
  let entries: Entries = new Map()
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    get: (): Entries => entries,
    set(order: number, gap: Gap | null) {
      const next = new Map(entries)
      if (gap === null) next.delete(order)
      else next.set(order, gap)
      entries = next
      for (const listener of listeners) listener()
    },
  }
}

const LedgerContext = createContext<ReturnType<typeof createLedger> | null>(null)

export function GapLedgerProvider({ children }: { children: ReactNode }) {
  const [ledger] = useState(createLedger)
  return <LedgerContext value={ledger}>{children}</LedgerContext>
}

/**
 * The form this surface prints for its gap: `allocateForms` over every surface registered on the
 * page plus this one. Surfaces register in a layout effect, so the corrected allocation commits
 * before paint and two surfaces never paint the full form together. Arrival order is the tradeoff:
 * a gap that arrives later but leads in reading order takes the full form from one already shown
 * (the cadence moves, it never repeats). Outside a provider the surface leads.
 */
export function useGapForm(order: number, gap: Gap | null | undefined): GapForm {
  const ledger = useContext(LedgerContext)
  const entries = useSyncExternalStore(ledger?.subscribe ?? noSubscribe, ledger?.get ?? noEntries)
  const short = gap?.short
  const full = gap?.full
  useLayoutEffect(() => {
    // Only a line that can carry the cadence competes for the slot.
    if (ledger === null || short === undefined || full === undefined || full === null) return
    ledger.set(order, { short, full })
    return () => ledger.set(order, null)
  }, [ledger, order, short, full])

  if (gap == null) return 'short'
  const merged = new Map(entries).set(order, gap)
  const orders = [...merged.keys()].toSorted((a, b) => a - b)
  const forms = allocateForms(orders.map((o) => merged.get(o)))
  return forms[orders.indexOf(order)] ?? 'short'
}

const EMPTY: Entries = new Map()
const noEntries = (): Entries => EMPTY
const noSubscribe = () => () => {}
