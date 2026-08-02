import { Client, type ConnectConfig, type ClientChannel } from 'ssh2'
import { createServer, connect, type Server as NetServer, type Socket } from 'net'
import { promises as fsp } from 'fs'
import { randomUUID } from 'crypto'
import type { SshNode, SshTunnelSpec, SshTunnelType } from './ssh-store'

export type { SshTunnelSpec, SshTunnelType } from './ssh-store'

export type SshTunnelStatusName = 'starting' | 'running' | 'error'

export interface SshTunnelState {
  id: string
  type: SshTunnelType
  status: SshTunnelStatusName
  error?: string
  localPort?: number
  listenAddr?: string
  remoteHost?: string
  remotePort?: number
  bindAddr?: string
  bindPort?: number
  targetHost?: string
  targetPort?: number
}

export type SshSessionStateName = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SshSessionStatus {
  nodeId: string
  nodeName: string
  host: string
  port: number
  username: string
  state: SshSessionStateName
  error?: string
  connectedAt?: number
  tunnels: SshTunnelState[]
}

export type SshLogLevel = 'info' | 'warn' | 'error'

export interface SshLogEntry {
  id: string
  time: number
  level: SshLogLevel
  nodeId: string
  nodeName: string
  message: string
}

const RETRY_DELAY = 3000
const MAX_RETRY = 10

function normalizeSshError(message: string): string {
  if (/host key|host denied|verification failed/i.test(message)) return 'HOST_KEY_MISMATCH'
  if (/authentication failed|all configured authentication|permission denied|unable to authenticate/i.test(message)) {
    return 'AUTH_FAILED'
  }
  return message
}

function isNonRecoverableError(error?: string): boolean {
  if (!error) return false
  if (error === 'HOST_KEY_MISMATCH' || error === 'AUTH_FAILED' || error === 'RECONNECT_EXHAUSTED') {
    return true
  }
  return /authentication failed|all configured authentication|permission denied|unable to authenticate/i.test(
    error
  )
}

interface TunnelRuntime {
  spec: SshTunnelSpec
  state: SshTunnelState
  server?: NetServer
  effectivePort?: number
}

interface SessionRuntime {
  node: SshNode
  client: Client | null
  state: SshSessionStateName
  error?: string
  connectedAt?: number
  everConnected: boolean
  stopRequested: boolean
  retryTimer?: NodeJS.Timeout
  retryCount: number
  pending: SshTunnelSpec[]
  tunnels: Map<string, TunnelRuntime>
  connectPromise?: Promise<void>
}

export interface SshManagerOptions {
  verifyHostKey?: (host: string, port: number, key: Buffer) => boolean
}

async function makeConnectConfig(
  node: SshNode,
  verifyHostKey?: SshManagerOptions['verifyHostKey']
): Promise<ConnectConfig> {
  const cfg: ConnectConfig = {
    host: node.host,
    port: node.port,
    username: node.username,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    readyTimeout: 15000,
    timeout: 30000
  }
  if (node.auth.type === 'password' && node.auth.password) {
    cfg.password = node.auth.password
  } else if (node.auth.type === 'privateKey' && node.auth.privateKeyPath) {
    cfg.privateKey = await fsp.readFile(node.auth.privateKeyPath)
    if (node.auth.passphrase) cfg.passphrase = node.auth.passphrase
  }
  if (verifyHostKey) {
    cfg.hostVerifier = (key: Buffer) => verifyHostKey(node.host, node.port, key)
  }
  return cfg
}

function tunnelStateFromSpec(spec: SshTunnelSpec): SshTunnelState {
  return {
    id: spec.id!,
    type: spec.type,
    status: 'starting',
    localPort: spec.localPort,
    listenAddr: spec.listenAddr,
    remoteHost: spec.remoteHost,
    remotePort: spec.remotePort,
    bindAddr: spec.bindAddr,
    bindPort: spec.bindPort,
    targetHost: spec.targetHost,
    targetPort: spec.targetPort
  }
}

function formatIpv6(bytes: Buffer): string {
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) {
    groups.push(bytes.readUInt16BE(i).toString(16))
  }
  return groups.join(':')
}

