import { format } from 'date-fns'
import { garminStore } from '../../lib/window-stores'
import type { WindowPreset } from './constants'
import type { SummaryParams } from './types'

export type WindowSearch = {
  window: WindowPreset | 'custom'
  from?: string | undefined
  to?: string | undefined
}

/**
 * The route's search → the API's window query.
 *
 * `field.range.toWindow` covers the custom range; what it cannot know is that the backend's
 * `WindowQuerySchema` only accepts 7d / 30d / 90d / all, so `3m` and `1y` still need explicit
 * `from`/`to` dates. A `'custom'` preset with no dates falls back to the field's own fallback.
 */
export function resolveWindow(search: WindowSearch): SummaryParams {
  const resolved = garminStore.field.window.toWindow({
    preset: search.window,
    from: search.from,
    to: search.to,
  })
  if ('from' in resolved) return { from: resolved.from, to: resolved.to }

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  switch (resolved.window) {
    case '7d':
      return { window: '7d' }
    case '3m': {
      const from = new Date(today)
      from.setMonth(from.getMonth() - 3)
      return { from: format(from, 'yyyy-MM-dd'), to: todayStr }
    }
    case '1y': {
      const from = new Date(today)
      from.setFullYear(from.getFullYear() - 1)
      return { from: format(from, 'yyyy-MM-dd'), to: todayStr }
    }
    case 'all':
      return { window: 'all' }
    // `30d` and a dateless `custom` both land on the field's fallback.
    default:
      return { window: '30d' }
  }
}
