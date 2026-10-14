/** A lane returns summary rows for the md table; `detail` goes to the gitignored raw dir. */
export type Row = { metric: string; value: number | string; unit?: string }
export type LaneResult = { rows: Row[]; detail?: unknown }

export type LaneCtx = {
  /** Origin of the served dist, e.g. http://127.0.0.1:51234 */
  baseUrl: string
  distDir: string
  /** Gitignored raw output dir for this label (already created). */
  rawDir: string
  routes: string[]
}

export type Lane = (ctx: LaneCtx) => Promise<LaneResult>

export const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Rejects with `<what> timed out after <ms> ms` if `work` has not settled in time. */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}