function handleSocks5(socket: Socket, client: Client): void {
  let stage: 'greeting' | 'request' | 'done' = 'greeting'
  let buffer = Buffer.alloc(0)
  const fail = (code: number): void => {
    stage = 'done'
    socket.removeListener('data', onData)
    if (!socket.destroyed) {
      socket.write(Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      socket.end()
    }
  }

  function onData(chunk: Buffer): void {
    if (stage === 'done') return
    buffer = Buffer.concat([buffer, chunk])

    if (stage === 'greeting') {
      if (buffer.length < 2) return
      const nmethods = buffer[1]
      if (buffer.length < 2 + nmethods) return
      socket.write(Buffer.from([0x05, 0x00]))
      buffer = buffer.subarray(2 + nmethods)
      stage = 'request'
    }

    if (stage !== 'request') return
    if (buffer.length < 4) return
    if (buffer[0] !== 0x05 || buffer[1] !== 0x01) {
      fail(0x07)
      return
    }
    const atyp = buffer[3]
    let host = ''
    let addrLen = 0
    if (atyp === 0x01) {
      if (buffer.length < 10) return
      addrLen = 4
      host = [...buffer.subarray(4, 8)].join('.')
    } else if (atyp === 0x03) {
      if (buffer.length < 5) return
      const len = buffer[4]
      if (buffer.length < 5 + len + 2) return
      addrLen = 1 + len
      host = buffer.subarray(5, 5 + len).toString()
    } else if (atyp === 0x04) {
      if (buffer.length < 22) return
      addrLen = 16
      host = formatIpv6(buffer.subarray(4, 20))
    } else {
      fail(0x08)
      return
    }
    const port = buffer.readUInt16BE(4 + addrLen)
    const leftover = buffer.subarray(4 + addrLen + 2)
    buffer = Buffer.alloc(0)
    stage = 'done'
    socket.removeListener('data', onData)

    client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
      if (err || !stream) {
        if (!socket.destroyed) {
          socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          socket.end()
        }
        return
      }
      if (socket.destroyed) {
        stream.destroy()
        return
      }
      socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      if (leftover.length > 0) stream.write(leftover)
      stream.pipe(socket).pipe(stream)
      stream.on('close', () => socket.destroy())
      socket.on('close', () => stream.end())
      socket.on('error', () => stream.destroy())
      stream.on('error', () => socket.destroy())
    })
  }

  socket.on('data', onData)
  socket.on('error', () => socket.destroy())
}

export interface SshManager {
  getStatus: () => SshSessionStatus[]
  connect: (node: SshNode, tunnels?: SshTunnelSpec[]) => Promise<SshSessionStatus>
  disconnect: (nodeId: string) => Promise<SshSessionStatus>
  disconnectAll: () => Promise<SshSessionStatus[]>
  addTunnel: (nodeId: string, spec: SshTunnelSpec) => Promise<SshSessionStatus>
  removeTunnel: (nodeId: string, tunnelId: string) => Promise<SshSessionStatus>
  startTunnel: (nodeId: string, spec: SshTunnelSpec) => Promise<SshSessionStatus>
  startTunnels: (nodeId: string, specs: SshTunnelSpec[]) => Promise<SshSessionStatus>
  stopTunnel: (nodeId: string, tunnelId: string) => Promise<SshSessionStatus>
  updateTunnel: (nodeId: string, spec: SshTunnelSpec) => Promise<SshSessionStatus>
  disconnectType: (nodeId: string, type: SshTunnelType) => Promise<SshSessionStatus>
  test: (node: SshNode) => Promise<{ ok: boolean; error?: string; latencyMs: number }>
  onStatusChange: (cb: (statuses: SshSessionStatus[]) => void) => () => void
  onLog: (cb: (entry: SshLogEntry) => void) => () => void
  stop: () => void
}

