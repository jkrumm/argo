import { z } from 'zod'
import { sql, type SQL } from 'drizzle-orm'
import { ACCOUNT_PATTERN, PAYER_EXPR, PayerEnum, WorkspaceEnum } from './usage-query.js'

export const BillingEnum = z.enum(['max', 'iu', 'openrouter', 'unknown'])

/**
 * Accept either a single scalar or an array for filter query params.
 * Eden/URLSearchParams flatten 1-element arrays to a scalar on the wire,
 * and the openapi plugin validates against the JSON Schema (not Zod runtime),
 * so preprocess wrappers never run — declare both shapes here and call
 * toArray() before using the value.
 */
export const stringFilter = z.union([z.string(), z.array(z.string())]).optional()
export const billingFilter = z.union([BillingEnum, z.array(BillingEnum)]).optional()
export const payerFilter = z.union([PayerEnum, z.array(PayerEnum)]).optional()
export const workspaceFilter = z.union([WorkspaceEnum, z.array(WorkspaceEnum)]).optional()
export const AccountSchema = z.string().regex(ACCOUNT_PATTERN)
export const accountFilter = z.union([AccountSchema, z.array(AccountSchema)]).optional()

function inList(column: SQL, values: string[]): SQL {
  return sql`${column} IN (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`
}

export function buildFilterSql({
  sources,
  machines,
  billing,
  workspace,
  account,
  payer,
}: {
  sources?: string[] | undefined
  machines?: string[] | undefined
  billing?: string[] | undefined
  workspace?: string[] | undefined
  account?: string[] | undefined
  payer?: string[] | undefined
}) {
  const parts: SQL[] = []
  if (sources && sources.length > 0) {
    parts.push(inList(sql`source`, sources))
  }
  if (machines && machines.length > 0) {
    parts.push(inList(sql`machine`, machines))
  }
  if (billing && billing.length > 0) {
    parts.push(inList(sql`billing`, billing))
  }
  if (workspace && workspace.length > 0) {
    parts.push(inList(sql`workspace`, workspace))
  }
  if (account && account.length > 0) {
    parts.push(inList(sql`account`, account))
  }
  if (payer && payer.length > 0) {
    parts.push(inList(PAYER_EXPR, payer))
  }
  if (parts.length === 0) return sql``
  return sql`AND ${sql.join(parts, sql` AND `)}`
}
