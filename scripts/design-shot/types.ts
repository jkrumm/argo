export type Scheme = 'dark' | 'light'
export type Device = 'desktop' | 'mobile'

/** One route's output; paths are relative to the label dir. */
export type RouteResult = {
  route: string
  slug: string
  /** `<scheme>--<device>` → file */
  full: Record<string, string>
  crops: Array<{ scheme: Scheme; file: string }>
  failures: string[]
}
