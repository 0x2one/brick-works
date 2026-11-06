import { spawn, type ChildProcess } from 'child_process'

export interface DockerCliRunResult {
  code: number
  stdout: string
  stderr: string
}

const DEFAULT_TIMEOUT_MS = 30000

/**
 * `wsl.exe` reports some failures as UTF-16LE (with a BOM), while normal
 * command output is UTF-8. Detect both and drop control characters so the
 * message stays readable in the UI.
 */
function decodeOutput(chunk: Buffer): string {
  let buffer = chunk
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    buffer = buffer.subarray(2)
    return cleanText(buffer.toString('utf16le'))
  }
  let nulls = 0
  const limit = Math.min(buffer.length, 512)
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) nulls += 1
  }
  if (limit >= 4 && nulls > limit / 4) return cleanText(buffer.toString('utf16le'))
  return cleanText(buffer.toString('utf8'))
}

function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

/**
 * Docker CLI backend — runs the `docker` binary inside a WSL distribution.
 *
 * Every argument is passed as a separate argv entry (never through a shell),
 * so user supplied values cannot be interpreted as shell syntax.
 */
export class DockerCli {
  constructor(private readonly distro: string) {}

  static supported(): boolean {
    return process.platform === 'win32'
  }

  private argvRaw(args: string[]): string[] {
    const head = this.distro ? ['-d', this.distro] : []
    return [...head, '--', ...args]
  }

  private ensureSupported(): void {
    if (!DockerCli.supported()) throw new Error('WSL_UNSUPPORTED')
  }

  run(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DockerCliRunResult> {
    return this.runRaw(['docker', ...args], timeoutMs)
  }

  /** Run an arbitrary command inside the distribution (no `docker` prefix). */
  runRaw(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DockerCliRunResult> {
    this.ensureSupported()
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawn('wsl.exe', this.argvRaw(args), { windowsHide: true })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      const out: Buffer[] = []
      const err: Buffer[] = []
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          child.kill()
        } catch {
          // ignore
        }
        reject(new Error('DOCKER_CLI_TIMEOUT'))
      }, timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
      child.on('error', (e) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({
          code: typeof code === 'number' ? code : -1,
          stdout: decodeOutput(Buffer.concat(out)),
          stderr: decodeOutput(Buffer.concat(err))
        })
      })
    })
  }

  /** Spawn a long running command (logs / exec) and stream its output. */
  spawnStream(args: string[]): ChildProcess {
    this.ensureSupported()
    return spawn('wsl.exe', this.argvRaw(['docker', ...args]), { windowsHide: true })
  }

  /** Spawn an arbitrary long running command inside the distribution. */
  spawnRaw(args: string[]): ChildProcess {
    this.ensureSupported()
    return spawn('wsl.exe', this.argvRaw(args), { windowsHide: true })
  }

  /** Check whether a command exists inside the distribution. */
  async hasCommand(name: string): Promise<boolean> {
    try {
      const res = await this.runRaw(['sh', '-c', `command -v ${name}`], 10000)
      return res.code === 0 && res.stdout.trim().length > 0
    } catch {
      return false
    }
  }

  /** Run a command and parse the JSON payload produced by `--format '{{json .}}'`. */
  async runJson<T>(args: string[]): Promise<T> {
    const res = await this.run(args)
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || res.stdout.trim() || 'DOCKER_CLI_FAILED')
    }
    const text = res.stdout.trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('DOCKER_CLI_UNPARSED')
    try {
      return JSON.parse(text.slice(start, end + 1)) as T
    } catch {
      throw new Error('DOCKER_CLI_UNPARSED')
    }
  }

  /**
   * Run a command that prints one JSON object per line.
   * Lines that are not valid JSON are skipped — `wsl.exe` may prepend a
   * distribution welcome banner on the first launch.
   */
  async runJsonLines<T>(args: string[]): Promise<T[]> {
    const res = await this.run(args)
    if (res.code !== 0) {
      throw new Error(res.stderr.trim() || res.stdout.trim() || 'DOCKER_CLI_FAILED')
    }
    const rows: T[] = []
    for (const line of res.stdout.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue
      try {
        rows.push(JSON.parse(trimmed) as T)
      } catch {
        // skip malformed line
      }
    }
    return rows
  }
}

/** List the installed WSL distributions (`wsl.exe -l -q`). */
export async function listWslDistros(): Promise<string[]> {
  if (!DockerCli.supported()) return []
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn('wsl.exe', ['-l', '-q'], { windowsHide: true })
    } catch {
      resolve([])
      return
    }
    const out: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.on('error', () => resolve([]))
    child.on('close', () => {
      const text = decodeOutput(Buffer.concat(out))
      const distros = text
        .split(/\r?\n/)
        .map((line) => line.replace(/\0/g, '').trim())
        .filter((line) => line.length > 0)
      resolve(distros)
    })
  })
}

/** Resolve the IPv4 address of a WSL distribution (`hostname -I` inside it). */
export async function resolveWslAddress(distro: string): Promise<string | null> {
  if (!DockerCli.supported()) return null
  return new Promise((resolve) => {
    const args = distro ? ['-d', distro, '--', 'hostname', '-I'] : ['--', 'hostname', '-I']
    let child: ChildProcess
    try {
      child = spawn('wsl.exe', args, { windowsHide: true })
    } catch {
      resolve(null)
      return
    }
    const out: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.on('error', () => resolve(null))
    child.on('close', () => {
      const text = decodeOutput(Buffer.concat(out))
      const match = text.match(/(\d{1,3}(?:\.\d{1,3}){3})/)
      resolve(match ? match[1] : null)
    })
  })
}
