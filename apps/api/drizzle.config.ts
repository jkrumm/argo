import { defineConfig } from 'drizzle-kit'

// Strip ?schema= / ?search_path= — postgres.js forwards unknown URL params to
// the server as GUCs, which Postgres rejects ("unrecognized configuration
// parameter"). Schema qualification is handled by pgSchema() + migrations.schema
// below. Mirrors the same strip in src/db/index.ts.
const url = (process.env['DATABASE_URL'] ?? '')
  .replace(/[?&](?:schema|search_path)=[^&]*/g, '')
  .replace(/[?&]$/, '')

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
  // Keep the applied-migration journal in argo's own schema instead of the
  // default shared `drizzle` schema — argo owns this schema, so the journal is
  // self-contained, survives db:sync, and never collides with other apps.
  migrations: { schema: 'argo' },
})
