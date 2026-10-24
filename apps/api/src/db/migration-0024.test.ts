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
const FIXTURES = sql`
  INSERT INTO argo.usage_record (source, source_id, grain, ts, billing, account, machine, input_tokens, ingested_at) VALUES
  (${SOURCE}, 'twin',      'm', '2020-05-01T00:00:00Z', 'max', NULL, NULL,   5, 'x'),
  (${SOURCE}, 'twin',      'm', '2020-05-01T00:00:00Z', 'max', 'iu', 'mini', 5, 'x'),
  (${SOURCE}, 'differs',   'm', '2020-05-01T00:00:00Z', 'max', NULL, NULL,   5, 'x'),
  (${SOURCE}, 'differs',   'm', '2020-05-01T00:00:00Z', 'max', 'iu', 'mini', 9, 'x'),
  (${SOURCE}, 'no-twin',   'm', '2020-05-02T00:00:00Z', 'max', NULL, 'mac',  1, 'x'),
  (${SOURCE}, 'api',       'm', '2020-05-02T00:00:00Z', 'iu',  NULL, 'mac',  1, 'x'),
  (${SOURCE}, 'first-me',  'm', '2021-01-01T00:00:00Z', 'max', 'me', 'mini', 1, 'x'),
  (${SOURCE}, 'after-me',  'm', '2021-01-02T00:00:00Z', 'max', NULL, 'mini', 1, 'x')`

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
        // The deleted copy is the NULL-machine one; the re-accounted rows are archived as they were
        // (account NULL). `api` (billing iu), `first-me` and `after-me` are untouched and not archived.
        expect(archive).toEqual([
          { source_id: 'differs', reason: 'account_backfill', account: null, machine: null },
          { source_id: 'no-twin', reason: 'account_backfill', account: null, machine: 'mac' },
          { source_id: 'twin', reason: 'duplicate_null_machine', account: null, machine: null },
        ])

        const after = await snapshot()
        expect(after.map((r) => r['source_id'])).toEqual([
          'twin',
          'differs',
          'differs',
          'no-twin',
          'api',
          'first-me',
          'after-me',
        ])
        const accountOf = (id: string) =>
          after.filter((r) => r['source_id'] === id).map((r) => r['account'])
        expect(accountOf('no-twin')).toEqual(['iu'])
        expect(accountOf('differs')).toEqual(['iu', 'iu'])
        expect(accountOf('api')).toEqual([null])
        expect(accountOf('after-me')).toEqual([null])

        for (const statement of RESTORE) await tx.execute(sql.raw(statement))
        expect(await snapshot()).toEqual(before)

        throw new Rollback()
      }),
    ).rejects.toBeInstanceOf(Rollback)
  })
})
