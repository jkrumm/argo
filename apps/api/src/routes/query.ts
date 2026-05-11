import { Elysia } from 'elysia'
import { z } from 'zod'
import { client } from '../db/index.js'

// Block any mutation or schema-altering keywords
const BLOCKED =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE|EXEC|EXECUTE|ATTACH|DETACH)\b/i

export const queryRoute = new Elysia().post(
  '/query',
  async ({ body, set }) => {
    const { sql } = body
    const trimmed = sql.trim()

    if (!trimmed.toUpperCase().startsWith('SELECT') || BLOCKED.test(trimmed)) {
      set.status = 400
      return { error: 'Only SELECT statements are allowed' }
    }

    try {
      const rows = Array.from(await client.unsafe(trimmed)) as Record<string, unknown>[]
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : []
      return { rows, columns }
    } catch (e) {
      set.status = 400
      return { error: e instanceof Error ? e.message : 'Query failed' }
    }
  },
  {
    body: z.object({ sql: z.string().min(1) }),
    detail: {
      tags: ['Database'],
      summary: 'Execute a read-only SQL query',
      description:
        'Executes a SELECT statement against the Postgres database. Only SELECT statements are permitted. Tables are in the argo schema — use argo.table_name syntax. Useful for ad-hoc chart queries and agent consumption.',
      security: [{ BearerAuth: [] }],
    },
  },
)
