#!/usr/bin/env bun
/* eslint-disable no-console -- standalone CLI script: stdout is the UX. */
/**
 * M365 OAuth bootstrap — laptop-side dance against the IU MCP server using a
 * redirect URI that the upstream Azure AD app actually allows (the MCP
 * inspector default at localhost:6274). Sidesteps the AADSTS50011 we hit when
 * trying argo.jkrumm.com's callback directly.
 *
 *   --target=local (default)  Write tokens to apps/api/data/oauth-tokens.json.
 *                              Run from repo root: `bun m365:auth`.
 *   --target=prod              POST tokens to https://argo.jkrumm.com/api/m365/seed.
 *                              Run two independent SSO flows (one for local,
 *                              one for prod) and each env gets its own
 *                              forever-rotating refresh-token chain.
 *
 * Requires API_SECRET in env when --target=prod. The repo's bun scripts wrap
 * this with `op run --account tkrumm`.
 */

import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { URL, fileURLToPath } from 'node:url'

const MCP_BASE =
  process.env['M365_MCP_BASE_URL'] ??
  'https://iu-m365-mcp.kindmushroom-c7823c35.westeurope.azurecontainerapps.io'

// MCP inspector's default — known to be in the upstream AAD app's allow-list,
// per the IT colleague's "try it in inspector as reference" hint.
const REDIRECT_PORT = 6274
const REDIRECT_PATH = '/oauth/callback/debug'
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`

const PROD_SEED_URL = 'https://argo.jkrumm.com/api/m365/seed'

const SCOPES = [
  'offline_access',
  'User.Read',
  'Calendars.Read.Shared',
  'Calendars.ReadWrite',
  'Mail.Read',
  'Chat.Read',
  'Team.ReadBasic.All',
  'Channel.ReadBasic.All',
  'ChannelMessage.Read.All',
].join(' ')

const TIMEOUT_MS = 15 * 60 * 1000

interface CliArgs {
  target: 'local' | 'prod'
}

function parseArgs(): CliArgs {
  const raw = process.argv.slice(2)
  const targetArg = raw.find((a) => a.startsWith('--target='))?.split('=')[1]
  const target = (targetArg ?? 'local') as CliArgs['target']
  if (target !== 'local' && target !== 'prod') {
    console.error(`--target must be "local" or "prod", got "${target}"`)
    process.exit(1)
  }
  return { target }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function registerClient(target: CliArgs['target']): Promise<string> {
  const res = await fetch(`${MCP_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: `argo-bootstrap-${target}`,
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (!res.ok) {
    throw new Error(`DCR failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { client_id: string }
  return data.client_id
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
}

async function exchangeCode(
  clientId: string,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const res = await fetch(`${MCP_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  })
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as TokenResponse
}

interface TokensToWrite {
  clientId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
}

function writeLocal(tokens: TokensToWrite): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const dataDir = resolve(here, '..', 'data')
  const file = join(dataDir, 'oauth-tokens.json')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  const store: Record<string, unknown> = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>)
    : {}
  store['m365'] = tokens
  writeFileSync(file, JSON.stringify(store, null, 2))
  return file
}

async function seedProd(tokens: TokensToWrite): Promise<void> {
  const apiSecret = process.env['API_SECRET']
  if (!apiSecret) {
    throw new Error(
      'API_SECRET env var required for --target=prod. Run via `op run --account tkrumm --env-file=apps/api/.env.local.tpl -- bun m365:auth --target=prod`',
    )
  }
  const res = await fetch(PROD_SEED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiSecret}`,
    },
    body: JSON.stringify(tokens),
  })
  if (!res.ok) {
    throw new Error(`Prod seed failed: ${res.status} ${await res.text()}`)
  }
}

async function main(): Promise<void> {
  const { target } = parseArgs()

  console.log(`\nM365 bootstrap — target=${target}`)
  console.log(`Registering DCR client against ${MCP_BASE} ...`)
  const clientId = await registerClient(target)
  console.log(`  client_id: ${clientId}`)

  const codeVerifier = b64url(randomBytes(32))
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest())
  const expectedState = b64url(randomBytes(16))

  const authUrl = new URL(`${MCP_BASE}/authorize`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('state', expectedState)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  console.log(`\nOpen this URL in a browser and complete IU SSO:\n`)
  console.log(`  ${authUrl.toString()}\n`)
  console.log(`Listening for callback on ${REDIRECT_URI} ...`)

  let resolved = false
  const server = http.createServer((req, res) => {
    void (async (): Promise<void> => {
      if (!req.url) {
        res.writeHead(404).end('not found')
        return
      }
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`)
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404).end('not found')
        return
      }
      const error = url.searchParams.get('error')
      if (error) {
        res.writeHead(400).end(`OAuth error: ${error}`)
        console.error(`OAuth error: ${error}`)
        finish(1)
        return
      }
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || state !== expectedState) {
        // Keep listening — stale browser retries from a previous bootstrap run
        // can land here. We only exit on success or a real OAuth error.
        res.writeHead(400).end('missing or invalid code/state — ignored, still listening')
        console.error('  (ignored stale/invalid callback, still waiting)')
        return
      }

      try {
        const tokens = await exchangeCode(clientId, code, codeVerifier)
        const toWrite: TokensToWrite = {
          clientId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          scope: tokens.scope ?? SCOPES,
        }

        if (target === 'local') {
          const file = writeLocal(toWrite)
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end(
            `M365 OAuth successful — tokens written locally. You can close this tab.\n\nFile: ${file}`,
          )
          console.log(`\n✅ Wrote tokens to ${file}`)
        } else {
          await seedProd(toWrite)
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('M365 OAuth successful — tokens seeded to prod. You can close this tab.')
          console.log(`\n✅ Seeded tokens to ${PROD_SEED_URL}`)
        }
        finish(0)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        res.writeHead(500).end(msg)
        console.error(`\n❌ ${msg}`)
        finish(1)
      }
    })()
  })

  function finish(exit: number): void {
    if (resolved) return
    resolved = true
    server.close(() => process.exit(exit))
  }

  server.listen(REDIRECT_PORT, '127.0.0.1')

  setTimeout(() => {
    console.error(`\n❌ Timed out after ${TIMEOUT_MS / 1000}s waiting for callback`)
    finish(1)
  }, TIMEOUT_MS).unref()
}

await main()
