/* eslint-disable no-console */
/**
 * One-shot Atlassian (Jira) discovery POC.
 *
 * Validates that we can hit the Atlassian Cloud REST API with HTTP Basic
 * (email + API token) and pull the data argo will eventually expose as
 * read-only REST routes for Hermes:
 *   - authenticated user (sanity + accountId)
 *   - the team board (EP/272)
 *   - the active sprint on that board
 *   - the user's open issues across all projects
 *   - the user's open issues in the active sprint
 *   - the board backlog (top of the queue)
 *
 * No DB, no Elysia, no token persistence — env vars only. Token MUST come
 * from the shell, never committed.
 *
 * Run from repo root:
 *   JIRA_EMAIL='johannes.krumm@iu.org' \
 *   JIRA_API_TOKEN='...' \
 *   ATLASSIAN_BASE_URL='https://careerpartner.atlassian.net' \
 *   BOARD_ID=272 \
 *     bun run --cwd apps/api scripts/jira-discover.ts
 */

const email = process.env.JIRA_EMAIL
const token = process.env.JIRA_API_TOKEN
const baseUrl = (process.env.ATLASSIAN_BASE_URL ?? '').replace(/\/+$/, '')
const boardId = Number(process.env.BOARD_ID ?? '272')

if (!email || !token || !baseUrl) {
  console.error('Missing env: JIRA_EMAIL / JIRA_API_TOKEN / ATLASSIAN_BASE_URL')
  process.exit(1)
}

const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')

async function jira<T>(path: string): Promise<T> {
  const url = `${baseUrl}${path}`
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${res.status} ${path}\n${text.slice(0, 400)}`)
  }
  return JSON.parse(text) as T
}

async function section(label: string, fn: () => Promise<unknown>): Promise<unknown> {
  console.log(`\n══ ${label}`)
  try {
    const r = await fn()
    const dump = JSON.stringify(r, null, 2)
    console.log(dump.length > 6000 ? dump.slice(0, 6000) + '\n  ...[truncated]' : dump)
    return r
  } catch (e) {
    console.error(`  ERROR: ${(e as Error).message}`)
    return undefined
  }
}

interface Myself {
  accountId: string
  emailAddress: string
  displayName: string
  timeZone: string
}
interface Sprint {
  id: number
  name: string
  state: string
  startDate?: string
  endDate?: string
  goal?: string
}
interface SprintList {
  values: Sprint[]
}
interface Issue {
  key: string
  fields: {
    summary: string
    status: { name: string; statusCategory: { name: string } }
    priority?: { name: string }
    duedate?: string | null
    issuetype?: { name: string }
  }
}
interface IssueSearch {
  issues?: Issue[]
  total?: number
  isLast?: boolean
}

async function main(): Promise<void> {
  console.log(`Atlassian discovery — base=${baseUrl}, board=${boardId}, as=${email}`)

  const me = (await section('GET /rest/api/3/myself', () => jira<Myself>('/rest/api/3/myself'))) as
    | Myself
    | undefined

  await section(`GET /rest/agile/1.0/board/${boardId}`, () =>
    jira(`/rest/agile/1.0/board/${boardId}`),
  )

  const sprints = (await section(`GET /rest/agile/1.0/board/${boardId}/sprint?state=active`, () =>
    jira<SprintList>(`/rest/agile/1.0/board/${boardId}/sprint?state=active`),
  )) as SprintList | undefined

  const activeSprintId = sprints?.values?.[0]?.id

  // New paginated search endpoint (replaced /search in 2025).
  const myOpenJql = encodeURIComponent('assignee = currentUser() AND statusCategory != Done')
  const fields = 'summary,status,priority,duedate,issuetype,project'
  await section(`GET /rest/api/3/search/jql?jql=<my-open>&fields=${fields}&maxResults=25`, () =>
    jira<IssueSearch>(`/rest/api/3/search/jql?jql=${myOpenJql}&fields=${fields}&maxResults=25`),
  )

  if (activeSprintId !== undefined) {
    await section(`GET /rest/agile/1.0/sprint/${activeSprintId}/issue (mine, top 25)`, () =>
      jira<IssueSearch>(
        `/rest/agile/1.0/sprint/${activeSprintId}/issue?jql=${myOpenJql}&fields=${fields}&maxResults=25`,
      ),
    )
  } else {
    console.log('\n(no active sprint → skipping per-sprint issue fetch)')
  }

  await section(`GET /rest/agile/1.0/board/${boardId}/backlog (first 10)`, () =>
    jira<IssueSearch>(`/rest/agile/1.0/board/${boardId}/backlog?fields=${fields}&maxResults=10`),
  )

  console.log(`\nDone. (resolved accountId=${me?.accountId ?? 'unknown'})`)
}

main().catch((e: unknown) => {
  console.error('DISCOVERY FAILED:', (e as Error).message)
  process.exit(1)
})
