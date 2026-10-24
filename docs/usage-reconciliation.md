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
   counts exists. One remaining duplicate key with differing content is left alone.
2. **7,165 Max rows without an account, $1,024.** MacBook rows from 2026-05-11 … 2026-07-02 that exist
   only in Argo: the mini's local DB starts at 2026-07-08 for that machine, so `resync-account` can never
   reach them. They predate the `me` subscription (first `me` row 2026-10-24), hence all `iu`. Migration
   `0024` sets `account = 'iu'` for Max rows older than the first `me` row; a database without any `me` row
   is untouched. After both migrations no Max row is account-less.
3. **Per-source row differences that are not bugs:** MacBook claude-code rows (the MacBook's tracker
   pushes them), VPS research-gateway (3,470) and mini research-gateway pre-rename rows (118), litellm
   MacBook rows (932), and the direct-posting gateways (audio, email, image, argo).

No usage-tracker bug was found.

## Dashboard

Not screenshot-verified: the shot harness serves the built dashboard against production's read-only
API, which does not have the payer endpoints until this PR deploys. The evidence is the API contract
(route tests in `usage.payer.test.ts`: derivation, filters, groupBy, headline), the dashboard unit
tests and the 48 h Argo data run through the new endpoints locally (`me-sub` $45.82 matches the table).
