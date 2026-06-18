import { registerGarminSyncCron } from './garmin-sync.js'
import { registerHardcoverSyncCron } from './hardcover-sync.js'
import { registerHardcoverReconcileCron } from './hardcover-reconcile.js'

export function registerCronJobs() {
  registerGarminSyncCron()
  registerHardcoverSyncCron()
  registerHardcoverReconcileCron()
}
