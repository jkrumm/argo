import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { app } from '../app.js'
import { env } from '../env.js'
import { authGuard } from '../lib/auth-guard.js'
import { createPaper } from '../lib/paper.js'
import { createPaperRoutes } from './paper.js'

// DB-free: the routes run a fake `hc` (src/test/fake-hc.ts) around a fake `paper` (src/test/fake-paper.ts),
// both real child processes, so the argv, the exit codes, the timeout and the base64 envelope are the
// real ones. No test starts a scan or prints; the fake is the only paper there is. All data is synthetic.

const HERE = join(import.meta.dir, '..', 'test')
const PRIVATE = 'Zebrafish-Kuchen-GmbH'

let root = ''
let dir = ''
let stateDir = ''
let brainDir = ''
let coreIsUp = true

const paper = () =>
  createPaper({
    hc: [process.execPath, join(HERE, 'fake-hc.ts')],
    paper: join(root, 'paper'),
    coreUp: async () => coreIsUp,
    maxTimeoutSec: 1,
  })

const bearer = { Authorization: `Bearer ${env.API_SECRET}` }
let routes: { handle: (request: Request) => Response | Promise<Response> }

const call = (path: string, init: RequestInit = {}) =>
  routes.handle(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { ...bearer, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    }),
  )
