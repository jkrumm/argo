import { trace, SpanStatusCode } from '@opentelemetry/api'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { opentelemetry } from '@elysiajs/opentelemetry'
import { openapi } from '@elysiajs/openapi'
import { cors } from '@elysiajs/cors'
import { telemetryConfig } from './telemetry.js'
import { healthRoute } from './routes/health.js'
import { ticktickRoutes } from './routes/ticktick.js'
import { uptimeKumaRoutes } from './routes/uptime-kuma.js'
import { dockerHomelabRoutes, dockerVpsRoutes } from './routes/docker.js'
import { summaryRoute } from './routes/summary.js'
import { oauthRoutes } from './routes/oauth.js'
import { gmailRoutes } from './routes/gmail.js'
import { calendarRoutes } from './routes/calendar.js'
import { m365Routes } from './routes/m365.js'
import { jiraRoutes } from './routes/jira.js'
import { confluenceRoutes } from './routes/confluence.js'
import { gitlabRoutes } from './routes/gitlab.js'
import { weatherRoutes } from './routes/weather.js'
import { astroRoutes } from './routes/astro.js'
import { marineRoutes } from './routes/marine.js'
import { queryRoute } from './routes/query.js'
import { workoutRoutes } from './routes/workouts.js'
import { workoutSetRoutes } from './routes/workout-sets.js'
import { strengthRoutes } from './routes/strength.js'
import { exerciseRoutes } from './routes/exercises.js'
import { dailyMetricsRoutes } from './routes/daily-metrics.js'
import { recoveryRoutes } from './routes/recovery.js'
import { trainingLoadRoutes } from './routes/training-load.js'
import { fitnessDirectionRoutes } from './routes/fitness-direction.js'
import { activitiesRoutes } from './routes/activities.js'
import { weightLogRoutes } from './routes/weight-log.js'
import { skinfoldLogRoutes } from './routes/skinfold-log.js'
import { walkingPadRoutes } from './routes/walking-pad.js'
import { usageRoutes } from './routes/usage.js'
import { readingRoutes } from './routes/reading.js'
import { userProfileRoutes } from './routes/user-profile.js'
import { gymRoutes } from './routes/gym.js'
import { workoutDraftRoutes } from './routes/workout-draft.js'
import { financeRoutes } from './routes/finance.js'
import { modelsRoutes } from './routes/models.js'
import { authGuard } from './lib/auth-guard.js'
import { shouldTraceRequest } from './lib/trace-filter.js'

/**
 * Builds the fully composed Elysia app — every plugin, the discovery route,
 * and all 34 domain routes, in the exact order production runs them. Does
 * NOT listen and has no other side effects, so it's safe to import and call
 * `.handle()` against in a test without migrating a database or opening a
 * port. `index.ts` is the entrypoint: it builds once (`export const app`
 * below), then runs migrations, listens, and wires cron/uptime/signal
 * handling around it.
 */
