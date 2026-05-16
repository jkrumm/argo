import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  getMergeRequest,
  getMergeRequestApprovals,
  getMyself,
  getUserByUsername,
  listMergeRequestDiscussions,
  listMergeRequests,
  listProjectCommits,
  listProjectReleases,
  listRecentPushEvents,
  searchUsers,
} from '../clients/gitlab.js'

// --- Shared response schemas ----------------------------------------------

const UserSchema = z.object({
  id: z.number().int(),
  username: z
    .string()
    .describe('Stable handle (e.g. "johannes.krumm") — use for cross-system joins'),
  name: z.string(),
  webUrl: z.string(),
  state: z.string().describe('e.g. "active", "blocked"'),
})

const MemberSchema = z.object({
  username: z.string(),
  name: z.string(),
})

const MergeRequestSchema = z.object({
  id: z
    .number()
    .int()
    .describe('Global GitLab MR id — opaque, use {projectId, iid} for further calls'),
  iid: z.number().int().describe('Per-project MR number — the "!1234" in the web URL'),
  projectId: z.number().int(),
  projectPath: z
    .string()
    .nullable()
    .describe(
      'e.g. "iu-group/epos/prometheus/epos.student-enrolment" — human-readable project path',
    ),
  title: z.string(),
  state: z.enum(['opened', 'closed', 'merged', 'locked']),
  draft: z.boolean().describe('true when title still tagged Draft/WIP'),
  webUrl: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  author: MemberSchema.nullable(),
  assignees: z.array(MemberSchema),
  reviewers: z.array(MemberSchema),
  labels: z.array(z.string()),
  upvotes: z.number().int(),
  downvotes: z.number().int(),
  userNotesCount: z.number().int().describe('Number of human comments (excludes system events)'),
  mergeStatus: z
    .string()
    .nullable()
    .describe('e.g. "can_be_merged", "cannot_be_merged" — null when not yet checked'),
  hasConflicts: z.boolean(),
  createdAt: z.string().describe('ISO 8601'),
  updatedAt: z.string().describe('ISO 8601 — sort by this for most-recently-touched'),
  jiraKeys: z
    .array(z.string())
    .describe(
      'Jira issue keys (PROJECT-NUMBER) auto-extracted from the title, source branch, and description — e.g. ["EP-17284"]. Use these to pivot directly to /atlassian/jira/issue/{key} for full ticket context.',
    ),
})

const ApprovalsSchema = z.object({
  approved: z.boolean(),
  approvalsRequired: z.number().int(),
  approvalsLeft: z.number().int(),
  approvedBy: z.array(MemberSchema),
})

