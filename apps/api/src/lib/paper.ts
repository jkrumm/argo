import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { env } from '../env.js'
import { log } from '../telemetry.js'

/**
 * The `paper` CLI (repo ~/SourceRoot/paper, contract `paper schema`) as Argo calls it.
 *
 * Every verb runs as `hc exec --json --timeout N -- paper …`: a launchd-born process (Argo is one) can
 * stat the SMB share but not read it and has no LAN access, while a child of the herdr core has both
 * (dotfiles docs/tcc.md). `--json` hands back exit code, `timed_out`, `truncated` and base64 stdout, so a
 * timeout is a fact and not a guess.
 *
 * Any `hc` call starts a core when none answers, and a core born from Argo would be a stray: so a bare
 * connect to the default core socket must answer before `hc` is spawned, else the call is `unavailable`.
 *
 * PRIVACY. A document's issuer, title and text are private. Logs carry the verb name, the outcome and
 * the duration only: never an argument, a message or an output.
 */

export type PaperResult<T> =
  | { kind: 'ok'; data: T }
  /** Exit 1 with `ok:false`: a refusal or failure the CLI explains. `data` is its body when it fits the shape. */
  | { kind: 'refused'; message: string; data: T | null }
  | { kind: 'timeout' }
  /** Output that is not JSON, or JSON that does not fit the shape this API promises. */
  | { kind: 'unparseable' }
  /** An exit code the CLI does not use, or output cut at the cap. */
  | { kind: 'failed'; message: string }
  /** The core is down or `hc` / `paper` cannot be started. */
  | { kind: 'unavailable'; message: string }

export type PaperDirs = { dokumente: string; inbox: string; brain: string; stateDir: string }

export type PaperConfig = {
  /** The `hc` command as argv, e.g. `['/home/me/.local/bin/hc']`. */
  hc: readonly string[]
  /** Absolute path of the `paper` executable. */
  paper: string
  /** True when the herdr core answers; default: a connect to its default socket. */
  coreUp?: () => Promise<boolean>
  /** Caps every call's timeout in seconds (tests only: a timeout case must not take 30 s). */
  maxTimeoutSec?: number
}

export type Call<T> = {
  /** Verb name for the log line, e.g. `docs list`. Never an argument. */
  verb: string
  /** Everything after `paper`. */
  args: readonly string[]
  timeoutSec: number
  schema: z.ZodType<T>
}

const BaseSchema = z.object({ ok: z.boolean(), message: z.string().optional() })

const HcExecSchema = z.union([
  z.object({
    code: z.number().int().nullable(),
    stdout: z.string(),
    timed_out: z.boolean(),
    truncated: z.boolean(),
  }),
  z.object({ error: z.object({ message: z.string() }) }),
])

export const DoctorSchema = z.object({
  ok: z.boolean(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), message: z.string() })),
  config: z.object({
    dokumente: z.string(),
    inbox: z.string(),
    brain: z.string(),
    stateDir: z.string(),
  }),
})

/** How hc resolves its default session's socket (dotfiles scripts/lib/core-up.sh). */
function coreSocketPath(): string {
  const explicit = process.env['HC_SOCKET']
  if (explicit) return explicit
  const runtime = process.env['XDG_RUNTIME_DIR']
  if (runtime) return join(runtime, 'herdr-core', 'default.sock')
  const state = process.env['XDG_STATE_HOME'] || join(homedir(), '.local', 'state')
  return join(state, 'herdr-core', 'default', 'default.sock')
}

async function coreSocketAnswers(): Promise<boolean> {
  const connect = Bun.connect({
    unix: coreSocketPath(),
    socket: { data() {}, error() {}, close() {} },
  }).then(
    (socket) => {
      socket.end()
      return true
    },
    () => false,
  )
  const timer = new Promise<boolean>((done) => setTimeout(() => done(false), 1000))
  return Promise.race([connect, timer])
}

async function timed<T>(
  verb: string,
  work: () => Promise<PaperResult<T>>,
): Promise<PaperResult<T>> {
  const started = performance.now()
  const result = await work()
  log.info('paper: call', {
    verb,
    outcome: result.kind,
    'duration.ms': Math.round(performance.now() - started),
  })
  return result
}

type Exec =
  | { kind: 'done'; code: number | null; stdout: string; truncated: boolean }
  | { kind: 'timeout' }
  | { kind: 'unavailable'; message: string }

