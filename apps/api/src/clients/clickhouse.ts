import { tracedFetch } from '../lib/traced-fetch.js'
import { env } from '../env.js'

/**
 * The one door to ClickHouse: ClickStack's HTTP interface, read-only (`argo_ro`: SELECT on `default.*`,
 * `readonly=1`, 15 s and 1 GB per query; contract in vps docs/observability.md). Plain `fetch` instead of
 * `@clickhouse/client`: the whole read path is one POST, the user is read-only, and a client would add a
 * dependency whose connection pool, compression and settings plumbing this call never uses.
 *
 * A query is SQL with typed placeholders (`{from:UInt32}`) plus a params object: ClickHouse substitutes them
 * server-side (`param_<name>` URL parameters), so a value never becomes SQL text. The SQL itself is written
 * only in the `lib/*-queries.ts` modules (Line, Machines); nothing from a request reaches it as text. The credential travels in the
 * `Authorization` header, never in the URL, so it is on no span. A `readonly=1` user cannot send settings,
 * so there are none: the response format is the `FORMAT JSON` clause of the query.
 */

export type ClickHouseConfig = { url: string; user: string; password: string }

export type ChParams = Record<string, string | number>

/** Thrown for a non-2xx answer or a transport failure; the message never carries SQL or the credential. */
export class ClickHouseError extends Error {
  override name = 'ClickHouseError'
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

export type ClickHouse = {
  /** Whether a URL and password are configured; false means every query throws without a request. */
  readonly configured: boolean
  /** Runs one named query; `name` becomes the span name. The SQL must end in `FORMAT JSON`. */
  query<Row>(name: string, sql: string, params?: ChParams): Promise<Row[]>
}

const QUERY_TIMEOUT_MS = 20_000
const ERROR_SNIPPET = 160

export function createClickHouse(config: ClickHouseConfig): ClickHouse {
  const base = config.url.replace(/\/+$/, '')
  const configured = base !== '' && config.password !== ''
  const authorization = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`

  return {
    configured,
    async query<Row>(name: string, sql: string, params: ChParams = {}): Promise<Row[]> {
      if (!configured) throw new ClickHouseError('ClickHouse is not configured', null)
      const url = new URL(base)
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(`param_${key}`, String(value))

      let response: Response
      try {
        response = await tracedFetch(
          url,
          { method: 'POST', headers: { Authorization: authorization }, body: sql },
          {
            spanName: `clickhouse ${name}`,
            attributes: { 'db.system.name': 'clickhouse', 'db.operation.name': name },
            timeoutMs: QUERY_TIMEOUT_MS,
            sanitizeError: (error) =>
              new ClickHouseError(error instanceof Error ? error.name : 'transport failure', null),
          },
        )
      } catch (error) {
        throw new ClickHouseError(
          `ClickHouse unreachable (${error instanceof Error ? error.name : 'unknown'})`,
          null,
        )
      }

      if (!response.ok) {
        // ClickHouse errors are plain text and may quote the query: keep a short head for the log, no more.
        const head = (await response.text().catch(() => ''))
          .replace(/\s+/g, ' ')
          .slice(0, ERROR_SNIPPET)
        throw new ClickHouseError(
          `ClickHouse answered ${response.status}: ${head}`,
          response.status,
        )
      }
      const body = (await response.json()) as { data?: Row[] }
      return body.data ?? []
    },
  }
}

export const clickhouse = createClickHouse({
  url: env.CLICKHOUSE_URL,
  user: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
})
