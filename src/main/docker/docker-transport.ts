import { createServer, type Server as NetServer, type Socket } from 'net'
import { connect as tlsConnect, type TLSSocket } from 'tls'
import { promises as fsp } from 'fs'
import type { Duplex } from 'stream'
import Docker from 'dockerode'
import type { Client } from 'ssh2'
import { connectViaJump, endClientChain } from '../ssh-connect'
import type { SshNode } from '../ssh-store'
import { assertAllowedLocalPath } from '../path-allowlist'
import { DockerCli, resolveWslAddress } from './docker-cli'
import {
  DEFAULT_DOCKER_PIPE_PATH,
  DEFAULT_DOCKER_SOCKET_PATH,
  DEFAULT_DOCKER_TCP_PORT
} from './docker-constants'
import type { DockerEndpoint } from './docker-store'

export type DockerBackend = 'engine' | 'cli'

export interface DockerCapabilities {
  /** Interactive shell with a real TTY */
  ttyExec: boolean
  /** Continuously streamed resource usage */
  streamStats: boolean
  followLogs: boolean
  pull: boolean
  inspect: boolean
}

export interface DockerSession {
  endpoint: DockerEndpoint
  backend: DockerBackend
  capabilities: DockerCapabilities
  engine?: Docker
  cli?: DockerCli
  /** Human readable description of the established transport */
  detail: string
  close: () => void
}

export interface DockerTransportContext {
  getSshNode: (id: string) => SshNode | null | undefined
  verifyHostKey?: (host: string, port: number, key: Buffer) => boolean | Promise<boolean>
}

export const ENGINE_CAPABILITIES: DockerCapabilities = {
  ttyExec: true,
  streamStats: true,
  followLogs: true,
  pull: true,
  inspect: true
}

export const CLI_CAPABILITIES: DockerCapabilities = {
  ttyExec: false,
  streamStats: false,
  followLogs: true,
  pull: true,
  inspect: true
}

type StreamOpener = (cb: (err: Error | null, stream: Duplex | null) => void) => void

interface LocalProxy {
  port: number
  close: () => void
}

/**
 * Bridge a remote byte stream to a loopback TCP port so that the Docker
 * Engine API client can talk to it over plain HTTP.
 *
 * Using a local proxy (instead of a custom http.Agent) keeps error handling
 * explicit: a failed remote connection simply destroys the socket.
 */
