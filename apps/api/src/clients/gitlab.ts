// HTTP client for GitLab REST API v4. Read-only.
//
// Target: gitlab.com (where IU's `iu-group/*` lives — including the EPOS
// Prometheus team repos). Auth: a Personal Access Token with scopes
// `read_api` + `read_user`. read_user is REQUIRED for /events; read_api
// alone is not sufficient there (see docs.gitlab.com/api/events).
//
// Pagination: page-based with per_page <= 100. Personal volumes stay well
// under the 10k offset cap; keyset isn't worth the complexity yet.

import { env } from '../env.js'
import { tracedFetch } from '../lib/traced-fetch.js'

const BASE_URL = env.GITLAB_BASE_URL.replace(/\/+$/, '')
const TOKEN = env.GITLAB_TOKEN

function ensureConfigured(): void {
  if (!TOKEN) throw new Error('GitLab not configured — set GITLAB_TOKEN')
}

async function gitlab<T>(path: string): Promise<T> {
  ensureConfigured()
  const res = await tracedFetch(`${BASE_URL}/api/v4${path}`, {
    headers: { 'PRIVATE-TOKEN': TOKEN, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) {
    const snippet = text.length > 300 ? text.slice(0, 300) + '…' : text
    throw new Error(`GitLab ${res.status} on ${path}: ${snippet}`)
  }
  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// Normalized public types
// ---------------------------------------------------------------------------

export interface User {
  id: number
  username: string
  name: string
  webUrl: string
  state: string
}

export type MrState = 'opened' | 'closed' | 'merged' | 'locked'
export type MrScope = 'created_by_me' | 'assigned_to_me' | 'reviews_for_me' | 'all'

export interface MergeRequest {
  id: number
  iid: number
  projectId: number
  projectPath: string | null
  title: string
  state: MrState
  draft: boolean
  webUrl: string
  sourceBranch: string
  targetBranch: string
  author: { username: string; name: string } | null
  assignees: { username: string; name: string }[]
  reviewers: { username: string; name: string }[]
  labels: string[]
  upvotes: number
  downvotes: number
  userNotesCount: number
  mergeStatus: string | null
  hasConflicts: boolean
  createdAt: string
  updatedAt: string
  jiraKeys: string[]
}

export interface MrApprovals {
  approved: boolean
  approvalsRequired: number
  approvalsLeft: number
  approvedBy: { username: string; name: string }[]
}

export interface Note {
  id: number
  body: string
  author: { username: string; name: string } | null
  system: boolean
  resolvable: boolean
  resolved: boolean
  createdAt: string
  updatedAt: string
}

export interface Discussion {
  id: string
  individualNote: boolean
  notes: Note[]
}

export interface Commit {
  id: string
  shortId: string
  title: string
  message: string
  authorName: string
  authoredDate: string
  webUrl: string
}

export interface Release {
  tagName: string
  name: string | null
  description: string | null
  createdAt: string
  releasedAt: string | null
  webUrl: string | null
}

export interface PushEvent {
  id: number
  createdAt: string
  projectId: number
  authorUsername: string | null
  pushData: {
    action: string
    refType: string
    ref: string | null
    commitTitle: string | null
    commitFrom: string | null
    commitTo: string | null
    commitCount: number
  } | null
}

// ---------------------------------------------------------------------------
// Wire types (partial — only what we read)
// ---------------------------------------------------------------------------

interface RawUser {
  id: number
  username: string
  name: string
  web_url: string
  state: string
}

interface RawMr {
  id: number
  iid: number
  project_id: number
  references?: { full?: string }
  web_url: string
  title: string
  description?: string | null
  state: string
  draft?: boolean
  work_in_progress?: boolean
  source_branch: string
  target_branch: string
  author?: { username: string; name: string } | null
  assignees?: { username: string; name: string }[]
  reviewers?: { username: string; name: string }[]
  labels?: string[]
  upvotes?: number
  downvotes?: number
  user_notes_count?: number
  merge_status?: string | null
  has_conflicts?: boolean
  created_at: string
  updated_at: string
}

interface RawApprovals {
  approved?: boolean
  approvals_required?: number
  approvals_left?: number
  approved_by?: { user: { username: string; name: string } }[]
}

interface RawNote {
  id: number
  body: string
  author?: { username: string; name: string } | null
  system?: boolean
  resolvable?: boolean
  resolved?: boolean
  created_at: string
  updated_at: string
}

interface RawDiscussion {
  id: string
  individual_note?: boolean
  notes?: RawNote[]
}

interface RawCommit {
  id: string
  short_id: string
  title: string
  message: string
  author_name: string
  authored_date: string
  web_url: string
}

interface RawRelease {
  tag_name: string
  name?: string | null
  description?: string | null
  created_at: string
  released_at?: string | null
  _links?: { self?: string }
}

interface RawPushEvent {
  id: number
  created_at: string
  project_id: number
  author_username?: string | null
  push_data?: {
    action?: string
    ref_type?: string
    ref?: string | null
    commit_title?: string | null
    commit_from?: string | null
    commit_to?: string | null
    commit_count?: number
  } | null
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normUser(raw: RawUser): User {
  return {
    id: raw.id,
    username: raw.username,
    name: raw.name,
    webUrl: raw.web_url,
    state: raw.state,
  }
}

// Match Atlassian-style issue keys (PROJECT-NUMBER). Two uppercase letters
// minimum to avoid false positives on words like "PR-1". The team uses EP- and
// QET- predominantly, but the regex stays generic so any IU project key works.
const JIRA_KEY_RE = /\b([A-Z]{2,10}-\d+)\b/g

function extractJiraKeys(...sources: (string | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const s of sources) {
    if (!s) continue
    const matches = s.matchAll(JIRA_KEY_RE)
    for (const m of matches) out.add(m[1] as string)
  }
  return [...out]
}

function normMr(raw: RawMr): MergeRequest {
  // GitLab `references.full` looks like `group/sub/project!42`. The bit before
  // `!` is the canonical project path — handy for the dashboard since
  // project_id alone is opaque.
  const projectPath = raw.references?.full?.split('!')[0] ?? null
  const state: MrState =
    raw.state === 'opened' ||
    raw.state === 'closed' ||
    raw.state === 'merged' ||
    raw.state === 'locked'
      ? raw.state
      : 'opened'
  return {
    id: raw.id,
    iid: raw.iid,
    projectId: raw.project_id,
    projectPath,
    title: raw.title,
    state,
    draft: raw.draft ?? raw.work_in_progress ?? false,
    webUrl: raw.web_url,
    sourceBranch: raw.source_branch,
    targetBranch: raw.target_branch,
    author: raw.author ? { username: raw.author.username, name: raw.author.name } : null,
    assignees: (raw.assignees ?? []).map((u) => ({ username: u.username, name: u.name })),
    reviewers: (raw.reviewers ?? []).map((u) => ({ username: u.username, name: u.name })),
    labels: raw.labels ?? [],
    upvotes: raw.upvotes ?? 0,
    downvotes: raw.downvotes ?? 0,
    userNotesCount: raw.user_notes_count ?? 0,
    mergeStatus: raw.merge_status ?? null,
    hasConflicts: raw.has_conflicts ?? false,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    jiraKeys: extractJiraKeys(raw.title, raw.source_branch, raw.description),
  }
}

function normApprovals(raw: RawApprovals): MrApprovals {
  return {
    approved: raw.approved ?? false,
    approvalsRequired: raw.approvals_required ?? 0,
    approvalsLeft: raw.approvals_left ?? 0,
    approvedBy: (raw.approved_by ?? []).map((a) => ({
      username: a.user.username,
      name: a.user.name,
    })),
  }
}

function normNote(raw: RawNote): Note {
  return {
    id: raw.id,
    body: raw.body,
    author: raw.author ? { username: raw.author.username, name: raw.author.name } : null,
    system: raw.system ?? false,
    resolvable: raw.resolvable ?? false,
    resolved: raw.resolved ?? false,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function normDiscussion(raw: RawDiscussion): Discussion {
  return {
    id: raw.id,
    individualNote: raw.individual_note ?? false,
    notes: (raw.notes ?? []).map(normNote),
  }
}

function normCommit(raw: RawCommit): Commit {
  return {
    id: raw.id,
    shortId: raw.short_id,
    title: raw.title,
    message: raw.message,
    authorName: raw.author_name,
    authoredDate: raw.authored_date,
    webUrl: raw.web_url,
  }
}

function normRelease(raw: RawRelease): Release {
  return {
    tagName: raw.tag_name,
    name: raw.name ?? null,
    description: raw.description ?? null,
    createdAt: raw.created_at,
    releasedAt: raw.released_at ?? null,
    webUrl: raw._links?.self ?? null,
  }
}

function normPushEvent(raw: RawPushEvent): PushEvent {
  return {
    id: raw.id,
    createdAt: raw.created_at,
    projectId: raw.project_id,
    authorUsername: raw.author_username ?? null,
    pushData: raw.push_data
      ? {
          action: raw.push_data.action ?? 'unknown',
          refType: raw.push_data.ref_type ?? 'unknown',
          ref: raw.push_data.ref ?? null,
          commitTitle: raw.push_data.commit_title ?? null,
          commitFrom: raw.push_data.commit_from ?? null,
          commitTo: raw.push_data.commit_to ?? null,
          commitCount: raw.push_data.commit_count ?? 0,
        }
      : null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getMyself(): Promise<User> {
  const r = await gitlab<RawUser>('/user')
  return normUser(r)
}

export async function searchUsers(query: string, perPage = 10): Promise<User[]> {
  const params = new URLSearchParams({ search: query, per_page: String(perPage) })
  const r = await gitlab<RawUser[]>(`/users?${params.toString()}`)
  return r.map(normUser)
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const params = new URLSearchParams({ username })
  const r = await gitlab<RawUser[]>(`/users?${params.toString()}`)
  return r[0] ? normUser(r[0]) : null
}

export async function listMergeRequests(opts: {
  scope?: MrScope
  state?: MrState
  authorUsername?: string
  assigneeUsername?: string
  reviewerUsername?: string
  perPage?: number
  page?: number
}): Promise<MergeRequest[]> {
  const params = new URLSearchParams({
    scope: opts.scope ?? 'created_by_me',
    state: opts.state ?? 'opened',
    per_page: String(opts.perPage ?? 50),
    page: String(opts.page ?? 1),
    order_by: 'updated_at',
    sort: 'desc',
    with_labels_details: 'false',
  })
  if (opts.authorUsername) params.set('author_username', opts.authorUsername)
  if (opts.assigneeUsername) params.set('assignee_username', opts.assigneeUsername)
  if (opts.reviewerUsername) params.set('reviewer_username', opts.reviewerUsername)
  const r = await gitlab<RawMr[]>(`/merge_requests?${params.toString()}`)
  return r.map(normMr)
}

export async function getMergeRequest(projectId: number, iid: number): Promise<MergeRequest> {
  const r = await gitlab<RawMr>(`/projects/${projectId}/merge_requests/${iid}`)
  return normMr(r)
}

export async function getMergeRequestApprovals(
  projectId: number,
  iid: number,
): Promise<MrApprovals> {
  const r = await gitlab<RawApprovals>(`/projects/${projectId}/merge_requests/${iid}/approvals`)
  return normApprovals(r)
}

export async function listMergeRequestDiscussions(
  projectId: number,
  iid: number,
  opts: { includeSystem?: boolean; perPage?: number } = {},
): Promise<Discussion[]> {
  const params = new URLSearchParams({ per_page: String(opts.perPage ?? 100) })
  const r = await gitlab<RawDiscussion[]>(
    `/projects/${projectId}/merge_requests/${iid}/discussions?${params.toString()}`,
  )
  const discussions = r.map(normDiscussion)
  if (opts.includeSystem) return discussions
  // Strip system notes (label changes, assignee changes, merge events) — agents
  // care about human comments. Drop a discussion entirely if every note is system.
  return discussions
    .map((d) => ({ ...d, notes: d.notes.filter((n) => !n.system) }))
    .filter((d) => d.notes.length > 0)
}

export async function listProjectCommits(
  projectId: number,
  opts: { since?: string; until?: string; refName?: string; perPage?: number } = {},
): Promise<Commit[]> {
  const params = new URLSearchParams({ per_page: String(opts.perPage ?? 50) })
  if (opts.since) params.set('since', opts.since)
  if (opts.until) params.set('until', opts.until)
  if (opts.refName) params.set('ref_name', opts.refName)
  const r = await gitlab<RawCommit[]>(
    `/projects/${projectId}/repository/commits?${params.toString()}`,
  )
  return r.map(normCommit)
}

export async function listProjectReleases(projectId: number, perPage = 20): Promise<Release[]> {
  const params = new URLSearchParams({ per_page: String(perPage) })
  const r = await gitlab<RawRelease[]>(`/projects/${projectId}/releases?${params.toString()}`)
  return r.map(normRelease)
}

export async function listRecentPushEvents(opts: {
  after?: string
  perPage?: number
}): Promise<PushEvent[]> {
  const params = new URLSearchParams({
    action: 'pushed',
    per_page: String(opts.perPage ?? 50),
  })
  if (opts.after) params.set('after', opts.after)
  const r = await gitlab<RawPushEvent[]>(`/events?${params.toString()}`)
  return r.map(normPushEvent)
}