const post = (path: string, body?: unknown) =>
  call(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

/** What the fake paper answers for a verb. */
async function say(verb: string, body: unknown, extra: { code?: number; sleepMs?: number } = {}) {
  const stdout = typeof body === 'string' ? body : JSON.stringify(body)
  await writeFile(
    join(dir, `${verb.replaceAll(' ', '_')}.json`),
    JSON.stringify({ stdout, ...extra }),
  )
}

/** The argv of every call the fake paper has seen, in order. */
async function paperCalls(): Promise<string[][]> {
  const text = await readFile(join(dir, 'calls.log'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[])
    .filter((args) => args[0] !== 'doctor')
}
const hcCalls = async () =>
  (await readFile(join(dir, 'hc-calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)

const DOCTOR = (ok = true) => ({
  ok,
  checks: [{ name: 'scanner', ok, message: ok ? 'reachable' : 'not reachable' }],
  config: {
    dokumente: join(root, 'dokumente'),
    inbox: join(root, 'inbox'),
    brain: brainDir,
    stateDir,
  },
})

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'paper-test-'))
  dir = join(root, 'scenarios')
  stateDir = join(root, 'state')
  brainDir = join(root, 'brain')
  await Promise.all([mkdir(dir), mkdir(stateDir), mkdir(brainDir)])
  await writeFile(
    join(root, 'paper'),
    `#!/bin/sh\nexec "${process.execPath}" "${join(HERE, 'fake-paper.ts')}" "$@"\n`,
  )
  await chmod(join(root, 'paper'), 0o755)
  process.env['FAKE_PAPER_DIR'] = dir
})
afterAll(async () => {
  delete process.env['FAKE_PAPER_DIR']
  await rm(root, { recursive: true, force: true })
})
beforeEach(async () => {
  coreIsUp = true
  await Promise.all(
    ['calls.log', 'hc-calls.log'].map((name) => rm(join(dir, name), { force: true })),
  )
  await say('doctor', DOCTOR())
  routes = new Elysia().use(authGuard).use(createPaperRoutes({ paper: paper() }))
})

describe('/paper auth', () => {
  it('401s without the bearer before any paper call', async () => {
    const res = await routes.handle(new Request('http://localhost/paper/scan/status'))
    expect(res.status).toBe(401)
    expect(await hcCalls()).toHaveLength(0)
  })
})

describe('failures of the CLI', () => {
  it("answers a refusal with 409 and the CLI's message", async () => {
    await say('scan submit', { ok: false, message: 'Nothing is pending' }, { code: 1 })
    const res = await post('/paper/scan/submit')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Nothing is pending' })
  })

  it('answers a refusal of a lookup with 404', async () => {
    await say('docs show', { ok: false, message: 'No such document' }, { code: 1 })
    const res = await call('/paper/docs/some-id')
    expect(res.status).toBe(404)
  })

  it('answers a call that outlives its timeout with 504', async () => {
    await say('scan status', { ok: true, actions: [], pending: null }, { sleepMs: 5000 })
    const started = Date.now()
    const res = await call('/paper/scan/status')
    expect(res.status).toBe(504)
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('answers output that is not JSON with 502', async () => {
    await say('scan status', 'Segmentation fault, core dumped')
    expect((await call('/paper/scan/status')).status).toBe(502)
  })

  it('answers JSON that does not fit the promised shape with 502', async () => {
    await say('scan status', { ok: true, pending: 'yes', actions: 3 })
    expect((await call('/paper/scan/status')).status).toBe(502)
  })

  it('answers an exit code the CLI does not use with 502', async () => {
    await say('scan status', '', { code: 137 })
    expect((await call('/paper/scan/status')).status).toBe(502)
  })

  it('answers 503 and spawns no hc while the herdr core does not answer', async () => {
    coreIsUp = false
    const res = await call('/paper/scan/status')
    expect(res.status).toBe(503)
    expect(await hcCalls()).toHaveLength(0)
  })

  it('answers 503 when hc cannot be started', async () => {
    const lost = createPaper({
      hc: [join(root, 'no-such-hc')],
      paper: join(root, 'paper'),
      coreUp: async () => true,
    })
    const res = await new Elysia()
      .use(authGuard)
      .use(createPaperRoutes({ paper: lost }))
      .handle(new Request('http://localhost/paper/print/status', { headers: bearer }))
    expect(res.status).toBe(503)
  })
})

describe('doctor and scan', () => {
  it('serves the doctor rows, a failing one as data', async () => {
    await say('doctor', DOCTOR(false), { code: 1 })
    const res = await call('/paper/doctor')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: false,
      checks: [{ name: 'scanner', ok: false, message: 'not reachable' }],
    })
  })

  it('serves the scan status with page URLs and no filesystem path', async () => {
    await say('scan status', {
      ok: true,
      pending: {
        parts: [
          {
            mode: 'feeder',
            fileName: 'scan.pdf',
            pages: 2,
            at: 1795782227,
            pagePaths: [join(stateDir, 'p1.jpg'), join(stateDir, 'p2.jpg')],
            thumbPaths: [join(stateDir, 't1.jpg'), null],
            pdfPath: join(stateDir, 'scan.pdf'),
          },
        ],
        scanning: false,
        needsAttention: false,
      },
      lastResult: {
        at: 1795782300,
        action: 'feeder',
        ok: true,
        message: 'Scanned 2 pages',
        pages: 2,
      },
      actions: [{ id: 'scan-submit', group: 'main', command: 'paper scan submit' }],
    })
    const res = await call('/paper/scan/status')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    expect(text).not.toContain(stateDir)
    const body = JSON.parse(text) as {
      pending: { parts: { thumbUrls: (string | null)[]; pageUrls: string[] }[]; attention: null }
      progress: null
    }
    expect(body.pending.parts[0]?.thumbUrls).toEqual(['/paper/scan/pages/0/0', null])
    expect(body.pending.parts[0]?.pageUrls).toEqual([
      '/paper/scan/pages/0/0?size=page',
      '/paper/scan/pages/0/1?size=page',
    ])
    expect(body.pending.attention).toBeNull()
    expect(body.progress).toBeNull()
  })

  it('serves a thumbnail and a full page of the pending scan, and 404s past the end', async () => {
    await writeFile(join(stateDir, 't1.jpg'), 'thumb-bytes')
    await writeFile(join(stateDir, 'p1.jpg'), 'page-bytes')
    await say('scan status', {
      ok: true,
      pending: {
        parts: [
          {
            mode: 'feeder',
            fileName: 'scan.pdf',
            pages: 1,
            at: 1,
            pagePaths: [join(stateDir, 'p1.jpg')],
            thumbPaths: [join(stateDir, 't1.jpg')],
            pdfPath: '',
          },
        ],
        scanning: false,
        needsAttention: false,
      },
      actions: [],
    })
    const thumb = await call('/paper/scan/pages/0/0')
    expect(thumb.headers.get('content-type')).toBe('image/jpeg')
    expect(await thumb.text()).toBe('thumb-bytes')
    expect(await (await call('/paper/scan/pages/0/0?size=page')).text()).toBe('page-bytes')
    expect((await call('/paper/scan/pages/0/1')).status).toBe(404)
    expect((await call('/paper/scan/pages/3/0')).status).toBe(404)
  })

  it('refuses to serve a page whose path lies outside the state dir', async () => {
    const outside = join(root, 'outside.jpg')
    await writeFile(outside, 'secret')
    await say('scan status', {
      ok: true,
      pending: {
        parts: [
          {
            mode: 'feeder',
            fileName: 'x',
            pages: 1,
            at: 1,
            pagePaths: [outside],
            thumbPaths: [outside],
            pdfPath: '',
          },
        ],
        scanning: false,
        needsAttention: false,
      },
      actions: [],
    })
    const res = await call('/paper/scan/pages/0/0')
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('secret')
  })

  it('refuses a symlink in the state dir that points out of it', async () => {
    const outside = join(root, 'outside2.jpg')
    await writeFile(outside, 'secret')
    await symlink(outside, join(stateDir, 'link.jpg')).catch(() => undefined)
    await say('scan status', {
      ok: true,
      pending: {
        parts: [
          {
            mode: 'feeder',
            fileName: 'x',
            pages: 1,
            at: 1,
            pagePaths: [join(stateDir, 'link.jpg')],
            thumbPaths: [null],
            pdfPath: '',
          },
        ],
        scanning: false,
        needsAttention: false,
      },
      actions: [],
    })
    expect((await call('/paper/scan/pages/0/0?size=page')).status).toBe(502)
  })

  it('answers a refused pre-flight as data and passes the settings through', async () => {
    await say(
      'scan check',
      {
        ok: false,
        message: 'No document in the feeder',
        mode: 'feeder',
        scanner: 'Idle',
        feeder: 'ScannerAdfEmpty',
      },
      { code: 1 },
    )
    const res = await call('/paper/scan/check?mode=flatbed&dpi=200&gray=true')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: false, feeder: 'ScannerAdfEmpty' })
    expect(await paperCalls()).toEqual([
      ['scan', 'check', '--mode', 'flatbed', '--dpi', '200', '--gray'],
    ])
  })

  it('starts a scan only on the POST, with exactly the asked settings', async () => {
    await say('scan start', {
      ok: true,
      message: 'Scan started (feeder)',
      started: true,
      mode: 'feeder',
      pid: 4242,
    })
    const res = await post('/paper/scan/start', { mode: 'feeder', dpi: 300, gray: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ started: true, pid: 4242 })
    expect(await paperCalls()).toEqual([
      ['scan', 'start', '--mode', 'feeder', '--dpi', '300', '--gray'],
    ])
  })

  it('answers a scan that would not start with 409', async () => {
    await say('scan start', { ok: false, message: 'No document in the feeder' }, { code: 1 })
    expect((await post('/paper/scan/start', { mode: 'feeder' })).status).toBe(409)
  })

  it.each([{ mode: 'sideways' }, { mode: 'feeder', dpi: 5 }, {}])(
    '422s the start body %j and runs nothing',
    async (body) => {
      expect((await post('/paper/scan/start', body)).status).toBe(422)
      expect(await paperCalls()).toHaveLength(0)
    },
  )

  it('submits with and without force, and discards', async () => {
    await say('scan submit', { ok: true, message: 'Filed' })
    await say('scan discard', { ok: true, message: 'Dropped' })
    expect((await post('/paper/scan/submit')).status).toBe(200)
    expect((await post('/paper/scan/submit', { force: true })).status).toBe(200)
    expect((await post('/paper/scan/discard')).status).toBe(200)
    expect(await paperCalls()).toEqual([
      ['scan', 'submit'],
      ['scan', 'submit', '--force'],
      ['scan', 'discard'],
    ])
  })
})