export function createSshManager(options: SshManagerOptions = {}): SshManager {
  const sessions = new Map<string, SessionRuntime>()
  const statusCbs = new Set<(statuses: SshSessionStatus[]) => void>()
  const logCbs = new Set<(entry: SshLogEntry) => void>()
  const disconnectRef: {
    fn: (nodeId: string) => Promise<SshSessionStatus>
  } = {
    fn: async (nodeId) => emptyStatus(nodeId)
  }

  function emitStatus(): void {
    const statuses = [...sessions.values()].map(sessionToStatus)
    for (const cb of statusCbs) cb(statuses)
  }

  function emitLog(nodeId: string, nodeName: string, level: SshLogLevel, message: string): void {
    const entry: SshLogEntry = {
      id: randomUUID(),
      time: Date.now(),
      level,
      nodeId,
      nodeName,
      message
    }
    for (const cb of logCbs) cb(entry)
  }

  function sessionToStatus(session: SessionRuntime): SshSessionStatus {
    return {
      nodeId: session.node.id,
      nodeName: session.node.name,
      host: session.node.host,
      port: session.node.port,
      username: session.node.username,
      state: session.state,
      error: session.error,
      connectedAt: session.connectedAt,
      tunnels: [...session.tunnels.values()].map((t) => t.state)
    }
  }

  function emptyStatus(nodeId: string): SshSessionStatus {
    return {
      nodeId,
      nodeName: '',
      host: '',
      port: 22,
      username: '',
      state: 'disconnected',
      tunnels: []
    }
  }

  function clearRetry(session: SessionRuntime): void {
    if (session.retryTimer) {
      clearTimeout(session.retryTimer)
      session.retryTimer = undefined
    }
  }

  function mergePending(session: SessionRuntime, tunnels: SshTunnelSpec[]): void {
    const byId = new Map<string, SshTunnelSpec>()
    const withoutId: SshTunnelSpec[] = []
    for (const spec of [...session.pending, ...tunnels]) {
      if (spec.id) byId.set(spec.id, spec)
      else withoutId.push(spec)
    }
    session.pending = [...byId.values(), ...withoutId]
  }

  function capturePendingFromLive(session: SessionRuntime): void {
    const byId = new Map<string, SshTunnelSpec>()
    for (const rt of session.tunnels.values()) {
      if (rt.spec.id) byId.set(rt.spec.id, rt.spec)
    }
    for (const spec of session.pending) {
      if (spec.id) byId.set(spec.id, spec)
    }
    session.pending = [...byId.values(), ...session.pending.filter((s) => !s.id)]
  }

  function teardownTunnels(session: SessionRuntime): void {
    for (const rt of session.tunnels.values()) {
      if (rt.server) {
        rt.server.close()
        rt.server = undefined
      }
    }
  }

  function stopRuntime(session: SessionRuntime, rt: TunnelRuntime): void {
    if (rt.server) {
      rt.server.close()
      rt.server = undefined
    }
    if (session.client && rt.state.type === 'remote' && rt.effectivePort != null) {
      session.client.unforwardIn(rt.state.bindAddr || '127.0.0.1', rt.effectivePort, () => {})
    }
    session.tunnels.delete(rt.state.id)
  }

  function hasActiveTunnels(session: SessionRuntime): boolean {
    return [...session.tunnels.values()].some(
      (rt) => rt.state.status === 'running' || rt.state.status === 'starting'
    )
  }

  async function disconnectIfIdle(session: SessionRuntime): Promise<SshSessionStatus> {
    if (session.state === 'connected' && !hasActiveTunnels(session)) {
      return disconnectRef.fn(session.node.id)
    }
    emitStatus()
    return sessionToStatus(session)
  }

  function bindTunnel(session: SessionRuntime, spec: SshTunnelSpec): void {
    const client = session.client
    if (!client) return
    const state = tunnelStateFromSpec(spec)
    const rt: TunnelRuntime = { spec, state }
    session.tunnels.set(state.id, rt)
    const setError = (err: Error): void => {
      state.status = 'error'
      state.error = err.message
      emitLog(session.node.id, session.node.name, 'error', `隧道失败: ${err.message}`)
      emitStatus()
      if (session.state === 'connected' && !hasActiveTunnels(session)) {
        void disconnectRef.fn(session.node.id)
      }
    }

    try {
      if (spec.type === 'local') {
        const server = createServer((socket) => {
          client.forwardOut(
            '127.0.0.1',
            socket.localPort ?? 0,
            spec.remoteHost!,
            spec.remotePort!,
            (err, stream) => {
              if (err || !stream) {
                socket.destroy()
                return
              }
              stream.pipe(socket).pipe(stream)
              stream.on('close', () => socket.destroy())
              socket.on('close', () => stream.end())
              socket.on('error', () => stream.destroy())
              stream.on('error', () => socket.destroy())
            }
          )
        })
        const listenAddr = spec.listenAddr || '127.0.0.1'
        server.on('error', setError)
        server.listen(spec.localPort!, listenAddr, () => {
          state.status = 'running'
          state.listenAddr = listenAddr
          rt.effectivePort = spec.localPort
          emitStatus()
        })
        rt.server = server
      } else if (spec.type === 'remote') {
        const addr = spec.bindAddr || '127.0.0.1'
        client.forwardIn(addr, spec.bindPort!, (err, port) => {
          if (err) {
            setError(err)
            return
          }
          state.status = 'running'
          state.bindPort = port
          rt.effectivePort = port
          emitLog(
            session.node.id,
            session.node.name,
            'info',
            `远程转发已建立: 服务器 ${addr}:${port} → 本机 ${spec.targetHost || '127.0.0.1'}:${spec.targetPort}`
          )
          emitStatus()
        })
      } else {
        const server = createServer((socket) => handleSocks5(socket, client))
        const listenAddr = spec.listenAddr || '127.0.0.1'
        server.on('error', setError)
        server.listen(spec.localPort!, listenAddr, () => {
          state.status = 'running'
          state.listenAddr = listenAddr
          rt.effectivePort = spec.localPort
          emitStatus()
        })
        rt.server = server
      }
    } catch (err) {
      setError(err as Error)
    }
  }

  function scheduleReconnect(session: SessionRuntime): void {
    session.retryCount += 1
    if (session.retryCount > MAX_RETRY) {
      session.state = 'error'
      session.error = 'RECONNECT_EXHAUSTED'
      session.pending = []
      session.tunnels = new Map()
      emitLog(
        session.node.id,
        session.node.name,
        'error',
        `自动重连已达上限（${MAX_RETRY} 次），已停止`
      )
      emitStatus()
      return
    }
    session.state = 'connecting'
    session.error = undefined
    session.retryTimer = setTimeout(() => {
      session.retryTimer = undefined
      if (session.stopRequested) return
      const p = doConnect(session)
      session.connectPromise = p
      p.catch(() => {}).finally(() => {
        if (session.connectPromise === p) session.connectPromise = undefined
      })
    }, RETRY_DELAY)
    emitLog(
      session.node.id,
      session.node.name,
      'warn',
      `连接断开，3 秒后自动重连（${session.retryCount}/${MAX_RETRY}）...`
    )
    emitStatus()
  }

  async function doConnect(session: SessionRuntime): Promise<void> {
    let cfg: ConnectConfig
    try {
      cfg = await makeConnectConfig(session.node, options.verifyHostKey)
    } catch (err) {
      if (session.stopRequested) return
      session.state = 'error'
      session.error = (err as Error).message
      emitLog(session.node.id, session.node.name, 'error', `连接失败: ${(err as Error).message}`)
      emitStatus()
      throw err
    }
    if (session.stopRequested) return

    return new Promise((resolve, reject) => {
      let settled = false
      const succeed = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        reject(err)
      }

      const client = new Client()
      session.client = client

      client.on('ready', () => {
        if (session.stopRequested || session.client !== client) {
          try {
            client.end()
          } catch {
            // ignore
          }
          succeed()
          return
        }
        session.state = 'connected'
        session.error = undefined
        session.everConnected = true
        session.connectedAt = Date.now()
        session.retryCount = 0
        clearRetry(session)
        emitLog(
          session.node.id,
          session.node.name,
          'info',
          `已建立 SSH 连接: ${session.node.username}@${session.node.host}:${session.node.port}`
        )
        const seen = new Set<string>()
        const specs = session.pending.filter((s) => {
          if (!s.id) return true
          if (seen.has(s.id)) return false
          seen.add(s.id)
          return true
        })
        session.pending = []
        teardownTunnels(session)
        session.tunnels = new Map()
        emitStatus()
        for (const spec of specs) {
          bindTunnel(session, spec)
        }
        succeed()
      })

      client.on('tcp connection', (details, accept, rejectTcp) => {
        if (session.client !== client) {
          rejectTcp()
          return
        }
        const rt = [...session.tunnels.values()].find(
          (t) => t.state.type === 'remote' && t.effectivePort === details.destPort
        )
        if (!rt) {
          rejectTcp()
          return
        }
        const host = rt.spec.targetHost || '127.0.0.1'
        const port = rt.spec.targetPort!
        const local = connect({ host, port })
        local.on('connect', () => {
          let stream: ClientChannel
          try {
            stream = accept()
          } catch {
            local.destroy()
            return
          }
          stream.pipe(local).pipe(stream)
          stream.on('close', () => local.destroy())
          local.on('close', () => stream.end())
          local.on('error', () => stream.destroy())
          stream.on('error', () => local.destroy())
        })
        local.on('error', () => rejectTcp())
      })

      client.on('error', (err) => {
        if (session.client !== client) return
        const message = normalizeSshError(err.message)
        session.error = message
        if (session.state === 'connecting') {
          session.state = 'error'
          emitLog(
            session.node.id,
            session.node.name,
            'error',
            message === 'HOST_KEY_MISMATCH'
              ? '主机密钥不匹配，可能存在安全风险。可在节点编辑中重置信任后重试'
              : message === 'AUTH_FAILED'
                ? '认证失败，请检查用户名、密码或私钥'
                : `连接失败: ${err.message}`
          )
          emitStatus()
          fail(new Error(message))
        } else {
          emitStatus()
        }
      })

      client.on('close', () => {
        if (session.client !== client) return
        session.client = null
        teardownTunnels(session)
        if (session.stopRequested) {
          session.state = 'disconnected'
          session.error = undefined
          session.pending = []
          session.tunnels = new Map()
          emitStatus()
          succeed()
          return
        }
        if (session.everConnected) {
          if (isNonRecoverableError(session.error)) {
            session.state = 'error'
            session.pending = []
            session.tunnels = new Map()
            emitLog(
              session.node.id,
              session.node.name,
              'error',
              '遇到不可自动恢复的错误，已停止重连'
            )
            emitStatus()
            succeed()
            return
          }
          capturePendingFromLive(session)
          session.tunnels = new Map()
          scheduleReconnect(session)
          succeed()
        } else {
          session.state = 'error'
          const err = new Error(session.error || 'CONNECTION_CLOSED')
          if (!session.error) session.error = err.message
          emitStatus()
          fail(err)
        }
      })

      client.connect(cfg)
    })
  }

  const manager: SshManager = {
    getStatus(): SshSessionStatus[] {
      return [...sessions.values()].map(sessionToStatus)
    },
    async connect(node: SshNode, tunnels: SshTunnelSpec[] = []): Promise<SshSessionStatus> {
      let session = sessions.get(node.id)
      if (session && session.state === 'connected') {
        return this.startTunnels(node.id, tunnels)
      }
      if (session && session.state === 'connecting') {
        mergePending(session, tunnels)
        if (session.connectPromise) {
          try {
            await session.connectPromise
          } catch {
            // status already updated
          }
        }
        return sessionToStatus(session)
      }
      if (session) {
        session.node = node
        session.stopRequested = false
        clearRetry(session)
        session.state = 'connecting'
        session.error = undefined
        session.everConnected = false
        session.retryCount = 0
        session.pending = tunnels
        session.tunnels = new Map()
      } else {
        session = {
          node,
          client: null,
          state: 'connecting',
          error: undefined,
          everConnected: false,
          stopRequested: false,
          retryCount: 0,
          pending: tunnels,
          tunnels: new Map()
        }
        sessions.set(node.id, session)
      }
      emitStatus()
      const p = doConnect(session)
      session.connectPromise = p
      try {
        await p
      } catch (err) {
        if (session.state !== 'error') {
          session.state = 'error'
          session.error = (err as Error).message
          emitStatus()
        }
        throw err
      } finally {
        if (session.connectPromise === p) session.connectPromise = undefined
      }
      return sessionToStatus(session)
    },
    async disconnect(nodeId: string): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session) return emptyStatus(nodeId)
      session.stopRequested = true
      clearRetry(session)
      teardownTunnels(session)
      session.tunnels.clear()
      session.pending = []
      session.retryCount = 0
      session.state = 'disconnected'
      session.error = undefined
      session.everConnected = false
      session.connectedAt = undefined
      const client = session.client
      if (client) {
        client.end()
      }
      sessions.delete(nodeId)
      emitStatus()
      return emptyStatus(nodeId)
    },
    async disconnectAll(): Promise<SshSessionStatus[]> {
      const ids = [...sessions.keys()]
      for (const id of ids) {
        await this.disconnect(id)
      }
      return this.getStatus()
    },
    async addTunnel(nodeId: string, spec: SshTunnelSpec): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session) return emptyStatus(nodeId)
      const next: SshTunnelSpec = { ...spec, id: spec.id ?? randomUUID() }
      if (session.state === 'connecting') {
        if (next.id && !session.pending.some((p) => p.id === next.id)) {
          session.pending.push(next)
        }
        return sessionToStatus(session)
      }
      if (session.state !== 'connected' || !session.client) {
        return emptyStatus(nodeId)
      }
      if (!session.tunnels.has(next.id!)) {
        bindTunnel(session, next)
      }
      return sessionToStatus(session)
    },
    async startTunnel(nodeId: string, spec: SshTunnelSpec): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session) return emptyStatus(nodeId)
      if (session.state === 'connecting') {
        if (spec.id && !session.pending.some((p) => p.id === spec.id)) {
          session.pending.push(spec)
        }
        return sessionToStatus(session)
      }
      if (session.state !== 'connected' || !session.client) {
        return emptyStatus(nodeId)
      }
      if (!spec.id) return sessionToStatus(session)
      if (session.tunnels.has(spec.id)) {
        const rt = session.tunnels.get(spec.id)
        if (rt && rt.state.status === 'error') {
          session.tunnels.delete(spec.id)
          bindTunnel(session, spec)
        }
        return sessionToStatus(session)
      }
      bindTunnel(session, spec)
      return sessionToStatus(session)
    },
    async startTunnels(nodeId: string, specs: SshTunnelSpec[]): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session || session.state !== 'connected' || !session.client) {
        return emptyStatus(nodeId)
      }
      for (const spec of specs) {
        if (!spec.id) continue
        const rt = session.tunnels.get(spec.id)
        if (rt) {
          if (rt.state.status === 'error') {
            session.tunnels.delete(spec.id)
            bindTunnel(session, spec)
          }
          continue
        }
        bindTunnel(session, spec)
      }
      emitStatus()
      return sessionToStatus(session)
    },
    async stopTunnel(nodeId: string, tunnelId: string): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session) return emptyStatus(nodeId)
      const rt = session.tunnels.get(tunnelId)
      if (!rt) return sessionToStatus(session)
      stopRuntime(session, rt)
      return disconnectIfIdle(session)
    },
    async updateTunnel(nodeId: string, spec: SshTunnelSpec): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session || !spec.id) return emptyStatus(nodeId)
      session.pending = session.pending.filter((s) => s.id !== spec.id)
      const rt = session.tunnels.get(spec.id)
      const shouldRestart = !!rt
      if (rt) stopRuntime(session, rt)
      if (session.state === 'connecting') {
        session.pending.push(spec)
        emitStatus()
        return sessionToStatus(session)
      }
      if (session.state === 'connected' && session.client && shouldRestart) {
        bindTunnel(session, spec)
        emitStatus()
        return sessionToStatus(session)
      }
      return disconnectIfIdle(session)
    },
    async disconnectType(nodeId: string, type: SshTunnelType): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session) return emptyStatus(nodeId)
      for (const rt of [...session.tunnels.values()]) {
        if (rt.state.type === type) {
          stopRuntime(session, rt)
        }
      }
      return disconnectIfIdle(session)
    },
    async removeTunnel(nodeId: string, tunnelId: string): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session) return emptyStatus(nodeId)
      session.pending = session.pending.filter((s) => s.id !== tunnelId)
      const rt = session.tunnels.get(tunnelId)
      if (rt) stopRuntime(session, rt)
      return disconnectIfIdle(session)
    },
    test(node: SshNode): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
      return new Promise((resolve) => {
        const client = new Client()
        const started = Date.now()
        let settled = false
        const finish = (ok: boolean, error?: string): void => {
          if (settled) return
          settled = true
          client.end()
          resolve({ ok, error, latencyMs: Date.now() - started })
        }
        client.on('ready', () => finish(true))
        client.on('error', (err) => {
          finish(false, normalizeSshError(err.message))
        })
        makeConnectConfig(node, options.verifyHostKey)
          .then((cfg) => client.connect(cfg))
          .catch((err) => finish(false, err.message))
      })
    },
    onStatusChange(cb: (statuses: SshSessionStatus[]) => void): () => void {
      statusCbs.add(cb)
      return () => statusCbs.delete(cb)
    },
    onLog(cb: (entry: SshLogEntry) => void): () => void {
      logCbs.add(cb)
      return () => logCbs.delete(cb)
    },
    stop(): void {
      for (const session of sessions.values()) {
        session.stopRequested = true
        clearRetry(session)
        teardownTunnels(session)
        session.client?.end()
        session.client = null
      }
      sessions.clear()
    }
  }

  disconnectRef.fn = (nodeId) => manager.disconnect(nodeId)
  return manager
}
