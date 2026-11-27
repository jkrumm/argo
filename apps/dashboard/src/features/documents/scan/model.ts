import type { ScanMode, ScanStatus } from '../../../lib/queries/paper'

export type ScanPhase = 'idle' | 'scanning' | 'fronts' | 'pair' | 'pending'

/** What the owner is asked before a button acts. */
export type Confirm = { title: string; body: string; confirmLabel: string; danger?: boolean }

export type ScanButton = {
  id: string
  label: string
  hint?: string
  primary: boolean
  /** Exactly one of these is set: start a scan, file the pending one, or drop it. */
  mode?: ScanMode
  submit?: { force: boolean }
  discard?: true
  confirm?: Confirm
}

export type ScanThumb = {
  key: string
  part: number
  page: number
  label: string
  /** The part's scan time: a new scan reuses part and page numbers, so the image cache keys on it. */
  version: number
  thumbUrl: string | null
  pageUrl: string
}

export type ScanRow = { label: string; value: string; bad: boolean }

export type ScanView = {
  phase: ScanPhase
  /** The big figure: `12`, or `8 + 8` for fronts and backs; the running page while a scan runs. */
  figure: string | null
  caption: string | null
  rows: ScanRow[]
  mismatch: string | null
  failure: { key: string; message: string; needsForce: boolean } | null
  thumbs: ScanThumb[]
  buttons: ScanButton[]
}

const START: Record<string, { mode: ScanMode; label: string; hint?: string }> = {
  'scan-document': { mode: 'feeder', label: 'Document', hint: 'Feeder, both sides' },
  'scan-fronts': { mode: 'fronts', label: 'Fronts', hint: 'Feeder, front sides first' },
  'scan-flatbed': { mode: 'flatbed', label: 'Flatbed', hint: 'One sheet on the glass' },
  'scan-backs': { mode: 'backs', label: 'Scan Backs', hint: 'Flip the stack' },
  'scan-more': { mode: 'more', label: 'Scan More', hint: 'Add pages to this scan' },
}

const SCAN_MODES = new Set(['feeder', 'fronts', 'backs', 'flatbed', 'more'])

