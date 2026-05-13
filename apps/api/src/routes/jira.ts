import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  DEFAULT_BOARD_ID,
  getMyself,
  getIssue,
  getBacklog,
  getSprint,
  getCurrentSprint,
  listMyOpenIssues,
  listSprints,
  searchByJql,
} from '../clients/jira.js'

// --- Shared response schemas ----------------------------------------------

const IssueSchema = z.object({
  key: z.string().describe('Jira issue key (e.g. EP-17849, QET-1200)'),
  url: z.string().describe('Browse URL — open this in a browser for the full ticket'),
  summary: z.string(),
  status: z.string().describe('Free-form status name (e.g. "In Progress", "Retesting", "Blocked")'),
  statusCategory: z
    .enum(['todo', 'in-progress', 'done', 'unknown'])
    .describe('Normalized status bucket — use this for grouping, ignore custom workflow names'),
  issueType: z.string().describe('e.g. "Bug", "Task", "Story", "Sub-task", "Epic"'),
  isSubtask: z.boolean(),
  priority: z.string().nullable(),
  project: z.object({
    key: z.string().describe('Project key prefix on the issue key (e.g. "EP", "QET")'),
    name: z.string(),
  }),
  assignee: z
    .object({ name: z.string(), email: z.string().nullable() })
    .nullable()
    .describe('null when unassigned'),
  reporter: z.object({ name: z.string(), email: z.string().nullable() }).nullable(),
  dueDate: z.string().nullable().describe('YYYY-MM-DD or null'),
  created: z.string().describe('ISO 8601 timestamp'),
  updated: z.string().describe('ISO 8601 timestamp — sort by this for most-recently-touched'),
  labels: z.array(z.string()),
  parent: z
    .object({ key: z.string(), summary: z.string() })
    .nullable()
    .describe('Parent issue (epic for stories, story for sub-tasks) — null if top-level'),
})

const SprintSchema = z.object({
  id: z.number().int(),
  name: z.string().describe('e.g. "Prometheus 107"'),
  state: z
    .enum(['active', 'closed', 'future'])
    .describe('active = currently running, future = next up, closed = completed'),
  startDate: z.string().nullable().describe('ISO 8601 timestamp or null'),
  endDate: z.string().nullable().describe('ISO 8601 timestamp or null'),
  completeDate: z.string().nullable().describe('ISO 8601 timestamp — set once the sprint closes'),
  goal: z.string().nullable(),
  boardId: z.number().int(),
})

const BoardSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string().describe('e.g. "scrum", "kanban"'),
  projectKey: z.string().nullable(),
  projectName: z.string().nullable(),
})

// --- Plugin ---------------------------------------------------------------

