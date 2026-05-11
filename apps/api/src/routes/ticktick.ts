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
      tags: ['TickTick'],
      summary: 'Get all projects',
      security: [{ BearerAuth: [] }],
    },
  })
  .get(
    '/project/:projectId/data',
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
        tags: ['TickTick'],
        summary: 'Get project with tasks and columns',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .post(
    '/task',
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
        tags: ['TickTick'],
        summary: 'Create a task',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/task/:taskId',
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
        tags: ['TickTick'],
        summary: 'Update a task',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .post(
    '/project/:projectId/task/:taskId/complete',
    ({ params }) => ticktickOps.completeTask(params.projectId, params.taskId),
    {
      params: z.object({ projectId: z.string(), taskId: z.string() }),
      response: z.object({ data: z.unknown() }),
      detail: {
        tags: ['TickTick'],
        summary: 'Mark task as complete',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/project/:projectId/task/:taskId',
    ({ params }) => ticktickOps.deleteTask(params.projectId, params.taskId),
    {
      params: z.object({ projectId: z.string(), taskId: z.string() }),
      response: z.object({ data: z.unknown() }),
      detail: {
        tags: ['TickTick'],
        summary: 'Delete a task',
        security: [{ BearerAuth: [] }],
      },
    },
  )