const pages = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`

/** Words for fronts and backs that disagree; null when they match or there are no backs yet. */
export function sidesMismatch(fronts: number, backs: number): string | null {
  if (fronts === backs) return null
  const gap = Math.abs(fronts - backs)
  return backs < fronts
    ? `Fronts have ${pages(fronts)}, backs only ${backs}: ${pages(gap)} missing on the backs.`
    : `Backs have ${pages(backs)}, fronts only ${fronts}: ${pages(gap)} missing on the fronts.`
}

function phaseOf(status: ScanStatus): ScanPhase {
  if (status.progress != null || status.pending?.scanning) return 'scanning'
  const parts = status.pending?.parts ?? []
  if (parts.length === 0) return 'idle'
  if (parts[0]?.mode !== 'fronts') return 'pending'
  return parts[1]?.mode === 'backs' ? 'pair' : 'fronts'
}

function thumbsOf(status: ScanStatus, phase: ScanPhase): ScanThumb[] {
  const parts = status.pending?.parts ?? []
  return parts.flatMap((part, partIndex) =>
    part.pageUrls.map((pageUrl, page) => {
      const side = part.mode === 'fronts' ? 'Front' : part.mode === 'backs' ? 'Back' : 'Page'
      const number =
        phase === 'pair' || part.mode === 'fronts' || part.mode === 'backs'
          ? page + 1
          : status.pending!.parts.slice(0, partIndex).reduce((sum, p) => sum + p.pages, 0) +
            page +
            1
      return {
        key: `${partIndex}-${page}-${part.at}`,
        part: partIndex,
        page,
        label: `${side} ${number}`,
        version: part.at,
        thumbUrl: part.thumbUrls[page] ?? null,
        pageUrl,
      }
    }),
  )
}

function failureOf(status: ScanStatus, phase: ScanPhase): ScanView['failure'] {
  if (phase === 'scanning') return null
  const attention = status.pending?.attention
  if (status.pending?.needsAttention && attention) {
    return { key: `attention-${attention}`, message: attention, needsForce: true }
  }
  const last = status.lastResult
  if (last && !last.ok && SCAN_MODES.has(last.action)) {
    return { key: `last-${last.at}`, message: last.message, needsForce: false }
  }
  return null
}

function buttonsOf(
  status: ScanStatus,
  phase: ScanPhase,
  view: Pick<ScanView, 'mismatch' | 'failure'>,
): ScanButton[] {
  const parts = status.pending?.parts ?? []
  const total = parts.reduce((sum, part) => sum + part.pages, 0)
  const buttons: ScanButton[] = []
  for (const action of status.actions) {
    if (action.group !== 'main') continue
    const start = START[action.id]
    if (start) {
      const primary = phase === 'idle' ? action.id === 'scan-document' : action.id === 'scan-backs'
      buttons.push({
        id: action.id,
        label: start.label,
        ...(start.hint && { hint: start.hint }),
        mode: start.mode,
        primary,
      })
    } else if (action.id === 'submit') {
      const reasons = [
        view.failure?.needsForce && `The last scan failed: ${view.failure.message}`,
        view.mismatch,
      ].filter(Boolean)
      buttons.push({
        id: action.id,
        label: 'Submit',
        hint: `File ${pages(total)}`,
        primary: true,
        submit: { force: view.failure?.needsForce === true },
        ...(reasons.length > 0 && {
          confirm: {
            title: view.failure?.needsForce ? 'File without the failed pages?' : 'File anyway?',
            body: `${reasons.join(' ')} File ${pages(total)} as they are?`,
            confirmLabel: 'Submit anyway',
          },
        }),
      })
    } else if (action.id === 'submit-fronts') {
      buttons.push({
        id: action.id,
        label: 'Submit fronts only',
        hint: 'No backs',
        primary: false,
        submit: { force: view.failure?.needsForce === true },
        confirm: {
          title: 'File the fronts only?',
          body: `The backs are not scanned. File ${pages(total)} (fronts) alone?`,
          confirmLabel: 'Submit fronts',
        },
      })
    } else if (action.id === 'discard') {
      buttons.push({
        id: action.id,
        label: 'Discard',
        primary: false,
        discard: true,
        confirm: {
          title: 'Discard this scan?',
          body: `The ${pages(total)} scanned are deleted. This cannot be undone.`,
          confirmLabel: 'Discard',
          danger: true,
        },
      })
    }
  }
  return buttons
}

/** Everything the Scan page shows, derived from one `GET /paper/scan/status` answer. */
export function scanView(status: ScanStatus): ScanView {
  const phase = phaseOf(status)
  const parts = status.pending?.parts ?? []
  const failure = failureOf(status, phase)
  let figure: string | null = null
  let caption: string | null = null
  let rows: ScanRow[] = []
  let mismatch: string | null = null

  if (phase === 'scanning') {
    figure = String(status.progress?.page ?? 0)
    caption = 'Pages scanned so far'
  } else if (phase === 'pair') {
    const fronts = parts[0]?.pages ?? 0
    const backs = parts[1]?.pages ?? 0
    mismatch = sidesMismatch(fronts, backs)
    figure = `${fronts} + ${backs}`
    caption = 'Fronts + backs'
    rows = [
      { label: 'Fronts', value: pages(fronts), bad: mismatch !== null },
      { label: 'Backs', value: pages(backs), bad: mismatch !== null },
    ]
  } else if (phase !== 'idle') {
    const total = parts.reduce((sum, part) => sum + part.pages, 0)
    figure = String(total)
    caption = phase === 'fronts' ? 'Fronts, no backs yet' : 'Pages scanned'
    if (phase === 'fronts') rows = [{ label: 'Fronts', value: pages(total), bad: false }]
  }

  return {
    phase,
    figure,
    caption,
    rows,
    mismatch,
    failure,
    thumbs: thumbsOf(status, phase),
    buttons: phase === 'scanning' ? [] : buttonsOf(status, phase, { mismatch, failure }),
  }
}
