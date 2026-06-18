import { registerGarminSyncCron } from './garmin-sync.js'
import { registerHardcoverSyncCron } from './hardcover-sync.js'

export function registerCronJobs() {
  registerGarminSyncCron()
  registerHardcoverSyncCron()
}
