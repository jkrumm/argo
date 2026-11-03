import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { emit } from 'basalt-ui/commands'
import { FINANCE_DATA, FinanceApiError, financeWrite } from './client'
import { TX_KEY, metaOptions } from './queries'
import type {
  AddMerchantRuleRequest,
  AddMerchantRuleResponse,
  Cadence,
  RecurringMode,
  RecurringOverride,
  SetCategoryRequest,
  SetRecurringOverrideRequest,
  SetTagRequest,
  TxList,
  TxRow,
} from './types'

type TxPatch = Partial<TxRow>

/** A cached transaction list is a page (`{ rows, total }`) or a plain array of every booking. */
function patchRows<T extends TxList | TxRow[] | undefined>(data: T, id: string, patch: TxPatch): T {
  if (data === undefined) return data
  const apply = (rows: TxRow[]) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
  return (Array.isArray(data) ? apply(data) : { ...data, rows: apply((data as TxList).rows) }) as T
}

/** The row `id` as any cached list holds it, for the rollback. */
function cachedRow(queryClient: QueryClient, id: string): TxRow | undefined {
  for (const [, data] of queryClient.getQueriesData<TxList | TxRow[]>({ queryKey: TX_KEY })) {
    const rows = Array.isArray(data) ? data : data?.rows
    const hit = rows?.find((r) => r.id === id)
    if (hit !== undefined) return hit
  }
  return undefined
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Derived numbers (month status, categories, sums per tag, recurring) and the filtered lists (a row
 * that was categorized leaves the "uncategorized" queue) refetch once after a burst of edits.
 */
export function refreshAfterWrite(queryClient: QueryClient, delayMs = 500): void {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    void queryClient.invalidateQueries({
      queryKey: FINANCE_DATA,
      predicate: (q) => q.queryKey[2] !== 'meta',
    })
  }, delayMs)
}

/** What a failed write says; the service's own text when it sent one. */
export const writeErrorMessage = (error: unknown): string =>
  error instanceof FinanceApiError ? error.message : 'The change could not be saved.'

/**
 * The curation writes of the finance pages (`POST /finance/api/…`, finances `docs/service.md` §Typed
 * writes). A row edit is optimistic: the row changes in every cached list at once, the call runs, the
 * answer replaces the row, and a failure puts the previous values back and rethrows (the caller
 * reports it). `refresh: false` leaves the derived queries alone for a loop of edits, which then
 * calls `refreshAfterWrite` once.
 */
export function useCurate() {
  const queryClient = useQueryClient()
  async function editRow(
    id: string,
    patch: TxPatch,
    write: () => Promise<TxRow>,
    refresh: boolean,
  ): Promise<TxRow> {
    await queryClient.cancelQueries({ queryKey: TX_KEY })
    const before = cachedRow(queryClient, id)
    const undo: TxPatch = {}
    for (const key of Object.keys(patch) as (keyof TxRow)[]) {
      if (before !== undefined) Object.assign(undo, { [key]: before[key] })
    }
    queryClient.setQueriesData<TxList | TxRow[]>({ queryKey: TX_KEY }, (d) =>
      patchRows(d, id, patch),
    )
    try {
      const saved = await write()
      queryClient.setQueriesData<TxList | TxRow[]>({ queryKey: TX_KEY }, (d) =>
        patchRows(d, id, saved),
      )
      if (refresh) refreshAfterWrite(queryClient)
      return saved
    } catch (error) {
      queryClient.setQueriesData<TxList | TxRow[]>({ queryKey: TX_KEY }, (d) =>
        patchRows(d, id, undo),
      )
      throw error
    }
  }

  return {
    /** Sets a category by hand (source `manual`). */
    setCategory(row: Pick<TxRow, 'id'>, category: string, refresh = true) {
      const meta = queryClient.getQueryData(metaOptions.queryKey)
      const kind = meta?.categories.find((c) => c.id === category)?.kind ?? null
      return editRow(
        row.id,
        {
          category,
          category_source: 'manual',
          category_kind: kind,
          top_category: category.split('/')[0] ?? category,
        },
        () =>
          financeWrite<TxRow>(`/transactions/${row.id}/category`, {
            category,
          } satisfies SetCategoryRequest),
        refresh,
      )
    },
    /** Sets (`null` clears) the tax tag by hand. */
    setTag(
      row: Pick<TxRow, 'id'>,
      tag: SetTagRequest['tag'],
      options: { note?: string; refresh?: boolean } = {},
    ) {
      return editRow(
        row.id,
        { tax_tag: tag, tag_source: tag === null ? null : 'manual' },
        () =>
          financeWrite<TxRow>(`/transactions/${row.id}/tag`, {
            tag,
            ...(options.note !== undefined && { note: options.note }),
          } satisfies SetTagRequest),
        options.refresh ?? true,
      )
    },
    /** Includes or excludes a merchant in the recurring list; `mode: null` clears the override. */
    async setOverride(input: { merchant: string; mode: RecurringMode | null; cadence?: Cadence }) {
      const saved = await financeWrite<RecurringOverride | null>('/recurring/overrides', {
        merchant: input.merchant,
        mode: input.mode,
        ...(input.mode === 'include' && input.cadence !== undefined && { cadence: input.cadence }),
      } satisfies SetRecurringOverrideRequest)
      refreshAfterWrite(queryClient, 0)
      return saved
    },
    /** Stores a merchant rule and re-applies the categories; resolves with how many bookings changed. */
    async addRule(input: AddMerchantRuleRequest) {
      const saved = await financeWrite<AddMerchantRuleResponse>('/merchant-rules', input)
      refreshAfterWrite(queryClient, 0)
      return saved
    },
  }
}

/** Reports a failed write the way every finance control does. */
export function reportWriteError(error: unknown): void {
  emit('finance:error', { message: writeErrorMessage(error) })
}
