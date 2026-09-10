import { Elysia } from 'elysia'
import { z } from 'zod'

// The commit this image was built from, injected as a build-arg by
// .github/workflows/deploy.yml and baked into the image by apps/api/Dockerfile.
// Read once at module load: it cannot change while the process is alive, and a
// per-request env lookup would only make that look otherwise.
const COMMIT = process.env['GIT_SHA'] ?? 'unknown'

export const healthRoute = new Elysia().get(
  '/health',
  () => ({ status: 'ok' as const, commit: COMMIT }),
  {
    response: z.object({ status: z.literal('ok'), commit: z.string() }),
    detail: {
      tags: ['System'],
      summary: 'Liveness probe',
      description:
        'Returns `{ status: "ok", commit }` if the API process is up, where `commit` is the git SHA this image was built from ("unknown" outside CI). No auth required. Used by the Docker healthcheck, external uptime monitors, and as a deploy-landed probe — comparing `commit` against a merge SHA proves THIS change is serving, not merely that the container is running. Does not touch the database.',
    },
  },
)
