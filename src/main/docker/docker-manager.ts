import { PassThrough, type Duplex, type Readable } from 'stream'
import { randomUUID } from 'crypto'
import type Dockerode from 'dockerode'
import {
  openDockerSession,
  type DockerBackend,
  type DockerSession,
  type DockerTransportContext
} from './docker-transport'
import type { DockerEndpoint, DockerEndpointType } from './docker-store'
import {
  parseCliTimestamp,
  parseLabelString,
  parsePortsString,
  parseSizeString,
  type DockerContainerRow,
  type DockerImageRow,
  type DockerMountRow,
  type DockerNetworkRow,
  type DockerPortMapping,
  type DockerStatsRow,
  type DockerSystemInfo,
  type DockerVersionInfo,
  type DockerVolumeRow
} from './docker-types'

export type DockerConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface DockerStatus {
  state: DockerConnectionState
  endpointId: string | null
  endpointName: string | null
  endpointType: DockerEndpointType | null
  backend: DockerBackend | null
  detail: string | null
  /** The session provides a real TTY (interactive shell with job control) */
  tty?: boolean
  error?: string
  connectedAt?: number
}

export interface DockerLogChunk {
  sessionId: string
  data: string
}

export interface DockerExecData {
  sessionId: string
  data: string
}

export interface DockerExecExit {
  sessionId: string
  reason?: string
}

export interface DockerContainerDetail {
  id: string
  name: string
  image: string
  state: string
  status: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  restartCount: number
  command: string
  entrypoint: string
  workingDir: string
  user: string
  hostname: string
  ipAddress: string
  ports: DockerPortMapping[]
  env: string[]
  labels: Record<string, string>
  mounts: DockerMountRow[]
  networks: string[]
  restartPolicy: { name: string; maxRetry: number }
  health: string
  exitCode: number | null
  error?: string
}

export type DockerContainerAction = 'start' | 'stop' | 'restart' | 'kill' | 'pause' | 'unpause'

/** Shells that understand the `-i` (interactive) flag. */
const POSIX_SHELLS = ['sh', 'bash']

export interface DockerStartLogsOpts {
  containerId: string
  tail?: number
  follow?: boolean
}

export interface DockerStartExecOpts {
  containerId: string
  cmd?: string[]
  shell?: string
  tty?: boolean
}

interface LogSession {
  sessionId: string
  stop: () => void
}

interface ExecSession {
  sessionId: string
  stream: NodeJS.WritableStream & { destroy?: () => void; end?: () => void }
  stop: () => void
}

/**
 * Docker multiplexes container stdout/stderr into frames prefixed with an
 * eight byte header. TTY enabled streams are not framed — in that case the
 * payload is passed through untouched.
 */
function demuxDockerStream(source: NodeJS.ReadableStream): Readable {
  const out = new PassThrough()
  let buffer: Buffer = Buffer.alloc(0)
  let pendingLength = -1
  let raw = false

  source.on('data', (chunk: Buffer | string) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (raw) {
      out.write(buf)
      return
    }
    buffer = Buffer.concat([buffer, buf])
    for (;;) {
      if (pendingLength < 0) {
        if (buffer.length < 8) return
        const type = buffer.readUInt8(0)
        const length = buffer.readUInt32BE(4)
        if (type > 2) {
          raw = true
          out.write(buffer)
          buffer = Buffer.alloc(0)
          return
        }
        pendingLength = length
        buffer = buffer.subarray(8)
        continue
      }
      if (buffer.length < pendingLength) return
      out.write(buffer.subarray(0, pendingLength))
      buffer = buffer.subarray(pendingLength)
      pendingLength = -1
    }
  })
  source.on('end', () => {
    if (buffer.length) out.write(buffer)
    out.end()
  })
  source.on('error', (err) => out.destroy(err))
  return out
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function bool(value: unknown): boolean {
  // The Docker CLI renders booleans as the strings "true" / "false".
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return Boolean(value)
}

function isoToMs(value: unknown): number | null {
  if (!value) return null
  const parsed = parseCliTimestamp(value)
  return parsed > 0 ? parsed : null
}

function parseEnginePorts(value: unknown): DockerPortMapping[] {
  if (!Array.isArray(value)) return []
  const ports: DockerPortMapping[] = []
  for (const raw of value) {
    const entry = asRecord(raw)
    const privatePort = num(entry.PrivatePort)
    if (!privatePort) continue
    ports.push({
      privatePort,
      publicPort: entry.PublicPort ? num(entry.PublicPort) : undefined,
      type: str(entry.Type) || 'tcp',
      ip: str(entry.IP) || undefined
    })
  }
  return ports
}

