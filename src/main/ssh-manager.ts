import { Client, type ConnectConfig, type ClientChannel } from 'ssh2'
import { createServer, connect, type Server as NetServer, type Socket } from 'net'
import { promises as fsp } from 'fs'
import { randomUUID } from 'crypto'
import type { SshNode, SshTunnelSpec, SshTunnelType } from './ssh-store'

export type { SshTunnelSpec, SshTunnelType } from './ssh-store'

export interface SshTunnelState {
  id: string
  type: SshTunnelType
  status: SshTunnelStatusName
  error?: string
  localPort?: number
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
  tunnels: Map<string, TunnelRuntime>
}

async function makeConnectConfig(node: SshNode): Promise<ConnectConfig> {
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
  return cfg
}

function tunnelStateFromSpec(spec: SshTunnelSpec): SshTunnelState {
  return {
    id: spec.id!,
    type: spec.type,
    status: 'starting',
    localPort: spec.localPort,
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
  let stage: 'greeting' | 'request' = 'greeting'
  let buffer = Buffer.alloc(0)
  const fail = (code: number): void => {
    if (!socket.destroyed) {
      socket.write(Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      socket.end()
    }
  }

  function onData(chunk: Buffer): void {
    buffer = Buffer.concat([buffer, chunk])

    if (stage === 'greeting') {
      if (buffer.length < 2) return
      const nmethods = buffer[1]
      if (buffer.length < 2 + nmethods) return
      socket.write(Buffer.from([0x05, 0x00]))
      buffer = buffer.subarray(2 + nmethods)
      stage = 'request'
    }

    if (stage === 'request') {
      if (buffer.length < 4) return
      if (buffer[0] !== 0x05 || buffer[1] !== 0x01) {
        fail(0x07)
        return
      }
      const atyp = buffer[3]
      let host = ''
      let addrLen = 0
      if (atyp === 0x01) {
        if (buffer.length < 8) return
        addrLen = 4
        host = [...buffer.subarray(4, 8)].join('.')
      } else if (atyp === 0x03) {
        if (buffer.length < 5) return
        const len = buffer[4]
        if (buffer.length < 5 + len + 2) return
        addrLen = 1 + len
        host = buffer.subarray(5, 5 + len).toString()
      } else if (atyp === 0x04) {
        if (buffer.length < 20) return
        addrLen = 16
        host = formatIpv6(buffer.subarray(4, 20))
      } else {
        fail(0x08)
        return
      }
      const port = buffer.readUInt16BE(4 + addrLen)
      client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
        if (err || !stream) {
          fail(0x05)
          return
        }
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        stream.pipe(socket).pipe(stream)
        stream.on('close', () => socket.destroy())
        socket.on('close', () => stream.end())
        socket.on('error', () => stream.destroy())
        stream.on('error', () => socket.destroy())
      })
    }
  }

  socket.on('data', onData)
  socket.on('error', () => socket.destroy())
}

export interface SshManager {
  getStatus: () => SshSessionStatus[]
  connect: (node: SshNode) => Promise<SshSessionStatus>
  disconnect: (nodeId: string) => Promise<SshSessionStatus>
  disconnectAll: () => Promise<SshSessionStatus[]>
  addTunnel: (nodeId: string, spec: SshTunnelSpec) => Promise<SshSessionStatus>
  removeTunnel: (nodeId: string, tunnelId: string) => Promise<SshSessionStatus>
  startTunnel: (nodeId: string, spec: SshTunnelSpec) => Promise<SshSessionStatus>
  stopTunnel: (nodeId: string, tunnelId: string) => Promise<SshSessionStatus>
  test: (node: SshNode) => Promise<{ ok: boolean; error?: string; latencyMs: number }>
  onStatusChange: (cb: (statuses: SshSessionStatus[]) => void) => () => void
  onLog: (cb: (entry: SshLogEntry) => void) => () => void
  stop: () => void
}

