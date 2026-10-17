export type Scheme = 'dark' | 'light'
export type Device = 'desktop' | 'mobile'

/** One route's output; paths are relative to the label dir. */
export type RouteResult = {
  route: string
  slug: string
  full: Partial<Record<`${Scheme}--${Device}`, string>>
  crops: Array<{ scheme: Scheme; file: string }>
  failures: string[]
  /** Degraded but usable output (cropped away, never settled); shown on the board, does not fail the run. */
  notes: string[]
}
