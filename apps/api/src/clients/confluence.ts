// HTTP Basic-auth client for Atlassian Cloud (Confluence). Read-only.
//
// Wraps two Confluence APIs on the same host:
//   - REST API v2 (spaces, pages, children, comments)   — /wiki/api/v2
//   - REST API v1 (CQL search — still v1-only)          — /wiki/rest/api
//
// Reuses the Jira credentials (same Atlassian API token works for both
// products): ATLASSIAN_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.

import { env } from '../env.js'
import { tracedFetch } from '../lib/traced-fetch.js'

const BASE_URL = env.ATLASSIAN_BASE_URL
const EMAIL = env.JIRA_EMAIL
const TOKEN = env.JIRA_API_TOKEN

function ensureConfigured(): void {
  if (!BASE_URL || !EMAIL || !TOKEN) {
    throw new Error(
      'Confluence not configured — set ATLASSIAN_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN',
    )
  }
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')
}

async function confluence<T>(path: string): Promise<T> {
  ensureConfigured()
  const res = await tracedFetch(`${BASE_URL}${path}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) {
    const snippet = text.length > 300 ? text.slice(0, 300) + '…' : text
    throw new Error(`Confluence ${res.status} on ${path}: ${snippet}`)
  }
  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// Normalized public types
// ---------------------------------------------------------------------------

export type BodyFormat = 'view' | 'storage' | 'atlas_doc_format'

export interface Space {
  id: string
  key: string
  name: string
  type: string
  url: string
  homepageId: string | null
  description: string | null
}

export interface PageSummary {
  id: string
  title: string
  spaceId: string
  parentId: string | null
  status: string
  url: string
  createdAt: string
  version: number
}

export interface Page extends PageSummary {
  body: {
    format: BodyFormat
    value: string
  } | null
  authorId: string | null
  ownerId: string | null
}

export interface SearchResult {
  id: string
  title: string
  type: string
  url: string
  spaceKey: string | null
  spaceName: string | null
  excerpt: string
  lastModified: string | null
}

// ---------------------------------------------------------------------------
// Upstream wire types — partial, only what we read.
// ---------------------------------------------------------------------------

interface RawSpace {
  id: string
  key: string
  name: string
  type?: string
  homepageId?: string | null
  description?: { plain?: { value?: string } } | null
  _links?: { webui?: string }
}

interface RawPage {
  id: string
  title?: string
  status?: string
  spaceId?: string
  parentId?: string | null
  authorId?: string
  ownerId?: string
  createdAt?: string
  version?: { number?: number }
  body?: Partial<Record<BodyFormat, { value?: string; representation?: string }>>
  _links?: { webui?: string }
}

interface RawV2Paged<T> {
  results?: T[]
  _links?: { next?: string; base?: string }
}

interface RawSearchResult {
  content?: {
    id?: string
    type?: string
    title?: string
    space?: { key?: string; name?: string }
  }
  title?: string
  excerpt?: string
  url?: string
  lastModified?: string
  resultGlobalContainer?: { title?: string; displayUrl?: string }
}

interface RawSearchResponse {
  results?: RawSearchResult[]
  start?: number
  limit?: number
  size?: number
  totalSize?: number
  _links?: { next?: string; base?: string }
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function siteBase(): string {
  return BASE_URL.replace(/\/+$/, '')
}

function webUrl(path: string | undefined): string {
  if (!path) return siteBase()
  if (path.startsWith('http')) return path
  return `${siteBase()}/wiki${path.startsWith('/') ? path : `/${path}`}`
}

function normalizeSpace(raw: RawSpace): Space {
  return {
    id: raw.id,
    key: raw.key,
    name: raw.name,
    type: raw.type ?? 'unknown',
    url: webUrl(raw['_links']?.webui),
    homepageId: raw.homepageId ?? null,
    description: raw.description?.plain?.value ?? null,
  }
}

function pickBody(raw: RawPage, format: BodyFormat): { format: BodyFormat; value: string } | null {
  const slot = raw.body?.[format]
  if (!slot?.value) return null
  return { format, value: slot.value }
}

function normalizePageSummary(raw: RawPage): PageSummary {
  return {
    id: raw.id,
    title: raw.title ?? '',
    spaceId: raw.spaceId ?? '',
    parentId: raw.parentId ?? null,
    status: raw.status ?? 'unknown',
    url: webUrl(raw['_links']?.webui),
    createdAt: raw.createdAt ?? '',
    version: raw.version?.number ?? 0,
  }
}

function normalizePage(raw: RawPage, format: BodyFormat): Page {
  return {
    ...normalizePageSummary(raw),
    body: pickBody(raw, format),
    authorId: raw.authorId ?? null,
    ownerId: raw.ownerId ?? null,
  }
}

function normalizeSearchResult(raw: RawSearchResult): SearchResult {
  const content = raw.content ?? {}
  return {
    id: content.id ?? '',
    title: content.title ?? raw.title ?? '',
    type: content.type ?? 'unknown',
    url: webUrl(raw.url),
    spaceKey: content.space?.key ?? null,
    spaceName: content.space?.name ?? null,
    // Excerpts come back with @@@hl@@@/@@@endhl@@@ highlight markers; strip them.
    excerpt: (raw.excerpt ?? '').replace(/@@@hl@@@|@@@endhl@@@/g, ''),
    lastModified: raw.lastModified ?? null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listSpaces(opts: {
  limit?: number
  type?: 'global' | 'personal' | 'collaboration' | 'knowledge_base'
}): Promise<{ spaces: Space[] }> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 50) })
  if (opts.type) params.set('type', opts.type)
  const r = await confluence<RawV2Paged<RawSpace>>(`/wiki/api/v2/spaces?${params.toString()}`)
  return { spaces: (r.results ?? []).map(normalizeSpace) }
}

export async function getPage(id: string, opts: { bodyFormat?: BodyFormat } = {}): Promise<Page> {
  const format = opts.bodyFormat ?? 'view'
  const params = new URLSearchParams({ 'body-format': format })
  const raw = await confluence<RawPage>(
    `/wiki/api/v2/pages/${encodeURIComponent(id)}?${params.toString()}`,
  )
  return normalizePage(raw, format)
}

export async function getPageChildren(
  id: string,
  opts: { limit?: number } = {},
): Promise<{ pages: PageSummary[] }> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 50) })
  const r = await confluence<RawV2Paged<RawPage>>(
    `/wiki/api/v2/pages/${encodeURIComponent(id)}/children?${params.toString()}`,
  )
  return { pages: (r.results ?? []).map(normalizePageSummary) }
}

export async function getRecentlyUpdated(opts: {
  spaceId?: string
  limit?: number
}): Promise<{ pages: PageSummary[] }> {
  // v2 supports sort=-modified-date on /pages to surface freshly-edited pages.
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 25),
    sort: '-modified-date',
  })
  if (opts.spaceId) params.set('space-id', opts.spaceId)
  const r = await confluence<RawV2Paged<RawPage>>(`/wiki/api/v2/pages?${params.toString()}`)
  return { pages: (r.results ?? []).map(normalizePageSummary) }
}

export async function searchByCql(opts: { cql: string; limit?: number; start?: number }): Promise<{
  results: SearchResult[]
  start: number
  limit: number
  totalSize: number
  isLast: boolean
}> {
  const params = new URLSearchParams({
    cql: opts.cql,
    limit: String(opts.limit ?? 25),
    start: String(opts.start ?? 0),
    // v1 search returns thin hits by default; expand space + version so the
    // normalized SearchResult carries spaceKey/spaceName and is comparable to
    // the v2 page list output.
    expand: 'content.space,content.version',
  })
  const r = await confluence<RawSearchResponse>(`/wiki/rest/api/search?${params.toString()}`)
  const results = (r.results ?? []).map(normalizeSearchResult)
  const start = r.start ?? 0
  const limit = r.limit ?? results.length
  const totalSize = r.totalSize ?? r.size ?? results.length
  return {
    results,
    start,
    limit,
    totalSize,
    isLast: !r['_links']?.next,
  }
}