export function createSshManager(): SshManager {
  const sessions = new Map<string, SessionRuntime>()
  const statusCbs = new Set<(statuses: SshSessionStatus[]) => void>()
  const logCbs = new Set<(entry: SshLogEntry) => void>()

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

  function teardownTunnels(session: SessionRuntime): void {
    for (const rt of session.tunnels.values()) {
      if (rt.server) {
        rt.server.close()
        rt.server = undefined
      }
    }
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
        server.on('error', setError)
        server.listen(spec.localPort!, '127.0.0.1', () => {
          state.status = 'running'
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
        server.on('error', setError)
        server.listen(spec.localPort!, '127.0.0.1', () => {
          state.status = 'running'
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
    session.state = 'connecting'
    session.error = undefined
    session.retryTimer = setTimeout(() => {
      session.retryTimer = undefined
      if (session.stopRequested) return
      doConnect(session).catch(() => {})
    }, RETRY_DELAY)
    emitLog(session.node.id, session.node.name, 'warn', '连接断开，3 秒后自动重连...')
    emitStatus()
  }

  async function doConnect(session: SessionRuntime): Promise<void> {
    let cfg: ConnectConfig
    try {
      cfg = await makeConnectConfig(session.node)
    } catch (err) {
      if (session.stopRequested) return
      session.state = 'error'
      session.error = (err as Error).message
      emitLog(session.node.id, session.node.name, 'error', `连接失败: ${(err as Error).message}`)
      emitStatus()
      return
    }
    if (session.stopRequested) return
    const client = new Client()
    session.client = client

    client.on('ready', () => {
      session.state = 'connected'
      session.error = undefined
      session.everConnected = true
      session.connectedAt = Date.now()
      clearRetry(session)
      emitLog(
        session.node.id,
        session.node.name,
        'info',
        `已建立 SSH 连接: ${session.node.username}@${session.node.host}:${session.node.port}`
      )
      const specs = [...session.tunnels.values()].map((t) => t.spec)
      teardownTunnels(session)
      session.tunnels = new Map()
      emitStatus()
      for (const spec of specs) {
        bindTunnel(session, spec)
      }
    })

    client.on('tcp connection', (details, accept, reject) => {
      const rt = [...session.tunnels.values()].find(
        (t) => t.state.type === 'remote' && t.effectivePort === details.destPort
      )
      if (!rt) {
        reject()
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
      local.on('error', () => reject())
    })

    client.on('error', (err) => {
      session.error = err.message
      if (session.state === 'connecting') {
        session.state = 'error'
        emitLog(session.node.id, session.node.name, 'error', `连接失败: ${err.message}`)
        emitStatus()
      }
    })

    client.on('close', () => {
      teardownTunnels(session)
      session.client = null
      if (session.stopRequested) {
        session.state = 'disconnected'
        session.error = undefined
        emitStatus()
        return
      }
      if (session.everConnected) {
        scheduleReconnect(session)
      } else {
        session.state = 'error'
        emitStatus()
      }
    })

    client.connect(cfg)
  }

  return {
    getStatus(): SshSessionStatus[] {
      return [...sessions.values()].map(sessionToStatus)
    },
    async connect(node: SshNode): Promise<SshSessionStatus> {
      let session = sessions.get(node.id)
      if (session && (session.state === 'connected' || session.state === 'connecting')) {
        return sessionToStatus(session)
      }
      if (session) {
        session.stopRequested = false
        clearRetry(session)
        session.state = 'connecting'
        session.error = undefined
        session.everConnected = false
      } else {
        session = {
          node,
          client: null,
          state: 'connecting',
          error: undefined,
          everConnected: false,
          stopRequested: false,
          tunnels: new Map()
        }
        sessions.set(node.id, session)
      }
      emitStatus()
      try {
        await doConnect(session)
      } catch (err) {
        session.state = 'error'
        session.error = (err as Error).message
        emitStatus()
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
      session.client?.end()
      session.client = null
      session.state = 'disconnected'
      session.error = undefined
      session.everConnected = false
      session.connectedAt = undefined
      emitStatus()
      return sessionToStatus(session)
    },
    async disconnectAll(): Promise<SshSessionStatus[]> {
      for (const session of sessions.values()) {
        await this.disconnect(session.node.id)
      }
      return this.getStatus()
    },
    async addTunnel(nodeId: string, spec: SshTunnelSpec): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session || session.state !== 'connected' || !session.client) {
        return emptyStatus(nodeId)
      }
      const next: SshTunnelSpec = { ...spec, id: spec.id ?? randomUUID() }
      if (!session.tunnels.has(next.id!)) {
        bindTunnel(session, next)
      }
      return sessionToStatus(session)
    },
    async startTunnel(nodeId: string, spec: SshTunnelSpec): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session || session.state !== 'connected' || !session.client) {
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
    async stopTunnel(nodeId: string, tunnelId: string): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session) return emptyStatus(nodeId)
      const rt = session.tunnels.get(tunnelId)
      if (rt) {
        if (rt.server) {
          rt.server.close()
          rt.server = undefined
        }
        if (session.client && rt.state.type === 'remote' && rt.effectivePort != null) {
          session.client.unforwardIn(rt.state.bindAddr || '127.0.0.1', rt.effectivePort, () => {})
        }
        session.tunnels.delete(tunnelId)
        emitStatus()
      }
      return sessionToStatus(session)
    },
    async removeTunnel(nodeId: string, tunnelId: string): Promise<SshSessionStatus> {
      const session = sessions.get(nodeId)
      if (!session) return emptyStatus(nodeId)
      const rt = session.tunnels.get(tunnelId)
      if (rt) {
        if (rt.server) {
          rt.server.close()
          rt.server = undefined
        }
        if (session.client && rt.state.type === 'remote' && rt.effectivePort != null) {
          session.client.unforwardIn(rt.state.bindAddr || '127.0.0.1', rt.effectivePort, () => {})
        }
        session.tunnels.delete(tunnelId)
        emitStatus()
      }
      return sessionToStatus(session)
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
        client.on('error', (err) => finish(false, err.message))
        makeConnectConfig(node)
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
}
