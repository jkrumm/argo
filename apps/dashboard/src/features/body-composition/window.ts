import { bodyCompStore } from '../../lib/window-stores'
import type { WindowPreset } from './constants'
import type { SummaryParams } from './types'

export type WindowSearch = {
  window: WindowPreset | 'custom'
  from?: string | undefined
  to?: string | undefined
}

/**
 * The route's search → the API's window query. Unlike Garmin Health and Strength Tracker every
 * preset here maps 1:1 onto the backend's `WindowQuerySchema`, so there is no date math — only the
 * custom range and the dateless-`custom` fallback to resolve.
 */
export function resolveWindow(search: WindowSearch): SummaryParams {
  const resolved = bodyCompStore.field.window.toWindow({
    preset: search.window,
    from: search.from,
    to: search.to,
  })
  if ('from' in resolved) return { from: resolved.from, to: resolved.to }
  return { window: resolved.window === 'custom' ? '90d' : resolved.window }
}
