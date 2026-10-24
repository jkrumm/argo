import { describe, it, expect, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { db, runMigrations } from './index.js'

beforeAll(async () => {
  await runMigrations()
})

const MIGRATION = readFileSync(
  join(import.meta.dirname, '../../drizzle/0024_usage_dedupe_and_backfill_account.sql'),
  'utf8',
)
const STATEMENTS = MIGRATION.split('--> statement-breakpoint')

// Restore SQL as documented in docs/usage-reconciliation.md; keep the two in step.
const COLUMNS = `id, source, source_id, grain, ts, model, model_norm, project, workspace, sub_tool, billing, account, machine, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, duration_ms, cost_usd, cost_source, raw, ingested_at, received_at, created_at, updated_at`
const RESTORE = [
  `INSERT INTO argo.usage_record (${COLUMNS}) SELECT ${COLUMNS} FROM argo.usage_record_dedupe_0024 WHERE reason = 'duplicate_null_machine'`,
  `UPDATE argo.usage_record u SET account = a.account FROM argo.usage_record_dedupe_0024 a WHERE a.reason = 'account_backfill' AND a.id = u.id`,
]

class Rollback extends Error {}

// Fixtures are older than anything real (2020/2021), so the first-`me` cutoff the migration computes
// is the fixture's own and no real row is touched; the whole run is rolled back regardless.
const SOURCE = 'mig0024-test'
// (source_id, ts, billing, account, machine, tokens, model, cost). `first-me` is the first Max `me`
// row; `early-api-me` is an earlier `me` row on another billing lane that must not move the cutoff.
const FIXTURES = sql`
  INSERT INTO argo.usage_record (source, source_id, grain, ts, billing, account, machine, input_tokens, model, cost_usd, ingested_at) VALUES
  (${SOURCE}, 'twin',       'm', '2020-05-01T00:00:00Z', 'max', NULL, NULL,   5, 'm1', 1, 'x'),
  (${SOURCE}, 'twin',       'm', '2020-05-01T00:00:00Z', 'max', 'iu', 'mini', 5, 'm1', 1, 'x'),
  (${SOURCE}, 'differs',    'm', '2020-05-01T00:00:00Z', 'max', NULL, NULL,   5, 'm1', 1, 'x'),
  (${SOURCE}, 'differs',    'm', '2020-05-01T00:00:00Z', 'max', 'iu', 'mini', 9, 'm1', 1, 'x'),
  (${SOURCE}, 'twin-cost',  'm', '2020-05-03T00:00:00Z', 'max', NULL, NULL,   5, 'm1', 1, 'x'),
  (${SOURCE}, 'twin-cost',  'm', '2020-05-03T00:00:00Z', 'max', 'iu', 'mini', 5, 'm1', 2, 'x'),
  (${SOURCE}, 'twin-bill',  'm', '2020-05-03T00:00:00Z', 'iu',  NULL, NULL,   5, 'm1', 1, 'x'),
  (${SOURCE}, 'twin-bill',  'm', '2020-05-03T00:00:00Z', 'max', 'iu', 'mini', 5, 'm1', 1, 'x'),
  (${SOURCE}, 'twin-model', 'm', '2020-05-03T00:00:00Z', 'max', NULL, NULL,   5, 'm1', 1, 'x'),
  (${SOURCE}, 'twin-model', 'm', '2020-05-03T00:00:00Z', 'max', 'iu', 'mini', 5, 'm2', 1, 'x'),
  (${SOURCE}, 'no-twin',    'm', '2020-05-02T00:00:00Z', 'max', NULL, 'mac',  1, 'm1', 1, 'x'),
  (${SOURCE}, 'api',        'm', '2020-05-02T00:00:00Z', 'iu',  NULL, 'mac',  1, 'm1', 1, 'x'),
  (${SOURCE}, 'early-api-me','m','2019-01-01T00:00:00Z', 'iu',  'me', 'mini', 1, 'm1', 1, 'x'),
  (${SOURCE}, 'first-me',   'm', '2021-01-01T00:00:00Z', 'max', 'me', 'mini', 1, 'm1', 1, 'x'),
  (${SOURCE}, 'after-me',   'm', '2021-01-02T00:00:00Z', 'max', NULL, 'mini', 1, 'm1', 1, 'x')`

type Archived = {
  source_id: string
  reason: string
  account: string | null
  machine: string | null
}

describe('migration 0024', () => {
  it('archives exactly the rows it deletes and re-accounts, and the restore SQL undoes it', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(FIXTURES)
        const snapshot = async () =>
          (await tx.execute(
            sql`SELECT id, source_id, account, machine, input_tokens FROM argo.usage_record WHERE source = ${SOURCE} ORDER BY id`,
          )) as unknown as Array<Record<string, unknown>>
        const before = await snapshot()

        for (const statement of STATEMENTS) await tx.execute(sql.raw(statement))

        const archive = (await tx.execute(
          sql`SELECT source_id, reason, account, machine FROM argo.usage_record_dedupe_0024 WHERE source = ${SOURCE} ORDER BY reason, source_id`,
        )) as unknown as Archived[]
        // Deleted: only the NULL-machine copy of `twin`. Twins that differ in cost, billing or model
        // survive. Re-accounted (archived as they were, account NULL): Max rows older than the first Max
        // `me` row; `early-api-me` (billing iu) does not move that cutoff, and `api`, `twin-bill`'s
        // iu-billed copy, `first-me` and `after-me` are untouched and not archived.
        expect(archive).toEqual([
          { source_id: 'differs', reason: 'account_backfill', account: null, machine: null },
          { source_id: 'no-twin', reason: 'account_backfill', account: null, machine: 'mac' },
          { source_id: 'twin-cost', reason: 'account_backfill', account: null, machine: null },
          { source_id: 'twin-model', reason: 'account_backfill', account: null, machine: null },
          { source_id: 'twin', reason: 'duplicate_null_machine', account: null, machine: null },
        ])

        const after = await snapshot()
        const rowsOf = (id: string) => after.filter((r) => r['source_id'] === id)
        expect(rowsOf('twin')).toHaveLength(1)
        expect(rowsOf('twin')[0]?.['machine']).toBe('mini')
        for (const id of ['differs', 'twin-cost', 'twin-bill', 'twin-model']) {
          expect(rowsOf(id)).toHaveLength(2)
        }
        const accountOf = (id: string) => rowsOf(id).map((r) => r['account'])
        expect(accountOf('no-twin')).toEqual(['iu'])
        expect(accountOf('differs')).toEqual(['iu', 'iu'])
        expect(accountOf('twin-cost')).toEqual(['iu', 'iu'])
        expect(accountOf('twin-model')).toEqual(['iu', 'iu'])
        expect(accountOf('api')).toEqual([null])
        expect(accountOf('after-me')).toEqual([null])

        for (const statement of RESTORE) await tx.execute(sql.raw(statement))
        expect(await snapshot()).toEqual(before)

        throw new Rollback()
      }),
    ).rejects.toBeInstanceOf(Rollback)
  })
})
