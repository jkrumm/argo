/* eslint-disable no-console */
/**
 * One-shot M365 MCP discovery script.
 *
 * Run from repo root:
 *   DATABASE_URL='postgresql://noop@localhost:5432/noop' \
 *     op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
 *     bun run --cwd apps/api scripts/m365-discover.ts [tool-name ...]
 *
 * No args → run the full search-tools sweep + dump schemas for top picks.
 * With args → just dump get-tool-schema for each named tool.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { env } from '../src/env.js'

const MCP_BASE = env.M365_MCP_BASE_URL
const PROTO = '2024-11-05'
const TOKEN_FILE = join(env.DATA_DIR, 'oauth-tokens.json')

interface M365 {
  clientId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

function loadStore(): Record<string, unknown> {
  if (!existsSync(TOKEN_FILE)) return {}
  return JSON.parse(readFileSync(TOKEN_FILE, 'utf-8')) as Record<string, unknown>
}
function saveStore(s: Record<string, unknown>): void {
  if (!existsSync(env.DATA_DIR)) mkdirSync(env.DATA_DIR, { recursive: true })
  writeFileSync(TOKEN_FILE, JSON.stringify(s, null, 2))
}
function patch(p: M365): void {
  const s = loadStore()
  s['m365'] = { ...(s['m365'] as object | undefined), ...p }
  saveStore(s)
}
async function refresh(): Promise<string> {
  const s = loadStore()
  const m = s['m365'] as M365 | undefined
  if (!m?.refreshToken || !m.clientId) throw new Error('not auth')
  const res = await fetch(`${MCP_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      clientrpcId: m.clientId,
      refresh_token: m.refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text()}`)
  const d = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  patch({
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? m.refreshToken,
    expiresAt: Date.now() + d.expires_in * 1000,
  })
  return d.access_token
}
let sid: string | undefined
let initialized = false
let rpcId = 1
async function post(body: unknown, token: string): Promise<Response> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'MCP-Protocol-Version': PROTO,
  }
  if (sid) h['Mcp-Session-Id'] = sid
  const res = await fetch(`${MCP_BASE}/mcp`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(body),
  })
  const newSid = res.headers.get('mcp-session-id') ?? res.headers.get('Mcp-Session-Id')
  if (newSid) sid = newSid
  return res
}
function parseSse(text: string): unknown {
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  if (!line) throw new Error('no SSE data frame')
  return JSON.parse(line.slice(5).trim())
}
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const token = await refresh()
  const id = rpcId++
  const res = await post({ jsonrpc: '2.0', id, method, params }, token)
  if (!res.ok) throw new Error(`${method} ${res.status}: ${await res.text()}`)
  const ct = res.headers.get('content-type') ?? ''
  const payload = (
    ct.includes('text/event-stream') ? parseSse(await res.text()) : await res.json()
  ) as {
    result?: T
    error?: { code: number; message: string }
  }
  if (payload.error)
    throw new Error(`${method} error ${payload.error.code}: ${payload.error.message}`)
  return payload.result as T
}
async function init(): Promise<void> {
  if (initialized) return
  await rpc('initialize', {
    protocolVersion: PROTO,
    capabilities: {},
    clientInfo: { name: 'argo-discover', version: '0.0.1' },
  })
  const token = await refresh()
  await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, token).catch(
    () => undefined,
  )
  initialized = true
}
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  await init()
  return rpc('tools/call', { name, arguments: args })
}

interface ToolHit {
  name: string
  description?: string
  category?: string
  path?: string
  method?: string
  score?: number
}
interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
  structuredContent?: unknown
}

// MCP server wraps responses as { content: [{type:'text', text: JSON-string}] }
// where JSON-string carries the actual payload (search results OR a schema).
function unwrap<T>(r: unknown): T {
  const tc = r as ToolCallResult
  if (tc.structuredContent !== undefined) return tc.structuredContent as T
  const text = tc.content?.find((c) => c.type === 'text')?.text
  if (text === undefined) throw new Error('no content')
  return JSON.parse(text) as T
}

async function searchHits(query: string): Promise<ToolHit[]> {
  const r = await callTool('search-tools', { query, limit: 8 })
  const body = unwrap<{ tools: ToolHit[] }>(r)
  return body.tools ?? []
}

async function dumpSchema(toolName: string): Promise<void> {
  console.log(`\n══ schema: ${toolName}`)
  try {
    const r = await callTool('get-tool-schema', { tool_name: toolName })
    const schema = unwrap<unknown>(r)
    console.log(JSON.stringify(schema, null, 2))
  } catch (e) {
    console.log(`  ERROR: ${(e as Error).message}`)
  }
}

async function runFullSweep(): Promise<void> {
  console.log('M365 MCP discovery — full sweep')
  const queries: Array<{ label: string; query: string }> = [
    { label: 'cal:list', query: 'list calendar events' },
    { label: 'cal:view', query: 'calendar view range' },
    { label: 'cal:upcoming', query: 'upcoming meetings' },
    { label: 'teams:list', query: 'list joined teams' },
    { label: 'teams:channels', query: 'list channels in team' },
    { label: 'teams:msgs', query: 'list channel messages' },
  ]
  const found = new Map<string, ToolHit>()
  for (const q of queries) {
    console.log(`\n── ${q.label}  (query="${q.query}")`)
    try {
      const hits = await searchHits(q.query)
      hits.forEach((h, i) => {
        const path = h.method && h.path ? ` [${h.method} ${h.path}]` : ''
        const desc = h.description ? `\n      ${h.description.slice(0, 160)}` : ''
        console.log(`  ${i + 1}. ${h.name}${path}${desc}`)
        if (!found.has(h.name)) found.set(h.name, h)
      })
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`)
    }
  }
  console.log(`\n── ${found.size} unique tool names`)
  const picks = [
    'get-calendar-view',
    'list-calendar-events',
    'list-joined-teams',
    'list-team-channels',
    'list-channel-messages',
  ].filter((n) => found.has(n))
  for (const n of picks) await dumpSchema(n)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length > 0) {
    for (const name of args) await dumpSchema(name)
  } else {
    await runFullSweep()
  }
  console.log('\nDone.')
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
