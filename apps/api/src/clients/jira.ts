// HTTP Basic-auth client for Atlassian Cloud (Jira).
//
// Wraps two underlying APIs against the same host:
//   - REST API v3 (issues, search/jql, myself, create/update/comment) — /rest/api/3
//   - Agile API v1 (boards, sprints, backlog)                          — /rest/agile/1.0
//
// All credentials come from env (JIRA_EMAIL + JIRA_API_TOKEN), which the
// argo deployment resolves from 1Password (op://vps/argo/ATLASSIAN_*).
// The board ID is single-tenant (JIRA_BOARD_ID, defaults to 272 — the
// user's "EPOS Team Prometheus" scrum board); other boards can be queried
// explicitly per call.
//
// Write surface (createIssue / updateIssue / addComment / transitionIssue)
// always stamps Team = Prometheus (customfield_11688 option 10561) and
// appends the Hermes attribution footer to descriptions, so an agent can
// fire a one-shot POST without remembering the team or signing each ticket
// manually. Custom-field IDs were discovered live via scripts/jira-write-discover.ts
// against the careerpartner Cloud tenant; they're stable for the EP project.

import { env } from '../env.js'
import { tracedFetch } from '../lib/traced-fetch.js'

const BASE_URL = env.ATLASSIAN_BASE_URL
const EMAIL = env.JIRA_EMAIL
const TOKEN = env.JIRA_API_TOKEN
export const DEFAULT_BOARD_ID = env.JIRA_BOARD_ID
export const DEFAULT_PROJECT_KEY = env.JIRA_DEFAULT_PROJECT_KEY
const DEFAULT_TEAM_OPTION_ID = env.JIRA_DEFAULT_TEAM_OPTION_ID

// Stable custom-field IDs on the EP project. Verified via createmeta probe.
// Don't move these without re-running scripts/jira-write-discover.ts.
const FIELD_SPRINT = 'customfield_10007' // gh-sprint (array of sprint ids on write)
const FIELD_EPIC_LINK = 'customfield_10009' // gh-epic-link (parent epic key, e.g. "EP-16692")
const FIELD_STORY_POINTS = 'customfield_10005' // float — the team's actual SP field
const FIELD_TEAM = 'customfield_11688' // multiselect option, holds [{id: "10561", value: "Prometheus"}]

const HERMES_FOOTER = "Created by Johannes' personal Hermes Agent"

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

// Upstream errors surface as HTTP status codes on the route layer (404, 409,
// 503). `JiraHttpError.status` is what routes inspect to decide the response
// code — wrapping it here keeps that mapping in one place instead of
// string-matching error messages.
export class JiraHttpError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown, path: string) {
    super(
      `Jira ${status} on ${path}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`,
    )
    this.status = status
    this.body = body
  }
}

async function jiraWrite<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T | null> {
  ensureConfigured()
  const res = await tracedFetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // keep raw text
    }
    throw new JiraHttpError(res.status, parsed, path)
  }
  if (text.length === 0) return null
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