async function createLocalProxy(open: StreamOpener): Promise<LocalProxy> {
  const sockets = new Set<Socket>()
  const server: NetServer = createServer((socket) => {
    sockets.add(socket)
    socket.setNoDelay(true)
    open((err, stream) => {
      if (err || !stream) {
        socket.destroy()
        return
      }
      socket.pipe(stream)
      stream.pipe(socket)
      const teardown = (): void => {
        socket.destroy()
        stream.destroy()
      }
      socket.on('error', teardown)
      socket.on('close', teardown)
      stream.on('error', teardown)
      stream.on('close', teardown)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    port,
    close: () => {
      for (const socket of sockets) {
        try {
          socket.destroy()
        } catch {
          // ignore
        }
      }
      sockets.clear()
      server.close()
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}

async function probeEngine(docker: Docker, timeoutMs = 10000): Promise<boolean> {
  try {
    await withTimeout(docker.version(), timeoutMs, 'DOCKER_PROBE_TIMEOUT')
    return true
  } catch {
    return false
  }
}

async function probeCli(cli: DockerCli, timeoutMs = 30000): Promise<boolean> {
  try {
    // The very first `wsl.exe` invocation may have to boot the distribution,
    // which can take a while — allow generous headroom for that cold start.
    await withTimeout(
      cli.run(['version', '--format', '{{json .}}'], timeoutMs),
      timeoutMs + 5000,
      'DOCKER_CLI_TIMEOUT'
    )
    return true
  } catch {
    return false
  }
}

function parsePipeCandidates(endpoint: DockerEndpoint): string[] {
  const configured = endpoint.pipePath?.trim() || DEFAULT_DOCKER_PIPE_PATH
  const candidates = [configured]
  if (configured === DEFAULT_DOCKER_PIPE_PATH) {
    candidates.push('//./pipe/dockerDesktopLinuxEngine')
  }
  return candidates
}

async function openPipeSession(
  endpoint: DockerEndpoint,
  closeables: Array<() => void>
): Promise<DockerSession | null> {
  for (const pipePath of parsePipeCandidates(endpoint)) {
    const docker = new Docker({ socketPath: pipePath })
    if (await probeEngine(docker)) {
      return {
        endpoint,
        backend: 'engine',
        capabilities: ENGINE_CAPABILITIES,
        engine: docker,
        detail: `pipe ${pipePath}`,
        close: () => {
          for (const close of closeables) close()
        }
      }
    }
  }
  return null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function openTcpSession(
  endpoint: DockerEndpoint,
  closeables: Array<() => void>
): Promise<DockerSession | null> {
  const host = endpoint.host?.trim()
  if (!host) return null
  const port = endpoint.port ?? DEFAULT_DOCKER_TCP_PORT
  const tls = endpoint.tls
  const useTls = Boolean(tls?.caPath || tls?.certPath || tls?.keyPath)

  if (useTls) {
    const readCert = async (path?: string): Promise<Buffer | undefined> => {
      if (!path) return undefined
      assertAllowedLocalPath(path)
      return fsp.readFile(path)
    }
    const ca = await readCert(tls?.caPath)
    const cert = await readCert(tls?.certPath)
    const key = await readCert(tls?.keyPath)
    if (!ca || !cert || !key) throw new Error('TLS_CERT_REQUIRED')
    const proxy = await createLocalProxy((cb) => {
      const socket: TLSSocket = tlsConnect({
        host,
        port,
        ca,
        cert,
        key,
        passphrase: tls?.keyPassphrase,
        servername: host
      })
      socket.once('secureConnect', () => cb(null, socket))
      socket.once('error', (err) => cb(err, null))
    })
    closeables.push(() => proxy.close())
    const docker = new Docker({ host: '127.0.0.1', port: proxy.port, protocol: 'http' })
    if (await probeEngine(docker)) {
      return {
        endpoint,
        backend: 'engine',
        capabilities: ENGINE_CAPABILITIES,
        engine: docker,
        detail: `tls ${host}:${port}`,
        close: () => {
          for (const close of closeables) close()
        }
      }
    }
    throw new Error('DOCKER_TLS_CONNECT_FAILED')
  }

  for (let round = 0; round < 2; round++) {
    const docker = new Docker({ host, port, protocol: 'http' })
    if (await probeEngine(docker)) {
      return {
        endpoint,
        backend: 'engine',
        capabilities: ENGINE_CAPABILITIES,
        engine: docker,
        detail: `tcp ${host}:${port}`,
        close: () => {
          for (const close of closeables) close()
        }
      }
    }
    if (round === 0) await delay(1200)
  }
  return null
}

async function openWslTcpSession(
  endpoint: DockerEndpoint,
  closeables: Array<() => void>
): Promise<DockerSession | null> {
  const port = endpoint.wslPort ?? DEFAULT_DOCKER_TCP_PORT
  const distro = endpoint.distro?.trim() ?? ''

  // The distribution may still be booting: the address changes between the
  // moments the VM starts and the network becomes usable, so retry a few times.
  for (let round = 0; round < 3; round++) {
    const candidates: string[] = []
    const address = await resolveWslAddress(distro)
    if (address) candidates.push(address)
    // WSL2 forwards Windows localhost connections to the distribution.
    candidates.push('127.0.0.1')

    for (const host of candidates) {
      const docker = new Docker({ host, port, protocol: 'http' })
      if (await probeEngine(docker, 6000)) {
        return {
          endpoint,
          backend: 'engine',
          capabilities: ENGINE_CAPABILITIES,
          engine: docker,
          detail: `wsl tcp ${host}:${port}`,
          close: () => {
            for (const close of closeables) close()
          }
        }
      }
    }
    await delay(1500)
  }
  return null
}

interface SshStrategy {
  id: string
  label: string
  open: StreamOpener
}

function buildSshStrategies(client: Client, endpoint: DockerEndpoint): SshStrategy[] {
  const strategies: SshStrategy[] = []

  // Preferred: the official Docker stdio bridge (same mechanism as `ssh://` contexts).
  strategies.push({
    id: 'dial-stdio',
    label: 'dial-stdio',
    open: (cb) => {
      client.exec('docker system dial-stdio', (err, stream) => {
        if (err || !stream) {
          cb(err ?? new Error('SSH_DIAL_STDIO_FAILED'), null)
          return
        }
        cb(null, stream)
      })
    }
  })

  const socketPath = endpoint.remoteSocketPath?.trim() || DEFAULT_DOCKER_SOCKET_PATH
  strategies.push({
    id: 'streamlocal',
    label: `unix:${socketPath}`,
    open: (cb) => {
      client.openssh_forwardOutStreamLocal(socketPath, (err, stream) => {
        if (err || !stream) {
          cb(err ?? new Error('SSH_STREAM_LOCAL_FAILED'), null)
          return
        }
        cb(null, stream)
      })
    }
  })

  const remoteHost = endpoint.remoteHost?.trim()
  const remotePort = endpoint.remotePort ?? DEFAULT_DOCKER_TCP_PORT
  if (remoteHost) {
    strategies.push({
      id: 'forward',
      label: `tcp:${remoteHost}:${remotePort}`,
      open: (cb) => {
        client.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (err, stream) => {
          if (err || !stream) {
            cb(err ?? new Error('SSH_FORWARD_FAILED'), null)
            return
          }
          cb(null, stream)
        })
      }
    })
  }

  return strategies
}

async function openSshSession(
  endpoint: DockerEndpoint,
  ctx: DockerTransportContext,
  closeables: Array<() => void>
): Promise<DockerSession | null> {
  const nodeId = endpoint.sshNodeId
  if (!nodeId) throw new Error('SSH_NODE_REQUIRED')
  const node = ctx.getSshNode(nodeId)
  if (!node) throw new Error('SSH_NODE_NOT_FOUND')

  const { client, jumpClients } = await connectViaJump(node, ctx.getSshNode, ctx.verifyHostKey)
  closeables.push(() => endClientChain(client, jumpClients))

  const strategies = buildSshStrategies(client, endpoint)
  let lastError: Error | null = null

  for (const strategy of strategies) {
    const proxy = await createLocalProxy(strategy.open)
    const docker = new Docker({ host: '127.0.0.1', port: proxy.port, protocol: 'http' })
    if (await probeEngine(docker, 12000)) {
      closeables.push(() => proxy.close())
      return {
        endpoint,
        backend: 'engine',
        capabilities: ENGINE_CAPABILITIES,
        engine: docker,
        detail: `ssh ${node.host} (${strategy.label})`,
        close: () => {
          for (const close of closeables) close()
        }
      }
    }
    proxy.close()
    lastError = new Error(`SSH_STRATEGY_FAILED:${strategy.id}`)
  }

  throw lastError ?? new Error('SSH_CONNECT_FAILED')
}

async function openWslCliSession(
  endpoint: DockerEndpoint,
  closeables: Array<() => void>
): Promise<DockerSession | null> {
  if (!DockerCli.supported()) throw new Error('WSL_UNSUPPORTED')
  const cli = new DockerCli(endpoint.distro?.trim() ?? '')
  if (await probeCli(cli)) {
    // `script` provides a pseudo terminal inside the distribution, which lets
    // `docker exec -it` hand a real TTY to the container.
    const hasPty = await cli.hasCommand('script')
    return {
      endpoint,
      backend: 'cli',
      capabilities: { ...CLI_CAPABILITIES, ttyExec: hasPty },
      cli,
      detail: `wsl cli ${endpoint.distro?.trim() || '(default)'}`,
      close: () => {
        for (const close of closeables) close()
      }
    }
  }
  return null
}

/**
 * Establish a Docker session for the given endpoint.
 *
 * Connection types map onto transports as follows:
 *  - `pipe` → Windows named pipe (`//./pipe/docker_engine`)
 *  - `tcp`  → plain TCP or TLS socket
 *  - `wsl`  → Docker CLI inside the distribution, or the daemon's TCP port
 *  - `ssh`  → SSH channel to the remote Docker socket
 */
export async function openDockerSession(
  endpoint: DockerEndpoint,
  ctx: DockerTransportContext
): Promise<DockerSession> {
  const closeables: Array<() => void> = []

  switch (endpoint.type) {
    case 'pipe': {
      const session = await openPipeSession(endpoint, closeables)
      if (session) return session
      throw new Error('DOCKER_PIPE_CONNECT_FAILED')
    }
    case 'tcp': {
      const session = await openTcpSession(endpoint, closeables)
      if (session) return session
      throw new Error('DOCKER_TCP_CONNECT_FAILED')
    }
    case 'wsl': {
      const mode = endpoint.wslMode ?? 'cli'
      if (mode === 'tcp') {
        const session = await openWslTcpSession(endpoint, closeables)
        if (session) return session
        throw new Error('DOCKER_WSL_TCP_CONNECT_FAILED')
      }
      const session = await openWslCliSession(endpoint, closeables)
      if (session) return session
      throw new Error('DOCKER_WSL_CLI_CONNECT_FAILED')
    }
    case 'ssh': {
      const session = await openSshSession(endpoint, ctx, closeables)
      if (session) return session
      throw new Error('DOCKER_SSH_CONNECT_FAILED')
    }
    default:
      throw new Error('DOCKER_ENDPOINT_TYPE_INVALID')
  }
}