function parseInspectMounts(value: unknown): DockerMountRow[] {
  if (!Array.isArray(value)) return []
  return value.map((raw) => {
    const entry = asRecord(raw)
    return {
      type: str(entry.Type) || 'bind',
      source: str(entry.Source),
      destination: str(entry.Destination),
      mode: str(entry.Mode) || str(entry.RW) === 'true' ? 'rw' : 'ro'
    }
  })
}

function normalizeContainerInfo(raw: unknown): DockerContainerRow {
  const info = asRecord(raw)
  const names = Array.isArray(info.Names) ? info.Names.map((n) => String(n)) : []
  const state = asRecord(info.State)
  const labels = asRecord(info.Labels)
  const hostConfig = asRecord(info.HostConfig)
  const networkSettings = asRecord(info.NetworkSettings)
  const networks = asRecord(networkSettings.Networks)
  const mounts = Array.isArray(info.Mounts)
    ? info.Mounts.map((m) => {
        const mount = asRecord(m)
        return {
          type: str(mount.Type) || 'bind',
          source: str(mount.Source),
          destination: str(mount.Destination),
          mode: 'rw'
        }
      })
    : []
  const labelMap: Record<string, string> = {}
  for (const [key, value] of Object.entries(labels)) labelMap[key] = String(value)

  return {
    id: str(info.Id),
    name: names[0] ? names[0].replace(/^\//, '') : str(info.Id).slice(0, 12),
    image: str(info.Image),
    imageId: str(info.ImageID),
    state: str(info.State) || str(state.Status),
    status: str(info.Status),
    command: str(info.Command),
    createdAt: num(info.Created) * 1000,
    startedAt: isoToMs(state.StartedAt),
    finishedAt: isoToMs(state.FinishedAt),
    restartCount:
      num(asRecord(hostConfig.RestartPolicy).MaximumRetryCount) || num(state.RestartCount),
    ports: parseEnginePorts(info.Ports),
    labels: labelMap,
    networks: Object.keys(networks),
    mounts
  }
}

function normalizeCliContainer(raw: unknown): DockerContainerRow {
  const info = asRecord(raw)
  const names = Array.isArray(info.Names)
    ? info.Names.map((n) => String(n))
    : typeof info.Names === 'string'
      ? info.Names.split(',')
          .map((n) => n.trim())
          .filter(Boolean)
      : []
  const labels = parseLabelString(info.Labels)
  const networks = typeof info.Networks === 'string' ? info.Networks.split(',').filter(Boolean) : []
  const mounts =
    typeof info.Mounts === 'string'
      ? info.Mounts.split(',')
          .filter(Boolean)
          .map((entry) => {
            const idx = entry.indexOf(':')
            if (idx < 0) {
              return { type: 'bind', source: '', destination: entry, mode: 'rw' }
            }
            return {
              type: 'bind',
              source: entry.slice(0, idx),
              destination: entry.slice(idx + 1),
              mode: 'rw'
            }
          })
      : []
  return {
    id: str(info.ID),
    name: names[0] || str(info.ID).slice(0, 12),
    image: str(info.Image),
    imageId: '',
    state: str(info.State),
    status: str(info.Status),
    command: str(info.Command).replace(/^"|"$/g, ''),
    createdAt: parseCliTimestamp(info.CreatedAt),
    startedAt: null,
    finishedAt: null,
    restartCount: 0,
    ports: parsePortsString(info.Ports),
    labels,
    networks,
    mounts
  }
}

function normalizeInspect(raw: unknown): DockerContainerDetail {
  const info = asRecord(raw)
  const config = asRecord(info.Config)
  const state = asRecord(info.State)
  const hostConfig = asRecord(info.HostConfig)
  const networkSettings = asRecord(info.NetworkSettings)
  const networks = asRecord(networkSettings.Networks)
  const restartPolicy = asRecord(hostConfig.RestartPolicy)
  const health = asRecord(state.Health)
  const labels = asRecord(config.Labels)
  const labelMap: Record<string, string> = {}
  for (const [key, value] of Object.entries(labels)) labelMap[key] = String(value)
  const names = Array.isArray(info.Name) ? [] : [str(info.Name).replace(/^\//, '')]

  return {
    id: str(info.Id),
    name: names[0] || str(info.Id).slice(0, 12),
    image: str(config.Image),
    state: str(state.Status),
    status: str(state.Status),
    createdAt: parseCliTimestamp(info.Created),
    startedAt: isoToMs(state.StartedAt),
    finishedAt: isoToMs(state.FinishedAt),
    restartCount: num(state.RestartCount),
    command: Array.isArray(config.Cmd) ? config.Cmd.join(' ') : str(config.Cmd),
    entrypoint: Array.isArray(config.Entrypoint)
      ? config.Entrypoint.join(' ')
      : str(config.Entrypoint),
    workingDir: str(config.WorkingDir),
    user: str(config.User),
    hostname: str(config.Hostname),
    ipAddress: str(networkSettings.IPAddress),
    ports: parseEnginePorts(
      hostConfig.PortBindings ? portBindingsToPorts(hostConfig.PortBindings) : []
    ),
    env: Array.isArray(config.Env) ? config.Env.map((e) => String(e)) : [],
    labels: labelMap,
    mounts: parseInspectMounts(info.Mounts),
    networks: Object.keys(networks),
    restartPolicy: {
      name: str(restartPolicy.Name) || 'no',
      maxRetry: num(restartPolicy.MaximumRetryCount)
    },
    health: str(health.Status),
    exitCode: state.ExitCode === undefined || state.ExitCode === null ? null : num(state.ExitCode)
  }
}

function portBindingsToPorts(bindings: unknown): unknown[] {
  const out: unknown[] = []
  const record = asRecord(bindings)
  for (const [containerPort, hosts] of Object.entries(record)) {
    const list = Array.isArray(hosts) ? hosts : []
    for (const host of list) {
      const entry = asRecord(host)
      out.push({
        PrivatePort: Number(containerPort),
        PublicPort: entry.HostPort ? Number(entry.HostPort) : undefined,
        Type: entry.HostPort ? 'tcp' : 'tcp',
        IP: str(entry.HostIp) || undefined
      })
    }
  }
  return out
}

function normalizeImageInfo(raw: unknown): DockerImageRow {
  const info = asRecord(raw)
  const repoTags = Array.isArray(info.RepoTags) ? info.RepoTags.map((t) => String(t)) : []
  const first = repoTags[0] ?? '<none>'
  const slash = first.lastIndexOf('/')
  const colon = first.indexOf(':', slash + 1)
  const labels = asRecord(info.Labels)
  const labelMap: Record<string, string> = {}
  for (const [key, value] of Object.entries(labels)) labelMap[key] = String(value)
  return {
    id: str(info.Id),
    repository: colon > 0 ? first.slice(0, colon) : first,
    tag: colon > 0 ? first.slice(colon + 1) : 'latest',
    size: num(info.Size),
    createdAt: num(info.Created) * 1000,
    containers: Array.isArray(info.Containers) ? info.Containers.length : 0,
    labels: labelMap
  }
}

function normalizeCliImage(raw: unknown): DockerImageRow {
  const info = asRecord(raw)
  const labels = parseLabelString(info.Labels)
  return {
    id: str(info.ID),
    repository: str(info.Repository) || '<none>',
    tag: str(info.Tag) || '<none>',
    size: parseSizeString(info.Size),
    createdAt: parseCliTimestamp(info.CreatedAt),
    containers: num(info.Containers),
    labels
  }
}

function normalizeVolume(raw: unknown): DockerVolumeRow {
  const info = asRecord(raw)
  const labels = parseLabelString(info.Labels)
  const usage = asRecord(info.UsageData)
  return {
    name: str(info.Name),
    driver: str(info.Driver),
    mountpoint: str(info.Mountpoint),
    scope: str(info.Scope),
    labels,
    size: usage.Size === undefined ? null : num(usage.Size)
  }
}

function normalizeNetwork(raw: unknown): DockerNetworkRow {
  const info = asRecord(raw)
  const labels = parseLabelString(info.Labels)
  const containers = asRecord(info.Containers)
  return {
    id: str(info.ID ?? info.Id),
    name: str(info.Name),
    driver: str(info.Driver),
    scope: str(info.Scope),
    internal: bool(info.Internal),
    ipv6: bool(info.IPv6),
    createdAt: parseCliTimestamp(info.CreatedAt ?? info.Created),
    labels,
    containers: Object.keys(containers).length
  }
}

export interface DockerManagerOptions extends DockerTransportContext {}

export interface DockerManager {
  getStatus: () => DockerStatus
  onStatusChange: (cb: (status: DockerStatus) => void) => () => void
  onLogChunk: (cb: (chunk: DockerLogChunk) => void) => () => void
  onExecData: (cb: (data: DockerExecData) => void) => () => void
  onExecExit: (cb: (data: DockerExecExit) => void) => () => void
  connect: (endpoint: DockerEndpoint) => Promise<DockerStatus>
  disconnect: () => Promise<DockerStatus>
  listContainers: () => Promise<DockerContainerRow[]>
  inspectContainer: (id: string) => Promise<DockerContainerDetail>
  containerAction: (id: string, action: DockerContainerAction) => Promise<{ ok: boolean }>
  removeContainer: (
    id: string,
    opts?: { force?: boolean; volumes?: boolean }
  ) => Promise<{ ok: boolean }>
  startLogs: (opts: DockerStartLogsOpts) => Promise<{ sessionId: string }>
  stopLogs: (sessionId: string) => boolean
  startExec: (opts: DockerStartExecOpts) => Promise<{ sessionId: string }>
  writeExec: (sessionId: string, dataBase64: string) => boolean
  resizeExec: (sessionId: string, cols: number, rows: number) => boolean
  stopExec: (sessionId: string) => boolean
  stats: (containerId: string) => Promise<DockerStatsRow>
  listImages: () => Promise<DockerImageRow[]>
  pullImage: (reference: string) => Promise<{ ok: boolean }>
  removeImage: (id: string, force?: boolean) => Promise<{ ok: boolean }>
  listVolumes: () => Promise<DockerVolumeRow[]>
  removeVolume: (name: string, force?: boolean) => Promise<{ ok: boolean }>
  listNetworks: () => Promise<DockerNetworkRow[]>
  removeNetwork: (id: string) => Promise<{ ok: boolean }>
  info: () => Promise<DockerSystemInfo>
  version: () => Promise<DockerVersionInfo>
  stop: () => void
}

export function createDockerManager(options: DockerManagerOptions): DockerManager {
  let status: DockerStatus = {
    state: 'disconnected',
    endpointId: null,
    endpointName: null,
    endpointType: null,
    backend: null,
    detail: null
  }
  let session: DockerSession | null = null
  const logSessions = new Map<string, LogSession>()
  const execSessions = new Map<string, ExecSession>()
  const statusListeners = new Set<(status: DockerStatus) => void>()
  const logListeners = new Set<(chunk: DockerLogChunk) => void>()
  const execDataListeners = new Set<(data: DockerExecData) => void>()
  const execExitListeners = new Set<(data: DockerExecExit) => void>()

  function emitStatus(next: DockerStatus): void {
    status = next
    for (const cb of statusListeners) cb(status)
  }

  function emitLog(chunk: DockerLogChunk): void {
    for (const cb of logListeners) cb(chunk)
  }

  function emitExecData(data: DockerExecData): void {
    for (const cb of execDataListeners) cb(data)
  }

  function emitExecExit(data: DockerExecExit): void {
    for (const cb of execExitListeners) cb(data)
  }

  function requireSession(): DockerSession {
    if (!session) throw new Error('DOCKER_NOT_CONNECTED')
    return session
  }

  function requireEngine(): Dockerode {
    const current = requireSession()
    if (!current.engine) throw new Error('DOCKER_ENGINE_UNAVAILABLE')
    return current.engine
  }

  function requireCli(): NonNullable<DockerSession['cli']> {
    const current = requireSession()
    if (!current.cli) throw new Error('DOCKER_CLI_UNAVAILABLE')
    return current.cli
  }

  function stopAllStreams(): void {
    for (const [id, log] of [...logSessions]) {
      log.stop()
      logSessions.delete(id)
    }
    for (const [id, exec] of [...execSessions]) {
      exec.stop()
      execSessions.delete(id)
    }
  }

  function teardownSession(): void {
    stopAllStreams()
    if (session) {
      try {
        session.close()
      } catch {
        // ignore
      }
      session = null
    }
  }

  return {
    getStatus(): DockerStatus {
      return status
    },

    onStatusChange(cb): () => void {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },

    onLogChunk(cb): () => void {
      logListeners.add(cb)
      return () => logListeners.delete(cb)
    },

    onExecData(cb): () => void {
      execDataListeners.add(cb)
      return () => execDataListeners.delete(cb)
    },

    onExecExit(cb): () => void {
      execExitListeners.add(cb)
      return () => execExitListeners.delete(cb)
    },

    async connect(endpoint: DockerEndpoint): Promise<DockerStatus> {
      teardownSession()
      emitStatus({
        state: 'connecting',
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        endpointType: endpoint.type,
        backend: null,
        detail: null
      })
      try {
        const opened = await openDockerSession(endpoint, options)
        session = opened
        emitStatus({
          state: 'connected',
          endpointId: endpoint.id,
          endpointName: endpoint.name,
          endpointType: endpoint.type,
          backend: opened.backend,
          detail: opened.detail,
          tty: opened.capabilities.ttyExec,
          connectedAt: Date.now()
        })
        return status
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emitStatus({
          state: 'error',
          endpointId: endpoint.id,
          endpointName: endpoint.name,
          endpointType: endpoint.type,
          backend: null,
          detail: null,
          error: message
        })
        throw err
      }
    },

    async disconnect(): Promise<DockerStatus> {
      teardownSession()
      emitStatus({
        state: 'disconnected',
        endpointId: null,
        endpointName: null,
        endpointType: null,
        backend: null,
        detail: null
      })
      return status
    },

    async listContainers(): Promise<DockerContainerRow[]> {
      const current = requireSession()
      if (current.backend === 'cli') {
        const rows = await requireCli().runJsonLines<Record<string, unknown>>([
          'ps',
          '-a',
          '--no-trunc',
          '--format',
          '{{json .}}'
        ])
        return rows.map(normalizeCliContainer)
      }
      const list = await requireEngine().listContainers({ all: true })
      return list.map(normalizeContainerInfo)
    },

    async inspectContainer(id: string): Promise<DockerContainerDetail> {
      const current = requireSession()
      if (current.backend === 'cli') {
        const raw = await requireCli().runJson<Record<string, unknown>>([
          'inspect',
          id,
          '--format',
          '{{json .}}'
        ])
        return normalizeInspect(raw)
      }
      const info = await requireEngine().getContainer(id).inspect()
      return normalizeInspect(info)
    },

    async containerAction(id: string, action: DockerContainerAction): Promise<{ ok: boolean }> {
      const current = requireSession()
      if (current.backend === 'cli') {
        await requireCli().run([action, id])
        return { ok: true }
      }
      const container = requireEngine().getContainer(id)
      switch (action) {
        case 'start':
          await container.start()
          break
        case 'stop':
          await container.stop({ t: 10 })
          break
        case 'restart':
          await container.restart({ t: 10 })
          break
        case 'kill':
          await container.kill()
          break
        case 'pause':
          await container.pause()
          break
        case 'unpause':
          await container.unpause()
          break
        default:
          throw new Error('DOCKER_ACTION_INVALID')
      }
      return { ok: true }
    },

    async removeContainer(
      id: string,
      opts?: { force?: boolean; volumes?: boolean }
    ): Promise<{ ok: boolean }> {
      const current = requireSession()
      const force = opts?.force ?? false
      const volumes = opts?.volumes ?? false
      if (current.backend === 'cli') {
        const args = ['rm']
        if (force) args.push('-f')
        if (volumes) args.push('-v')
        args.push(id)
        await requireCli().run(args)
        return { ok: true }
      }
      await requireEngine().getContainer(id).remove({ v: volumes, force })
      return { ok: true }
    },

    async startLogs(opts: DockerStartLogsOpts): Promise<{ sessionId: string }> {
      const current = requireSession()
      const sessionId = randomUUID()
      const follow = opts.follow ?? true
      const tail = opts.tail ?? 200

      if (current.backend === 'cli') {
        const child = requireCli().spawnStream([
          'logs',
          '--timestamps',
          '--tail',
          String(tail),
          ...(follow ? ['-f'] : []),
          opts.containerId
        ])
        const onData = (chunk: Buffer): void => {
          emitLog({ sessionId, data: chunk.toString('base64') })
        }
        child.stdout?.on('data', onData)
        child.stderr?.on('data', onData)
        const stop = (): void => {
          try {
            child.kill()
          } catch {
            // ignore
          }
        }
        child.on('close', () => {
          logSessions.delete(sessionId)
        })
        logSessions.set(sessionId, { sessionId, stop })
        return { sessionId }
      }

      const stream = (await requireEngine().getContainer(opts.containerId).logs({
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
        tail
      })) as unknown as NodeJS.ReadableStream
      const readable = demuxDockerStream(stream)
      let stopped = false
      readable.on('data', (chunk: Buffer) => {
        emitLog({ sessionId, data: chunk.toString('base64') })
        if (!follow && !stopped) {
          stopped = true
          const log = logSessions.get(sessionId)
          if (log) {
            logSessions.delete(sessionId)
            log.stop()
          }
        }
      })
      const stop = (): void => {
        try {
          readable.destroy()
        } catch {
          // ignore
        }
        try {
          ;(stream as unknown as { destroy?: () => void }).destroy?.()
        } catch {
          // ignore
        }
      }
      readable.on('close', () => {
        logSessions.delete(sessionId)
      })
      logSessions.set(sessionId, { sessionId, stop })
      return { sessionId }
    },

    stopLogs(sessionId: string): boolean {
      const log = logSessions.get(sessionId)
      if (!log) return false
      logSessions.delete(sessionId)
      log.stop()
      return true
    },

    async startExec(opts: DockerStartExecOpts): Promise<{ sessionId: string }> {
      const current = requireSession()
      const sessionId = randomUUID()
      const shell = opts.shell || 'sh'
      const cmd = opts.cmd && opts.cmd.length ? opts.cmd : [shell]
      const tty = opts.tty ?? current.capabilities.ttyExec

      if (current.backend === 'cli') {
        // `docker exec -t` needs a TTY on our side too. `script` allocates a
        // pseudo terminal inside the distribution, which gives the container a
        // real TTY (full job control, no "no job control" warning).
        const usePty = current.capabilities.ttyExec && POSIX_SHELLS.includes(cmd[0])
        const child = usePty
          ? requireCli().spawnRaw([
              'script',
              '-qefc',
              `docker exec -it ${opts.containerId} ${cmd[0]}`,
              '/dev/null'
            ])
          : requireCli().spawnStream([
              'exec',
              '-i',
              opts.containerId,
              // Without a TTY the shell would not print a prompt.
              ...(POSIX_SHELLS.includes(cmd[0]) ? [cmd[0], '-i'] : cmd)
            ])
        const onData = (chunk: Buffer): void => {
          emitExecData({ sessionId, data: chunk.toString('base64') })
        }
        child.stdout?.on('data', onData)
        child.stderr?.on('data', onData)
        const stop = (): void => {
          try {
            child.kill()
          } catch {
            // ignore
          }
        }
        child.on('close', (code) => {
          execSessions.delete(sessionId)
          emitExecExit({ sessionId, reason: typeof code === 'number' ? `exit-${code}` : undefined })
        })
        execSessions.set(sessionId, {
          sessionId,
          stream: child.stdin ?? new PassThrough(),
          stop
        })
        return { sessionId }
      }

      const container = requireEngine().getContainer(opts.containerId)
      const exec = await container.exec({
        Cmd: cmd,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: tty
      })
      const stream = (await exec.start({
        hijack: true,
        stdin: true,
        Tty: tty
      })) as unknown as Duplex | null
      if (!stream) throw new Error('DOCKER_EXEC_FAILED')
      const readable = tty ? stream : demuxDockerStream(stream)
      readable.on('data', (chunk: Buffer) => {
        emitExecData({ sessionId, data: chunk.toString('base64') })
      })
      const stop = (): void => {
        try {
          readable.destroy()
        } catch {
          // ignore
        }
        try {
          stream.end()
        } catch {
          // ignore
        }
        try {
          stream.destroy()
        } catch {
          // ignore
        }
      }
      readable.on('close', () => {
        execSessions.delete(sessionId)
        emitExecExit({ sessionId })
      })
      execSessions.set(sessionId, {
        sessionId,
        stream: stream as unknown as NodeJS.WritableStream,
        stop
      })
      return { sessionId }
    },

    writeExec(sessionId: string, dataBase64: string): boolean {
      const exec = execSessions.get(sessionId)
      if (!exec) return false
      try {
        exec.stream.write(Buffer.from(dataBase64, 'base64'))
        return true
      } catch {
        return false
      }
    },

    resizeExec(): boolean {
      // Docker exec sessions do not support resizing; the renderer keeps the
      // terminal size for display purposes only.
      return false
    },

    stopExec(sessionId: string): boolean {
      const exec = execSessions.get(sessionId)
      if (!exec) return false
      execSessions.delete(sessionId)
      exec.stop()
      return true
    },

    async stats(containerId: string): Promise<DockerStatsRow> {
      const current = requireSession()
      if (current.backend === 'cli') {
        const raw = await requireCli().runJson<Record<string, unknown>>([
          'stats',
          '--no-stream',
          '--format',
          '{{json .}}',
          containerId
        ])
        const memUsage = str(raw.MemUsage)
        const [used, limit] = memUsage.split('/').map((part) => parseSizeString(part.trim()))
        const net = str(raw.NetIO)
          .split('/')
          .map((part) => parseSizeString(part.trim()))
        const block = str(raw.BlockIO)
          .split('/')
          .map((part) => parseSizeString(part.trim()))
        return {
          id: str(raw.ID) || containerId,
          name: str(raw.Name) || containerId,
          cpuPercent: parseFloat(str(raw.CPUPerc).replace('%', '')) || 0,
          memoryUsage: used || 0,
          memoryLimit: limit || 0,
          memoryPercent: parseFloat(str(raw.MemPerc).replace('%', '')) || 0,
          networkRx: net[0] || 0,
          networkTx: net[1] || 0,
          blockRead: block[0] || 0,
          blockWrite: block[1] || 0,
          pids: num(raw.PIDs)
        }
      }
      const raw = asRecord(await requireEngine().getContainer(containerId).stats({ stream: false }))
      const cpu = asRecord(raw.cpu_stats)
      const preCpu = asRecord(raw.precpu_stats)
      const cpuUsage = asRecord(asRecord(cpu.cpu_usage))
      const preCpuUsage = asRecord(asRecord(preCpu.cpu_usage))
      const systemCpu = num(asRecord(cpu.system_cpu_usage).usage)
      const preSystemCpu = num(asRecord(preCpu.system_cpu_usage).usage)
      const cpuDelta = num(cpuUsage.total_usage) - num(preCpuUsage.total_usage)
      const systemDelta = systemCpu - preSystemCpu
      const cores = num(asRecord(raw.cpu_stats).online_cpus) || 1
      const cpuPercent =
        systemDelta > 0 && cpuDelta > 0 ? Math.min(100, (cpuDelta / systemDelta) * cores * 100) : 0
      const memory = asRecord(raw.memory_stats)
      const memoryUsage = num(memory.usage)
      const memoryLimit = num(memory.limit)
      const networks = asRecord(raw.networks)
      let networkRx = 0
      let networkTx = 0
      for (const entry of Object.values(networks)) {
        const net = asRecord(entry)
        networkRx += num(net.rx_bytes)
        networkTx += num(net.tx_bytes)
      }
      const blkio = asRecord(raw.blkio_stats)
      const ioEntries = Array.isArray(blkio.io_service_bytes_recursive)
        ? blkio.io_service_bytes_recursive
        : []
      let blockRead = 0
      let blockWrite = 0
      for (const raw2 of ioEntries) {
        const entry = asRecord(raw2)
        if (str(entry.op).toLowerCase() === 'read') blockRead += num(entry.value)
        else blockWrite += num(entry.value)
      }
      return {
        id: str(raw.id) || containerId,
        name: str(raw.name).replace(/^\//, '') || containerId,
        cpuPercent,
        memoryUsage,
        memoryLimit,
        memoryPercent: memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0,
        networkRx,
        networkTx,
        blockRead,
        blockWrite,
        pids: num(asRecord(raw.pids_stats).current)
      }
    },

    async listImages(): Promise<DockerImageRow[]> {
      const current = requireSession()
      if (current.backend === 'cli') {
        const rows = await requireCli().runJsonLines<Record<string, unknown>>([
          'images',
          '--no-trunc',
          '--format',
          '{{json .}}'
        ])
        return rows.map(normalizeCliImage)
      }
      const list = await requireEngine().listImages()
      return list.map(normalizeImageInfo)
    },

    async pullImage(reference: string): Promise<{ ok: boolean }> {
      const ref = reference.trim()
      if (!ref) throw new Error('DOCKER_IMAGE_REF_REQUIRED')
      const current = requireSession()
      if (current.backend === 'cli') {
        await requireCli().run(['pull', ref], 15 * 60 * 1000)
        return { ok: true }
      }
      const stream = await requireEngine().pull(ref)
      await new Promise<void>((resolve, reject) => {
        stream.on('data', () => undefined)
        stream.on('end', () => resolve())
        stream.on('error', (err) => reject(err))
      })
      return { ok: true }
    },

    async removeImage(id: string, force = false): Promise<{ ok: boolean }> {
      const current = requireSession()
      if (current.backend === 'cli') {
        await requireCli().run(['rmi', ...(force ? ['-f'] : []), id])
        return { ok: true }
      }
      await requireEngine().getImage(id).remove({ force })
      return { ok: true }
    },

    async listVolumes(): Promise<DockerVolumeRow[]> {
      const current = requireSession()
      if (current.backend === 'cli') {
        const rows = await requireCli().runJsonLines<Record<string, unknown>>([
          'volume',
          'ls',
          '--format',
          '{{json .}}'
        ])
        return rows.map(normalizeVolume)
      }
      const list = await requireEngine().listVolumes()
      return (list.Volumes ?? []).map(normalizeVolume)
    },

    async removeVolume(name: string, force = false): Promise<{ ok: boolean }> {
      const current = requireSession()
      if (current.backend === 'cli') {
        await requireCli().run(['volume', 'rm', ...(force ? ['-f'] : []), name])
        return { ok: true }
      }
      await requireEngine().getVolume(name).remove({ force })
      return { ok: true }
    },

    async listNetworks(): Promise<DockerNetworkRow[]> {
      const current = requireSession()
      if (current.backend === 'cli') {
        const rows = await requireCli().runJsonLines<Record<string, unknown>>([
          'network',
          'ls',
          '--no-trunc',
          '--format',
          '{{json .}}'
        ])
        return rows.map(normalizeNetwork)
      }
      const list = await requireEngine().listNetworks()
      return list.map(normalizeNetwork)
    },

    async removeNetwork(id: string): Promise<{ ok: boolean }> {
      const current = requireSession()
      if (current.backend === 'cli') {
        await requireCli().run(['network', 'rm', id])
        return { ok: true }
      }
      await requireEngine().getNetwork(id).remove()
      return { ok: true }
    },

    async info(): Promise<DockerSystemInfo> {
      const current = requireSession()
      if (current.backend === 'cli') {
        const raw = asRecord(
          await requireCli().runJson<Record<string, unknown>>(['info', '--format', '{{json .}}'])
        )
        return {
          name: str(raw.Name),
          serverVersion: str(raw.ServerVersion),
          os: str(raw.OSType),
          arch: str(raw.Architecture),
          cpus: num(raw.NCPU),
          memory: num(raw.MemTotal),
          containers: num(raw.Containers),
          containersRunning: num(raw.ContainersRunning),
          containersPaused: num(raw.ContainersPaused),
          containersStopped: num(raw.ContainersStopped),
          images: num(raw.Images),
          driver: str(raw.Driver),
          dockerRootDir: str(raw.DockerRootDir),
          kernelVersion: str(raw.KernelVersion),
          operatingSystem: str(raw.OperatingSystem)
        }
      }
      const raw = asRecord(await requireEngine().info())
      return {
        name: str(raw.Name),
        serverVersion: str(raw.ServerVersion),
        os: str(raw.OSType),
        arch: str(raw.Architecture),
        cpus: num(raw.NCPU),
        memory: num(raw.MemTotal),
        containers: num(raw.Containers),
        containersRunning: num(raw.ContainersRunning),
        containersPaused: num(raw.ContainersPaused),
        containersStopped: num(raw.ContainersStopped),
        images: num(raw.Images),
        driver: str(raw.Driver),
        dockerRootDir: str(raw.DockerRootDir),
        kernelVersion: str(raw.KernelVersion),
        operatingSystem: str(raw.OperatingSystem)
      }
    },

    async version(): Promise<DockerVersionInfo> {
      const current = requireSession()
      if (current.backend === 'cli') {
        const raw = asRecord(
          await requireCli().runJson<Record<string, unknown>>(['version', '--format', '{{json .}}'])
        )
        const client = asRecord(raw.Client)
        const server = asRecord(raw.Server)
        return {
          version: str(client.Version) || str(server.Version),
          apiVersion: str(client.ApiVersion) || str(server.ApiVersion),
          os: str(client.Os) || str(server.Os),
          arch: str(client.Arch) || str(server.Arch)
        }
      }
      const raw = asRecord(await requireEngine().version())
      return {
        version: str(raw.Version),
        apiVersion: str(raw.ApiVersion),
        os: str(raw.Os),
        arch: str(raw.Arch)
      }
    },

    stop(): void {
      teardownSession()
      status = {
        state: 'disconnected',
        endpointId: null,
        endpointName: null,
        endpointType: null,
        backend: null,
        detail: null
      }
    }
  }
}