describe('inbox', () => {
  it('lists the inbox without paths and with the proposal', async () => {
    await say('inbox list', {
      ok: true,
      waiting: [],
      review: [
        {
          name: 'stack.pdf',
          path: join(root, 'inbox', 'review', 'stack.pdf'),
          mtime: 1795782227,
          why: 'long text with a hint',
          reason: 'a stack of several documents',
          proposal: {
            kind: null,
            date: null,
            split: { documents: 2, ranges: ['1-2', '3'], starts: [3] },
          },
          sides: null,
          sideOf: null,
        },
      ],
      done: [{ name: 'old.pdf', path: join(root, 'x'), mtime: 1 }],
      filed: [
        {
          title: 'Invoice',
          kind: 'invoice',
          issuer: 'Example GmbH',
          date: '2026-01-02',
          tags: ['a'],
          summary: 's',
          path: 'p',
          notePath: join(root, 'n'),
          exists: true,
        },
      ],
      filedAsOf: 5,
    })
    const text = await (await call('/paper/inbox')).text()
    expect(text).not.toContain(root)
    expect(JSON.parse(text).review[0]).toMatchObject({
      name: 'stack.pdf',
      reason: 'a stack of several documents',
      proposal: { split: { starts: [3] } },
    })
    expect(JSON.parse(text).review[0].sides).toBeNull()
  })

  it('decides a file with the given parts', async () => {
    await say('inbox decide', {
      ok: true,
      message: 'Decided',
      name: 'stack.split-3.pdf',
      from: '/a',
      to: '/b',
    })
    const res = await post('/paper/inbox/stack.pdf/decide', { split: '3,5' })
    expect(await res.json()).toEqual({ message: 'Decided', name: 'stack.split-3.pdf' })
    await post('/paper/inbox/stack.pdf/decide', {
      kind: 'invoice',
      issuer: 'Example GmbH',
      date: '2026-01-02',
      title: 'March invoice',
      object: 'Car',
    })
    expect(await paperCalls()).toEqual([
      ['inbox', 'decide', 'stack.pdf', '--split', '3,5'],
      [
        'inbox',
        'decide',
        'stack.pdf',
        '--kind',
        'invoice',
        '--issuer',
        'Example GmbH',
        '--date',
        '2026-01-02',
        '--title',
        'March invoice',
        '--object',
        'Car',
      ],
    ])
  })

  it("passes the CLI's refusal of a busy pipeline on as 409", async () => {
    await say('inbox decide', { ok: false, message: 'The pipeline is filing' }, { code: 1 })
    expect((await post('/paper/inbox/a.pdf/decide', { single: true })).status).toBe(409)
  })

  it.each([
    ['/paper/inbox/a.pdf/decide', { kind: '--force' }],
    ['/paper/inbox/a.pdf/decide', { date: 'tomorrow' }],
    ['/paper/inbox/a.pdf/decide', { split: '3;rm' }],
    ['/paper/inbox/-rf/decide', { single: true }],
    ['/paper/inbox/..%2Fetc/decide', { single: true }],
  ])('422s %s %j and runs nothing', async (path, body) => {
    expect((await post(path, body)).status).toBe(422)
    expect(await paperCalls()).toHaveLength(0)
  })

  it('serves the file of an inbox item from the local cache', async () => {
    await writeFile(join(stateDir, 'cached.pdf'), '%PDF-fake')
    await say('inbox fetch', {
      ok: true,
      name: 'a.pdf',
      path: join(stateDir, 'cached.pdf'),
      cached: true,
    })
    const res = await call('/paper/inbox/a.pdf/pdf')
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(await res.text()).toBe('%PDF-fake')
    expect(await paperCalls()).toEqual([['inbox', 'fetch', 'a.pdf']])
  })

  it('serves the first-page thumbnail found by file name, and 404s an unlisted one', async () => {
    await writeFile(join(stateDir, 'thumb-a.jpg'), 'img')
    await say('inbox thumbs', {
      ok: true,
      thumbs: [
        { path: join(root, 'inbox', 'review', 'a.pdf'), thumbPath: join(stateDir, 'thumb-a.jpg') },
      ],
    })
    expect(await (await call('/paper/inbox/a.pdf/thumb')).text()).toBe('img')
    expect((await call('/paper/inbox/b.pdf/thumb')).status).toBe(404)
  })
})

