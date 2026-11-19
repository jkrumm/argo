# API Google and M365 auth

Moved from `apps/api/AGENTS.md`. Read before changing Google or M365 token handling, seeding, access control or re-auth.

## Google (Gmail + Calendar)

In-browser OAuth, refresh-token based. Local and prod are independent grants — each holds its own `google` slice in `data/oauth-tokens.json` (alongside the M365 slice).

### Token install / refresh

```bash
bun google:auth:prod     # copies https://argo.jkrumm.com/api/oauth/google/init to clipboard
```

Paste into a browser signed into one of the allowlisted Google accounts. On completion, Google calls the prod callback and the API writes the tokens to disk. No script — pure browser flow.

`bun google:auth` (local) is left in place for emergencies but **local OAuth is intentionally not used in normal development** — see "Local Google auth — intentionally disabled" below.

### Local Google auth — intentionally disabled

Google refresh tokens grant ~6 months of Gmail + Calendar read access. On prod they sit in the mini's `~/.argo/state` (mode 600), an acceptable risk. On a laptop they would sit in plain JSON owned by the user, readable by anything running as that user — other dev tooling, IDE extensions, stray transitive deps. The marginal benefit of `bun dev` reaching Google directly does not justify that attack surface.

Therefore `apps/api/.env.local.tpl` does not wire `GOOGLE_*` env vars, and `data/oauth-tokens.json` should never contain a `google` slice on a developer laptop. For Google-backed features, use `bun dev:prod-api` — the local dashboard proxies `/api/*` to `argo.jkrumm.com`, which holds the prod tokens.

Under `bun dev`, `/calendar` returns 503 and the dashboard renders its standard re-auth alert. That is the intended behavior, not a bug.

### Refresh behavior

`clients/google.ts:getValidAccessToken()` auto-refreshes when the access token has less than 5 minutes of life left. Refresh tokens themselves do not normally expire — except in one case below.

### When to re-auth

- The Google Cloud OAuth client is in **"Testing"** publishing status → refresh tokens expire after **7 days**. Either re-auth weekly with `bun google:auth*`, or publish the OAuth app (Google Cloud Console → OAuth consent screen → **Publish App**) to lift refresh tokens to the standard 6-month-idle policy. **This is the most likely cause of recurring 503s on `/calendar` and Gmail endpoints.**
- The Google account password changed, or the user revoked the grant at https://myaccount.google.com/permissions.
- The token file was deleted.

### Access control — `GOOGLE_ALLOWED_EMAIL`

When the OAuth app is published to **In Production**, the consent screen is reachable by anyone who knows the `client_id`. Without further protection, a stranger could complete the flow and **overwrite** the stored tokens with their own grant — breaking the app and pulling their data onto our disk.

`GOOGLE_ALLOWED_EMAIL` (comma-separated list of emails) closes this. `clients/google.ts:exchangeCode()` calls `/oauth2/v2/userinfo` immediately after the token exchange and refuses to persist if the authenticated email is not on the list. Empty value disables the check (suitable only for private deployments). Set it on prod via the standard env path (`op://vps/argo/GOOGLE_ALLOWED_EMAIL`) and redeploy.

The refresh path is not gated because once a permitted token is saved, refresh only rotates the access token under the same `refresh_token` — there is no second consent step to attack.

The Calendar page in the dashboard surfaces a "Re-authorize Google →" link in its error alert when `/calendar` returns 503, so the re-auth flow is one click from the UI.

## M365 (IU Microsoft 365 MCP)

Wraps the IU M365 MCP server (proxy over Microsoft Graph — calendar, mail, Teams, OneDrive, OneNote, ~270 operations behind 3 meta-tools). Argo never sees the user's IU password; it holds an OAuth refresh token per environment.

### Why bootstrap-script-only

The upstream Azure AD app's redirect-URI allow-list doesn't include `argo.jkrumm.com/api/...` — only the MCP-inspector callback (`http://localhost:6274/oauth/callback/debug`) is allowed. The IT colleague won't widen it without justification. So argo has no in-process OAuth init route; tokens are always installed by a laptop-side bootstrap script that uses the inspector URI, then POSTs the result to `/m365/seed`.

### Token install / refresh

```bash
# One-time per env (each is an independent OAuth grant, separate refresh-token chain):
bun m365:auth          # writes apps/api/data/oauth-tokens.json on the laptop
bun m365:auth:prod     # POSTs to https://argo.jkrumm.com/api/m365/seed
```

Both run `apps/api/scripts/m365-bootstrap.ts`, which spawns a one-shot HTTP server on `localhost:6274`, does its own DCR + PKCE + token exchange against the MCP server, then either writes the file or seeds prod via `POST /m365/seed` (bearer-auth gated by `API_SECRET`). The script prints the IU SSO URL to stdout; you complete it in a browser; the success page lands and the process exits.

### Where tokens live

- **Local:** `apps/api/data/oauth-tokens.json` — gitignored, on the laptop's disk, owned by the user.
- **Prod:** `~/.argo/state/oauth-tokens.json` on the mini (`DATA_DIR`, mode 600), outside every release, so it survives `make deploy`. Copied from the VPS at the 2026-10-30 cutover.

Tokens are NOT stored in 1Password or in env vars — they're per-grant, per-env runtime state. Both files coexist with the existing `google` OAuth tokens (each integration owns its slice of the JSON; `clients/oauth-token-store.ts` is the only writer: in-process mutex, per-provider single-flight refresh, atomic tmp + rename).

The M365 chat/channel labels live in `DATA_DIR/m365-labels.json` (seeded from the committed `apps/api/m365-labels.json` when absent), so they survive deploys and rollbacks; `clients/m365-labels-store.ts` serialises and atomically writes them.

### Refresh behavior

`clients/m365.ts` refreshes the access token automatically when it has less than 5 minutes of life left. Microsoft rotates refresh tokens on every use; we persist the new one each round. Either env stays alive forever as long as it gets called at least once every 90 days (Microsoft's inactivity ceiling). Local and prod do not race — independent grants → independent rotation chains.

### When to re-seed

Re-run `bun m365:auth*` if:

- `/m365/*` returns `M365 not authenticated …` (refresh token revoked, file deleted, or 90-day inactivity expired)
- You changed your IU password (revokes all grants)
- You explicitly want to invalidate the current token and start fresh

The same command both installs and replaces — no clean-up step needed.
