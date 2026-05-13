/* eslint-disable no-console */
/**
 * One-shot smoke test for the Jira client (src/clients/jira.ts). Exercises
 * the same code path the Elysia routes use — verifies env wiring,
 * basic-auth, normalization, and the full set of public functions
 * against the live Atlassian Cloud API.
 *
 * Run from repo root:
 *   DATABASE_URL='postgresql://noop@localhost:5432/noop' \
 *     op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
 *     bun run --cwd apps/api scripts/jira-smoke.ts
 */
import {
  DEFAULT_BOARD_ID,
  getBacklog,
  getBoard,
  getCurrentSprint,
  getIssue,
  getMyself,
  getSprint,
  listMyOpenIssues,
  listSprints,
  searchByJql,
} from '../src/clients/jira.js'

async function section<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  console.log(`\n══ ${label}`)
  try {
    const r = await fn()
    return r
  } catch (e) {
    console.error(`  ERROR: ${(e as Error).message}`)
    return undefined
  }
}

function brief(...lines: string[]): void {
  for (const l of lines) console.log(`  ${l}`)
}

const me = await section('getMyself()', () => getMyself())
if (me) brief(`accountId=${me.accountId}`, `displayName=${me.displayName}`, `tz=${me.timeZone}`)

const board = await section(`getBoard(${DEFAULT_BOARD_ID})`, () => getBoard())
if (board)
  brief(
    `board=${board.id} ${board.name} (${board.type})`,
    `project=${board.projectKey} ${board.projectName}`,
  )

const activeSprints = await section("listSprints({ state: 'active' })", () =>
  listSprints({ state: 'active' }),
)
if (activeSprints)
  brief(
    ...activeSprints.map((s) => `sprint=${s.id} ${s.name} ${s.state} ${s.startDate}→${s.endDate}`),
  )

const myIssues = await section('listMyOpenIssues(5)', () => listMyOpenIssues(5))
if (myIssues) {
  brief(`isLast=${myIssues.isLast}`, `count=${myIssues.issues.length}`)
  for (const i of myIssues.issues)
    brief(`  ${i.key} [${i.statusCategory}/${i.status}] ${i.summary.slice(0, 80)}`)
}

const firstIssueKey = myIssues?.issues[0]?.key ?? 'EP-17849'
const oneIssue = await section(`getIssue("${firstIssueKey}")`, () => getIssue(firstIssueKey))
if (oneIssue)
  brief(
    `key=${oneIssue.key}`,
    `url=${oneIssue.url}`,
    `status=${oneIssue.status} (${oneIssue.statusCategory})`,
    `type=${oneIssue.issueType} subtask=${oneIssue.isSubtask}`,
    `priority=${oneIssue.priority}`,
    `assignee=${oneIssue.assignee?.name ?? 'unassigned'}`,
    `labels=[${oneIssue.labels.join(',')}]`,
    `parent=${oneIssue.parent?.key ?? 'none'}`,
  )

const cur = await section('getCurrentSprint({ onlyMine: true })', () =>
  getCurrentSprint(undefined, { onlyMine: true }),
)
if (cur) {
  brief(
    `board=${cur.board.name}`,
    `sprint=${cur.sprint?.name ?? 'none'}`,
    `issues=${cur.issues.length} (yours only)`,
  )
  for (const i of cur.issues) brief(`  ${i.key} [${i.statusCategory}] ${i.summary.slice(0, 70)}`)
}

const sprintId = cur?.sprint?.id ?? activeSprints?.[0]?.id
if (sprintId !== undefined) {
  const sp = await section(`getSprint(${sprintId})`, () => getSprint(sprintId))
  if (sp) brief(`sprint=${sp.sprint.name}`, `total-issues=${sp.issues.length} (all, not just mine)`)
}

const backlog = await section('getBacklog({ maxResults: 3 })', () => getBacklog({ maxResults: 3 }))
if (backlog) {
  brief(
    `total=${backlog.total}`,
    `startAt=${backlog.startAt}`,
    `isLast=${backlog.isLast}`,
    `page=${backlog.issues.length}`,
  )
  for (const i of backlog.issues)
    brief(`  ${i.key} [${i.statusCategory}/${i.status}] ${i.summary.slice(0, 70)}`)
}

const jqlResult = await section('searchByJql({ jql: project = EP AND updated >= -7d })', () =>
  searchByJql({ jql: 'project = EP AND updated >= -7d ORDER BY updated DESC', maxResults: 3 }),
)
if (jqlResult) {
  brief(
    `count=${jqlResult.issues.length}`,
    `isLast=${jqlResult.isLast}`,
    `nextPageToken=${jqlResult.nextPageToken ?? 'null'}`,
  )
  for (const i of jqlResult.issues) brief(`  ${i.key} ${i.updated} ${i.summary.slice(0, 65)}`)
}

console.log('\nDone.')
