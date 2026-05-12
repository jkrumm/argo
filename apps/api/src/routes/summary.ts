import { Elysia } from 'elysia'
import { z } from 'zod'
import { env } from '../env.js'
import { uptimeKumaClient } from '../clients/uptime-kuma.js'
import { ticktickOps } from '../clients/ticktick.js'
import type { Project, Task } from '../generated/ticktick/types.gen.js'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DockerContainer {
  Id: string
  Names: string[]
  State: string
}

interface DockerInspect {
  RestartCount: number
  State: { Health?: { Status: string }; StartedAt: string }
}

interface DockerInfo {
  NCPU: number
  MemTotal: number
  ServerVersion: string
}

interface DockerSummary {
  host: { cpus: number; totalMemoryGB: number; dockerVersion: string }
  counts: { total: number; running: number; stopped: number }
  alerts: {
    unhealthyContainers: string[]
    highRestartContainers: Array<{ name: string; restarts: number }>
  }
}

interface TickTaskItem {
  id: string
  title: string
  dueDate: string
  projectName: string
  priority: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function settle<T>(r: PromiseSettledResult<T>): T | { error: string } {
  return r.status === 'fulfilled'
    ? r.value
    : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

async function fetchDockerSummary(proxyUrl: string): Promise<DockerSummary> {
  if (!proxyUrl) throw new Error('Docker proxy URL not configured')

  async function dockerGet<T>(path: string): Promise<T> {
    const res = await fetch(`${proxyUrl}${path}`)
    if (!res.ok) throw new Error(`Docker API ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  }

  const [containers, dockerInfo] = await Promise.all([
    dockerGet<DockerContainer[]>('/containers/json?all=1'),
    dockerGet<DockerInfo>('/info'),
  ])

  const inspected = await Promise.all(
    containers.map(async (c) => {
      const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12)
      try {
        const inspect = await dockerGet<DockerInspect>(`/containers/${c.Id}/json`)
        return {
          name,
          state: c.State,
          health: inspect.State.Health?.Status ?? 'none',
          restartCount: inspect.RestartCount,
        }
      } catch {
        return { name, state: c.State, health: 'unknown', restartCount: -1 }
      }
    }),
  )

  const running = inspected.filter((c) => c.state === 'running')
  const stopped = inspected.filter((c) => c.state !== 'running')
  const unhealthy = running.filter((c) => c.health === 'unhealthy')
  const highRestarts = running.filter((c) => c.restartCount > 3)

  return {
    host: {
      cpus: dockerInfo.NCPU,
      totalMemoryGB: Math.round((dockerInfo.MemTotal / 1024 / 1024 / 1024) * 10) / 10,
      dockerVersion: dockerInfo.ServerVersion,
    },
    counts: { total: containers.length, running: running.length, stopped: stopped.length },
    alerts: {
      unhealthyContainers: unhealthy.map((c) => c.name),
      highRestartContainers: highRestarts.map((c) => ({ name: c.name, restarts: c.restartCount })),
    },
  }
}

async function fetchTickTickSummary() {
  const projectsRes = await ticktickOps.getProjects()
  const projects = (projectsRes.data ?? []) as Project[]
  const projectMap = new Map(projects.map((p) => [p.id ?? '', p.name ?? '']))

  const projectDataList = await Promise.all(
    projects.filter((p) => p.id).map((p) => ticktickOps.getProjectData(p.id!).catch(() => null)),
  )

  const allTasks: Task[] = []
  for (const res of projectDataList) {
    if (!res?.data) continue
    const data = res.data as { tasks?: Task[] }
    if (Array.isArray(data.tasks)) allTasks.push(...data.tasks)
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const in7 = new Date()
  in7.setUTCDate(in7.getUTCDate() + 7)
  const in7Str = in7.toISOString().slice(0, 10)

  const toItem = (task: Task): TickTaskItem => ({
    id: task.id ?? '',
    title: task.title ?? '',
    dueDate: (task.dueDate ?? '').slice(0, 10),
    projectName: projectMap.get(task.projectId ?? '') ?? task.projectId ?? '',
    priority: task.priority ?? 0,
  })

  const eligible = allTasks.filter(
    (t) => t.status !== 2 && t.dueDate && (t.dueDate ?? '').length >= 10,
  )

  const overdue = eligible
    .filter((t) => (t.dueDate ?? '').slice(0, 10) < todayStr)
    .map(toItem)
    .toSorted((a, b) => a.dueDate.localeCompare(b.dueDate) || b.priority - a.priority)

  const dueSoon = eligible
    .filter((t) => {
      const d = (t.dueDate ?? '').slice(0, 10)
      return d >= todayStr && d <= in7Str
    })
    .map(toItem)
    .toSorted((a, b) => a.dueDate.localeCompare(b.dueDate) || b.priority - a.priority)

  return { overdue, dueSoon }
}

// ─── Response Schema ─────────────────────────────────────────────────────────

const errSchema = z.object({ error: z.string() })

const DockerSummarySchema = z.object({
  host: z.object({ cpus: z.number(), totalMemoryGB: z.number(), dockerVersion: z.string() }),
  counts: z.object({ total: z.number(), running: z.number(), stopped: z.number() }),
  alerts: z.object({
    unhealthyContainers: z.array(z.string()),
    highRestartContainers: z.array(z.object({ name: z.string(), restarts: z.number() })),
  }),
})

const TickTaskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueDate: z.string().describe('YYYY-MM-DD'),
  projectName: z.string(),
  priority: z.number().describe('0=none 1=low 3=medium 5=high'),
})

const UptimeKumaSummarySchema = z.object({
  status: z
    .enum(['warming', 'ready', 'stale'])
    .describe('warming = no data yet · ready = live · stale = last-known data, connection lost'),
  lastUpdatedAt: z.string().nullable(),
  staleSince: z.string().nullable(),
  lastError: z.string().nullable(),
  up: z.number(),
  down: z.number(),
  maintenance: z.number(),
  total: z.number(),
  downMonitors: z.array(
    z.object({ name: z.string(), type: z.string(), uptime1d: z.number().nullable() }),
  ),
})

const SummaryResponseSchema = z.object({
  generatedAt: z.string().describe('ISO timestamp when summary was generated'),
  uptimeKuma: UptimeKumaSummarySchema,
  dockerHomelab: z.union([DockerSummarySchema, errSchema]),
  dockerVps: z.union([DockerSummarySchema, errSchema]),
  ticktick: z.union([
    z.object({ overdue: z.array(TickTaskItemSchema), dueSoon: z.array(TickTaskItemSchema) }),
    errSchema,
  ]),
})

// ─── Route ───────────────────────────────────────────────────────────────────

export const summaryRoute = new Elysia().get(
  '/summary',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (): Promise<any> => {
    const kumaSnapshot = uptimeKumaClient.getSnapshot()
    const nonGroup = kumaSnapshot.monitors.filter((m) => m.type !== 'group')
    const uptimeKuma = {
      status: kumaSnapshot.status,
      lastUpdatedAt: kumaSnapshot.lastUpdatedAt,
      staleSince: kumaSnapshot.staleSince,
      lastError: kumaSnapshot.lastError,
      up: nonGroup.filter((m) => m.status === 1).length,
      down: nonGroup.filter((m) => m.status === 0).length,
      maintenance: nonGroup.filter((m) => m.status === 3).length,
      total: nonGroup.length,
      downMonitors: nonGroup
        .filter((m) => m.status === 0)
        .map((m) => ({ name: m.name, type: m.type, uptime1d: m.uptime1d })),
    }

    const dockerHomelabUrl = env.DOCKER_HOMELAB_URL || `http://${env.HOMELAB_TAILSCALE_IP}:2376`
    const dockerVpsUrl = env.DOCKER_VPS_URL
    const [dockerHLResult, dockerVPSResult, ticktickResult] = await Promise.allSettled([
      withTimeout(fetchDockerSummary(dockerHomelabUrl), 10_000, 'dockerHomelab'),
      withTimeout(fetchDockerSummary(dockerVpsUrl), 10_000, 'dockerVps'),
      withTimeout(fetchTickTickSummary(), 15_000, 'ticktick'),
    ])

    return {
      generatedAt: new Date().toISOString(),
      uptimeKuma,
      dockerHomelab: settle(dockerHLResult),
      dockerVps: settle(dockerVPSResult),
      ticktick: settle(ticktickResult),
    }
  },
  {
    response: SummaryResponseSchema,
    detail: {
      tags: ['System'],
      summary: 'Aggregated infrastructure snapshot',
      description:
        'Single-call dashboard summary: UptimeKuma monitor counts, Docker container health on HomeLab + VPS, and overdue/due-soon TickTick tasks. Each subsystem is fetched in parallel with a per-subsystem timeout; failures degrade gracefully to `{ error: ... }` rather than failing the whole response. Use this for at-a-glance ops monitoring; for per-domain detail call the dedicated endpoints (e.g. /uptime-kuma/status, /docker/homelab/summary).',
      security: [{ BearerAuth: [] }],
    },
  },
)