export function browseUrl(key: string): string {
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

// ---------------------------------------------------------------------------
// Write surface — create / update / comment / transition
// ---------------------------------------------------------------------------

export type IssueTypeName = 'Story' | 'Task' | 'Bug' | 'Spike' | 'Sub-task' | 'Epic' | 'Requirement'
export type PriorityName = 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest'
export type SprintRef = 'current' | 'next' | 'backlog' | number

interface AdfNode {
  type: string
  text?: string
  marks?: Array<{ type: string }>
  content?: AdfNode[]
  attrs?: Record<string, unknown>
}
interface AdfDoc {
  type: 'doc'
  version: 1
  content: AdfNode[]
}

// Plain text → ADF. We accept markdown-lite: blank lines split paragraphs,
// single newlines become hard breaks. The Hermes footer is always appended
// as a final italic paragraph so the human reader sees who filed the ticket.
//
// We deliberately don't try to parse headings/lists/code — agents that need
// rich formatting should send `descriptionAdf` directly. Keeping the
// converter dumb avoids surprises when the agent's markdown collides with
// Jira's ADF semantics.
function textToAdf(text: string | null | undefined, includeFooter: boolean): AdfDoc {
  const paragraphs: AdfNode[] = []
  const trimmed = (text ?? '').trim()
  if (trimmed.length > 0) {
    for (const block of trimmed.split(/\n{2,}/)) {
      const lines = block.split('\n')
      const content: AdfNode[] = []
      lines.forEach((line, idx) => {
        if (line.length > 0) content.push({ type: 'text', text: line })
        if (idx < lines.length - 1) content.push({ type: 'hardBreak' })
      })
      if (content.length > 0) paragraphs.push({ type: 'paragraph', content })
    }
  }
  if (includeFooter) {
    paragraphs.push({
      type: 'paragraph',
      content: [{ type: 'text', text: HERMES_FOOTER, marks: [{ type: 'em' }] }],
    })
  }
  return { type: 'doc', version: 1, content: paragraphs }
}

// Append the footer to an agent-supplied ADF doc. If the agent already
// included the footer (rare), don't double-stamp.
function ensureFooterAdf(doc: AdfDoc): AdfDoc {
  const flat = JSON.stringify(doc)
  if (flat.includes(HERMES_FOOTER)) return doc
  return {
    type: 'doc',
    version: 1,
    content: [
      ...doc.content,
      {
        type: 'paragraph',
        content: [{ type: 'text', text: HERMES_FOOTER, marks: [{ type: 'em' }] }],
      },
    ],
  }
}

async function resolveSprintId(ref: SprintRef, boardId: number): Promise<number | null> {
  if (typeof ref === 'number') return ref
  if (ref === 'backlog') return null
  const state = ref === 'current' ? 'active' : 'future'
  const list = await listSprints({ boardId, state })
  if (list.length === 0) {
    throw new JiraHttpError(409, `No ${state} sprint on board ${boardId}`, '/sprint-resolve')
  }
  // Future sprints come back in chronological order; pick the earliest.
  if (ref === 'next') {
    return [...list].sort((a, b) => {
      const aT = a.startDate ? Date.parse(a.startDate) : Number.MAX_SAFE_INTEGER
      const bT = b.startDate ? Date.parse(b.startDate) : Number.MAX_SAFE_INTEGER
      return aT - bT
    })[0]!.id
  }
  return list[0]!.id
}

const ISSUE_TYPE_ID: Record<IssueTypeName, string> = {
  Epic: '10000',
  Story: '10001',
  Task: '10002',
  'Sub-task': '10003',
  Bug: '10004',
  Spike: '10338',
  Requirement: '14523',
}

const PRIORITY_ID: Record<PriorityName, string> = {
  Highest: '1',
  High: '2',
  Medium: '3',
  Low: '4',
  Lowest: '5',
}

export interface CreateIssueInput {
  projectKey?: string
  issueType: IssueTypeName
  summary: string
  description?: string | null
  descriptionAdf?: AdfDoc
  assigneeAccountId?: string | null
  parentKey?: string // for sub-tasks
  epicKey?: string | null // assign Story to Epic via customfield_10009
  sprint?: SprintRef
  storyPoints?: number | null
  priority?: PriorityName
  labels?: string[]
  boardId?: number
  team?: 'prometheus' | 'none'
}

export async function createIssue(
  input: CreateIssueInput,
): Promise<{ key: string; id: string; url: string }> {
  const projectKey = input.projectKey ?? DEFAULT_PROJECT_KEY
  const boardId = input.boardId ?? DEFAULT_BOARD_ID
  const issueTypeId = ISSUE_TYPE_ID[input.issueType]
  if (!issueTypeId) {
    throw new JiraHttpError(400, `Unknown issue type "${input.issueType}"`, '/issue')
  }

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    issuetype: { id: issueTypeId },
    summary: input.summary,
    description: input.descriptionAdf
      ? ensureFooterAdf(input.descriptionAdf)
      : textToAdf(input.description ?? null, true),
  }

  if (input.team !== 'none') {
    fields[FIELD_TEAM] = [{ id: DEFAULT_TEAM_OPTION_ID }]
  }
  if (input.assigneeAccountId) {
    fields['assignee'] = { accountId: input.assigneeAccountId }
  }
  if (input.parentKey) {
    fields['parent'] = { key: input.parentKey }
  }
  if (input.epicKey !== undefined && input.epicKey !== null) {
    fields[FIELD_EPIC_LINK] = input.epicKey
  }
  if (input.storyPoints !== undefined && input.storyPoints !== null) {
    fields[FIELD_STORY_POINTS] = input.storyPoints
  }
  if (input.priority) {
    fields['priority'] = { id: PRIORITY_ID[input.priority] }
  }
  if (input.labels && input.labels.length > 0) {
    fields['labels'] = input.labels
  }
  if (input.sprint !== undefined && input.sprint !== 'backlog') {
    const sprintId = await resolveSprintId(input.sprint, boardId)
    if (sprintId !== null) fields[FIELD_SPRINT] = sprintId
  }

  const created = await jiraWrite<{ id: string; key: string }>('POST', '/rest/api/3/issue', {
    fields,
  })
  if (!created) throw new JiraHttpError(502, 'Empty response from Jira', '/rest/api/3/issue')
  return {
    id: created.id,
    key: created.key,
    url: browseUrl(created.key),
  }
}

