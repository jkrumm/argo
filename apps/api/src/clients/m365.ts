import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash, randomBytes } from 'crypto'
import { env } from '../env.js'
import { tracedFetch } from '../lib/traced-fetch.js'

const MCP_BASE = env.M365_MCP_BASE_URL
const REDIRECT_URI = env.M365_OAUTH_REDIRECT_URI

// DCR registers both URIs so the same client_id is valid in local + prod.
const REGISTERED_REDIRECT_URIS = [
  'http://localhost:4000/oauth/m365/callback',
  'https://argo.jkrumm.com/api/oauth/m365/callback',
]

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

const MCP_PROTOCOL_VERSION = '2024-11-05'
const REFRESH_LEEWAY_MS = 5 * 60 * 1000

const DATA_DIR = env.DATA_DIR
const TOKEN_FILE = join(DATA_DIR, 'oauth-tokens.json')

export interface M365State {
  clientId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
}

export interface SeedTokens {
  clientId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
}

// Loose store type: each integration owns its slice and preserves unknown
// keys (e.g. google) on write so they don't get clobbered.
type TokenStore = Record<string, unknown> & { m365?: M365State }

function loadTokens(): TokenStore {
  if (!existsSync(TOKEN_FILE)) return {}
  return JSON.parse(readFileSync(TOKEN_FILE, 'utf-8')) as TokenStore
}

function saveTokens(store: TokenStore): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2))
}

function loadM365(): M365State {
  return loadTokens().m365 ?? {}
}

function patchM365(patch: M365State): void {
  const store = loadTokens()
  store.m365 = { ...store.m365, ...patch }
  saveTokens(store)
}

/**
 * Seed M365 tokens from an external bootstrap (laptop-side OAuth flow against
 * an AAD-allowed redirect URI like the MCP inspector's localhost:6274). Used
 * by POST /m365/seed to ship a fresh grant from laptop → VPS without exposing
 * the VPS to the IU SSO browser dance.
 */
export function seedTokens(tokens: SeedTokens): void {
  patchM365(tokens)
  // Reset MCP session state so the next call re-initializes with new creds.
  sessionId = undefined
  initialized = false
}

// ---------- Dynamic Client Registration (RFC 7591) ----------

async function registerClient(): Promise<string> {
  const res = await tracedFetch(`${MCP_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'argo',
      redirect_uris: REGISTERED_REDIRECT_URIS,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (!res.ok) throw new Error(`M365 DCR failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { client_id: string }
  patchM365({ clientId: data.client_id })
  return data.client_id
}

async function getClientId(): Promise<string> {
  const m = loadM365()
  if (m.clientId) return m.clientId
  return registerClient()
}

// ---------- PKCE + state ----------

interface PendingAuth {
  codeVerifier: string
  createdAt: number
}

const pendingAuths = new Map<string, PendingAuth>()
const PENDING_TTL_MS = 10 * 60 * 1000

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function newPkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = b64url(randomBytes(32))
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest())
  return { codeVerifier, codeChallenge }
}

function gcPending(): void {
  const now = Date.now()
  for (const [k, v] of pendingAuths) {
    if (now - v.createdAt > PENDING_TTL_MS) pendingAuths.delete(k)
  }
}

export async function getAuthUrl(): Promise<string> {
  gcPending()
  const clientId = await getClientId()
  const state = b64url(randomBytes(16))
  const { codeVerifier, codeChallenge } = newPkce()
  pendingAuths.set(state, { codeVerifier, createdAt: Date.now() })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${MCP_BASE}/authorize?${params}`
}

export async function exchangeCode(code: string, state: string): Promise<void> {
  const entry = pendingAuths.get(state)
  if (!entry)
    throw new Error(
      'Unknown or expired OAuth state. This route is only reachable if the IU AAD app has been updated to allow argo.jkrumm.com / localhost:4000 callbacks; otherwise use `bun m365:auth` instead.',
    )
  pendingAuths.delete(state)

  const clientId = await getClientId()
  const res = await tracedFetch(`${MCP_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: entry.codeVerifier,
    }),
  })
  if (!res.ok) throw new Error(`M365 token exchange failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    scope?: string
  }
  patchM365({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? SCOPES,
  })
}

const NOT_AUTHENTICATED_MSG =
  'M365 not authenticated. Run `bun m365:auth` (local) or `bun m365:auth:prod` (prod) to seed tokens via the laptop bootstrap script. See apps/api/scripts/m365-bootstrap.ts.'

const REFRESH_FAILED_HINT =
  'If this persists (e.g. refresh token revoked or 90-day inactivity expiry), re-seed via `bun m365:auth` (local) / `bun m365:auth:prod` (prod).'

async function refreshAccessToken(): Promise<string> {
  const m = loadM365()
  if (!m.refreshToken) {
    throw new Error(NOT_AUTHENTICATED_MSG)
  }
  const clientId = await getClientId()
  const res = await tracedFetch(`${MCP_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: m.refreshToken,
    }),
  })
  if (!res.ok) {
    throw new Error(
      `M365 token refresh failed: ${res.status} ${await res.text()}. ${REFRESH_FAILED_HINT}`,
    )
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }
  patchM365({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? m.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    ...(data.scope !== undefined ? { scope: data.scope } : {}),
  })
  return data.access_token
}

async function getValidAccessToken(): Promise<string> {
  const m = loadM365()
  if (!m.accessToken || !m.expiresAt) return refreshAccessToken()
  if (Date.now() >= m.expiresAt - REFRESH_LEEWAY_MS) return refreshAccessToken()
  return m.accessToken
}

// ---------- MCP transport (Streamable HTTP, JSON-RPC 2.0) ----------

let sessionId: string | undefined
let initialized = false
let nextRpcId = 1

interface JsonRpcResponse<T> {
  jsonrpc: '2.0'
  id: number
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

function parseSseFrame<T>(text: string): JsonRpcResponse<T> {
  // Server-Sent Events: take the first `data:` line and JSON-parse the payload.
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  if (!line) throw new Error('MCP SSE response had no data frame')
  return JSON.parse(line.slice(5).trim()) as JsonRpcResponse<T>
}

async function mcpPost(body: unknown, token: string): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  const res = await tracedFetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const newSid = res.headers.get('mcp-session-id') ?? res.headers.get('Mcp-Session-Id')
  if (newSid) sessionId = newSid
  return res
}

async function mcpRequest<T>(method: string, params: unknown = {}): Promise<T> {
  const token = await getValidAccessToken()
  const id = nextRpcId++
  const res = await mcpPost({ jsonrpc: '2.0', id, method, params }, token)
  if (!res.ok) {
    throw new Error(`MCP ${method} failed: ${res.status} ${await res.text()}`)
  }
  const ct = res.headers.get('content-type') ?? ''
  const payload = ct.includes('text/event-stream')
    ? parseSseFrame<T>(await res.text())
    : ((await res.json()) as JsonRpcResponse<T>)
  if (payload.error) {
    throw new Error(`MCP ${method} error ${payload.error.code}: ${payload.error.message}`)
  }
  return payload.result as T
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return
  await mcpRequest('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'argo-api', version: '1.0.0' },
  })
  // Per MCP spec, follow up with a notification (no id, no response expected).
  const token = await getValidAccessToken()
  await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, token).catch(
    () => undefined,
  )
  initialized = true
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export async function listTools(): Promise<McpTool[]> {
  await ensureInitialized()
  const result = await mcpRequest<{ tools: McpTool[] }>('tools/list')
  return result.tools ?? []
}
