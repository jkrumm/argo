import type { ScanStatus } from '../../../lib/queries/paper'

type Part = NonNullable<ScanStatus['pending']>['parts'][number]
type Action = ScanStatus['actions'][number]

/** A scanned part with `pages` pages; synthetic, no file behind it. */
export const part = (mode: string, pages: number, at = 1000): Part => ({
  mode,
  fileName: `synthetic-${mode}.pdf`,
  pages,
  at,
  thumbUrls: Array.from({ length: pages }, (_, page) => `/paper/scan/pages/0/${page}`),
  pageUrls: Array.from({ length: pages }, (_, page) => `/paper/scan/pages/0/${page}?size=page`),
})

const action = (id: string, group = 'main'): Action => ({ id, group, command: `paper ${id}` })

/** The allowed actions per state, as `paper scan status` lists them (paper's `scan/flow.ts`). */
export const FLOW = {
  idle: ['scan-document', 'scan-fronts', 'scan-flatbed'].map((id) => action(id)),
  scanning: [action('open-log', 'footer'), action('refresh', 'footer')],
  fronts: ['scan-backs', 'scan-more', 'submit-fronts', 'discard'].map((id) => action(id)),
  pair: ['submit', 'scan-more', 'discard'].map((id) => action(id)),
  single: [
    ...['submit', 'scan-more', 'discard'].map((id) => action(id)),
    ...['scan-document', 'scan-fronts', 'scan-flatbed'].map((id) => action(id, 'new-scan')),
    action('open-log', 'footer'),
  ],
}

export const status = (over: Partial<ScanStatus> & Pick<ScanStatus, 'actions'>): ScanStatus => ({
  pending: null,
  progress: null,
  lastResult: null,
  ...over,
})

const pending = (parts: Part[], extra: { needsAttention?: boolean; attention?: string } = {}) => ({
  parts,
  scanning: false,
  needsAttention: extra.needsAttention ?? false,
  attention: extra.attention ?? null,
})

export const SCAN_STATES = {
  idle: status({ actions: FLOW.idle }),
  scanning: status({
    actions: FLOW.scanning,
    progress: { mode: 'feeder', page: 7, startedAt: 1000, pid: 1 },
  }),
  pending: status({ actions: FLOW.single, pending: pending([part('feeder', 12)]) }),
  frontsPending: status({ actions: FLOW.fronts, pending: pending([part('fronts', 8)]) }),
  pairPending: status({
    actions: FLOW.pair,
    pending: pending([part('fronts', 8), part('backs', 8, 2000)]),
  }),
  pairMismatch: status({
    actions: FLOW.pair,
    pending: pending([part('fronts', 8), part('backs', 7, 2000)]),
  }),
  failedBatch: status({
    actions: FLOW.idle,
    lastResult: {
      at: 5000,
      action: 'feeder',
      ok: false,
      message: 'Scan stopped: all 6 pages look blank. Stack upside down?',
      pages: null,
    },
  }),
  failedMore: status({
    actions: FLOW.single,
    pending: pending([part('feeder', 12)], {
      needsAttention: true,
      attention: 'The scanner cancelled the scan (the feeder did not pick up the paper).',
    }),
  }),
} satisfies Record<string, ScanStatus>
