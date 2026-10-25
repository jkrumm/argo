# Usage reconciliation — usage-tracker ↔ Argo

Run 2026-10-24 against Argo prod as deployed before the payer PR. Method: usage-tracker's local
SQLite (`~/.local/share/usage-tracker/usage.db`, the mini) against `argo.usage_record` (read-only SQL),
keyed on `(source, source_id)`, window `2026-10-22T20:30Z … 2026-10-24T18:00Z`, payer derived with the
same CASE as `PAYER_SQL`. Re-run it after any change to the sync, the account pipeline or the payer
mapping.

## Payer mapping

| Payer | billing | account | Today (all time) |
|-|-|-|-|
| `iu-sub` | max | iu | 623,935 rows |
| `me-sub` | max | me | 591 rows (first on 2026-10-24) |
| `iu-api` | iu | any | 131,564 rows |
| `me-api` | openrouter | any | 47 rows, $0.003 (2026-10-05); lights up on any new `openrouter` row |
| `unknown` | anything else, including Max without an account | | 31,919 Max rows, see finding 2 |

Derived in the query layer (`PAYER_SQL`), not stored, so history re-reads correctly.

## 48 h by payer × day (after a forced sync)

| day | payer | rows local | rows argo | tokens local | tokens argo | cost local | cost argo |
|-|-|-|-|-|-|-|-|
| 2026-10-22 | iu-api | 435 | 435 | 59027824 | 59027824 | 2.84 | 2.84 |
| 2026-10-22 | iu-sub | 1324 | 1324 | 227246584 | 227246584 | 103.94 | 103.94 |
| 2026-10-23 | iu-api | 2384 | 2395 | 323542134 | 323544128 | 20.91 | 21.00 |
| 2026-10-23 | iu-sub | 11864 | 11864 | 2055474479 | 2055474479 | 903.30 | 903.30 |
| 2026-10-24 | iu-api | 1858 | 1868 | 233176875 | 233180582 | 15.54 | 15.55 |
| 2026-10-24 | iu-sub | 5281 | 5281 | 867916518 | 867916518 | 409.41 | 409.41 |
| 2026-10-24 | me-sub | 487 | 487 | 88872428 | 88872428 | 45.82 | 45.82 |

Keyed diff of the 23,654 Argo rows against the 23,633 local rows: 0 rows only local, 21 only in Argo,
0 cost differences, 1 account difference (pending, then resolved by the forced sync).

- **The +21 `iu-api` rows** are `audio-gateway` (19) and `email-gateway` (2): the VPS gateways post to
  Argo directly, never through the tracker's SQLite. Expected.
- **One account difference** (`agent-gateway-sessions` `559bb45a…`): a session whose account the tracker
  corrected to `me` after the row had synced as `iu`; fixed on the next sync (Argo now `me`).

## Quota and picks

| | local | argo |
|-|-|-|
| `quota_sample` | 32 (32 synced) | 32 |
| `account_pick` | 20 (20 synced) | 20 |

Before the forced sync: 30/28 and 18/17 — the difference was exactly the unsynced rows.

## Account backfill

`resync-account` is complete locally: 0 Max rows without an account (623,935 `iu`, 596 `me`), and Argo's
`iu` Max count equals the local one. What was still account-less in Argo is not backfill lag — see
findings 1 and 2.

## Sessions end to end

`session_env` line (`~/.claude/logs`) → `usage_record` (local) → Argo row, matched on the session id in
`raw`; row count, cost and tokens are identical in both stores:

| Session | Lane | Account in `session_env` | Local row | Argo row |
|-|-|-|-|-|
| `57fb6aa8…` | fan (interactive spawn) | iu | max / iu, 1 row, $0.0046 | max / iu, 1 row, $0.0046 |
| `5afa20db…` | interactive | me | max / me, 1 row, $0.0025 | max / me, 1 row, $0.0025 |
| `c00167b8…` | agent-gateway:otel worker (harness claude) | me | max / me, 2 rows, $0.1608 | max / me, 2 rows, $0.1608 |

## Findings

1. **Double-counted history, $3,081 / 24,803 rows.** Rows ingested before the `machine` column existed
   (`machine IS NULL`, 2026-04-28 … 2026-05-22 claude-code, plus litellm and one research-gateway row)
   were re-pushed once the tracker backfilled `machine`. The key `(source, source_id, machine)` treats
   the two as different events, so each exists twice and every chart counted both. Not a tracker bug
   (the re-push is correct); not recurring (every collector now sends `machine`). Fixed by migration
   `0024`: delete the NULL-machine copy when a machine-bearing twin with identical timestamp and token
   counts, billing, model and cost exists (all of `billing`, `model` and `cost_usd` must match, NULL-safe). One remaining duplicate key with differing content is left alone.
2. **7,165 Max rows without an account, $1,024.** MacBook rows from 2026-05-11 … 2026-07-02 that exist
   only in Argo: the mini's local DB starts at 2026-07-08 for that machine, so `resync-account` can never
   reach them. They predate the `me` subscription (first `me` row 2026-10-24), hence all `iu`. Migration
   `0024` sets `account = 'iu'` for Max rows older than the first Max `me` row; a database without any Max `me`
   row is untouched. After both migrations no Max row is account-less.
