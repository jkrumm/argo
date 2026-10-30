import { env } from '../env.js'
import { log } from '../telemetry.js'
import { registerGarminSyncCron } from './garmin-sync.js'
import { registerHardcoverSyncCron } from './hardcover-sync.js'
import { registerHardcoverReconcileCron } from './hardcover-reconcile.js'

export function registerCronJobs() {
  if (!env.CRONS_ENABLED) {
    log.info('crons disabled (CRONS_ENABLED=false)')
    return
  }
  registerGarminSyncCron()
  registerHardcoverSyncCron()
  registerHardcoverReconcileCron()
}
