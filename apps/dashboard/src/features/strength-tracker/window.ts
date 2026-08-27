import { strengthStore } from '../../lib/window-stores'
import type { WindowPreset } from './constants'
import type { SummaryParams } from './types'

export type WindowSearch = {
  window: WindowPreset | 'custom'
  from?: string | undefined
  to?: string | undefined
}

/**
 * The route's search → the API's window query. The backend accepts 7d / 30d / 90d / all directly;
 * `3m` / `6m` / `1y` / `ytd` become explicit `from`/`to` ISO dates, which is the part `toWindow`
 * cannot know.
 */
export function resolveWindow(search: WindowSearch): SummaryParams {
  const resolved = strengthStore.field.window.toWindow({
    preset: search.window,
    from: search.from,
    to: search.to,
  })
  if ('from' in resolved) return { from: resolved.from, to: resolved.to }

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const monthsBack = (months: number): SummaryParams => {
    const from = new Date(today)
    from.setMonth(from.getMonth() - months)
    return { from: from.toISOString().slice(0, 10), to: todayStr }
  }

  switch (resolved.window) {
    case '7d':
      return { window: '7d' }
    case '30d':
      return { window: '30d' }
    case '3m':
      return monthsBack(3)
    case '6m':
      return monthsBack(6)
    case '1y':
      return monthsBack(12)
    case 'ytd':
      return { from: new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10), to: todayStr }
    // `all` and a dateless `custom` both land on the field's fallback.
    default:
      return { window: 'all' }
  }
}