export const jiraRoutes = new Elysia({ prefix: '/atlassian/jira' })
  .get(
    '/me',
    async ({ set }) => {
      try {
        return await getMyself()
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Jira error'
      }
    },
    {
      response: {
        200: z.object({
          accountId: z.string(),
          displayName: z.string(),
          email: z.string(),
          timeZone: z.string(),
        }),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Resolve the authenticated Jira user',
        description:
          "Returns the Atlassian user that argo's API token belongs to. Mostly a sanity-check endpoint — useful for agents to confirm the surface is wired (404/503 means the token is missing or revoked, 200 means everything downstream will work). The returned accountId can be plugged into JQL like `assignee = <accountId>`; most callers should prefer `assignee = currentUser()` in /search instead.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/my-issues',
    async ({ query, set }) => {
      try {
        return await listMyOpenIssues(query.limit ?? 50)
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Jira error'
      }
    },
    {
      query: z.object({
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe('Max issues to return (default 50, max 100)')
          .optional(),
      }),
      response: {
        200: z.object({
          issues: z.array(IssueSchema),
          isLast: z.boolean().describe('false when more results exist beyond `limit`'),
        }),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: "List the authenticated user's open issues across all projects",
        description:
          'Returns open issues (statusCategory != Done) assigned to the authenticated user, sorted by most recently updated. Spans every Jira project the user has access to — not limited to the team board (so you see cross-project work like QET tickets in addition to EP). For board-scoped views use GET /atlassian/jira/current-sprint (sprint issues on board 272) or GET /atlassian/jira/backlog (backlog issues on board 272). For arbitrary filters use GET /atlassian/jira/search with a custom JQL string.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/issue/:key',
    async ({ params, set }) => {
      try {
        return await getIssue(params.key)
      } catch (error) {
        set.status = error instanceof Error && error.message.includes('404') ? 404 : 503
        return error instanceof Error ? error.message : 'Jira error'
      }
    },
    {
      params: z.object({
        key: z.string().describe('Issue key — e.g. EP-17849, QET-1200'),
      }),
      response: { 200: IssueSchema, 404: z.string(), 503: z.string() },
      detail: {
        tags: ['Atlassian'],
        summary: 'Fetch a single Jira issue by key',
        description:
          'Returns the normalized shape for one ticket. Use this when an agent already has a key (e.g. from a Slack message, a commit footer, the user pasted "EP-17849"). For multi-issue queries use /atlassian/jira/my-issues or /atlassian/jira/search instead — those return the same Issue shape so client code can be uniform. 404 if the key is malformed or the user has no permission to see the project.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/current-sprint',
    async ({ query, set }) => {
      try {
        return await getCurrentSprint(query.boardId ?? DEFAULT_BOARD_ID, {
          onlyMine: query.onlyMine ?? false,
        })
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Jira error'
      }
    },
    {
      query: z.object({
        boardId: z.coerce
          .number()
          .int()
          .default(DEFAULT_BOARD_ID)
          .describe('Board ID (defaults to JIRA_BOARD_ID — the "EPOS Team Prometheus" board)')
          .optional(),
        onlyMine: z.coerce
          .boolean()
          .default(false)
          .describe('When true, filter sprint issues to those assigned to the authenticated user')
          .optional(),
      }),
      response: {
        200: z.object({
          board: BoardSchema,
          sprint: SprintSchema.nullable().describe(
            'null when no active sprint exists on the board',
          ),
          issues: z.array(IssueSchema),
        }),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: "Snapshot of the team board's active sprint",
        description:
          'Returns the active sprint on the board (default: 272 "EPOS Team Prometheus") plus every issue committed to it. Pass ?onlyMine=true to scope issues to the authenticated user — preferred when an agent answers "what am I doing this sprint". For specific past/future sprints use /atlassian/jira/sprints (list) and /atlassian/jira/sprints/{sprintId} (detail). Sprints contain board-managed issues; cross-project tickets the user owns elsewhere are NOT here — use /atlassian/jira/my-issues for that.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/sprints',
    async ({ query, set }) => {
      try {
        const sprints = await listSprints(
          query.state
            ? { boardId: query.boardId ?? DEFAULT_BOARD_ID, state: query.state }
            : { boardId: query.boardId ?? DEFAULT_BOARD_ID },
        )
        return { sprints }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Jira error'
      }
    },
    {
      query: z.object({
        boardId: z.coerce
          .number()
          .int()
          .default(DEFAULT_BOARD_ID)
          .describe('Board ID (defaults to JIRA_BOARD_ID)')
          .optional(),
        state: z
          .enum(['active', 'closed', 'future'])
          .describe('Filter by sprint lifecycle state. Omit to include all states (max 50)')
          .optional(),
      }),
      response: { 200: z.object({ sprints: z.array(SprintSchema) }), 503: z.string() },
      detail: {
        tags: ['Atlassian'],
        summary: 'List sprints on a board',
        description:
          "Returns up to 50 sprints on the given board. Use ?state=active for the current sprint (or use /atlassian/jira/current-sprint for a richer snapshot incl. issues), ?state=future to peek at what's queued, ?state=closed for historical retrospectives. Sprint metadata only — for the issues attached to a specific sprint call /atlassian/jira/sprints/{sprintId}.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/sprints/:sprintId',
    async ({ params, set }) => {
      try {
        return await getSprint(Number(params.sprintId))
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Jira error'
      }
    },
    {
      params: z.object({
        sprintId: z.coerce.number().int().describe('Numeric sprint id (e.g. 18546)'),
      }),
      response: {
        200: z.object({ sprint: SprintSchema, issues: z.array(IssueSchema) }),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Fetch a sprint and all its issues',
        description:
          'Returns full sprint metadata + every issue assigned to the sprint (up to 200, in sprint order). Use this when an agent needs to retrospect on a closed sprint or preview a future one. For the current sprint specifically prefer /atlassian/jira/current-sprint which also returns board context and supports ?onlyMine. Discover sprint IDs via /atlassian/jira/sprints.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/backlog',
    async ({ query, set }) => {
      try {
        return await getBacklog({
          boardId: query.boardId ?? DEFAULT_BOARD_ID,
          startAt: query.startAt ?? 0,
          maxResults: query.maxResults ?? 50,
        })
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Jira error'
      }
    },
    {
      query: z.object({
        boardId: z.coerce
          .number()
          .int()
          .default(DEFAULT_BOARD_ID)
          .describe('Board ID (defaults to JIRA_BOARD_ID)')
          .optional(),
        startAt: z.coerce
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Zero-based offset for pagination')
          .optional(),
        maxResults: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe('Page size (default 50, max 100)')
          .optional(),
      }),
      response: {
        200: z.object({
          issues: z.array(IssueSchema),
          total: z.number().int().describe('Total backlog issues across all pages'),
          startAt: z.number().int(),
          isLast: z.boolean(),
        }),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Page through the board backlog',
        description:
          'Returns issues sitting in the board backlog (not committed to any sprint) in board rank order — the order the team will pull from. Paginated via startAt + maxResults; check `isLast` and `total` to decide whether to keep paging. Use this to answer "what\'s next" or "what\'s our queue look like". Distinct from /atlassian/jira/my-issues which returns issues assigned to the user across all projects regardless of sprint/backlog membership.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/search',
    async ({ query, set }) => {
      try {
        return await searchByJql({
          jql: query.jql,
          maxResults: query.maxResults ?? 50,
          ...(query.nextPageToken ? { nextPageToken: query.nextPageToken } : {}),
        })
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Jira error'
      }
    },
    {
      query: z.object({
        jql: z
          .string()
          .min(1)
          .describe(
            'Raw JQL expression. Examples: `assignee = currentUser() AND priority = High`, `project = EP AND created >= -7d`, `text ~ "rollout" ORDER BY updated DESC`. Read-only — write operations are not supported by this endpoint.',
          ),
        maxResults: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe('Page size (default 50, max 100)')
          .optional(),
        nextPageToken: z
          .string()
          .describe('Pagination cursor returned by a previous /search call (opaque)')
          .optional(),
      }),
      response: {
        200: z.object({
          issues: z.array(IssueSchema),
          isLast: z.boolean(),
          nextPageToken: z
            .string()
            .nullable()
            .describe('Pass this back as ?nextPageToken on the next call; null when isLast=true'),
        }),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Run a JQL search (escape hatch for arbitrary queries)',
        description:
          'Generic JQL search against the Atlassian REST v3 `/search/jql` endpoint. Use this when the curated endpoints (/my-issues, /current-sprint, /backlog) don\'t express the filter you need — e.g. "issues updated in the last 24h", "all blockers in project EP", "anything mentioning a specific feature flag". JQL reference: https://support.atlassian.com/jira-software-cloud/docs/jql-fields/. Cursor-paginated: when `isLast=false`, pass the returned `nextPageToken` back to fetch the next page.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