const NoteSchema = z.object({
  id: z.number().int(),
  body: z.string().describe('Markdown comment body'),
  author: MemberSchema.nullable(),
  system: z
    .boolean()
    .describe('true for auto-generated events (label change, assignee change, etc.)'),
  resolvable: z.boolean(),
  resolved: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const DiscussionSchema = z.object({
  id: z.string(),
  individualNote: z
    .boolean()
    .describe('false for threaded review comments, true for one-off comments'),
  notes: z.array(NoteSchema),
})

const CommitSchema = z.object({
  id: z.string().describe('Full SHA'),
  shortId: z.string(),
  title: z.string(),
  message: z.string(),
  authorName: z.string(),
  authoredDate: z.string(),
  webUrl: z.string(),
})

const ReleaseSchema = z.object({
  tagName: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  releasedAt: z.string().nullable(),
  webUrl: z.string().nullable(),
})

const PushEventSchema = z.object({
  id: z.number().int(),
  createdAt: z.string(),
  projectId: z.number().int(),
  authorUsername: z.string().nullable(),
  pushData: z
    .object({
      action: z.string().describe('"pushed", "created", "removed"'),
      refType: z.string().describe('"branch" or "tag"'),
      ref: z.string().nullable(),
      commitTitle: z.string().nullable(),
      commitFrom: z.string().nullable(),
      commitTo: z.string().nullable(),
      commitCount: z.number().int(),
    })
    .nullable(),
})

// --- Plugin ---------------------------------------------------------------

export const gitlabRoutes = new Elysia({ prefix: '/gitlab' })
  .get(
    '/me',
    async ({ set }) => {
      try {
        return await getMyself()
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      response: { 200: UserSchema, 503: z.string() },
      detail: {
        tags: ['GitLab'],
        summary: 'Resolve the authenticated GitLab user',
        description:
          "Returns the GitLab user that argo's PAT belongs to. Sanity-check endpoint — 200 confirms the token is valid and read_api/read_user scopes are present. The returned `username` is the stable handle to plug into other endpoints (e.g. ?authorUsername=…).",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/users/search',
    async ({ query, set }) => {
      try {
        const users = await searchUsers(query.query, query.perPage ?? 10)
        return { users }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      query: z.object({
        query: z
          .string()
          .min(1)
          .describe('Free-form: matches name, username, or email visible to you'),
        perPage: z.coerce.number().int().min(1).max(50).default(10).optional(),
      }),
      response: { 200: z.object({ users: z.array(UserSchema) }), 503: z.string() },
      detail: {
        tags: ['GitLab'],
        summary: 'Search GitLab users by name/username/email',
        description:
          "Free-form user search via GET /users?search=…. Filtered by what your token can see. Use this to resolve a teammate's `username` for joining with m365-team.json — e.g. populate `gitlab.username` once, then use stable handles for all subsequent queries.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/users/by-username/:username',
    async ({ params, set }) => {
      try {
        const user = await getUserByUsername(params.username)
        if (!user) {
          set.status = 404
          return 'User not found'
        }
        return user
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      params: z.object({
        username: z.string().describe('Exact username (e.g. "johannes.krumm")'),
      }),
      response: { 200: UserSchema, 404: z.string(), 503: z.string() },
      detail: {
        tags: ['GitLab'],
        summary: 'Look up a GitLab user by exact username',
        description:
          'Exact-match lookup via GET /users?username=…. Returns 404 if no user matches. For fuzzy/partial matching use /gitlab/users/search.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/merge-requests',
    async ({ query, set }) => {
      try {
        const opts: Parameters<typeof listMergeRequests>[0] = {
          scope: query.scope ?? 'created_by_me',
          state: query.state ?? 'opened',
          perPage: query.perPage ?? 50,
          page: query.page ?? 1,
        }
        if (query.authorUsername) opts.authorUsername = query.authorUsername
        if (query.assigneeUsername) opts.assigneeUsername = query.assigneeUsername
        if (query.reviewerUsername) opts.reviewerUsername = query.reviewerUsername
        const mrs = await listMergeRequests(opts)
        return { mergeRequests: mrs }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      query: z.object({
        scope: z
          .enum(['created_by_me', 'assigned_to_me', 'reviews_for_me', 'all'])
          .default('created_by_me')
          .describe(
            'created_by_me = I opened it · assigned_to_me = I own it · reviews_for_me = I should review it · all = anything I can see',
          )
          .optional(),
        state: z
          .enum(['opened', 'closed', 'merged', 'locked'])
          .default('opened')
          .describe('Defaults to opened — change to "merged" for shipped MR history')
          .optional(),
        authorUsername: z
          .string()
          .describe("Filter by GitLab username — combine with scope=all to view a teammate's MRs")
          .optional(),
        assigneeUsername: z.string().optional(),
        reviewerUsername: z.string().optional(),
        perPage: z.coerce.number().int().min(1).max(100).default(50).optional(),
        page: z.coerce.number().int().min(1).default(1).optional(),
      }),
      response: {
        200: z.object({ mergeRequests: z.array(MergeRequestSchema) }),
        503: z.string(),
      },
      detail: {
        tags: ['GitLab'],
        summary: 'List merge requests across all visible projects',
        description:
          'Cross-project MR listing via the top-level /merge_requests endpoint — no per-project iteration needed. Sorted by updated_at desc. Use scope=created_by_me|assigned_to_me|reviews_for_me for the three "my work" lenses; combine scope=all with authorUsername to view a specific teammate\'s open MRs (e.g. resolve their username from /m365/team → gitlab.username, then pass it here). For a single MR with full details + approvals, fetch /gitlab/projects/{projectId}/merge-requests/{iid} and /…/approvals.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/projects/:projectId/merge-requests/:iid',
    async ({ params, set }) => {
      try {
        return await getMergeRequest(Number(params.projectId), Number(params.iid))
      } catch (error) {
        set.status = error instanceof Error && error.message.includes('404') ? 404 : 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      params: z.object({
        projectId: z.coerce
          .number()
          .int()
          .describe('Numeric project id (from MergeRequest.projectId)'),
        iid: z.coerce.number().int().describe('Per-project MR number (the "!1234")'),
      }),
      response: { 200: MergeRequestSchema, 404: z.string(), 503: z.string() },
      detail: {
        tags: ['GitLab'],
        summary: 'Fetch one merge request',
        description:
          'Returns the same MR shape as the list endpoint but for a single MR. Use when you already have {projectId, iid} from a list call or a webhook payload. For the comment thread call /gitlab/projects/{projectId}/merge-requests/{iid}/discussions; for approval state call /…/approvals.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/projects/:projectId/merge-requests/:iid/approvals',
    async ({ params, set }) => {
      try {
        return await getMergeRequestApprovals(Number(params.projectId), Number(params.iid))
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      params: z.object({
        projectId: z.coerce.number().int(),
        iid: z.coerce.number().int(),
      }),
      response: { 200: ApprovalsSchema, 503: z.string() },
      detail: {
        tags: ['GitLab'],
        summary: 'Approval state for a merge request',
        description:
          'Returns whether the MR is approved, how many approvals it still needs, and who has approved so far. Works on GitLab Free. Use this to triage "what is ready to merge" — agents should treat `approved=true && mergeStatus="can_be_merged" && !hasConflicts && !draft` as the green-light condition.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/projects/:projectId/merge-requests/:iid/discussions',
    async ({ params, query, set }) => {
      try {
        const discussions = await listMergeRequestDiscussions(
          Number(params.projectId),
          Number(params.iid),
          { includeSystem: query.includeSystem ?? false, perPage: query.perPage ?? 100 },
        )
        return { discussions }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      params: z.object({
        projectId: z.coerce.number().int(),
        iid: z.coerce.number().int(),
      }),
      query: z.object({
        includeSystem: z.coerce
          .boolean()
          .default(false)
          .describe(
            'When false (default), drops auto-generated events (label/assignee changes, merge events)',
          )
          .optional(),
        perPage: z.coerce.number().int().min(1).max(100).default(100).optional(),
      }),
      response: { 200: z.object({ discussions: z.array(DiscussionSchema) }), 503: z.string() },
      detail: {
        tags: ['GitLab'],
        summary: 'Threaded discussions (comments) on a merge request',
        description:
          'Returns review comments grouped by thread. Each Discussion has notes[]: a top-level comment + replies (or just one Note when individualNote=true). System events (label changes, etc.) are filtered out by default — pass ?includeSystem=true for the raw GitLab stream. Use this to surface unresolved review feedback to the author.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/projects/:projectId/commits',
    async ({ params, query, set }) => {
      try {
        const opts: Parameters<typeof listProjectCommits>[1] = {
          perPage: query.perPage ?? 50,
        }
        if (query.since) opts.since = query.since
        if (query.until) opts.until = query.until
        if (query.refName) opts.refName = query.refName
        const commits = await listProjectCommits(Number(params.projectId), opts)
        return { commits }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      params: z.object({
        projectId: z.coerce.number().int(),
      }),
      query: z.object({
        since: z.string().describe('ISO 8601 lower bound on authored_date').optional(),
        until: z.string().describe('ISO 8601 upper bound on authored_date').optional(),
        refName: z
          .string()
          .describe("Branch, tag, or revision range — defaults to the project's default branch")
          .optional(),
        perPage: z.coerce.number().int().min(1).max(100).default(50).optional(),
      }),
      response: { 200: z.object({ commits: z.array(CommitSchema) }), 503: z.string() },
      detail: {
        tags: ['GitLab'],
        summary: 'Recent commits on a project',
        description:
          'Returns commits on the default branch (or ?refName=...) ordered newest first. Use ?since=ISO and ?until=ISO for a window. For a cross-project view of YOUR recent push activity (without iterating per project) use /gitlab/events/recent — that endpoint hits /events and surfaces commit-level metadata.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/projects/:projectId/releases',
    async ({ params, query, set }) => {
      try {
        const releases = await listProjectReleases(Number(params.projectId), query.perPage ?? 20)
        return { releases }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      params: z.object({
        projectId: z.coerce.number().int(),
      }),
      query: z.object({
        perPage: z.coerce.number().int().min(1).max(100).default(20).optional(),
      }),
      response: { 200: z.object({ releases: z.array(ReleaseSchema) }), 503: z.string() },
      detail: {
        tags: ['GitLab'],
        summary: 'Releases for a project',
        description:
          'Returns releases (tag + name + description + released_at) sorted newest first. GitLab has no cross-project releases feed — iterate per project. Pair with /gitlab/projects/{projectId}/commits to see what shipped between two tags.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .get(
    '/events/recent',
    async ({ query, set }) => {
      try {
        const after = query.after ?? defaultAfter(query.days ?? 7)
        const events = await listRecentPushEvents({ after, perPage: query.perPage ?? 100 })
        return { events }
      } catch (error) {
        set.status = 503
        return error instanceof Error ? error.message : 'GitLab error'
      }
    },
    {
      query: z.object({
        after: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('YYYY-MM-DD lower bound — defaults to today minus `days`')
          .optional(),
        days: z.coerce
          .number()
          .int()
          .min(1)
          .max(90)
          .default(7)
          .describe('Lookback window when `after` is omitted (default 7, max 90)')
          .optional(),
        perPage: z.coerce.number().int().min(1).max(100).default(100).optional(),
      }),
      response: { 200: z.object({ events: z.array(PushEventSchema) }), 503: z.string() },
      detail: {
        tags: ['GitLab'],
        summary: 'Recent push events by the authenticated user (cross-project)',
        description:
          'Hits /events?action=pushed for the authenticated user — gives a single-call view of YOUR recent commit activity across every project, with project_id + commit metadata. Requires `read_user` scope on the PAT. Use this for "what did I push this week" or to drive cross-project commit timelines without iterating /projects/:id/commits per repo.',
        security: [{ BearerAuth: [] }],
      },
    },
  )

function defaultAfter(daysBack: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d.toISOString().slice(0, 10)
}
