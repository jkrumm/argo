import { Elysia } from 'elysia'
import { z } from 'zod'
import { ticktickOps } from '../clients/ticktick'

// ─── Inbound: accept YYYY-MM-DD, convert to UTC midnight ISO for TickTick ───

// Convert YYYY-MM-DD to UTC midnight ISO string with timeZone: UTC.
// TickTick treats the task as timezone-agnostic — the date is always correct
// regardless of account timezone or where the user is physically located.
function normalizeDueDate(body: Record<string, unknown>): Record<string, unknown> {
  const { dueDate } = body
  if (!dueDate || typeof dueDate !== 'string') return body
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error(`dueDate must be YYYY-MM-DD, got: ${dueDate}`)
  }
  const iso = `${dueDate}T00:00:00+0000`
  return { ...body, dueDate: iso, startDate: iso, isAllDay: true, timeZone: 'UTC' }
}

// ─── Outbound: extract plain YYYY-MM-DD from TickTick's ISO date string ──────

// All tasks created via this API have timeZone: UTC, so the date portion of the
// ISO string is the correct calendar date. For legacy tasks with non-UTC offsets,
// we still just return the date portion as-is (best effort).
// Idempotent: YYYY-MM-DD input passes through unchanged.
function fromTickTickISO(iso: string): string {
  return iso.slice(0, 10)
}

function normalizeTaskDates(task: Record<string, unknown>): Record<string, unknown> {
  const result = { ...task }
  if (typeof result['dueDate'] === 'string' && result['dueDate']) {
    result['dueDate'] = fromTickTickISO(result['dueDate'])
  }
  if (typeof result['startDate'] === 'string' && result['startDate']) {
    result['startDate'] = fromTickTickISO(result['startDate'])
  }
  return result
}

// Normalize SDK response { data: T } where T is a task or project data with tasks array.
function normalizeSdkResponse(sdkResult: Record<string, unknown>): Record<string, unknown> {
  const data = sdkResult['data']
  if (!data || typeof data !== 'object') return sdkResult
  const d = data as Record<string, unknown>
  if (Array.isArray(d['tasks'])) {
    return {
      ...sdkResult,
      data: {
        ...d,
        tasks: d['tasks'].map((t) => normalizeTaskDates(t as Record<string, unknown>)),
      },
    }
  }
  if (typeof d['id'] === 'string') {
    return { ...sdkResult, data: normalizeTaskDates(d) }
  }
  return sdkResult
}

const TaskSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  desc: z.string().optional(),
  dueDate: z.string().describe('YYYY-MM-DD').optional(),
  startDate: z.string().describe('YYYY-MM-DD').optional(),
  priority: z.number().describe('0=none 1=low 3=medium 5=high').optional(),
  status: z.number().describe('0=active 2=completed').optional(),
  isAllDay: z.union([z.string(), z.boolean()]).optional(),
  completedTime: z.string().optional(),
  timeZone: z.string().optional(),
  sortOrder: z.number().optional(),
})

const ProjectSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  color: z.string().nullable().optional(),
  closed: z.boolean().nullable().optional(),
  viewMode: z.string().nullable().optional(),
  permission: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
})

