const STDERR_LIMIT = 500
const STDOUT_LIMIT = 5 * 1024 * 1024

/**
 * Split a configured command string into argv on whitespace. There is no shell and
 * no quoting support: an argument cannot contain whitespace. Empty string = no command.
 */
export function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

/** Read a stream to text; once more than STDOUT_LIMIT bytes arrive, kill the child and throw. */
async function readCapped(
  stream: ReadableStream<Uint8Array>,
  kill: () => void,
  cmd: string,
): Promise<string> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > STDOUT_LIMIT) {
      kill()
      throw new Error(`${cmd} stdout exceeded ${STDOUT_LIMIT} bytes`)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export interface RunCommandOptions {
  /** Written to the child's stdin, which is then closed. Omitted = no stdin. */
  stdin?: string
  /** The child is killed and the call rejects once this many ms have passed. */
  timeoutMs: number
}

/**
 * Run an argv (never through a shell) and resolve with its stdout.
 * Rejects on a non-zero exit (message carries the code and truncated stderr) or on timeout.
 */
export async function runCommand(argv: string[], opts: RunCommandOptions): Promise<string> {
  const [cmd] = argv
  if (!cmd) throw new Error('empty command')

  const proc = Bun.spawn(argv, {
    stdin: opts.stdin === undefined ? 'ignore' : new Blob([opts.stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`))
    }, opts.timeoutMs)
  })

  const finished = (async () => {
    const [stdout, stderr, code] = await Promise.all([
      readCapped(proc.stdout, () => proc.kill(), cmd),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) {
      throw new Error(`${cmd} exited with code ${code}: ${stderr.trim().slice(0, STDERR_LIMIT)}`)
    }
    return stdout
  })()
  // If the timeout wins, `finished` may still settle later; keep that from being unhandled.
  finished.catch(() => undefined)

  try {
    return await Promise.race([finished, timedOut])
  } finally {
    clearTimeout(timer)
  }
}
