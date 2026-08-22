/**
 * window-stores.ts — the per-page window-preset stores, in a LEAF module.
 *
 * Each page whose search carries a `window` preset persists the last selection through
 * `createSearchParamStore` (basalt's URL ⟷ localStorage store: versioned envelope under
 * `basalt:<key>`, cross-tab, Standard-Schema validated). The store's own `validateSearch` is
 * deliberately unused — every one of these routes also carries `from`/`to` (and strength carries
 * `tab`/`exercises`), while the store models exactly ONE enum param. The route's zod schema stays
 * the validator and calls `readStored()` for the default; `useStore()` writes the mirror.
 *
 * They live HERE, not in the feature, because `lib/nav.tsx` needs them too and is a leaf by
 * contract (no feature imports). Stating them once is what keeps the nav link's default and the
 * route's default from drifting — the seam `nav.tsx`'s own header warns about.
 *
 * The value tuples are the single source for the type, the Select options, the route's zod enum
 * and the store's accepted values.
 */
import { createSearchParamStore } from 'basalt-ui/router-tanstack'

export const GARMIN_WINDOW_VALUES = ['7d', '30d', '3m', '1y', 'all'] as const
export const STRENGTH_WINDOW_VALUES = ['7d', '30d', '3m', '6m', '1y', 'ytd', 'all'] as const
export const BODY_COMP_WINDOW_VALUES = ['7d', '30d', '90d', 'all'] as const

export const garminWindowStore = createSearchParamStore({
  key: 'garmin-health:window',
  param: 'window',
  values: GARMIN_WINDOW_VALUES,
  fallback: '30d',
})

export const strengthWindowStore = createSearchParamStore({
  key: 'strength-tracker:window',
  param: 'window',
  values: STRENGTH_WINDOW_VALUES,
  fallback: 'all',
})

export const bodyCompWindowStore = createSearchParamStore({
  key: 'body-composition:window',
  param: 'window',
  values: BODY_COMP_WINDOW_VALUES,
  fallback: '90d',
})