export interface UpdateIssueInput {
  summary?: string
  description?: string | null
  descriptionAdf?: AdfDoc
  assigneeAccountId?: string | null // null clears assignment
  epicKey?: string | null // null removes from epic
  sprint?: SprintRef
  storyPoints?: number | null // null removes points
  priority?: PriorityName
  labels?: string[]
  status?: string // free-form transition target name ("In Progress", "Code Review", "Done")
  boardId?: number
}

export async function updateIssue(
  key: string,
  input: UpdateIssueInput,
): Promise<{ key: string; url: string; transitioned: boolean }> {
  const boardId = input.boardId ?? DEFAULT_BOARD_ID
  const fields: Record<string, unknown> = {}

  if (input.summary !== undefined) fields['summary'] = input.summary
  if (input.descriptionAdf !== undefined) {
    fields['description'] = ensureFooterAdf(input.descriptionAdf)
  } else if (input.description !== undefined) {
    fields['description'] = textToAdf(input.description, true)
  }
  if (input.assigneeAccountId !== undefined) {
    fields['assignee'] =
      input.assigneeAccountId === null ? null : { accountId: input.assigneeAccountId }
  }
  if (input.epicKey !== undefined) {
    fields[FIELD_EPIC_LINK] = input.epicKey
  }
  if (input.storyPoints !== undefined) {
    fields[FIELD_STORY_POINTS] = input.storyPoints
  }
  if (input.priority !== undefined) {
    fields['priority'] = { id: PRIORITY_ID[input.priority] }
  }
  if (input.labels !== undefined) {
    fields['labels'] = input.labels
  }
  if (input.sprint !== undefined) {
    const sprintId =
      input.sprint === 'backlog' ? null : await resolveSprintId(input.sprint, boardId)
    fields[FIELD_SPRINT] = sprintId
  }

  if (Object.keys(fields).length > 0) {
    await jiraWrite('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields })
  }

  let transitioned = false
  if (input.status !== undefined) {
    await transitionIssue(key, input.status)
    transitioned = true
  }

  return { key, url: browseUrl(key), transitioned }
}

interface RawTransition {
  id: string
  name: string
  to?: { name?: string }
}

export async function listTransitions(
  key: string,
): Promise<Array<{ id: string; name: string; targetStatus: string | null }>> {
  const r = await jira<{ transitions?: RawTransition[] }>(
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
  )
  return (r.transitions ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    targetStatus: t.to?.name ?? null,
  }))
}

export async function transitionIssue(key: string, statusOrTransition: string): Promise<void> {
  const transitions = await listTransitions(key)
  const target = statusOrTransition.trim().toLowerCase()
  const match =
    transitions.find((t) => t.name.toLowerCase() === target) ??
    transitions.find((t) => (t.targetStatus ?? '').toLowerCase() === target) ??
    transitions.find((t) => t.name.toLowerCase().includes(target))
  if (!match) {
    const avail = transitions.map((t) => `${t.name}→${t.targetStatus ?? '?'}`).join(', ')
    throw new JiraHttpError(
      409,
      `No transition matches "${statusOrTransition}". Available: ${avail}`,
      `/rest/api/3/issue/${key}/transitions`,
    )
  }
  await jiraWrite('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    transition: { id: match.id },
  })
}

export interface AddCommentInput {
  body: string
  bodyAdf?: AdfDoc
}

export async function addComment(key: string, input: AddCommentInput): Promise<{ id: string }> {
  const doc = input.bodyAdf ? ensureFooterAdf(input.bodyAdf) : textToAdf(input.body, true)
  const created = await jiraWrite<{ id: string }>(
    'POST',
    `/rest/api/3/issue/${encodeURIComponent(key)}/comment`,
    { body: doc },
  )
  if (!created)
    throw new JiraHttpError(502, 'Empty response from Jira', `/rest/api/3/issue/${key}/comment`)
  return { id: created.id }
}

// Export for tests
export const __test = { textToAdf, ensureFooterAdf, HERMES_FOOTER }
