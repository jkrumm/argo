/* eslint-disable no-console */
/**
 * Regenerates `src/generated/garmin` from the vendored official spec
 * (`specs/garmin-personal-api.openapi.json`). Run from `apps/api`:
 *
 *   bun run gen:garmin
 *
 * Same recipe as `src/generated/ticktick` (@hey-api/openapi-ts, bundled fetch client, oxfmt
 * formatting, `// @ts-nocheck` on the client/core internals that do not satisfy this repo's
 * strict tsconfig). The generator version is pinned in package.json — bumping it is a
 * deliberate, reviewed diff of the generated tree.
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const out = join(root, 'src/generated/garmin')
const NOCHECK = [
  'client/client.gen.ts',
  'client/utils.gen.ts',
  'core/params.gen.ts',
  'core/pathSerializer.gen.ts',
  'core/serverSentEvents.gen.ts',
]

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit' })
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(' ')} failed`)
}

await rm(out, { recursive: true, force: true })
await run([
  './node_modules/.bin/openapi-ts',
  '-i',
  './specs/garmin-personal-api.openapi.json',
  '-o',
  './src/generated/garmin',
  '-c',
  '@hey-api/client-fetch',
])
await run(['../../node_modules/.bin/oxfmt', 'src/generated/garmin'])

for (const file of NOCHECK) {
  const path = join(out, file)
  await Bun.write(path, `// @ts-nocheck\n${await Bun.file(path).text()}`)
}
console.log('[gen:garmin] done')
