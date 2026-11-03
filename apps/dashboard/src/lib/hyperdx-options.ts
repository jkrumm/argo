/**
 * The HyperDX browser SDK options that keep the finance vault's plaintext out of ClickStack (which
 * runs on the VPS; the vault's data stays on the mini). Split out of `hyperdx.ts` so a test can pin
 * them without initialising the SDK.
 */

/** rrweb skips every element with this class: the finance layout root carries it. */
export const HYPERDX_BLOCK_CLASS = 'hdx-block'

/**
 * Requests the SDK must not instrument at all. Finance fetches carry merchants and search terms in
 * their query strings; with no span there is no URL and no `traceparent` header either.
 */
export const HYPERDX_IGNORE_URLS: RegExp[] = [
  /\/@vite\//,
  /\/__vite_ping/,
  /\.hot-update\./,
  /\/node_modules\/.vite\//,
  /\/api\/finance\//,
]
