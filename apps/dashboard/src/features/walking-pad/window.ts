import { walkingStore } from '../../lib/window-stores'
import type { WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import type { WindowPreset } from './constants'

export type WindowSearch = {
  window: WindowPreset | 'custom'
  from?: string | undefined
  to?: string | undefined
}

/**
 * The route's search → the API's window query. The backend accepts 7d / 30d / 90d / all directly;
 * `6m` and `1y` become explicit `from`/`to` dates, which is the part `toWindow` cannot know.
 *
 * The field declares no `custom: true`, so a `'custom'` preset can only arrive from a hand-typed
 * URL — it lands on the fallback rather than erroring the page.
 */
export function resolveWindow(search: WindowSearch): WalkingPadWindowParams {
  const resolved = walkingStore.field.window.toWindow({
    preset: search.window,
    from: search.from,
    to: search.to,
  })
  if ('from' in resolved) return { from: resolved.from, to: resolved.to }

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  switch (resolved.window) {
    case '7d':
      return { window: '7d' }
    case '90d':
      return { window: '90d' }
    case '6m': {
      const from = new Date(today)
      from.setMonth(from.getMonth() - 6)
      return { from: from.toISOString().slice(0, 10), to: todayStr }
    }
    case '1y': {
      const from = new Date(today)
      from.setFullYear(from.getFullYear() - 1)
      return { from: from.toISOString().slice(0, 10), to: todayStr }
    }
    case 'all':
      return { window: 'all' }
    // `30d` and a stray `custom` both land on the field's fallback.
    default:
      return { window: '30d' }
  }
}