export const ticktickRoutes = new Elysia({ prefix: '/ticktick' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .get('/projects', () => ticktickOps.getProjects() as any, {
    response: z.object({ data: z.array(ProjectSchema) }),
    detail: {
      tags: ['Productivity'],
      summary: 'List TickTick projects',
      description:
        'Returns all TickTick projects (lists) visible to the authenticated TickTick account. Use the project.id values returned here to drill into tasks via GET /ticktick/projects/{projectId}/data.',
      security: [{ BearerAuth: [] }],
    },
  })
  .get(
    '/projects/:projectId/data',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ params }) =>
      normalizeSdkResponse(
        (await ticktickOps.getProjectData(params.projectId)) as Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    {
      params: z.object({ projectId: z.string() }),
      response: z.object({
        data: z.object({
          tasks: z.array(TaskSchema),
          columns: z
            .array(z.object({ id: z.string().optional(), name: z.string().optional() }))
            .optional(),
        }),
      }),
      detail: {
        tags: ['Productivity'],
        summary: 'Get a TickTick project with its tasks',
        description:
          'Returns the project metadata plus all of its tasks and (for kanban projects) columns. Task dueDate and startDate are normalised from TickTick ISO timestamps to YYYY-MM-DD on the way out.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .post(
    '/tasks',
    async ({ body }) =>
      normalizeSdkResponse(
        (await ticktickOps.createTask(normalizeDueDate(body as Record<string, unknown>))) as Record<
          string,
          unknown
        >,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any,
    {
      body: z
        .object({
          title: z.string(),
          projectId: z.string().optional(),
          dueDate: z
            .string()
            .describe(
              'YYYY-MM-DD only. Server converts to the correct midnight timestamp for the TickTick account timezone.',
            )
            .optional(),
          priority: z.number().describe('0=none, 1=low, 3=medium, 5=high').optional(),
          content: z.string().optional(),
          startDate: z.string().optional(),
          isAllDay: z.boolean().optional(),
        })
        .passthrough(),
      response: z.object({ data: TaskSchema }),
      detail: {
        tags: ['Productivity'],
        summary: 'Create a TickTick task',
        description:
          'Creates a task. `dueDate` accepts YYYY-MM-DD only — the server converts to UTC midnight ISO with `isAllDay: true, timeZone: "UTC"` so the date stays correct regardless of TickTick account timezone. Priority: 0=none, 1=low, 3=medium, 5=high. To set the project, pass `projectId` (default = TickTick inbox).',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/tasks/:taskId',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ params, body }): Promise<any> => {
      const res = await ticktickOps.updateTask(
        params.taskId,
        normalizeDueDate(body as Record<string, unknown>),
      )
      if (!res.ok) return new Response(await res.text(), { status: res.status })
      return normalizeTaskDates((await res.json()) as Record<string, unknown>)
    },
    {
      params: z.object({ taskId: z.string() }),
      body: z
        .object({
          title: z.string().optional(),
          projectId: z.string().optional(),
          dueDate: z.string().describe('YYYY-MM-DD only').optional(),
          priority: z.number().describe('0=none, 1=low, 3=medium, 5=high').optional(),
          content: z.string().optional(),
          status: z.number().describe('0=active, 2=completed').optional(),
        })
        .passthrough(),
      response: TaskSchema,
      detail: {
        tags: ['Productivity'],
        summary: 'Update a TickTick task',
        description:
          "Partial update of an existing task. POST (not PATCH) because that is what TickTick's SDK expects. Date handling is identical to task creation — pass dueDate as YYYY-MM-DD. Set `status: 2` to mark completed, `status: 0` to reopen. Returns the upstream response or proxies the TickTick error body on non-2xx.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/projects/:projectId/tasks/:taskId/complete',
    ({ params }) => ticktickOps.completeTask(params.projectId, params.taskId),
    {
      params: z.object({ projectId: z.string(), taskId: z.string() }),
      response: z.object({ data: z.unknown() }),
      detail: {
        tags: ['Productivity'],
        summary: 'Mark a TickTick task complete',
        description:
          'Calls the TickTick "complete" endpoint, which is semantically equivalent to setting status=2 but doesn\'t require sending the full task body. Both `projectId` and `taskId` are required by the upstream API.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/projects/:projectId/tasks/:taskId',
    ({ params }) => ticktickOps.deleteTask(params.projectId, params.taskId),
    {
      params: z.object({ projectId: z.string(), taskId: z.string() }),
      response: z.object({ data: z.unknown() }),
      detail: {
        tags: ['Productivity'],
        summary: 'Delete a TickTick task',
        description:
          'Permanently deletes a task. Both `projectId` and `taskId` are required by the upstream API. There is no soft-delete or trash — once deleted, the task is gone.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
