// Run the one-time journal relocation before `drizzle-kit migrate` so the CLI
// path (`bun db:migrate`) matches the API-boot path. Without this, running
// `bun db:migrate` on a DB whose journal is still in the legacy `drizzle`
// schema would make drizzle-kit re-apply every migration. See
// relocateDrizzleJournal() in src/db/index.ts for the full rationale.
//
// Invoked by scripts/db-migrate.sh with DATABASE_URL already assembled.
import { client, relocateDrizzleJournal } from '../src/db/index.js'

await relocateDrizzleJournal(client)
await client.end()