export function createPaper(config: PaperConfig) {
  const coreUp = config.coreUp ?? coreSocketAnswers
  let dirs: Promise<PaperDirs | null> | null = null

  async function exec(argv: readonly string[], requestedSec: number): Promise<Exec> {
    const timeoutSec = Math.min(requestedSec, config.maxTimeoutSec ?? requestedSec)
    if (!(await coreUp()))
      return { kind: 'unavailable', message: 'the herdr core is not answering' }
    const [hc, ...hcArgs] = config.hc
    if (!hc) return { kind: 'unavailable', message: 'no hc command configured' }
    // A guard past hc's own limit: hc ends the command itself at `timeoutSec`.
    const guard = AbortSignal.timeout((timeoutSec + 15) * 1000)
    let proc: ReturnType<typeof Bun.spawn>
    try {
      proc = Bun.spawn(
        [hc, ...hcArgs, 'exec', '--json', '--timeout', String(timeoutSec), '--', ...argv],
        { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', signal: guard, env: process.env },
      )
    } catch (error) {
      return {
        kind: 'unavailable',
        message: error instanceof Error ? error.message : 'spawn failed',
      }
    }
    const [raw] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ])
    if (guard.aborted) return { kind: 'timeout' }
    let parsed: z.infer<typeof HcExecSchema>
    try {
      parsed = HcExecSchema.parse(JSON.parse(raw))
    } catch {
      return { kind: 'unavailable', message: 'hc answered with something that is not its JSON' }
    }
    if ('error' in parsed) return { kind: 'unavailable', message: parsed.error.message }
    if (parsed.timed_out) return { kind: 'timeout' }
    return {
      kind: 'done',
      code: parsed.code,
      stdout: Buffer.from(parsed.stdout, 'base64').toString('utf8'),
      truncated: parsed.truncated,
    }
  }

  /** Runs one verb and returns its JSON typed by `schema`. */
  function run<T>(call: Call<T>): Promise<PaperResult<T>> {
    return timed(call.verb, async () => {
      const out = await exec([config.paper, ...call.args], call.timeoutSec)
      if (out.kind !== 'done') return out
      if (out.truncated) return { kind: 'failed', message: 'the output was cut at the cap' }
      let body: unknown
      try {
        body = JSON.parse(out.stdout)
      } catch {
        return out.code === 0 || out.code === 1
          ? { kind: 'unparseable' }
          : { kind: 'failed', message: `paper exited ${out.code}` }
      }
      const typed = call.schema.safeParse(body)
      if (out.code === 0)
        return typed.success ? { kind: 'ok', data: typed.data } : { kind: 'unparseable' }
      const base = BaseSchema.safeParse(body)
      if ((out.code === 1 || out.code === 2) && base.success && !base.data.ok) {
        return {
          kind: 'refused',
          message: base.data.message ?? 'paper refused',
          data: typed.success ? typed.data : null,
        }
      }
      return { kind: 'failed', message: `paper exited ${out.code}` }
    })
  }

  /** Paper's own directories, from `paper doctor` once (a failed read is not remembered). */
  function paperDirs(): Promise<PaperDirs | null> {
    if (dirs) return dirs
    const read: Promise<PaperDirs | null> = run({
      verb: 'doctor',
      args: ['doctor'],
      timeoutSec: 30,
      schema: DoctorSchema,
    }).then((result) => {
      const data = result.kind === 'ok' || result.kind === 'refused' ? result.data : null
      const found = data?.config ?? null
      if (!found && dirs === read) dirs = null
      return found
    })
    dirs = read
    return read
  }

  /**
   * A file Argo may serve: a path whose realpath lies under paper's state dir (the thumbnails, and
   * the copies `docs fetch` / `inbox fetch` make). Symlinks are resolved first; null for anything else.
   */
  async function servable(path: string): Promise<string | null> {
    const found = await paperDirs()
    if (!found) return null
    const [root, real] = await Promise.all([
      realpath(found.stateDir).catch(() => null),
      realpath(path).catch(() => null),
    ])
    return root && real && real.startsWith(root + sep) ? real : null
  }

  /** A document's extracted text: a .md or .txt under the brain or the Dokumente share, read by `cat` in the core's child. */
  function brainText(path: string): Promise<PaperResult<string>> {
    return timed('docs text read', async () => {
      const found = await paperDirs()
      if (!found) return { kind: 'unavailable', message: 'paper directories are unknown' }
      const absolute = resolve(path)
      const roots = [found.brain, found.dokumente].map((root) => resolve(root) + sep)
      if (!roots.some((root) => absolute.startsWith(root)) || !/\.(md|txt)$/.test(absolute)) {
        return {
          kind: 'failed',
          message: 'the text file lies outside the brain and the Dokumente share',
        }
      }
      const out = await exec(['/bin/cat', absolute], 30)
      if (out.kind !== 'done') return out
      if (out.code !== 0)
        return { kind: 'refused', message: 'the text file cannot be read', data: null }
      if (out.truncated) return { kind: 'failed', message: 'the text was cut at the cap' }
      return { kind: 'ok', data: out.stdout }
    })
  }

  return { run, servable, brainText, dirs: paperDirs }
}

export type Paper = ReturnType<typeof createPaper>

export function defaultPaper(): Paper {
  const home = homedir()
  return createPaper({
    hc: [env.HC_BIN || join(home, '.local', 'bin', 'hc')],
    paper: env.PAPER_BIN || join(home, '.local', 'bin', 'paper'),
  })
}
