import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { env } from '../env.js'
import { tracedFetch } from '../lib/traced-fetch.js'

const MCP_BASE = env.M365_MCP_BASE_URL
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

const NOT_AUTHENTICATED_MSG =
  'M365 not authenticated. Run `bun m365:auth` (local) or `bun m365:auth:prod` (prod) to seed tokens via the laptop bootstrap script. See apps/api/scripts/m365-bootstrap.ts.'

const REFRESH_FAILED_HINT =
  'If this persists (e.g. refresh token revoked or 90-day inactivity expiry), re-seed via `bun m365:auth` (local) / `bun m365:auth:prod` (prod).'

/**
 * Seed M365 tokens from the laptop bootstrap (apps/api/scripts/m365-bootstrap.ts).
 * Canonical install path — see POST /m365/seed. The bootstrap owns DCR + PKCE +
 * the IU SSO dance; this module only persists the resulting grant and refreshes
 * the access token on demand.
 */
export function seedTokens(tokens: SeedTokens): void {
  patchM365(tokens)
  // Reset MCP session state so the next call re-initializes with new creds.
  sessionId = undefined
  initialized = false
}

async function refreshAccessToken(): Promise<string> {
  const m = loadM365()
  if (!m.refreshToken || !m.clientId) {
    throw new Error(NOT_AUTHENTICATED_MSG)
  }
  const res = await tracedFetch(`${MCP_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: m.clientId,
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

async function mcpRequest<T>(method: string, params: unknown = {}, retried = false): Promise<T> {
  const token = await getValidAccessToken()
  const id = nextRpcId++
  const res = await mcpPost({ jsonrpc: '2.0', id, method, params }, token)
  // Cached AT can be server-revoked despite passing the local leeway check
  // (manual revoke, clock skew, IT-side token wipe). Force a refresh once.
  if (res.status === 401 && !retried) {
    await res.text().catch(() => undefined)
    await refreshAccessToken()
    return mcpRequest<T>(method, params, true)
  }
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

// ---------- Meta-tool dispatch (search → schema → execute) ----------
//
// The IU M365 MCP exposes 3 meta-tools that fan out to ~270 Graph operations.
// Argo never surfaces execute-tool publicly — every Phase 2 route hard-codes a
// single (tool_name, parameter shape) and uses callGraphTool internally.

interface McpToolCallResult {
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
  structuredContent?: unknown
}

async function callMetaTool<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
  await ensureInitialized()
  const result = await mcpRequest<McpToolCallResult>('tools/call', {
    name: toolName,
    arguments: args,
  })
  if (result.isError) {
    const text = result.content?.find((c) => c.type === 'text')?.text ?? ''
    throw new Error(`M365 ${toolName} failed: ${text}`)
  }
  if (result.structuredContent !== undefined) return result.structuredContent as T
  const text = result.content?.find((c) => c.type === 'text')?.text
  if (text === undefined) throw new Error(`M365 ${toolName} returned no content`)
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export interface SearchToolsHit {
  name: string
  description?: string
  category?: string
  path?: string
  method?: string
  score?: number
}

export async function searchTools(
  query: string,
  opts: { category?: string; limit?: number } = {},
): Promise<SearchToolsHit[]> {
  const args: Record<string, unknown> = { query }
  if (opts.category) args['category'] = opts.category
  if (opts.limit) args['limit'] = opts.limit
  const r = await callMetaTool<
    { tools?: SearchToolsHit[]; results?: SearchToolsHit[] } | SearchToolsHit[]
  >('search-tools', args)
  if (Array.isArray(r)) return r
  return r.tools ?? r.results ?? []
}

export async function getToolSchema(toolName: string): Promise<unknown> {
  return callMetaTool<unknown>('get-tool-schema', { tool_name: toolName })
}

/**
 * Execute a Microsoft Graph operation through the MCP meta-dispatcher.
 *
 * Path/query/header params go at the top level of `parameters`; request bodies
 * go under `parameters.body` (per MCP server spec — see /m365/tools output).
 * Argo routes hard-code both `toolName` and the shape of `parameters` — this
 * helper is internal-only and must never be exposed via a generic endpoint.
 */
export async function callGraphTool<T>(
  toolName: string,
  parameters: Record<string, unknown> = {},
): Promise<T> {
  return callMetaTool<T>('execute-tool', { tool_name: toolName, parameters })
}

// ---------- Calendar ----------

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  isOnlineMeeting: boolean
  location?: string
  organizer?: { name: string; email: string }
  attendees: Array<{ name: string; email: string; status: string }>
  bodyPreview?: string
  videoLink?: string
  webLink?: string
}

interface GraphDateTime {
  dateTime: string
  timeZone?: string
}
interface GraphEmailAddress {
  name?: string
  address?: string
}
interface GraphAttendee {
  emailAddress?: GraphEmailAddress
  status?: { response?: string }
}
interface GraphEvent {
  id?: string
  subject?: string
  bodyPreview?: string
  webLink?: string
  isAllDay?: boolean
  isOnlineMeeting?: boolean
  start?: GraphDateTime
  end?: GraphDateTime
  organizer?: { emailAddress?: GraphEmailAddress }
  attendees?: GraphAttendee[]
  location?: { displayName?: string }
  onlineMeeting?: { joinUrl?: string }
}

// Graph returns dateTime as "2026-05-13T09:00:00.0000000" without offset (UTC
// when no Prefer header is set). For all-day events the value is midnight UTC
// and we emit a date-only string to match the existing Google calendar shape.
function graphDateTimeToIso(dt: GraphDateTime | undefined, isAllDay: boolean): string {
  if (!dt?.dateTime) return ''
  if (isAllDay) return dt.dateTime.slice(0, 10)
  // Trim sub-millisecond precision Graph emits; append Z when no offset present.
  const trimmed = dt.dateTime.replace(/\.\d+$/, '').replace(/Z?$/, 'Z')
  return new Date(trimmed).toISOString()
}

const RESPONSE_MAP: Record<string, string> = {
  accepted: 'accepted',
  declined: 'declined',
  tentativelyAccepted: 'tentative',
  notResponded: 'needsAction',
  none: 'needsAction',
  organizer: 'organizer',
}

function normalizeEvent(e: GraphEvent): CalendarEvent {
  const isAllDay = e.isAllDay ?? false
  const organizerEmail = e.organizer?.emailAddress
  const attendees = (e.attendees ?? []).map((a) => ({
    name: a.emailAddress?.name ?? '',
    email: a.emailAddress?.address ?? '',
    status: RESPONSE_MAP[a.status?.response ?? ''] ?? 'unknown',
  }))
  return {
    id: e.id ?? '',
    title: e.subject ?? '',
    start: graphDateTimeToIso(e.start, isAllDay),
    end: graphDateTimeToIso(e.end, isAllDay),
    isAllDay,
    isOnlineMeeting: e.isOnlineMeeting ?? false,
    ...(e.location?.displayName ? { location: e.location.displayName } : {}),
    ...(organizerEmail?.address
      ? { organizer: { name: organizerEmail.name ?? '', email: organizerEmail.address } }
      : {}),
    attendees,
    ...(e.bodyPreview ? { bodyPreview: e.bodyPreview } : {}),
    ...(e.onlineMeeting?.joinUrl ? { videoLink: e.onlineMeeting.joinUrl } : {}),
    ...(e.webLink ? { webLink: e.webLink } : {}),
  }
}

// ---------- Teams: joined teams + channels ----------

export interface Team {
  id: string
  displayName: string
  description: string | null
  webUrl: string | null
  isArchived: boolean
}

export interface Channel {
  id: string
  displayName: string
  description: string | null
  webUrl: string | null
  membershipType: string
  createdAt: string | null
}

interface GraphTeam {
  id?: string
  displayName?: string
  description?: string | null
  webUrl?: string | null
  isArchived?: boolean
}

interface GraphChannel {
  id?: string
  displayName?: string
  description?: string | null
  webUrl?: string | null
  membershipType?: string
  createdDateTime?: string
}

function normalizeTeam(raw: GraphTeam): Team {
  return {
    id: raw.id ?? '',
    displayName: raw.displayName ?? '',
    description: raw.description ?? null,
    webUrl: raw.webUrl ?? null,
    isArchived: raw.isArchived ?? false,
  }
}

function normalizeChannel(raw: GraphChannel): Channel {
  return {
    id: raw.id ?? '',
    displayName: raw.displayName ?? '',
    description: raw.description ?? null,
    webUrl: raw.webUrl ?? null,
    membershipType: raw.membershipType ?? 'standard',
    createdAt: raw.createdDateTime ?? null,
  }
}

export async function listJoinedTeams(): Promise<Team[]> {
  // /me/joinedTeams rejects $top; pass an empty params object instead.
  const r = await callGraphTool<{ value?: GraphTeam[] }>('list-joined-teams', {})
  return (r.value ?? []).map(normalizeTeam)
}

export async function listTeamChannels(teamId: string): Promise<Channel[]> {
  // /teams/:teamId/channels rejects $top; the endpoint returns the full list.
  const r = await callGraphTool<{ value?: GraphChannel[] }>('list-team-channels', { teamId })
  return (r.value ?? []).map(normalizeChannel)
}

// ---------- Teams: chats (1:1, group, meeting) ----------

export type ChatType = 'oneOnOne' | 'group' | 'meeting' | 'unknownFutureValue'

export interface ChatMember {
  name: string
  email: string | null
  userId: string | null
}

export interface ChatSummary {
  id: string
  topic: string | null
  chatType: ChatType
  webUrl: string | null
  createdAt: string | null
  lastUpdatedAt: string | null
  members: ChatMember[]
  /** Last activity preview (sender + plain-text snippet) when expanded. */
  lastMessagePreview: {
    from: string | null
    text: string
    createdAt: string | null
  } | null
}

interface GraphChatMember {
  displayName?: string
  email?: string | null
  userId?: string | null
}

interface GraphLastMessagePreview {
  createdDateTime?: string
  body?: { contentType?: string; content?: string }
  from?: { user?: { displayName?: string } }
}

interface GraphChat {
  id?: string
  topic?: string | null
  chatType?: string
  webUrl?: string | null
  createdDateTime?: string
  lastUpdatedDateTime?: string
  members?: GraphChatMember[]
  lastMessagePreview?: GraphLastMessagePreview | null
}

function htmlToText(input: string): string {
  // The MCP/Graph delivers chat messages with HTML body — strip tags for a
  // preview that's readable to agents and humans without a renderer.
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeChatType(raw: string | undefined): ChatType {
  switch (raw) {
    case 'oneOnOne':
    case 'group':
    case 'meeting':
      return raw
    default:
      return 'unknownFutureValue'
  }
}

function normalizeChat(raw: GraphChat): ChatSummary {
  const members: ChatMember[] = (raw.members ?? []).map((m) => ({
    name: m.displayName ?? '',
    email: m.email ?? null,
    userId: m.userId ?? null,
  }))
  let lastMessagePreview: ChatSummary['lastMessagePreview'] = null
  const lp = raw.lastMessagePreview
  if (lp && (lp.body?.content || lp.createdDateTime)) {
    const text =
      lp.body?.contentType === 'html' ? htmlToText(lp.body.content ?? '') : (lp.body?.content ?? '')
    lastMessagePreview = {
      from: lp.from?.user?.displayName ?? null,
      text: text.slice(0, 280),
      createdAt: lp.createdDateTime ?? null,
    }
  }
  return {
    id: raw.id ?? '',
    topic: raw.topic ?? null,
    chatType: normalizeChatType(raw.chatType),
    webUrl: raw.webUrl ?? null,
    createdAt: raw.createdDateTime ?? null,
    lastUpdatedAt: raw.lastUpdatedDateTime ?? null,
    members,
    lastMessagePreview,
  }
}

export async function listChats(opts: { top?: number } = {}): Promise<ChatSummary[]> {
  // Graph default order for /me/chats is lastMessagePreview/createdDateTime
  // desc — explicit orderby chokes on nested paths, so let the server sort
  // and apply a secondary sort client-side as a safety net.
  const r = await callGraphTool<{ value?: GraphChat[] }>('list-chats', {
    top: opts.top ?? 50,
    expand: ['members', 'lastMessagePreview'],
  })
  const chats = (r.value ?? []).map(normalizeChat)
  return chats.toSorted((a, b) => {
    const ax = a.lastMessagePreview?.createdAt ?? a.lastUpdatedAt ?? ''
    const bx = b.lastMessagePreview?.createdAt ?? b.lastUpdatedAt ?? ''
    return bx.localeCompare(ax)
  })
}

// ---------- Teams: chat + channel messages ----------

export interface MessageAttachment {
  name: string | null
  contentType: string | null
  contentUrl: string | null
}

export interface ChatMessage {
  id: string
  createdAt: string | null
  lastModifiedAt: string | null
  from: { name: string; email: string | null } | null
  subject: string | null
  importance: string
  bodyText: string
  bodyHtml: string | null
  webUrl: string | null
  attachments: MessageAttachment[]
  /** Number of replies (channel messages can be reply roots); 0 for chat messages. */
  replyCount: number
  /**
   * True when the message is a Graph system event (join/leave, member added,
   * meeting started/ended). Body is empty and `from` is null. Default filtered
   * out by chat/channel/important routes; opt back in with ?includeSystem=true.
   */
  isSystem: boolean
}

interface GraphMessageBody {
  contentType?: string
  content?: string
}

interface GraphMessageAttachment {
  name?: string
  contentType?: string
  contentUrl?: string
}

interface GraphIdentitySet {
  user?: { displayName?: string; id?: string }
  application?: { displayName?: string; id?: string }
}

interface GraphChatMessage {
  id?: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  subject?: string | null
  importance?: string
  webUrl?: string | null
  from?: GraphIdentitySet | null
  body?: GraphMessageBody
  attachments?: GraphMessageAttachment[]
  replies?: GraphChatMessage[]
}

function normalizeMessage(
  raw: GraphChatMessage,
  userEmailLookup?: Map<string, string>,
): ChatMessage {
  const body = raw.body ?? {}
  const isHtml = (body.contentType ?? 'text').toLowerCase() === 'html'
  const rawContent = body.content ?? ''
  const html = isHtml ? rawContent || null : null
  const text = isHtml ? htmlToText(rawContent) : rawContent
  const userId = raw.from?.user?.id
  const fromName = raw.from?.user?.displayName ?? raw.from?.application?.displayName ?? null
  const from = fromName
    ? { name: fromName, email: (userId && userEmailLookup?.get(userId)) ?? null }
    : null
  // Graph wraps join/leave + meeting started/ended in <systemEventMessage>.
  // After tag-stripping these come out as empty text with a null `from` — both
  // are reliable signals; combine them so we don't flag user "Sent an empty
  // message" as system.
  const isSystem = !from && (rawContent.includes('<systemEventMessage') || text.trim() === '')
  return {
    id: raw.id ?? '',
    createdAt: raw.createdDateTime ?? null,
    lastModifiedAt: raw.lastModifiedDateTime ?? null,
    from,
    subject: raw.subject ?? null,
    importance: raw.importance ?? 'normal',
    bodyText: text,
    bodyHtml: html,
    webUrl: raw.webUrl ?? null,
    attachments: (raw.attachments ?? []).map((a) => ({
      name: a.name ?? null,
      contentType: a.contentType ?? null,
      contentUrl: a.contentUrl ?? null,
    })),
    replyCount: raw.replies?.length ?? 0,
    isSystem,
  }
}

export async function listChatMessages(opts: {
  chatId: string
  top?: number
  includeSystem?: boolean
}): Promise<ChatMessage[]> {
  // Graph rejects $orderby on chat/channel messages — both endpoints return
  // newest-first by default. `top` is the only pagination knob. We over-fetch
  // a bit when filtering so the post-filter result still hits the target size.
  const ask = opts.top ?? 20
  const fetchTop = opts.includeSystem ? ask : Math.min(50, ask * 3)
  const r = await callGraphTool<{ value?: GraphChatMessage[] }>('list-chat-messages', {
    chatId: opts.chatId,
    top: fetchTop,
  })
  const all = (r.value ?? []).map((m) => normalizeMessage(m))
  const filtered = opts.includeSystem ? all : all.filter((m) => !m.isSystem)
  return filtered.slice(0, ask)
}

export async function listChannelMessages(opts: {
  teamId: string
  channelId: string
  top?: number
  includeSystem?: boolean
}): Promise<ChatMessage[]> {
  const ask = opts.top ?? 20
  const fetchTop = opts.includeSystem ? ask : Math.min(50, ask * 3)
  const r = await callGraphTool<{ value?: GraphChatMessage[] }>('list-channel-messages', {
    teamId: opts.teamId,
    channelId: opts.channelId,
    top: fetchTop,
  })
  const all = (r.value ?? []).map((m) => normalizeMessage(m))
  const filtered = opts.includeSystem ? all : all.filter((m) => !m.isSystem)
  return filtered.slice(0, ask)
}

// ---------- Calendar ----------

/**
 * Returns expanded calendar events (recurring series flattened to occurrences)
 * from the user's default Outlook calendar within `[now, now + days)`.
 * Sorted ascending by start. Uses Graph's `/me/calendarView` via the MCP
 * meta-dispatcher (tool: get-calendar-view).
 */
export async function listUpcomingCalendarEvents(days: number): Promise<CalendarEvent[]> {
  const now = new Date()
  const end = new Date(now.getTime() + days * 86_400_000)
  const r = await callGraphTool<{ value?: GraphEvent[] }>('get-calendar-view', {
    startDateTime: now.toISOString(),
    endDateTime: end.toISOString(),
    orderby: ['start/dateTime'],
    top: 200,
    select: [
      'id',
      'subject',
      'bodyPreview',
      'webLink',
      'isAllDay',
      'isOnlineMeeting',
      'start',
      'end',
      'organizer',
      'attendees',
      'location',
      'onlineMeeting',
    ],
  })
  return (r.value ?? []).map(normalizeEvent)
}
