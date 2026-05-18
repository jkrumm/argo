import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  DEFAULT_BOARD_ID,
  DEFAULT_PROJECT_KEY,
  JiraHttpError,
  addComment,
  browseUrl,
  createIssue,
  getIssueLinkTypes,
  getMyself,
  getIssue,
  getBacklog,
  getSprint,
  getCurrentSprint,
  listMyOpenIssues,
  listSprints,
  listTransitions,
  searchByJql,
  searchUsers,
  updateIssue,
} from '../clients/jira.js'

const ISSUE_TYPE_ENUM = [
  'Story',
  'Task',
  'Bug',
  'Spike',
  'Sub-task',
  'Epic',
  'Requirement',
] as const

const IssueLinkSchema = z.object({
  type: z
    .string()
    .min(1)
    .describe(
      'Link type — preferred form is the direction-flavored phrase ("blocks", "is blocked by", "duplicates", "is duplicated by", "causes", "is caused by", "relates to", "tests", "is tested by", "clones", "is cloned by"). Canonical type names ("Blocks", "Relates", "Duplicate") also work and default to outward direction. Tenant-specific phrases (e.g. "is connected to") are accepted too — fetch the full list from GET /atlassian/jira/create-meta `linkTypes`.',
    ),
  key: z
    .string()
    .regex(/^[A-Z]+-\d+$/)
    .describe(
      'The OTHER ticket to link to. The current issue is the implicit source — "blocks" + key="EP-100" means THIS ticket blocks EP-100.',
    ),
})

function mapError(error: unknown): { status: number; message: string } {
  if (error instanceof JiraHttpError) {
    // Atlassian-side 4xx surfaces as 4xx to the agent so it can react;
    // anything else gets bundled as a transient upstream failure (503).
    const status = error.status >= 400 && error.status < 500 ? error.status : 503
    return { status, message: error.message }
  }
  return { status: 503, message: error instanceof Error ? error.message : 'Jira error' }
}

// --- Shared response schemas ----------------------------------------------

