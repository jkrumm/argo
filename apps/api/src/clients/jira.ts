// HTTP Basic-auth client for Atlassian Cloud (Jira). Read-only.
//
// Wraps two underlying APIs against the same host:
//   - REST API v3 (issues, search/jql, myself)        — /rest/api/3
//   - Agile API v1 (boards, sprints, backlog)          — /rest/agile/1.0
//
// All credentials come from env (JIRA_EMAIL + JIRA_API_TOKEN), which the
// argo deployment resolves from 1Password (op://vps/argo/ATLASSIAN_*).
// The board ID is single-tenant (JIRA_BOARD_ID, defaults to 272 — the
// user's "EPOS Team Prometheus" scrum board); other boards can be queried
// explicitly per call.

import { env } from '../env.js'
import { tracedFetch } from '../lib/traced-fetch.js'

const BASE_URL = env.ATLASSIAN_BASE_URL
const EMAIL = env.JIRA_EMAIL
const TOKEN = env.JIRA_API_TOKEN
export const DEFAULT_BOARD_ID = env.JIRA_BOARD_ID

function ensureConfigured(): void {
  if (!BASE_URL || !EMAIL || !TOKEN) {
    throw new Error('Jira not configured — set ATLASSIAN_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN')
  }
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')
}

async function jira<T>(path: string): Promise<T> {
  ensureConfigured()
  const res = await tracedFetch(`${BASE_URL}${path}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) {
    const snippet = text.length > 300 ? text.slice(0, 300) + '…' : text
    throw new Error(`Jira ${res.status} on ${path}: ${snippet}`)
  }
  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// Normalized public types — what the REST routes expose. Stable shape; the
// dashboard / Hermes can rely on these field names regardless of how the
// upstream APIs rename things.
// ---------------------------------------------------------------------------

export type StatusCategory = 'todo' | 'in-progress' | 'done' | 'unknown'

export interface Issue {
  key: string
  url: string
  summary: string
  status: string
  statusCategory: StatusCategory
  issueType: string
  isSubtask: boolean
  priority: string | null
  project: { key: string; name: string }
  assignee: { name: string; email: string | null } | null
  reporter: { name: string; email: string | null } | null
  dueDate: string | null
  created: string
  updated: string
  labels: string[]
  parent: { key: string; summary: string } | null
}

export interface Sprint {
  id: number
  name: string
  state: 'active' | 'closed' | 'future'
  startDate: string | null
  endDate: string | null
  completeDate: string | null
  goal: string | null
  boardId: number
}

export interface Board {
  id: number
  name: string
  type: string
  projectKey: string | null
  projectName: string | null
}

export interface CurrentSprintSnapshot {
  board: Board
  sprint: Sprint | null
  issues: Issue[]
}

// ---------------------------------------------------------------------------
// Upstream wire types — partial, only what we read.
// ---------------------------------------------------------------------------

interface RawUser {
  displayName?: string
  emailAddress?: string | null
}

interface RawStatus {
  name: string
  statusCategory?: { key?: string }
}

interface RawIssue {
  key: string
  fields: {
    summary?: string
    status?: RawStatus
    issuetype?: { name?: string; subtask?: boolean }
    priority?: { name?: string }
    project?: { key?: string; name?: string }
    assignee?: RawUser | null
    reporter?: RawUser | null
    duedate?: string | null
    created?: string
    updated?: string
    labels?: string[]
    parent?: { key?: string; fields?: { summary?: string } } | null
  }
}

interface RawSprint {
  id: number
  name: string
  state: string
  startDate?: string
  endDate?: string
  completeDate?: string
  goal?: string
  originBoardId: number
}

interface RawBoard {
  id: number
  name: string
  type: string
  location?: {
    projectKey?: string
    projectName?: string
  }
}

interface RawPaged<T> {
  values?: T[]
  issues?: T[]
  total?: number
  isLast?: boolean
  startAt?: number
  maxResults?: number
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeStatusCategory(key: string | undefined): StatusCategory {
  switch (key) {
    case 'new':
      return 'todo'
    case 'indeterminate':
      return 'in-progress'
    case 'done':
      return 'done'
    default:
      return 'unknown'
  }
}

function browseUrl(key: string): string {
  return `${BASE_URL.replace(/\/+$/, '')}/browse/${key}`
}

function normalizeIssue(raw: RawIssue): Issue {
  const f = raw.fields
  return {
    key: raw.key,
    url: browseUrl(raw.key),
    summary: f.summary ?? '',
    status: f.status?.name ?? 'Unknown',
    statusCategory: normalizeStatusCategory(f.status?.statusCategory?.key),
    issueType: f.issuetype?.name ?? 'Unknown',
    isSubtask: Boolean(f.issuetype?.subtask),
    priority: f.priority?.name ?? null,
    project: {
      key: f.project?.key ?? 'UNKNOWN',
      name: f.project?.name ?? 'Unknown',
    },
    assignee: f.assignee
      ? { name: f.assignee.displayName ?? 'Unknown', email: f.assignee.emailAddress ?? null }
      : null,
    reporter: f.reporter
      ? { name: f.reporter.displayName ?? 'Unknown', email: f.reporter.emailAddress ?? null }
      : null,
    dueDate: f.duedate ?? null,
    created: f.created ?? '',
    updated: f.updated ?? '',
    labels: f.labels ?? [],
    parent: f.parent?.key ? { key: f.parent.key, summary: f.parent.fields?.summary ?? '' } : null,
  }
}

function normalizeSprint(raw: RawSprint): Sprint {
  const state =
    raw.state === 'active' || raw.state === 'closed' || raw.state === 'future'
      ? raw.state
      : 'closed'
  return {
    id: raw.id,
    name: raw.name,
    state,
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    completeDate: raw.completeDate ?? null,
    goal: raw.goal && raw.goal.length > 0 ? raw.goal : null,
    boardId: raw.originBoardId,
  }
}

function normalizeBoard(raw: RawBoard): Board {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    projectKey: raw.location?.projectKey ?? null,
    projectName: raw.location?.projectName ?? null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const ISSUE_FIELDS =
  'summary,status,issuetype,priority,project,assignee,reporter,duedate,created,updated,labels,parent'

export async function getMyself(): Promise<{
  accountId: string
  displayName: string
  email: string
  timeZone: string
}> {
  const r = await jira<{
    accountId: string
    displayName: string
    emailAddress: string
    timeZone: string
  }>('/rest/api/3/myself')
  return {
    accountId: r.accountId,
    displayName: r.displayName,
    email: r.emailAddress,
    timeZone: r.timeZone,
  }
}

export async function getBoard(boardId: number = DEFAULT_BOARD_ID): Promise<Board> {
  const r = await jira<RawBoard>(`/rest/agile/1.0/board/${boardId}`)
  return normalizeBoard(r)
}

export async function listSprints(opts: {
  boardId?: number
  state?: 'active' | 'closed' | 'future'
}): Promise<Sprint[]> {
  const boardId = opts.boardId ?? DEFAULT_BOARD_ID
  const params = new URLSearchParams({ maxResults: '50' })
  if (opts.state) params.set('state', opts.state)
  const r = await jira<RawPaged<RawSprint>>(
    `/rest/agile/1.0/board/${boardId}/sprint?${params.toString()}`,
  )
  return (r.values ?? []).map(normalizeSprint)
}

export async function getSprint(sprintId: number): Promise<{ sprint: Sprint; issues: Issue[] }> {
  const [raw, issuesResp] = await Promise.all([
    jira<RawSprint>(`/rest/agile/1.0/sprint/${sprintId}`),
    jira<RawPaged<RawIssue>>(
      `/rest/agile/1.0/sprint/${sprintId}/issue?fields=${ISSUE_FIELDS}&maxResults=200`,
    ),
  ])
  return {
    sprint: normalizeSprint(raw),
    issues: (issuesResp.issues ?? []).map(normalizeIssue),
  }
}

export async function getCurrentSprint(
  boardId: number = DEFAULT_BOARD_ID,
  opts: { onlyMine?: boolean } = {},
): Promise<CurrentSprintSnapshot> {
  const [board, sprintsResp] = await Promise.all([
    getBoard(boardId),
    jira<RawPaged<RawSprint>>(`/rest/agile/1.0/board/${boardId}/sprint?state=active`),
  ])
  const rawSprint = sprintsResp.values?.[0]
  if (!rawSprint) return { board, sprint: null, issues: [] }
  const sprint = normalizeSprint(rawSprint)
  const jql = opts.onlyMine ? '?jql=' + encodeURIComponent('assignee = currentUser()') : ''
  const sep = jql.length > 0 ? '&' : '?'
  const issuesResp = await jira<RawPaged<RawIssue>>(
    `/rest/agile/1.0/sprint/${sprint.id}/issue${jql}${sep}fields=${ISSUE_FIELDS}&maxResults=200`,
  )
  return {
    board,
    sprint,
    issues: (issuesResp.issues ?? []).map(normalizeIssue),
  }
}

export async function getBacklog(opts: {
  boardId?: number
  maxResults?: number
  startAt?: number
}): Promise<{ issues: Issue[]; total: number; startAt: number; isLast: boolean }> {
  const boardId = opts.boardId ?? DEFAULT_BOARD_ID
  const params = new URLSearchParams({
    fields: ISSUE_FIELDS,
    maxResults: String(opts.maxResults ?? 50),
    startAt: String(opts.startAt ?? 0),
  })
  const r = await jira<RawPaged<RawIssue>>(
    `/rest/agile/1.0/board/${boardId}/backlog?${params.toString()}`,
  )
  const issues = (r.issues ?? []).map(normalizeIssue)
  const total = r.total ?? issues.length
  const startAt = r.startAt ?? 0
  // Agile backlog doesn't include isLast; derive it from pagination math.
  return {
    issues,
    total,
    startAt,
    isLast: r.isLast ?? startAt + issues.length >= total,
  }
}

export async function listMyOpenIssues(
  maxResults = 50,
): Promise<{ issues: Issue[]; isLast: boolean }> {
  const jql = encodeURIComponent(
    'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
  )
  const r = await jira<RawPaged<RawIssue>>(
    `/rest/api/3/search/jql?jql=${jql}&fields=${ISSUE_FIELDS}&maxResults=${maxResults}`,
  )
  return {
    issues: (r.issues ?? []).map(normalizeIssue),
    isLast: r.isLast ?? true,
  }
}

export async function getIssue(key: string): Promise<Issue> {
  const r = await jira<RawIssue>(
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}`,
  )
  return normalizeIssue(r)
}

