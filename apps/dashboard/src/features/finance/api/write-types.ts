/**
 * The request bodies of the four curation writes (`POST /finance/api/…`, finances `docs/service.md`
 * §Typed writes). The finances repo validates them in `src/service/writes.ts` and no longer exports the
 * shapes (row retire-ui, 200ed59), so they are kept here by hand; the pinned contract in `./types.ts`
 * holds the rows and answers. Change them only with that file.
 */
import type { Cadence, RecurringMode } from './types'

/** `POST /api/transactions/:id/category` -> `TxRow` (source `manual`; unknown category: 400, unknown id: 404). */
export type SetCategoryRequest = { category: string }

/** `POST /api/transactions/:id/tag` -> `TxRow`. `tag: null` clears the tag; rules may then set one again. */
export type SetTagRequest = {
  tag: 'business' | 'tax' | 'donation' | 'private' | 'transfer' | 'investment' | 'income' | null
  note?: string
}

/**
 * `POST /api/recurring/overrides` -> `RecurringOverride | null` (null after a clear). `mode: null` removes the override. `cadence`
 * only goes with `include`.
 */
export type SetRecurringOverrideRequest = {
  merchant: string
  mode: RecurringMode | null
  cadence?: Cadence
  note?: string
}

/** `POST /api/merchant-rules`: needs `merchant` and/or `category`; re-categorizes at once. */
export type AddMerchantRuleRequest = { pattern: string; merchant?: string; category?: string }
