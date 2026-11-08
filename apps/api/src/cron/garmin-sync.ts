import { Cron } from 'croner'
import { count, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { dailyMetrics, garminActivities, syncControl } from '../db/schema.js'
import { garmin, type ActivityRecord, type DailyMetric } from '../clients/garmin.js'
import { env } from '../env.js'
import { log } from '../telemetry.js'
import { cronOptions, fireTick } from './traced-tick.js'

const BACKFILL_DAYS = env.GARMIN_BACKFILL_DAYS
const ACTIVITIES_INITIAL_BACKFILL_DAYS = env.GARMIN_ACTIVITIES_INITIAL_BACKFILL_DAYS
const HEARTBEAT_URL = env.GARMIN_HEARTBEAT_URL

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
    // Plain fetch on purpose: the push URL carries the secret token, and tracedFetch records the full URL on its span.
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
  const [existing] = await db.select().from(dailyMetrics).where(eq(dailyMetrics.date, metric.date))

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

type SyncGuardDeps = {
  begin: () => Promise<void>
  finish: (result: GarminSyncResult) => Promise<void>
}

/**
 * Single-flight guard around one sync run. The in-memory flag and the DB `in_progress`
 * flag are always reset (`finish` runs in `finally`), even when `begin` or `fn` throws.
 */
export function createSyncGuard(deps: SyncGuardDeps) {
  let inProgress = false
  return async (fn: () => Promise<GarminSyncResult>): Promise<GarminSyncResult> => {
    if (inProgress) {
      return { errors: 0, message: 'already in progress', daysSynced: 0, activitiesSynced: 0 }
    }
    inProgress = true
    let result: GarminSyncResult = {
      errors: 1,
      message: 'failed before completion',
      daysSynced: 0,
      activitiesSynced: 0,
    }
    try {
      await deps.begin()
      result = await fn()
      return result
    } catch (e) {
      result = { ...result, message: `failed: ${(e as Error).message}` }
      throw e
    } finally {
      try {
        await deps.finish(result)
      } catch (e) {
        log.error('[garmin-sync] closing sync_control update failed', e)
      }
      inProgress = false
    }
  }
}

const guardedSync = createSyncGuard({
  begin: async () => {
    await db
      .update(syncControl)
      .set({ in_progress: 1, last_started_at: isoNow(), refresh_requested: 0 })
      .where(eq(syncControl.id, 1))
  },
  finish: async (result) => {
    await db
      .update(syncControl)
      .set({
        in_progress: 0,
        last_completed_at: isoNow(),
        last_status: result.errors === 0 ? 'ok' : 'error',
        last_message: result.message,
      })
      .where(eq(syncControl.id, 1))
    await pingHeartbeat(result.errors === 0 ? 'up' : 'down', result.message)
  },
})

/** A killed process leaves `in_progress=1` behind; nothing runs at boot, so clear it. */
async function resetStaleInProgress(): Promise<void> {
  await db.update(syncControl).set({ in_progress: 0 }).where(eq(syncControl.id, 1))
}

export function runGarminSync(reason: string): Promise<GarminSyncResult> {
  return guardedSync(() => syncOnce(reason))
}

async function syncOnce(reason: string): Promise<GarminSyncResult> {
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
    const metrics = await garmin.dailyMetrics({
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
    const [{ total = 0 } = { total: 0 }] = await db
      .select({ total: count() })
      .from(garminActivities)
    const windowDays = total === 0 ? ACTIVITIES_INITIAL_BACKFILL_DAYS : BACKFILL_DAYS
    const actFrom = new Date(today)
    actFrom.setUTCDate(actFrom.getUTCDate() - windowDays)
    const records = await garmin.activities({
      from: ymd(actFrom),
      to: ymd(today),
    })
    activitiesSynced = await upsertActivities(records)
    activitiesMsg = `window=${windowDays}d records=${activitiesSynced}${total === 0 ? ' (initial)' : ''}`
  } catch (e) {
    errors += 1
    activitiesMsg = `error: ${(e as Error).message}`
    // eslint-disable-next-line no-console
    console.error('[garmin-sync] activities fetch failed:', e)
  }

  const message = `synced=${daysSynced} errors=${errors} activities[${activitiesMsg}]`
  // eslint-disable-next-line no-console
  console.log(`[garmin-sync] done: ${message}`)

  return { errors, message, daysSynced, activitiesSynced }
}

export function registerGarminSyncCron(): void {
  if (!env.GARMIN_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[garmin-sync] GARMIN_API_KEY not set — cron disabled')
    return
  }

  ensureControlRow()
    .then(resetStaleInProgress)
    .catch((e) => log.error('[garmin-sync] control row init failed', e))

  // Scheduled sync every 6h. Each tick is a fresh root trace via ROOT_CONTEXT —
  // without detachment, croner's timer-based scheduling could chain ticks together.
  new Cron('0 */6 * * *', cronOptions('garmin-sync'), () => {
    fireTick('cron.garmin-sync.scheduled', { 'cron.schedule': '0 */6 * * *' }, () =>
      runGarminSync('scheduled'),
    )
  })

  // Manual refresh poller — picks up dashboard-triggered refresh within 60s.
  // Only emit a span when work actually runs; the no-op DB check would be noise.
  new Cron('* * * * *', cronOptions('garmin-sync-poll'), async () => {
    const [row] = await db
      .select()
      .from(syncControl)
      .where(eq(syncControl.id, 1))
      .catch((e) => {
        log.error('[garmin-sync] refresh poll read failed', e)
        return []
      })
    if (row?.refresh_requested) {
      fireTick('cron.garmin-sync.manual-refresh', { 'cron.schedule': '* * * * *' }, () =>
        runGarminSync('manual-refresh'),
      )
    }
  })

  // eslint-disable-next-line no-console
  console.log('[garmin-sync] cron registered (every 6h + 1m refresh poll)')
}