3. **Per-source row differences that are not bugs:** MacBook claude-code rows (the MacBook's tracker
   pushes them), VPS research-gateway (3,470) and mini research-gateway pre-rename rows (118), litellm
   MacBook rows (932), and the direct-posting gateways (audio, email, image, argo).

No usage-tracker bug was found.

## What migration 0024 selects on prod (read-only, 2026-10-24)

| | rows | cost |
|-|-|-|
| Step 1: NULL-machine rows with an identical twin (same ts, tokens, billing, model, cost) | 24,803 | $3,080.99 |
| Step 2 cutoff: first Max `me` row | 2026-10-24T16:27:59Z (the first `me` row on any billing lane is the same instant) | |
| Step 2: Max rows with NULL account before the cutoff, before step 1 | 31,919 | $4,101.72 |
| Step 2: the same, after step 1 has removed the twins (what is actually re-accounted and archived) | 7,165 | $1,024.54 |
| Max rows with NULL account at or after the cutoff (left untouched) | 0 | |

The 7,165 are all `claude-code` rows of machine `MacBook Pro (M2 Max)`, 2026-05-11 … 2026-07-02. The other
24,754 of the 31,919 are the NULL-machine rows step 1 deletes. The strict step 1 predicate (billing, model
and cost added) selects the same 24,803 rows as the looser one, so the extra conditions only guard future
data. The archive table therefore ends with 24,803 `duplicate_null_machine` + 7,165 `account_backfill` rows.

## Undoing migration 0024

Migration 0024 archived every deleted row and the pre-update state of every re-accounted row into
`argo.usage_record_dedupe_0024` (reasons `duplicate_null_machine` = deleted, `account_backfill` = account
was NULL, now `iu`). **That table was dropped on 2026-10-25 by migration 0025** once the change was
accepted. Its full contents survive in a dump on the mini:

`~/.local/share/argo-backups/usage_record_dedupe_0024-2026-10-25.sql.gz` (31,968 rows = 24,803 + 7,165,
sha256 `a86f1069094aa74c8be23cdf44e390ecf7800692cf15f443ed604d450a4d281c`; kept out of git).

Restore: replay the dump (recreates the table with its data), then run the SQL below (ends by dropping the table again).

```sh
gzip -dc ~/.local/share/argo-backups/usage_record_dedupe_0024-2026-10-25.sql.gz \
  | make -C ~/SourceRoot/vps sql-postgres ENV=prod   # CREATE TABLE + COPY of argo.usage_record_dedupe_0024
```

```sql
SELECT reason, count(*), round(sum(cost_usd)::numeric, 2) FROM argo.usage_record_dedupe_0024 GROUP BY 1;

-- bring the deleted NULL-machine duplicates back
INSERT INTO argo.usage_record (id, source, source_id, grain, ts, model, model_norm, project, workspace, sub_tool, billing, account, machine, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, duration_ms, cost_usd, cost_source, raw, ingested_at, received_at, created_at, updated_at)
SELECT id, source, source_id, grain, ts, model, model_norm, project, workspace, sub_tool, billing, account, machine, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, duration_ms, cost_usd, cost_source, raw, ingested_at, received_at, created_at, updated_at
FROM argo.usage_record_dedupe_0024 WHERE reason = 'duplicate_null_machine';

-- put the old (NULL) account back
UPDATE argo.usage_record u SET account = a.account
FROM argo.usage_record_dedupe_0024 a WHERE a.reason = 'account_backfill' AND a.id = u.id AND u.account = 'iu';

DROP TABLE argo.usage_record_dedupe_0024;
```

The INSERT is single-shot (a second run fails on duplicate keys). After the replay, check the count is 31,968.

`src/db/migration-0024.test.ts` runs the real 0024 file on fixtures in a rolled-back transaction and
exercises this same restore SQL; keep the two in step.

The UPDATE is filtered on `u.account = 'iu'` because a tracker `resync-account` or normal sync may have
legitimately changed `account` on a re-accounted row since; those rows are left alone.

## Bucket timezone

Daily and weekly buckets of `/usage/timeseries` are pinned to UTC (`date_trunc(…, ts AT TIME ZONE 'UTC')`).
Prod Postgres reports `TimeZone = Etc/UTC` (no per-database or per-role override, no `TZ` in the API
container, no timezone in the connection URL), so this matches what prod already did; the pin makes it
independent of the session. Covered by a test that runs under `PGTZ=Europe/Berlin` too.

## Dashboard

Not screenshot-verified: the shot harness serves the built dashboard against production's read-only
API, which does not have the payer endpoints until this PR deploys. The evidence is the API contract
(route tests in `usage.payer.test.ts`: derivation, filters, groupBy, headline), the dashboard unit
tests and the 48 h Argo data run through the new endpoints locally (`me-sub` $45.82 matches the table).
