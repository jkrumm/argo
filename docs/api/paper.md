# Paper (`/paper/*`)

Read before changing `apps/api/src/routes/paper.ts`, `lib/paper.ts` or `lib/paper-schemas.ts`.

`/paper/*` is the `paper` CLI (repo `~/SourceRoot/paper`, `paper schema` lists every verb and field) as an API: scanning, the scan inbox, the document index and printing. Argo keeps no copy of the index and has no table: `paper docs list` is the source. A missing verb or field is a signal to the paper repo, not a workaround here. The gate is Argo's own bearer (`authGuard`); there is no vault unlock, the notes and originals are not the encrypted vault.

## How a call runs

Every verb runs as `hc exec --json --timeout N -- ~/.local/bin/paper …`, `scan status` included. A launchd-born process (Argo is one) can stat the SMB share but not read it and has no LAN access; a child of the herdr core has both (dotfiles `docs/tcc.md`). Never ask for a TCC grant. `hc exec` ends a command after 600 s; Argo's timeouts are 30 s for reads, 60 s for checks, starts and `docs list`, 90 s for printing and the inbox listing, 120 s for fetches and submit.

- `PAPER_BIN` and `HC_BIN` (env, default `~/.local/bin/paper` and `hc`) let tests point at fakes.
- **Core guard.** Any `hc` call starts a core when none answers, and a core born from Argo would be a stray (dotfiles `scripts/lib/core-up.sh`). So a bare connect to the default core socket must answer before `hc` is spawned; otherwise the call is `unavailable` (503) and nothing is spawned.
- **Result kinds** (`PaperResult` in `lib/paper.ts`): `ok`; `refused` (exit 1 or 2 with `ok:false`) → 409, 404 on id and name lookups; `timeout` → 504; `unparseable` (not JSON, or it does not fit the zod shape) → 502; `failed` (another exit code, output cut at the cap) → 502; `unavailable` → 503. `GET /paper/doctor` and `GET /paper/scan/check` answer a refusal as 200 data: the failing rows and "no document in the feeder" are the answer.
- A CLI field that is not in `lib/paper-schemas.ts` is dropped; one it stops sending fails the parse. Update the schema when `paper schema` changes.

## Files

Files reach the browser from local disk only. Thumbnails and the copies `docs fetch` / `inbox fetch` make lie in paper's state dir; a route serves a path only when its realpath is under that dir (the dir comes from `paper doctor`'s config, read once and cached; a failed read is retried). `GET /paper/docs/{id}/text` is the one exception: the text lives in the brain, so the path from `paper docs text` must lie under the doctor's brain dir and be a `.md` or `.txt`, and it is read with `hc exec -- /bin/cat`. No filesystem path appears in a JSON body: scan parts carry thumbnail and page URLs (`/paper/scan/pages/{part}/{page}`), `notePath` and the CLI's `path`, `argv` and `file` fields are dropped. Doctor messages do name local paths.

## Rules that hold

- A scan starts only on `POST /paper/scan/start`, called for a person's request. No cron, health check, test or proof starts one. Printing is the same; a print proof is `hold:true`, then cancel.
- Ids, names and job ids are allowlisted (letters, digits, `.`, `-`, `_`; an inbox name may also hold spaces and brackets), none starts with `-`; filter and decision values are one line and do not start with `-`. Argv is never a shell string.
- Document contents are private: logs carry the verb, outcome and duration (`paper: call`), never an argument, message, title, issuer or text. Test fixtures are synthetic.

## Tests

`src/routes/paper.test.ts` (in `make check`, DB-free) runs the routes against `src/test/fake-hc.ts` around `src/test/fake-paper.ts`, real child processes: the fake paper answers a verb from `$FAKE_PAPER_DIR/<verb>.json` and records its argv. It covers refusal, timeout, unparseable and misshapen output, an unused exit code, the core down, `hc` missing, a path outside the state dir (also through a symlink), option-injection inputs, that no scan or print starts without its POST, the log, and that `/openapi/json` lists every `/paper` route.

## Verifying on the mini

```bash
# bearer: secrets-run read op://common/api/SECRET  (never op read on the mini)
curl -s -H "Authorization: Bearer $API_SECRET" http://127.0.0.1:7737/api/paper/doctor
curl -s -H "Authorization: Bearer $API_SECRET" http://127.0.0.1:7737/api/paper/scan/status
curl -s -H "Authorization: Bearer $API_SECRET" 'http://127.0.0.1:7737/api/paper/docs?limit=3'
```