export interface JiraUser {
  accountId: string
  displayName: string
  email: string | null
  active: boolean
}

interface RawJiraUser {
  accountId: string
  displayName?: string
  emailAddress?: string | null
  active?: boolean
  accountType?: string
}

/**
 * Resolve Atlassian Cloud users by free-form query (matches displayName, email,
 * username). Filters to atlassian accountType only — drops `app` and
 * `customer` rows that show up in the raw response and add noise.
 */
export async function searchUsers(query: string, maxResults = 10): Promise<JiraUser[]> {
  const params = new URLSearchParams({ query, maxResults: String(maxResults) })
  const r = await jira<RawJiraUser[]>(`/rest/api/3/user/search?${params.toString()}`)
  return r
    .filter((u) => u.accountType === undefined || u.accountType === 'atlassian')
    .map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName ?? 'Unknown',
      email: u.emailAddress ?? null,
      active: u.active ?? true,
    }))
}

export async function searchByJql(opts: {
  jql: string
  maxResults?: number
  nextPageToken?: string
}): Promise<{ issues: Issue[]; isLast: boolean; nextPageToken: string | null }> {
  const params = new URLSearchParams({
    jql: opts.jql,
    fields: ISSUE_FIELDS,
    maxResults: String(opts.maxResults ?? 50),
  })
  if (opts.nextPageToken) params.set('nextPageToken', opts.nextPageToken)
  const r = await jira<RawPaged<RawIssue> & { nextPageToken?: string }>(
    `/rest/api/3/search/jql?${params.toString()}`,
  )
  return {
    issues: (r.issues ?? []).map(normalizeIssue),
    isLast: r.isLast ?? true,
    nextPageToken: r.nextPageToken ?? null,
  }
}