const doc = (id: string) => ({
  id,
  title: 'Rechnung März',
  kind: 'invoice',
  issuer: PRIVATE,
  date: '2026-03-04',
  taxYear: 2026,
  validUntil: null,
  subject: null,
  tags: ['steuer'],
  summary: 'A synthetic summary.',
  sharePath: `Steuer/2026/${id}.pdf`,
  textPath: `Steuer/2026/${id}.md`,
  vaultId: null,
  notePath: join(brainDir, `${id}.md`),
  fileExists: true,
})

describe('docs', () => {
  it('lists with every filter as a flag and without the note path', async () => {
    await say('docs list', {
      ok: true,
      total: 7,
      count: 1,
      asOf: 9,
      documents: [doc('rechnung-1')],
    })
    const res = await call(
      '/paper/docs?kind=invoice&issuer=Zebra&year=2026&taxYear=2026&tag=steuer&query=rechnung&limit=3',
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(brainDir)
    expect(JSON.parse(text)).toMatchObject({
      total: 7,
      count: 1,
      documents: [{ id: 'rechnung-1', fileExists: true }],
    })
    expect(await paperCalls()).toEqual([
      [
        'docs',
        'list',
        '--kind',
        'invoice',
        '--issuer',
        'Zebra',
        '--year',
        '2026',
        '--tax-year',
        '2026',
        '--tag',
        'steuer',
        '--query',
        'rechnung',
        '--limit',
        '3',
      ],
    ])
  })

  it.each(['year=20x6', 'limit=0', 'kind=--evil', 'query='])(
    '422s ?%s and runs nothing',
    async (query) => {
      expect((await call(`/paper/docs?${query}`)).status).toBe(422)
      expect(await paperCalls()).toHaveLength(0)
    },
  )

  it('returns one document', async () => {
    await say('docs show', { ok: true, document: doc('rechnung-1') })
    expect(await (await call('/paper/docs/rechnung-1')).json()).toMatchObject({ id: 'rechnung-1' })
  })

  it('serves the original as application/pdf from the cache', async () => {
    await writeFile(join(stateDir, 'doc.pdf'), '%PDF-doc')
    await say('docs fetch', {
      ok: true,
      id: 'rechnung-1',
      path: join(stateDir, 'doc.pdf'),
      cached: false,
      source: 'share',
    })
    const res = await call('/paper/docs/rechnung-1/pdf')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('%PDF-doc')
  })

  it('does not serve a fetched path outside the state dir', async () => {
    await say('docs fetch', {
      ok: true,
      id: 'x',
      path: join(root, 'outside.pdf'),
      cached: false,
      source: 'share',
    })
    await writeFile(join(root, 'outside.pdf'), 'nope')
    const res = await call('/paper/docs/x/pdf')
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('nope')
  })

  it('reads the extracted text under the brain through the core', async () => {
    await writeFile(join(brainDir, 'rechnung-1.md'), 'Rechnungstext')
    await say('docs text', { ok: true, id: 'rechnung-1', path: join(brainDir, 'rechnung-1.md') })
    const res = await call('/paper/docs/rechnung-1/text')
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toBe('Rechnungstext')
    expect((await hcCalls()).some((line) => line.includes('/bin/cat'))).toBe(true)
  })

  it('reads the extracted text that lies under the Dokumente share', async () => {
    await mkdir(join(root, 'dokumente'), { recursive: true })
    await writeFile(join(root, 'dokumente', 'doc.txt'), 'Freitext')
    await say('docs text', { ok: true, id: 'x', path: join(root, 'dokumente', 'doc.txt') })
    const res = await call('/paper/docs/x/text')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Freitext')
  })

  it('does not read a text path outside the brain and the share', async () => {
    await say('docs text', { ok: true, id: 'x', path: '/etc/hosts' })
    expect((await call('/paper/docs/x/text')).status).toBe(502)
    expect((await hcCalls()).some((line) => line.includes('/bin/cat'))).toBe(false)
  })
})

describe('print', () => {
  const printed = {
    ok: true,
    message: 'Held',
    action: 'hold',
    jobId: 'Test_Printer-7',
    printer: 'Test_Printer',
    file: '/x/y.pdf',
    argv: ['lp'],
    sides: 'two-sided-long-edge',
    sidesWhy: 'a multi-page job',
    media: 'A4',
    documentPages: 3,
    pageCount: 3,
    copies: 1,
    state: 'held',
    warnings: [],
  }

  it('prints a filed document with the asked options, held for a proof', async () => {
    await say('print', printed)
    const res = await post('/paper/docs/rechnung-1/print', {
      sides: 'simplex',
      pages: '1-2',
      copies: 2,
      hold: true,
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({
      jobId: 'Test_Printer-7',
      sidesWhy: 'a multi-page job',
    })
    expect(text).not.toContain('/x/y.pdf')
    expect(await paperCalls()).toEqual([
      ['print', '--doc', 'rechnung-1', '--simplex', '--pages', '1-2', '--copies', '2', '--hold'],
    ])
  })

  it('lets the CLI choose the sides by default and supports a dry run', async () => {
    await say('print', { ...printed, action: 'dry-run', jobId: undefined })
    await post('/paper/docs/rechnung-1/print', { dryRun: true })
    expect(await paperCalls()).toEqual([['print', '--doc', 'rechnung-1', '--dry-run']])
  })

  it('answers a queue that does not take a job with 409', async () => {
    await say('print', { ok: false, message: 'The queue is stopped' }, { code: 1 })
    expect((await post('/paper/docs/rechnung-1/print', {})).status).toBe(409)
  })

  it.each([{ copies: 0 }, { copies: 500 }, { pages: '1;2' }, { sides: 'diagonal' }])(
    '422s the print body %j',
    async (body) => {
      expect((await post('/paper/docs/rechnung-1/print', body)).status).toBe(422)
      expect(await paperCalls()).toHaveLength(0)
    },
  )

  it('prints an inbox file from its cached copy', async () => {
    await writeFile(join(stateDir, 'in.pdf'), '%PDF')
    await say('inbox fetch', {
      ok: true,
      name: 'a.pdf',
      path: join(stateDir, 'in.pdf'),
      cached: true,
    })
    await say('print', printed)
    await post('/paper/inbox/a.pdf/print', { hold: true })
    const calls = await paperCalls()
    expect(calls[0]).toEqual(['inbox', 'fetch', 'a.pdf'])
    expect(calls[1]?.[0]).toBe('print')
    expect(calls[1]?.[1]).toMatch(/in\.pdf$/)
    expect(calls[1]?.slice(2)).toEqual(['--hold'])
  })

  it('reports the printer, one job, and cancels a job', async () => {
    const status = {
      ok: true,
      printer: 'Test_Printer',
      state: 'idle',
      accepting: true,
      reasons: [],
      tonerPercent: 60,
      tonerLow: false,
      warnings: [],
      jobs: [],
    }
    await say('print status', status)
    expect(await (await call('/paper/print/status')).json()).toMatchObject({
      accepting: true,
      tonerPercent: 60,
    })
    await say('print status', {
      ...status,
      jobs: undefined,
      job: { id: 'Test_Printer-7', state: 'held', sheets: 2 },
    })
    expect(await (await call('/paper/print/jobs/Test_Printer-7')).json()).toMatchObject({
      job: { id: 'Test_Printer-7' },
    })
    await say('print cancel', { ok: true, message: 'Cancelled', cancelled: ['Test_Printer-7'] })
    expect(await (await post('/paper/print/jobs/Test_Printer-7/cancel')).json()).toEqual({
      message: 'Cancelled',
      cancelled: ['Test_Printer-7'],
    })
    expect((await paperCalls()).map((args) => args.join(' '))).toEqual([
      'print status',
      'print status Test_Printer-7',
      'print cancel Test_Printer-7',
    ])
  })

  it('422s a job id that is an option', async () => {
    expect((await post('/paper/print/jobs/-a/cancel')).status).toBe(422)
    expect(await paperCalls()).toHaveLength(0)
  })
})

describe('privacy and the contract', () => {
  it('logs the verb and the outcome but nothing of a document', async () => {
    const seen: string[] = []
    const spy = spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      seen.push(JSON.stringify(args))
    })
    try {
      await say('docs list', {
        ok: true,
        total: 1,
        count: 1,
        asOf: 1,
        documents: [
          {
            id: 'a',
            title: PRIVATE,
            kind: null,
            issuer: PRIVATE,
            date: null,
            taxYear: null,
            validUntil: null,
            subject: null,
            tags: [],
            summary: PRIVATE,
            sharePath: null,
            textPath: null,
            vaultId: null,
            fileExists: true,
          },
        ],
      })
      const res = await call(`/paper/docs?query=${PRIVATE}`)
      expect(await res.text()).toContain(PRIVATE)
    } finally {
      spy.mockRestore()
    }
    const logged = seen.join('\n')
    expect(logged).toContain('docs list')
    expect(logged).toContain('"ok"')
    expect(logged).not.toContain(PRIVATE)
  })

  it('lists every /paper route in /openapi/json under the Paper tag', async () => {
    const res = await app.handle(new Request('http://localhost/openapi/json'))
    const spec = (await res.json()) as {
      paths: Record<
        string,
        Record<string, { tags?: string[]; responses?: Record<string, unknown> }>
      >
    }
    const expected = [
      'get /paper/doctor',
      'get /paper/scan/status',
      'get /paper/scan/check',
      'post /paper/scan/start',
      'post /paper/scan/submit',
      'post /paper/scan/discard',
      'get /paper/scan/pages/{part}/{page}',
      'get /paper/inbox',
      'post /paper/inbox/{name}/decide',
      'get /paper/inbox/{name}/pdf',
      'get /paper/inbox/{name}/thumb',
      'post /paper/inbox/{name}/print',
      'get /paper/docs',
      'get /paper/docs/{id}',
      'get /paper/docs/{id}/pdf',
      'get /paper/docs/{id}/text',
      'post /paper/docs/{id}/print',
      'get /paper/print/status',
      'get /paper/print/jobs/{jobId}',
      'post /paper/print/jobs/{jobId}/cancel',
    ]
    const actual = Object.entries(spec.paths)
      .filter(([path]) => path.startsWith('/paper'))
      .flatMap(([path, ops]) => Object.keys(ops).map((method) => `${method} ${path}`))
    expect(actual.toSorted()).toEqual(expected.toSorted())
    for (const [path, ops] of Object.entries(spec.paths).filter(([p]) => p.startsWith('/paper'))) {
      for (const op of Object.values(ops)) {
        expect(op.tags, path).toEqual(['Paper'])
        expect(Object.keys(op.responses ?? {}), path).toContain('503')
      }
    }
  })
})