export function buildApp() {
  return (
    new Elysia()
      .use(
        opentelemetry({
          ...telemetryConfig,
          checkIfShouldTrace: shouldTraceRequest,
        }),
      )
      .onError(({ error }) => {
        const span = trace.getActiveSpan()
        if (span) {
          span.recordException(error as Error)
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        }
      })
      .use(
        cors({
          origin: ['https://argo.jkrumm.com', 'https://argo.test', 'http://localhost:7715'],
          // W3C trace context headers must be allowed so distributed tracing
          // survives the browser→API hop (HyperDX injects traceparent on fetch).
          allowedHeaders: ['Authorization', 'Content-Type', 'traceparent', 'tracestate', 'baggage'],
          exposeHeaders: ['x-total-count'],
        }),
      )
      .use(
        openapi({
          mapJsonSchema: { zod: z.toJSONSchema },
          documentation: {
            info: {
              title: 'Argo API',
              version: '1.0.0',
              description:
                'Personal stack API for Johannes Krumm. Powers the Argo dashboard (Garmin Health + Strength Tracker pages) and is consumed as an AI-agent endpoint by Hermes Agent and external tools. Start at `GET /` for discovery. All routes except `/`, `/health`, and `/oauth/*` require `Authorization: Bearer <API_SECRET>`. Served under the `/api` prefix on `argo.jkrumm.com`.',
            },
            servers: [
              { url: 'https://argo.jkrumm.com/api', description: 'Argo (Mac mini, tailnet only)' },
            ],
            components: {
              securitySchemes: {
                BearerAuth: { type: 'http', scheme: 'bearer' },
              },
            },
            tags: [
              {
                name: 'Garmin Health',
                description:
                  'Daily Garmin metrics (HRV, sleep, stress, resting HR), recovery score, training load (ACWR), fitness direction, activity sessions, body-weight log, manual skinfold-caliper measurements, and user profile. Powers the Garmin Health dashboard page.',
              },
              {
                name: 'Strength',
                description:
                  'Strength training: workouts and sets CRUD, exercise catalog, and analytics under /workouts/summary/* (e1RM, volume, ACWR, PRs, readiness, alignment, deload signal). Powers the Strength Tracker dashboard page.',
              },
              {
                name: 'Productivity',
                description:
                  'Personal comms and task management: TickTick projects/tasks, Gmail inbox, Google Calendar events.',
              },
              {
                name: 'M365',
                description:
                  'IU Microsoft 365 surface — proxied through the IU MCP server (Microsoft Graph wrapper covering Outlook calendar, mail, Teams chats/channels). The MCP server exposes ~270 Graph operations behind 3 meta-tools (search-tools, get-tool-schema, execute-tool); curated read-only REST endpoints will be added incrementally as use cases land. Tokens are installed via the laptop bootstrap script (`bun m365:auth*`) which POSTs to /m365/seed — see apps/api/AGENTS.md.',
              },
              {
                name: 'Atlassian',
                description:
                  'IU Atlassian Cloud (careerpartner tenant), read-only. **Jira** — work board ("EPOS Team Prometheus", board 272 in project EP): list assigned issues, fetch a single ticket, current/past/future sprints, backlog, arbitrary JQL. **Confluence** — list spaces, CQL search across all content, fetch a page (rendered HTML / storage XHTML / ADF), list children, recently-updated feed. Both share a single Atlassian API token; HTTP Basic auth via Cloud REST APIs (Jira v3 + Agile v1, Confluence v2 + v1 search). Confluence is read-only; Jira also writes: create an issue (POST /jira/issues), edit one (PATCH /jira/issues/{key}) and add a comment (POST /jira/issues/{key}/comments).',
              },
              {
                name: 'GitLab',
                description:
                  "IU GitLab on gitlab.com (`iu-group/*`), read-only. PAT-auth (scopes `read_api` + `read_user`). Cross-project merge requests (created/assigned/reviewer scopes), per-MR threaded discussions and approval state, per-project commits and releases, and the authenticated user's cross-project push-event feed via /events. Pair `gitlab.username` from /m365/team to walk from a teammate name to their open MRs.",
              },
              {
                name: 'WalkingPad',
                description:
                  'KingSmith under-desk treadmill sessions. The local Go daemon `king-smith-walkingpad-mac` records per-second samples in its own SQLite, then POSTs each closed session to /walking-pad/sessions (idempotent on `uuid`). Argo only stores closed-session totals — per-second samples stay on the daemon. Use /walking-pad/sessions to list raw rows and /walking-pad/sessions/summary for windowed totals (steps, distance, duration, kcal).',
              },
              {
                name: 'Usage Tracking',
                description:
                  'Local AI token/cost telemetry. Read-only here: usage-tracker and agw write the shared `usage` schema directly, Argo has no ingest endpoint.',
              },
              {
                name: 'Infrastructure',
                description:
                  'Self-hosted ops: UptimeKuma monitors + status, Docker container state on HomeLab (and VPS when `DOCKER_VPS_URL` is set; unset it answers an error) (containers, stats, logs, summary).',
              },
              {
                name: 'External Data',
                description: 'Third-party read-only data feeds: weather via Open-Meteo (geocoded).',
              },
              {
                name: 'Astro & Marine',
                description:
                  'Go/no-go planning for night photography and for surf, for a given place and the next N nights or days. `/astro/window` scores each night deterministically — galactic-core altitude, astronomical darkness and moon are computed from an ephemeris, never from a model — and returns a verdict plus the named reasons a night is out. `/astro/sites` lists the candidate drive-to sites with their measured sky and terrain — zenith brightness, the brightness where the core actually sits, and the southern terrain horizon. `/astro/light-pollution` and `/astro/skyglow` add the measured half from the Lorenz light-pollution atlas: zenith brightness for a coordinate, and the direction-resolved skyglow rose plus the sky brightness where the galactic core actually sits. `/astro/tiles/lp/{year}/{z}/{x}/{y}.png` serves the same atlas as a terrarium-encoded raster tile for the dashboard map. `/marine/window` and `/marine/spots` are the surf half over the same engine, scoring the longest usable daylight session per day from swell, period and wind. Weather comes from Open-Meteo DWD-ICON (cloud by layer), Open-Meteo Marine and 7Timer (atmospheric transparency); attribution is required and returned in the payload. Ask this instead of a raw weather forecast whenever the question is "is tonight (or this week) worth going out for".',
              },
              {
                name: 'Reading',
                description:
                  'Book reading vertical. Synced daily from Hardcover.app (shelf + book metadata). Generic reading-stat telemetry ingested from a homelab reading-stats job. Phase A: read-only shelf + stats ingest. `/reading` returns the full shelf with a summary; `POST /reading/stats` accepts batch telemetry. Phase C adds status/date write-back to Hardcover: `GET /reading/unmatched` + `POST /reading/match` (confirm a matched book), `POST /reading/reconcile` (run match-scan + write-back), `POST /reading/want-to-read`.',
              },
              {
                name: 'Finance',
                description:
                  "Johannes's encrypted finance vault (bank transactions, categories, recurring costs, net worth, tax tags), relayed to the loopback `fin serve` service on the mini. The vault is LOCKED by default and only a human can unlock it (the key never passes through an agent): every data call answers 423 while locked, so read `GET /finance/status` first and, if locked, tell the user to unlock it in the Argo dashboard under /finance — never ask for or handle the key. Unlocked, `GET /finance/api/*` serves read-only views (amounts in integer cents, months YYYY-MM), `POST /finance/sync` starts a bank sync, `POST /finance/lock` closes the vault. The vault re-locks itself after 30 idle minutes. Status codes and bodies are the service's own: 423 locked, 401 wrong key, 429 unlock throttled, 409 sync already running, 503 service down.",
              },
              {
                name: 'Models',
                description:
                  'Which model to use for what: Artificial Analysis intelligence, cost per task and speed per model and reasoning effort, joined with the agent-workflows route table and IU access, relayed from the loopback modelpick server on the mini. `GET /models/efficiency` is the one read; tokens and time per task in it are estimates. 503 when modelpick is down.',
              },
              {
                name: 'System',
                description:
                  'Discovery, health, observability, and auth plumbing: `/` (API discovery), `/health` (liveness), `/summary` (aggregated infra snapshot), `/query` (read-only SQL), `/oauth/google/*` (Google auth dance for Gmail + Calendar). M365 tokens are installed via the laptop bootstrap script — see POST /m365/seed.',
              },
            ],
          },
        }),
      )
      .get(
        '/',
        () => ({
          name: 'Argo API',
          version: '1.0.0',
          description:
            'Personal stack API for Johannes Krumm. Health/training domains (Garmin Health, Strength, WalkingPad) plus integration groups (Productivity, M365, Atlassian, GitLab, Infrastructure, External Data, System). See docs for the full surface.',
          docs: {
            scalar: '/openapi',
            json: '/openapi/json',
          },
          auth: {
            scheme: 'Bearer',
            header: 'Authorization: Bearer <API_SECRET>',
            public: [
              'GET /',
              'GET /health',
              'GET /oauth/google/init',
              'GET /oauth/google/callback',
            ],
          },
          tags: [
            'Garmin Health',
            'Strength',
            'Productivity',
            'M365',
            'Atlassian',
            'GitLab',
            'WalkingPad',
            'Usage Tracking',
            'Infrastructure',
            'External Data',
            'Astro & Marine',
            'Reading',
            'Finance',
            'Models',
            'System',
          ],
        }),
        {
          response: z.object({
            name: z.string(),
            version: z.string(),
            description: z.string(),
            docs: z.object({
              scalar: z.string().describe('Interactive OpenAPI UI'),
              json: z.string().describe('Raw OpenAPI 3.0 JSON spec'),
            }),
            auth: z.object({
              scheme: z.string(),
              header: z.string(),
              public: z.array(z.string()).describe('Paths that do not require Bearer auth'),
            }),
            tags: z.array(z.string()).describe('Top-level tag taxonomy used in the OpenAPI spec'),
          }),
          detail: {
            tags: ['System'],
            summary: 'API discovery — start here',
            description:
              'Public root endpoint. Returns the API name, version, where to find the OpenAPI spec (Scalar UI + raw JSON), auth scheme, and the list of OpenAPI tag groups. AI agents should call this first to bootstrap, then read /openapi/json for the full surface.',
          },
        },
      )
      .use(healthRoute)
      .use(oauthRoutes)
      // Everything below this line is auth-gated by authGuard. This ordering
      // is load-bearing — moving a route above this .use() would expose it
      // without Bearer auth — and is asserted by a test that imports
      // buildApp() and checks a domain route 401s without a token. Do not
      // reorder casually.
      .use(authGuard)
      .use(ticktickRoutes)
      .use(uptimeKumaRoutes)
      .use(dockerHomelabRoutes)
      .use(dockerVpsRoutes)
      .use(gmailRoutes)
      .use(calendarRoutes)
      .use(m365Routes)
      .use(jiraRoutes)
      .use(confluenceRoutes)
      .use(gitlabRoutes)
      .use(weatherRoutes)
      .use(astroRoutes)
      .use(marineRoutes)
      .use(summaryRoute)
      .use(queryRoute)
      .use(exerciseRoutes)
      .use(workoutRoutes)
      .use(strengthRoutes)
      .use(workoutSetRoutes)
      .use(dailyMetricsRoutes)
      .use(recoveryRoutes)
      .use(trainingLoadRoutes)
      .use(fitnessDirectionRoutes)
      .use(activitiesRoutes)
      .use(weightLogRoutes)
      .use(skinfoldLogRoutes)
      .use(userProfileRoutes)
      .use(gymRoutes)
      .use(workoutDraftRoutes)
      .use(walkingPadRoutes)
      .use(usageRoutes)
      .use(readingRoutes)
      .use(financeRoutes)
      .use(modelsRoutes)
  )
}

export const app = buildApp()

export type App = typeof app
