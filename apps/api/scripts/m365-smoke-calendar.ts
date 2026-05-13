/* eslint-disable no-console */
/**
 * One-shot smoke test for listUpcomingCalendarEvents. Verifies the helper
 * end-to-end against the live MCP — does NOT touch the Elysia route layer
 * (that's covered by src/routes/m365.test.ts).
 *
 * Run from repo root with the real local DATABASE_URL:
 *   DATABASE_URL=... op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
 *     bun run --cwd apps/api scripts/m365-smoke-calendar.ts [days]
 */
import { listUpcomingCalendarEvents } from '../src/clients/m365.js'

async function main(): Promise<void> {
  const days = Number(process.argv[2] ?? 7)
  const events = await listUpcomingCalendarEvents(days)
  console.log(`Returned ${events.length} events in the next ${days} days.\n`)
  for (const e of events.slice(0, 5)) {
    console.log(`  • ${e.start}  →  ${e.end}`)
    console.log(`    ${e.title}`)
    if (e.location) console.log(`    @ ${e.location}`)
    if (e.organizer) console.log(`    by ${e.organizer.name || e.organizer.email}`)
    if (e.isOnlineMeeting) console.log(`    📞 ${e.videoLink ?? '(no joinUrl)'}`)
    console.log(`    attendees=${e.attendees.length}  allDay=${e.isAllDay}`)
    console.log()
  }
  if (events.length > 5) console.log(`  ... +${events.length - 5} more\n`)
  console.log('Shape spot-check (first event keys):')
  if (events[0]) console.log(`  ${Object.keys(events[0]).toSorted().join(', ')}`)
}

main().catch((e: unknown) => {
  console.error('SMOKE FAILED:', (e as Error).message)
  process.exit(1)
})