const IssueSchema = z.object({
  key: z.string().describe('Jira issue key (e.g. EP-17849, QET-1200)'),
  url: z.string().describe('Browse URL — open this in a browser for the full ticket'),
  summary: z.string().describe('Short ticket title (the human-readable label).'),
  status: z.string().describe('Free-form status name (e.g. "In Progress", "Retesting", "Blocked")'),
  statusCategory: z
    .enum(['todo', 'in-progress', 'done', 'unknown'])
    .describe('Normalized status bucket — use this for grouping, ignore custom workflow names'),
  issueType: z.string().describe('e.g. "Bug", "Task", "Story", "Sub-task", "Epic"'),
  isSubtask: z
    .boolean()
    .describe('True for sub-tasks of a parent story (the parent appears in `parent`).'),
  priority: z
    .string()
    .nullable()
    .describe(
      'Free-form priority name (e.g. "Highest", "High", "Medium", "Low"). null when unset.',
    ),
  project: z
    .object({
      key: z.string().describe('Project key prefix on the issue key (e.g. "EP", "QET")'),
      name: z.string().describe('Human project name (e.g. "Education Product OS").'),
    })
    .describe(
      'Project the ticket belongs to. `key` is the prefix on `Issue.key` (EP-17665 → "EP").',
    ),
  assignee: z
    .object({ name: z.string(), email: z.string().nullable() })
    .nullable()
    .describe(
      'null when unassigned. `email` may also be null per privacy settings. For cross-system joins, resolve via /m365/team `members[].displayName` — names from Jira are not directly linkable to GitLab.',
    ),
  reporter: z
    .object({ name: z.string(), email: z.string().nullable() })
    .nullable()
    .describe(
      'Who filed the ticket. Use `.name` for display; for cross-system joins, resolve via /m365/team `members[].displayName`. `email` may be null per privacy settings.',
    ),
  dueDate: z.string().nullable().describe('YYYY-MM-DD or null'),
  created: z.string().describe('ISO 8601 timestamp'),
  updated: z.string().describe('ISO 8601 timestamp — sort by this for most-recently-touched'),
  labels: z
    .array(z.string())
    .describe(
      "Free-form Jira labels (e.g. 'tech-debt', 'security'). Project-specific conventions — NOT GitLab MR labels.",
    ),
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
          'Generic JQL search against the Atlassian REST v3 `/search/jql` endpoint. Use this when the curated endpoints (/my-issues, /current-sprint, /backlog) don\'t express the filter you need — e.g. "issues updated in the last 24h", "all blockers in project EP", "anything mentioning a specific feature flag". JQL reference: https://support.atlassian.com/jira-software-cloud/docs/jql-fields/. Cursor-paginated: when `isLast=false`, pass the returned `nextPageToken` back to fetch the next page.\n\nCanonical pattern — "all open tickets assigned to teammate X": resolve X\'s accountId from /m365/team `members[].atlassian.accountId`, then `assignee = "<accountId>" AND statusCategory != Done ORDER BY updated DESC`. If the user means themselves, prefer the curated /atlassian/jira/my-issues — cheaper and uses `currentUser()`.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/users/search',
    async ({ query, set }) => {
      try {
        const users = await searchUsers(query.query, query.maxResults ?? 10)
        return { users }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'Jira error'
      }
    },
    {
      query: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            'Free-form match against displayName / email / username. e.g. "samhammer" or "fabian.samhammer@iu.org" or "Patierno, Marco".',
          ),
        maxResults: z.coerce
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Max users to return (default 10, max 50).')
          .optional(),
      }),
      response: {
        200: z.object({
          users: z.array(
            z.object({
              accountId: z
                .string()
                .describe(
                  'Atlassian Cloud accountId — stable cross-product identifier. Pair with `assignee = <accountId>` in JQL.',
                ),
              displayName: z.string(),
              email: z.string().nullable(),
              active: z.boolean(),
            }),
          ),
        }),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Resolve Atlassian users by name/email',
        description:
          "Wraps Jira Cloud's `/rest/api/3/user/search`. Returns only atlassian-type users (filters out `app` and `customer` accounts that pollute the raw response). Primary use: bridge a Teams/M365 person to their Jira accountId so agents can run JQL like `assignee = <accountId>` or look up tickets across systems. For the authenticated user's own accountId, use /atlassian/jira/me instead — cheaper and avoids a search call.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  // --- Write surface ----------------------------------------------------
  //
  // Every issue created or commented via these endpoints is automatically:
  //   - assigned to the "Prometheus" Team option (customfield_11688)
  //   - stamped with an italic Hermes-attribution footer in the description/body
  //
  // Agents do NOT need to supply the team, the footer, or a project key —
  // those are derived from JIRA_DEFAULT_PROJECT_KEY / JIRA_DEFAULT_TEAM_OPTION_ID.
  // Before creating, agents should call GET /atlassian/jira/current-sprint or
  // /atlassian/jira/search to inspect sibling tickets for the project's title
  // convention (e.g. `[Topic][Sub-topic] Description`) so the new ticket fits.
  .get(
    '/create-meta',
    async ({ set }) => {
      // Link types are tenant-defined; fetch them live so the response stays
      // accurate when admins add new ones. On upstream failure, surface a 503
      // rather than returning a half-populated meta bundle.
      let linkTypes: Array<{ name: string; outward: string; inward: string }>
      try {
        const raw = await getIssueLinkTypes()
        linkTypes = raw.map((t) => ({ name: t.name, outward: t.outward, inward: t.inward }))
      } catch (error) {
        const { status, message } = mapError(error)
        set.status = status
        return message
      }
      return {
        projectKey: DEFAULT_PROJECT_KEY,
        boardId: DEFAULT_BOARD_ID,
        defaultTeam: 'Prometheus',
        issueTypes: [...ISSUE_TYPE_ENUM],
        priorities: ['Highest', 'High', 'Medium', 'Low', 'Lowest'],
        sprintRefs: ['current', 'next', 'backlog'],
        transitions: [
          'To Do',
          'In Progress',
          'Code Review',
          'QA Tech',
          'QA Business',
          'QA Design',
          'Refinement Done',
          'Blocked',
          'On Hold',
          'Done',
        ],
        linkTypes,
        titleConvention:
          'Prefix with bracketed topic tags, stackable. Examples: "[FE][Booking Migration] Phase 3 - BookingsView", "[MS][TMC][Cancellation] Block finance fields", "[BI] Fix 2 failed prod imports". Look at GET /atlassian/jira/current-sprint for live examples.',
        hermesFooter:
          "Italic line '_Created by Johannes' personal Hermes Agent_' is appended automatically to every description and comment body — do NOT add it manually.",
      }
    },
    {
      response: {
        200: z.object({
          projectKey: z.string(),
          boardId: z.number().int(),
          defaultTeam: z.string(),
          issueTypes: z.array(z.string()),
          priorities: z.array(z.string()),
          sprintRefs: z.array(z.string()),
          transitions: z.array(z.string()),
          linkTypes: z
            .array(
              z.object({
                name: z.string().describe('Canonical link-type name (e.g. "Blocks", "Duplicate")'),
                outward: z
                  .string()
                  .describe(
                    'Phrase shown on the source side (e.g. "blocks", "duplicates"). Pass this as `links[].type` to set THIS issue as the outward end.',
                  ),
                inward: z
                  .string()
                  .describe(
                    'Phrase shown on the target side (e.g. "is blocked by"). Pass this as `links[].type` to set THIS issue as the inward end.',
                  ),
              }),
            )
            .describe(
              'Tenant-configured issue-link types. The `outward` and `inward` strings are the recommended values for the `links[].type` field on create/update — they carry direction unambiguously.',
            ),
          titleConvention: z.string(),
          hermesFooter: z.string(),
        }),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Self-describing metadata for the Jira write surface',
        description:
          "Returns the constants an agent needs to fill a valid POST /atlassian/jira/issues body: the default project key (`EP`), the board (`272` — Prometheus), the accepted issue type and priority enums, the sprint keyword set, the transition names available on a typical ticket, the team's title-bracket convention, and the tenant's issue-link types (with the recommended direction phrases). Read this once before any create/update call so you don't have to memorize field names. Issue-type / priority / transition lists are static client-side mappings (verified live against the EP project); the actual transitions returned for a specific ticket may differ slightly per workflow state — use /atlassian/jira/issues/{key}/transitions for the exact list when transitioning. Link types are fetched live from Atlassian.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/issues',
    async ({ body, set }) => {
      try {
        return await createIssue({
          issueType: body.issueType,
          summary: body.summary,
          description: body.description ?? null,
          ...(body.assigneeAccountId !== undefined
            ? { assigneeAccountId: body.assigneeAccountId }
            : {}),
          ...(body.parentKey !== undefined ? { parentKey: body.parentKey } : {}),
          ...(body.epicKey !== undefined ? { epicKey: body.epicKey } : {}),
          ...(body.sprint !== undefined ? { sprint: body.sprint } : {}),
          ...(body.storyPoints !== undefined ? { storyPoints: body.storyPoints } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.labels !== undefined ? { labels: body.labels } : {}),
          ...(body.links !== undefined ? { links: body.links } : {}),
          ...(body.team !== undefined ? { team: body.team } : {}),
        })
      } catch (error) {
        const { status, message } = mapError(error)
        set.status = status
        return message
      }
    },
    {
      body: z.object({
        issueType: z
          .enum(['Story', 'Task', 'Bug', 'Spike', 'Sub-task', 'Epic', 'Requirement'])
          .describe(
            'Issue type. Use `Story` for user-facing features, `Task` for engineering chores, `Bug` for defects, `Spike` for time-boxed investigations, `Sub-task` when `parentKey` is also set, `Epic` for multi-sprint themes.',
          ),
        summary: z
          .string()
          .min(1)
          .max(255)
          .describe(
            'Ticket title. Follow the team convention: bracketed topic tags first, then a concise imperative. Stack multiple brackets when relevant: "[FE][Booking] Migrate OverviewInformation", "[MS][TMC][Cancellation] Block finance fields". Inspect /atlassian/jira/current-sprint before composing — match the existing prefix taxonomy.',
          ),
        description: z
          .string()
          .describe(
            'Plain text. Blank lines split paragraphs, single newlines become hard breaks. The Hermes footer (italic "Created by Johannes\' personal Hermes Agent") is auto-appended — do NOT add it manually. For richer formatting (panels, code blocks, bullet lists) Argo currently converts plain text only; raise the limit if needed.',
          )
          .optional(),
        assigneeAccountId: z
          .string()
          .describe(
            'Atlassian accountId (NOT email or display name). Resolve from /atlassian/jira/me (for Johannes), /atlassian/jira/users/search, or /m365/team members[].atlassian.accountId. Omit to leave unassigned.',
          )
          .optional(),
        parentKey: z
          .string()
          .regex(/^[A-Z]+-\d+$/)
          .describe(
            'Parent issue key (e.g. "EP-17850") — REQUIRED when issueType is "Sub-task", otherwise leave empty.',
          )
          .optional(),
        epicKey: z
          .string()
          .regex(/^[A-Z]+-\d+$/)
          .describe(
            'Epic key (e.g. "EP-16692") to link this Story/Task under. Distinct from `parentKey` — Epic Link is a Story-on-Epic association, not a hierarchy.',
          )
          .optional(),
        sprint: z
          .union([z.enum(['current', 'next', 'backlog']), z.number().int().positive()])
          .describe(
            'Where to place the ticket. `current` → active sprint on board 272 (Prometheus), `next` → earliest future sprint, `backlog` → leave unscheduled (default behavior if omitted). Or pass a numeric sprint ID directly when you already know it (from /atlassian/jira/sprints).',
          )
          .optional(),
        storyPoints: z
          .number()
          .min(0)
          .max(100)
          .describe(
            'Estimation in story points. Usually OMIT — points should be set during team refinement, not at creation. Only set when the ticket is a pre-estimated chore (e.g. "1 — config tweak").',
          )
          .optional(),
        priority: z
          .enum(['Highest', 'High', 'Medium', 'Low', 'Lowest'])
          .describe('Priority. Defaults to Medium upstream when omitted.')
          .optional(),
        labels: z
          .array(z.string())
          .describe(
            'Free-form labels. Conventions on this project include "tech", "business", "now", "next", "later", "Refinement", "Missing_Scenarios". Avoid inventing new label vocabulary without discussion.',
          )
          .optional(),
        links: z
          .array(IssueLinkSchema)
          .describe(
            'Structured issue links to create alongside the ticket (Jira REST has no atomic create-with-links — each link is a follow-up POST, fired sequentially so failures point at the offending entry). Use this for "Blocks EP-X", "Is blocked by EP-Y", "Relates to EP-Z" etc. — anything you would otherwise paste into the description as prose. Fetch the tenant-valid link types from GET /atlassian/jira/create-meta `linkTypes` if unsure.',
          )
          .optional(),
        team: z
          .enum(['prometheus', 'none'])
          .describe(
            'Team assignment. Defaults to `prometheus` — Argo always stamps Team=Prometheus (customfield_11688). Pass `none` only if you explicitly want to create an unassigned cross-team ticket.',
          )
          .optional(),
      }),
      response: {
        200: z.object({
          key: z.string().describe('Newly created issue key, e.g. "EP-17920"'),
          id: z.string().describe('Numeric issue id (string-wrapped, as Jira returns it)'),
          url: z.string().describe('Browse URL — open this to inspect the ticket in Jira'),
        }),
        400: z.string(),
        403: z.string(),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Create a Jira ticket on the Prometheus board',
        description:
          'Creates a new issue in the EP project, Team=Prometheus (always — board 272). Returns the new key + URL. The description is auto-suffixed with an italic Hermes attribution line. \n\n**Agent checklist before calling:** (1) call GET /atlassian/jira/create-meta if you forgot the field shape, (2) call GET /atlassian/jira/current-sprint to see how sibling tickets are titled (bracket convention), (3) for sub-tasks set `parentKey`, for Story-on-Epic set `epicKey`. Sprint defaults to backlog — pass `sprint: "current"` to drop the ticket directly into this week\'s sprint. \n\nFor updates use PATCH /atlassian/jira/issues/{key}; for comments POST /atlassian/jira/issues/{key}/comments. To resolve an assignee\'s accountId from a name use /atlassian/jira/users/search.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .patch(
    '/issues/:key',
    async ({ params, body, set }) => {
      try {
        return await updateIssue(params.key, {
          ...(body.summary !== undefined ? { summary: body.summary } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.issueType !== undefined ? { issueType: body.issueType } : {}),
          ...(body.assigneeAccountId !== undefined
            ? { assigneeAccountId: body.assigneeAccountId }
            : {}),
          ...(body.epicKey !== undefined ? { epicKey: body.epicKey } : {}),
          ...(body.sprint !== undefined ? { sprint: body.sprint } : {}),
          ...(body.storyPoints !== undefined ? { storyPoints: body.storyPoints } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.labels !== undefined ? { labels: body.labels } : {}),
          ...(body.links !== undefined ? { links: body.links } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        })
      } catch (error) {
        const { status, message } = mapError(error)
        set.status = status
        return message
      }
    },
    {
      params: z.object({
        key: z
          .string()
          .regex(/^[A-Z]+-\d+$/)
          .describe('Issue key, e.g. "EP-17849"'),
      }),
      body: z.object({
        summary: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe("New ticket title. Keep the team's bracket convention."),
        description: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Replaces the entire description (Jira PUT semantics — there is no append). Pass empty string to clear. Hermes footer is re-stamped automatically. To add a follow-up note without rewriting, prefer POST /atlassian/jira/issues/{key}/comments.',
          ),
        issueType: z
          .enum(ISSUE_TYPE_ENUM)
          .optional()
          .describe(
            'Change the issue type after creation (Story↔Task↔Spike↔Bug↔...). Works in EP because the workflow is shared across types; Jira may reject combinations that change schema-required fields. Use this when the ticket was filed under the wrong type — recreation loses key + history.',
          ),
        assigneeAccountId: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Atlassian accountId, or null to unassign. Resolve via /atlassian/jira/users/search.',
          ),
        epicKey: z
          .string()
          .regex(/^[A-Z]+-\d+$/)
          .nullable()
          .optional()
          .describe('Epic key to link under, or null to remove from epic.'),
        sprint: z
          .union([z.enum(['current', 'next', 'backlog']), z.number().int().positive()])
          .optional()
          .describe(
            'Move to current/next sprint, drop to backlog, or assign to a specific sprint id.',
          ),
        storyPoints: z
          .number()
          .min(0)
          .max(100)
          .nullable()
          .optional()
          .describe(
            'Set or clear story points. Usually done by the team during refinement — be conservative about updating from an agent.',
          ),
        priority: z.enum(['Highest', 'High', 'Medium', 'Low', 'Lowest']).optional(),
        labels: z
          .array(z.string())
          .optional()
          .describe(
            'REPLACES the full label set — to add one, fetch existing labels first via GET /atlassian/jira/issue/{key}.',
          ),
        links: z
          .array(IssueLinkSchema)
          .optional()
          .describe(
            'ADDS issue links to the ticket. Unlike `labels`, this is additive — there is no remove-link endpoint exposed by Argo (Jira has no atomic set-links call and walking the diff would be racy). To drop a stale link, use the Jira UI. Fetch the tenant-valid link types from GET /atlassian/jira/create-meta `linkTypes`.',
          ),
        status: z
          .string()
          .optional()
          .describe(
            'Transition target — accepts a workflow transition name OR the destination status name (case-insensitive prefix match). Common values: "In Progress", "Code Review", "QA Tech", "QA Business", "Refinement Done", "Blocked", "Done". The active set of transitions depends on the ticket\'s current state — if the requested transition is unavailable you\'ll get a 409 listing the valid options.',
          ),
      }),
      response: {
        200: z.object({
          key: z.string(),
          url: z.string(),
          transitioned: z
            .boolean()
            .describe('true when the `status` field triggered a workflow transition'),
        }),
        400: z.string(),
        404: z.string(),
        409: z
          .string()
          .describe(
            'Returned when a requested status transition is not available from the current state — message lists valid transitions.',
          ),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Partially update a Jira ticket (fields + optional status transition)',
        description:
          'PATCH semantics: every supplied field is updated; omitted fields are left untouched. Two notable Jira gotchas wrapped here: (1) PUT description in Jira REPLACES the body (no native append) — pass null/empty to clear, or use POST .../comments for incremental notes; (2) `labels` REPLACES the full set — read existing labels first to add one. Status changes piggyback on the same call: pass `status: "Code Review"` to fire the matching workflow transition after the field update. Returns the canonical URL + a `transitioned` boolean so the agent knows whether the state actually moved.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/issues/:key/comments',
    async ({ params, body, set }) => {
      try {
        const r = await addComment(params.key, { body: body.body })
        return {
          id: r.id,
          key: params.key,
          issueUrl: browseUrl(params.key),
        }
      } catch (error) {
        const { status, message } = mapError(error)
        set.status = status
        return message
      }
    },
    {
      params: z.object({
        key: z.string().regex(/^[A-Z]+-\d+$/),
      }),
      body: z.object({
        body: z
          .string()
          .min(1)
          .describe(
            'Comment text. Blank lines split paragraphs. Hermes footer auto-appended. Use for follow-ups that should NOT overwrite the description — e.g. status updates, "tested locally, looks good", "blocked by EP-17XXX".',
          ),
      }),
      response: {
        200: z.object({
          id: z.string().describe('Comment id'),
          key: z.string(),
          issueUrl: z.string().describe('Browse URL of the parent ticket'),
        }),
        400: z.string(),
        404: z.string(),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: 'Post a comment on a Jira ticket',
        description:
          'Adds a comment to the ticket. Use this for incremental updates instead of PATCH .../issues/{key} with description — comments preserve the original description and keep an audit trail. Footer is auto-appended so the team always sees who filed the note.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/issues/:key/transitions',
    async ({ params, set }) => {
      try {
        const transitions = await listTransitions(params.key)
        return { transitions }
      } catch (error) {
        const { status, message } = mapError(error)
        set.status = status
        return message
      }
    },
    {
      params: z.object({ key: z.string().regex(/^[A-Z]+-\d+$/) }),
      response: {
        200: z.object({
          transitions: z.array(
            z.object({
              id: z.string().describe('Numeric transition id (workflow-specific)'),
              name: z
                .string()
                .describe('Human transition label, e.g. "Code Review", "Refinement Done"'),
              targetStatus: z
                .string()
                .nullable()
                .describe('The status the ticket lands in after the transition fires'),
            }),
          ),
        }),
        404: z.string(),
        503: z.string(),
      },
      detail: {
        tags: ['Atlassian'],
        summary: "List transitions available on a ticket's current state",
        description:
          'Returns the workflow transitions valid for this ticket right now. Use this before PATCH .../issues/{key} with `status: "..."` if you\'re unsure which targets are reachable — the EP workflow gates some transitions on the source state. The returned `name` and `targetStatus` are both accepted by the PATCH `status` field (case-insensitive).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
