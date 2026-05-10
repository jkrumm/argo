import { Cron } from 'croner'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics, garminActivities, syncControl } from '../db/schema.js'
import {
  garminCollector,
  type ActivityRecord,
  type DailyMetric,
} from '../clients/garmin-collector.js'

const BACKFILL_DAYS = Number(process.env.GARMIN_BACKFILL_DAYS ?? '7')
const ACTIVITIES_INITIAL_BACKFILL_DAYS = Number(
  process.env.GARMIN_ACTIVITIES_INITIAL_BACKFILL_DAYS ?? '60',
)
const HEARTBEAT_URL = process.env.GARMIN_HEARTBEAT_URL ?? ''

let inProgress = false

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}

function isDayComplete(targetDate: string): boolean {
  const dayEnd = new Date(`${targetDate}T00:00:00Z`)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)
  return Date.now() - dayEnd.getTime() >= 6 * 60 * 60 * 1000
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function pingHeartbeat(status: 'up' | 'down', msg: string): Promise<void> {
  if (!HEARTBEAT_URL) return
  try {
    const url = `${HEARTBEAT_URL}?status=${status}&msg=${encodeURIComponent(msg)}`
    await fetch(url, { signal: AbortSignal.timeout(10_000) })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[garmin-sync] heartbeat ping failed:', e)
  }
}

async function ensureControlRow(): Promise<void> {
  const [row] = await db.select().from(syncControl).where(eq(syncControl.id, 1))
  if (!row) {
    await db.insert(syncControl).values({ id: 1 })
  }
}

async function upsertDailyMetric(metric: DailyMetric): Promise<void> {
  const completed = isDayComplete(metric.date) ? 1 : 0
  const synced_at = isoNow()
  const [existing] = await db
    .select()
    .from(dailyMetrics)
    .where(eq(dailyMetrics.date, metric.date))

  if (!existing) {
    await db.insert(dailyMetrics).values({ ...metric, completed, synced_at })
    return
  }

  // Only overwrite with non-null values; preserve existing non-null fields.
  const updates: Record<string, unknown> = { synced_at, completed }
  for (const [k, v] of Object.entries(metric)) {
    if (k === 'date') continue
    if (v !== null && v !== undefined) updates[k] = v
  }
  await db.update(dailyMetrics).set(updates).where(eq(dailyMetrics.date, metric.date))
}

async function upsertActivities(records: ActivityRecord[]): Promise<number> {
  if (records.length === 0) return 0
  const synced_at = isoNow()
  for (const r of records) {
    await db
      .insert(garminActivities)
      .values({ ...r, synced_at })
      .onConflictDoUpdate({
        target: garminActivities.activity_id,
        set: { ...r, synced_at },
      })
  }
  return records.length
}

export type GarminSyncResult = {
  errors: number
  message: string
  daysSynced: number
  activitiesSynced: number
}

export async function runGarminSync(reason: string): Promise<GarminSyncResult> {
  if (inProgress) {
    return { errors: 0, message: 'already in progress', daysSynced: 0, activitiesSynced: 0 }
  }
  inProgress = true

  await db
    .update(syncControl)
    .set({ in_progress: 1, last_started_at: sql`datetime('now')`, refresh_requested: 0 })
    .where(eq(syncControl.id, 1))

  // eslint-disable-next-line no-console
  console.log(`[garmin-sync] starting (reason=${reason}, backfill=${BACKFILL_DAYS}d)`)

  let errors = 0
  let daysSynced = 0
  let activitiesSynced = 0
  let activitiesMsg = ''

  const today = new Date()
  const fromDay = new Date(today)
  fromDay.setUTCDate(fromDay.getUTCDate() - BACKFILL_DAYS)

  try {
    const metrics = await garminCollector.dailyMetrics({
      from: ymd(fromDay),
      to: ymd(today),
    })
    for (const m of metrics) {
      try {
        await upsertDailyMetric(m)
        daysSynced += 1
      } catch (e) {
        errors += 1
        // eslint-disable-next-line no-console
        console.error(`[garmin-sync] upsert ${m.date} failed:`, e)
      }
    }
  } catch (e) {
    errors += 1
    // eslint-disable-next-line no-console
    console.error('[garmin-sync] daily-metrics fetch failed:', e)
  }

  // Activities — wider window if table is empty.
  try {
    const [{ count = 0 } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(garminActivities)
    const windowDays = count === 0 ? ACTIVITIES_INITIAL_BACKFILL_DAYS : BACKFILL_DAYS
    const actFrom = new Date(today)
    actFrom.setUTCDate(actFrom.getUTCDate() - windowDays)
    const records = await garminCollector.activities({
      from: ymd(actFrom),
      to: ymd(today),
    })
    activitiesSynced = await upsertActivities(records)
    activitiesMsg = `window=${windowDays}d records=${activitiesSynced}${count === 0 ? ' (initial)' : ''}`
  } catch (e) {
    errors += 1
    activitiesMsg = `error: ${(e as Error).message}`
    // eslint-disable-next-line no-console
    console.error('[garmin-sync] activities fetch failed:', e)
  }

  const message = `synced=${daysSynced} errors=${errors} activities[${activitiesMsg}]`
  // eslint-disable-next-line no-console
  console.log(`[garmin-sync] done: ${message}`)

  await db
    .update(syncControl)
    .set({
      in_progress: 0,
      last_completed_at: sql`datetime('now')`,
      last_status: errors === 0 ? 'ok' : 'error',
      last_message: message,
    })
    .where(eq(syncControl.id, 1))

  await pingHeartbeat(errors === 0 ? 'up' : 'down', message)
  inProgress = false
  return { errors, message, daysSynced, activitiesSynced }
}

export function registerGarminSyncCron(): void {
  if (!process.env.GARMIN_COLLECTOR_URL) {
    // eslint-disable-next-line no-console
    console.warn('[garmin-sync] GARMIN_COLLECTOR_URL not set — cron disabled')
    return
  }

  void ensureControlRow()

  // Scheduled sync every 6h.
  new Cron('0 */6 * * *', () => {
    void runGarminSync('scheduled')
  })

  // Manual refresh poller — picks up dashboard-triggered refresh within 60s.
  new Cron('* * * * *', async () => {
    const [row] = await db.select().from(syncControl).where(eq(syncControl.id, 1))
    if (row?.refresh_requested) {
      void runGarminSync('manual-refresh')
    }
  })

  // eslint-disable-next-line no-console
  console.log('[garmin-sync] cron registered (every 6h + 1m refresh poll)')
}
