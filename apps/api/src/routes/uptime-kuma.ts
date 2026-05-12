import { Elysia } from 'elysia'
import { z } from 'zod'
import { uptimeKumaClient } from '../clients/uptime-kuma'

const MonitorSchema = z.object({
  id: z.string().describe('UptimeKuma monitor ID'),
  name: z.string().describe('Display name'),
  type: z.string().describe('Monitor type: http, keyword, docker, push, mysql, group, …'),
  url: z.string().nullable().describe('Target URL. Null for docker, group, and push monitors.'),
  active: z.boolean().describe('Whether the monitor is enabled in UptimeKuma'),
  status: z.number().describe('0=DOWN 1=UP 2=PENDING 3=MAINTENANCE'),
  ping: z
    .number()
    .nullable()
    .describe('Response latency in milliseconds. Null for docker and push monitors.'),
  uptime1d: z
    .number()
    .nullable()
    .describe('Uptime ratio over last 24 h (0.0–1.0). Null until first uptime event lands.'),
  uptime30d: z
    .number()
    .nullable()
    .describe('Uptime ratio over last 30 days (0.0–1.0). Null until first uptime event lands.'),
})

const StatusFieldSchema = z
  .enum(['warming', 'ready', 'stale'])
  .describe('warming = no data yet · ready = live · stale = last-known data, connection lost')

const SnapshotSchema = z.object({
  status: StatusFieldSchema,
  lastUpdatedAt: z
    .string()
    .nullable()
    .describe('ISO timestamp of latest event applied to in-memory state'),
  staleSince: z.string().nullable().describe('ISO timestamp of last disconnect; null while ready'),
  lastError: z.string().nullable(),
  monitors: z.array(MonitorSchema),
})

export const uptimeKumaRoutes = new Elysia({ prefix: '/uptime-kuma' })

  .get('/monitors', () => uptimeKumaClient.getSnapshot(), {
    response: SnapshotSchema,
    detail: {
      tags: ['Infrastructure'],
      summary: 'Live UptimeKuma monitor snapshot (held in memory via long-lived socket)',
      description:
        'Returns the in-memory snapshot maintained by a persistent socket.io connection to UptimeKuma. ' +
        'Includes a `status` field (warming|ready|stale) and `lastUpdatedAt` so callers can reason about freshness.',
      security: [{ BearerAuth: [] }],
    },
  })

  .get(
    '/status',
    () => {
      const snapshot = uptimeKumaClient.getSnapshot()
      const real = snapshot.monitors.filter((m) => m.type !== 'group')
      return {
        status: snapshot.status,
        lastUpdatedAt: snapshot.lastUpdatedAt,
        staleSince: snapshot.staleSince,
        lastError: snapshot.lastError,
        up: real.filter((m) => m.status === 1).length,
        down: real.filter((m) => m.status === 0).length,
        maintenance: real.filter((m) => m.status === 3).length,
        total: real.length,
      }
    },
    {
      response: z.object({
        status: StatusFieldSchema,
        lastUpdatedAt: z.string().nullable(),
        staleSince: z.string().nullable(),
        lastError: z.string().nullable(),
        up: z.number(),
        down: z.number(),
        maintenance: z.number(),
        total: z.number(),
      }),
      detail: {
        tags: ['Infrastructure'],
        summary: 'UptimeKuma monitor counts',
        description:
          'Aggregated counters (up / down / maintenance / total) derived from the in-memory snapshot. Group monitors are excluded since they aggregate child monitors. Includes `status` (warming|ready|stale) and `lastUpdatedAt` so callers can reason about freshness. For the full monitor list with per-monitor uptime/ping use /uptime-kuma/monitors.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
