import { z } from 'zod'

/**
 * The IU API keys spend goes through. Each key has its own rolling 30-day cap in IU's portal, so
 * spend is split per key: `usage_record.iu_key`, the portal tables and the `iuKey` query filters.
 * Only ids live here, never key material. Adding a key = one entry in `IU_KEYS` and `IU_KEY_LABELS`
 * (plus the dashboard's registry). Mirrors usage-tracker `src/iu-keys.ts`.
 */
export const IU_KEYS = ['personal', 'athena-team'] as const
export type IuKey = (typeof IU_KEYS)[number]

export const IU_KEY_LABELS: Record<IuKey, string> = {
  personal: 'Personal key',
  'athena-team': 'Athena team key',
}

/** Per-key rolling-window cap in USD; each key is measured independently by the portal. */
export const IU_KEY_LIMIT_USD: Record<IuKey, number> = {
  personal: 500,
  'athena-team': 500,
}

/** The key every IU row belonged to before the dimension existed. */
export const DEFAULT_IU_KEY: IuKey = 'personal'

/** Shape of a well-formed key id as the producer spells it (registered or not). */
export const IU_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

export const IuKeyEnum = z.enum(IU_KEYS)

const registered: ReadonlySet<string> = new Set(IU_KEYS)

/** A registered key id, or null (non-string, blank, unknown). An unknown id is never invented into a key. */
export function parseIuKey(value: unknown): IuKey | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return registered.has(id) ? (id as IuKey) : null
}
