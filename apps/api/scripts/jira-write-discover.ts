/* eslint-disable no-console */
/**
 * Discovery for the Jira *write* surface. Probes the metadata we need before
 * implementing create/update endpoints:
 *   - Project key + name (resolved from board 272)
 *   - All custom field IDs (Sprint, Epic Link, Story Points, Team)
 *   - Available issue types on the project (with their required fields)
 *   - Sample of recent Prometheus tickets to learn title conventions
 *   - Transitions available on a sample ticket
 *
 * Run:
 *   op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
 *     bun run --cwd apps/api scripts/jira-write-discover.ts
 */

const email = process.env.JIRA_EMAIL
const token = process.env.JIRA_API_TOKEN
const baseUrl = (process.env.ATLASSIAN_BASE_URL ?? '').replace(/\/+$/, '')
const boardId = Number(process.env.JIRA_BOARD_ID ?? process.env.BOARD_ID ?? '272')

if (!email || !token || !baseUrl) {
  console.error('Missing env: JIRA_EMAIL / JIRA_API_TOKEN / ATLASSIAN_BASE_URL')
  process.exit(1)
}

const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')

async function jira<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${path}\n${text.slice(0, 600)}`)
  return JSON.parse(text) as T
}

async function section(label: string, fn: () => Promise<unknown>): Promise<unknown> {
  console.log(`\n══ ${label}`)
  try {
    const r = await fn()
    const dump = JSON.stringify(r, null, 2)
    console.log(dump.length > 8000 ? dump.slice(0, 8000) + '\n  ...[truncated]' : dump)
    return r
  } catch (e) {
    console.error(`  ERROR: ${(e as Error).message}`)
    return undefined
  }
}

interface Board {
  id: number
  name: string
  location?: { projectKey?: string; projectName?: string }
}
interface Field {
  id: string
  key?: string
  name: string
  custom?: boolean
  schema?: { type?: string; custom?: string; system?: string }
}
interface CreateMetaIssueType {
  id: string
  name: string
  description?: string
  subtask?: boolean
  fields?: Record<string, unknown>
}
async function main(): Promise<void> {
  console.log(`Jira WRITE discovery — base=${baseUrl}, board=${boardId}, as=${email}`)

  // 1. Project from board
  const board = (await section(`board/${boardId}`, () =>
    jira<Board>(`/rest/agile/1.0/board/${boardId}`),
  )) as Board | undefined
  const projectKey = board?.location?.projectKey
  console.log(`\n>> Resolved project key: ${projectKey}`)

  if (!projectKey) {
    console.error('Cannot continue without project key')
    process.exit(1)
  }

  // 2. All fields — find custom-field IDs by name
  const fields = (await section(
    'GET /rest/api/3/field (custom + Prometheus-relevant)',
    async () => {
      const all = await jira<Field[]>('/rest/api/3/field')
      return all
        .filter((f) => f.custom || /sprint|epic|story.?point|team/i.test(f.name))
        .map((f) => ({
          id: f.id,
          name: f.name,
          custom: f.custom,
          type: f.schema?.type,
          customType: f.schema?.custom,
        }))
    },
  )) as Array<{ id: string; name: string; custom?: boolean; type?: string; customType?: string }>

  console.log('\n>> Key custom-field IDs:')
  for (const f of fields ?? []) {
    if (/sprint|epic|story.?point|team|^parent$/i.test(f.name)) {
      console.log(
        `   ${f.id.padEnd(20)} ${f.name.padEnd(30)} (type=${f.type}, custom=${f.customType ?? '-'})`,
      )
    }
  }

  // 3. Project create-meta — issue types and required fields
  await section(`createmeta for ${projectKey} (issue types + required fields)`, async () => {
    // New API (post-2024): /createmeta/{projectIdOrKey}/issuetypes
    const types = await jira<{ issueTypes?: CreateMetaIssueType[] }>(
      `/rest/api/3/issue/createmeta/${projectKey}/issuetypes`,
    )
    return (types.issueTypes ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      subtask: t.subtask,
      description: t.description?.slice(0, 100),
    }))
  })

  // 4. Required fields for the "Story" issue type specifically
  await section(`createmeta fields for ${projectKey} → "Story" (full schema)`, async () => {
    // Find issue type id for Story
    const types = await jira<{ issueTypes?: CreateMetaIssueType[] }>(
      `/rest/api/3/issue/createmeta/${projectKey}/issuetypes`,
    )
    const story = types.issueTypes?.find((t) => /story/i.test(t.name))
    if (!story) return { error: 'no Story type' }
    const fieldsResp = await jira<{
      fields?: Array<{
        fieldId: string
        name: string
        required: boolean
        schema?: unknown
        allowedValues?: unknown
      }>
    }>(`/rest/api/3/issue/createmeta/${projectKey}/issuetypes/${story.id}`)
    return {
      issueType: story.name,
      fields: (fieldsResp.fields ?? []).map((f) => ({
        id: f.fieldId,
        name: f.name,
        required: f.required,
        schema: f.schema,
      })),
    }
  })

  // 5. Recent Prometheus tickets — learn title conventions
  await section('Recent tickets in active sprint (titles only)', async () => {
    const sprints = await jira<{ values?: Array<{ id: number; name: string }> }>(
      `/rest/agile/1.0/board/${boardId}/sprint?state=active`,
    )
    const sid = sprints.values?.[0]?.id
    if (!sid) return { error: 'no active sprint' }
    const issues = await jira<{
      issues?: Array<{
        key: string
        fields: { summary: string; issuetype?: { name: string }; labels?: string[] }
      }>
    }>(`/rest/agile/1.0/sprint/${sid}/issue?fields=summary,issuetype,labels&maxResults=40`)
    return (issues.issues ?? []).map((i) => ({
      key: i.key,
      type: i.fields.issuetype?.name,
      summary: i.fields.summary,
      labels: i.fields.labels,
    }))
  })

  // 6. Transitions on a sample issue
  await section('Transitions on a sample EP-* issue', async () => {
    const issues = await jira<{ issues?: Array<{ key: string }> }>(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(`project = ${projectKey} AND statusCategory != Done ORDER BY updated DESC`)}&fields=summary&maxResults=1`,
    )
    const sampleKey = issues.issues?.[0]?.key
    if (!sampleKey) return { error: 'no sample issue' }
    const trans = await jira<{
      transitions?: Array<{ id: string; name: string; to?: { name: string } }>
    }>(`/rest/api/3/issue/${sampleKey}/transitions`)
    return {
      sample: sampleKey,
      transitions: trans.transitions,
    }
  })

  // 7. Priorities and Labels available in project
  await section('Priorities available', () => jira(`/rest/api/3/priority`))

  console.log('\nDone. Use the field IDs above when building the create/update payloads.')
}

main().catch((e: unknown) => {
  console.error('DISCOVERY FAILED:', (e as Error).message)
  process.exit(1)
})
