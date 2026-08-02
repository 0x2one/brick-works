import { createServer, type Server as NetServer, type Socket } from 'net'
import { Writable, PassThrough } from 'stream'
import { randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import type { K8sCluster } from './k8s-store'

export type K8sConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface K8sStatus {
  state: K8sConnectionState
  clusterId: string | null
  clusterName: string | null
  context: string | null
  server: string | null
  error?: string
  connectedAt?: number
}

export interface K8sContextInfo {
  name: string
  cluster: string
  user: string
  namespace?: string
}

export interface K8sPodRow {
  name: string
  namespace: string
  ready: string
  status: string
  restarts: number
  node: string
  ageMs: number
  containers: string[]
  containerPorts: number[]
}

export interface K8sWorkloadRow {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet'
  name: string
  namespace: string
  ready: string
  replicas: number
  ageMs: number
}

export interface K8sServiceRow {
  name: string
  namespace: string
  type: string
  clusterIP: string
  ports: string
  ageMs: number
}

export interface K8sIngressRow {
  name: string
  namespace: string
  hosts: string
  address: string
  ageMs: number
}

export interface K8sLogChunk {
  sessionId: string
  data: string
}

export interface K8sExecData {
  sessionId: string
  data: string
}

export interface K8sExecExit {
  sessionId: string
  reason?: string
}

export type K8sPortForwardState = 'starting' | 'active' | 'error' | 'stopped'

export interface K8sPortForwardStatus {
  id: string
  namespace: string
  pod: string
  localPort: number
  remotePort: number
  state: K8sPortForwardState
  error?: string
}

type K8sModule = typeof import('@kubernetes/client-node')

interface LogSession {
  abort: AbortController
  stream: Writable
}

interface ExecSession {
  ws: { close: () => void } | null
  stdin: PassThrough
  stdout: ResizablePassThrough
}

interface PortForwardRuntime {
  status: K8sPortForwardStatus
  server: NetServer
  sockets: Set<Socket>
}

class ResizablePassThrough extends PassThrough {
  rows = 24
  columns = 80

  setSize(cols: number, rows: number): void {
    this.columns = cols
    this.rows = rows
    this.emit('resize')
  }
}

function ageMs(creationTimestamp?: string | Date): number {
  if (!creationTimestamp) return 0
  const t =
    creationTimestamp instanceof Date ? creationTimestamp.getTime() : Date.parse(creationTimestamp)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Date.now() - t)
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

export interface K8sManager {
  getStatus: () => K8sStatus
  onStatusChange: (cb: (status: K8sStatus) => void) => () => void
  onLogChunk: (cb: (chunk: K8sLogChunk) => void) => () => void
  onExecData: (cb: (data: K8sExecData) => void) => () => void
  onExecExit: (cb: (data: K8sExecExit) => void) => () => void
  onPortForwardStatus: (cb: (list: K8sPortForwardStatus[]) => void) => () => void
  parseContexts: (kubeconfigPath: string) => Promise<K8sContextInfo[]>
  parseContextsFromContent: (content: string) => Promise<K8sContextInfo[]>
  connect: (cluster: K8sCluster) => Promise<K8sStatus>
  disconnect: () => Promise<K8sStatus>
  listNamespaces: () => Promise<string[]>
  listPods: (namespace: string | 'all') => Promise<K8sPodRow[]>
  listWorkloads: (namespace: string | 'all') => Promise<K8sWorkloadRow[]>
  listNetwork: (
    namespace: string | 'all'
  ) => Promise<{ services: K8sServiceRow[]; ingresses: K8sIngressRow[] }>
  startLogs: (opts: {
    namespace: string
    pod: string
    container?: string
    tailLines?: number
    follow?: boolean
  }) => Promise<{ sessionId: string }>
  stopLogs: (sessionId: string) => Promise<boolean>
  fetchLogs: (opts: {
    namespace: string
    pod: string
    container?: string
    tailLines?: number
  }) => Promise<string>
  startExec: (opts: {
    namespace: string
    pod: string
    container?: string
    cols?: number
    rows?: number
  }) => Promise<{ sessionId: string }>
  writeExec: (sessionId: string, dataBase64: string) => Promise<boolean>
  resizeExec: (sessionId: string, cols: number, rows: number) => Promise<boolean>
  stopExec: (sessionId: string) => Promise<boolean>
  startPortForward: (opts: {
    namespace: string
    pod: string
    localPort: number
    remotePort: number
  }) => Promise<K8sPortForwardStatus>
  stopPortForward: (id: string) => Promise<boolean>
  listPortForwards: () => K8sPortForwardStatus[]
  stop: () => void
}

export function createK8sManager(): K8sManager {
  let k8sMod: K8sModule | null = null
  let kc: InstanceType<K8sModule['KubeConfig']> | null = null
  let status: K8sStatus = {
    state: 'disconnected',
    clusterId: null,
    clusterName: null,
    context: null,
    server: null
  }

  const logSessions = new Map<string, LogSession>()
  const execSessions = new Map<string, ExecSession>()
  const portForwards = new Map<string, PortForwardRuntime>()

  const statusListeners = new Set<(s: K8sStatus) => void>()
  const logListeners = new Set<(c: K8sLogChunk) => void>()
  const execDataListeners = new Set<(d: K8sExecData) => void>()
  const execExitListeners = new Set<(d: K8sExecExit) => void>()
  const pfListeners = new Set<(list: K8sPortForwardStatus[]) => void>()

  async function loadK8s(): Promise<K8sModule> {
    if (!k8sMod) k8sMod = await import('@kubernetes/client-node')
    return k8sMod
  }

  function setStatus(next: Partial<K8sStatus>): void {
    status = { ...status, ...next }
    for (const cb of statusListeners) cb(status)
  }

  function broadcastPf(): void {
    const list = [...portForwards.values()].map((r) => r.status)
    for (const cb of pfListeners) cb(list)
  }

  function requireConnected(): InstanceType<K8sModule['KubeConfig']> {
    if (!kc || status.state !== 'connected') {
      throw new Error('NOT_CONNECTED')
    }
    return kc
  }

  async function resolveContainer(
    namespace: string,
    pod: string,
    container?: string
  ): Promise<string> {
    const k8s = await loadK8s()
    const api = requireConnected().makeApiClient(k8s.CoreV1Api)
    const res = await api.readNamespacedPod({ name: pod, namespace })
    const names = [
      ...(res.spec?.containers ?? []).map((c) => c.name),
      ...(res.spec?.initContainers ?? []).map((c) => c.name)
    ].filter(Boolean) as string[]
    if (container && names.includes(container)) return container
    if (names.length === 0) throw new Error('NO_CONTAINER')
    return names[0]
  }

  return {
    getStatus: () => status,

    onStatusChange(cb) {
      statusListeners.add(cb)
      return () => {
        statusListeners.delete(cb)
      }
    },
    onLogChunk(cb) {
      logListeners.add(cb)
      return () => {
        logListeners.delete(cb)
      }
    },
    onExecData(cb) {
      execDataListeners.add(cb)
      return () => {
        execDataListeners.delete(cb)
      }
    },
    onExecExit(cb) {
      execExitListeners.add(cb)
      return () => {
        execExitListeners.delete(cb)
      }
    },
    onPortForwardStatus(cb) {
      pfListeners.add(cb)
      return () => {
        pfListeners.delete(cb)
      }
    },

    async parseContexts(kubeconfigPath: string): Promise<K8sContextInfo[]> {
      const k8s = await loadK8s()
      await fsp.access(kubeconfigPath)
      const config = new k8s.KubeConfig()
      config.loadFromFile(kubeconfigPath)
      return config.getContexts().map((c) => ({
        name: c.name,
        cluster: c.cluster,
        user: c.user,
        namespace: c.namespace
      }))
    },

    async parseContextsFromContent(content: string): Promise<K8sContextInfo[]> {
      const trimmed = content?.trim()
      if (!trimmed) throw new Error('KUBECONFIG_EMPTY')
      const k8s = await loadK8s()
      const config = new k8s.KubeConfig()
      config.loadFromString(trimmed)
      const contexts = config.getContexts()
      if (!contexts.length) throw new Error('NO_CONTEXT')
      return contexts.map((c) => ({
        name: c.name,
        cluster: c.cluster,
        user: c.user,
        namespace: c.namespace
      }))
    },

    async connect(cluster: K8sCluster): Promise<K8sStatus> {
      setStatus({
        state: 'connecting',
        clusterId: cluster.id,
        clusterName: cluster.name,
        context: cluster.context,
        server: null,
        error: undefined
      })
      try {
        const k8s = await loadK8s()
        await fsp.access(cluster.kubeconfigPath)
        const config = new k8s.KubeConfig()
        config.loadFromFile(cluster.kubeconfigPath)
        config.setCurrentContext(cluster.context)
        const api = config.makeApiClient(k8s.CoreV1Api)
        await api.listNamespace({ limit: 1 })
        kc = config
        const current = config.getCurrentCluster()
        setStatus({
          state: 'connected',
          clusterId: cluster.id,
          clusterName: cluster.name,
          context: cluster.context,
          server: current?.server ?? null,
          error: undefined,
          connectedAt: Date.now()
        })
      } catch (err) {
        kc = null
        setStatus({
          state: 'error',
          clusterId: cluster.id,
          clusterName: cluster.name,
          context: cluster.context,
          server: null,
          error: errMessage(err),
          connectedAt: undefined
        })
        throw err
      }
      return status
    },

    async disconnect(): Promise<K8sStatus> {
      for (const id of [...logSessions.keys()]) {
        await this.stopLogs(id)
      }
      for (const id of [...execSessions.keys()]) {
        await this.stopExec(id)
      }
      for (const id of [...portForwards.keys()]) {
        await this.stopPortForward(id)
      }
      kc = null
      setStatus({
        state: 'disconnected',
        clusterId: null,
        clusterName: null,
        context: null,
        server: null,
        error: undefined,
        connectedAt: undefined
      })
      return status
    },

    async listNamespaces(): Promise<string[]> {
      const k8s = await loadK8s()
      const api = requireConnected().makeApiClient(k8s.CoreV1Api)
      const res = await api.listNamespace()
      return (res.items ?? [])
        .map((n) => n.metadata?.name)
        .filter((n): n is string => Boolean(n))
        .sort()
    },

    async listPods(namespace: string | 'all'): Promise<K8sPodRow[]> {
      const k8s = await loadK8s()
      const api = requireConnected().makeApiClient(k8s.CoreV1Api)
      const res =
        namespace === 'all'
          ? await api.listPodForAllNamespaces()
          : await api.listNamespacedPod({ namespace })

      return (res.items ?? [])
        .map((pod) => {
          const containers = pod.spec?.containers ?? []
          const statuses = pod.status?.containerStatuses ?? []
          const readyCount = statuses.filter((s) => s.ready).length
          const restarts = statuses.reduce((sum, s) => sum + (s.restartCount ?? 0), 0)
          const ports = containers.flatMap((c) => (c.ports ?? []).map((p) => p.containerPort))
          return {
            name: pod.metadata?.name ?? '',
            namespace: pod.metadata?.namespace ?? '',
            ready: `${readyCount}/${containers.length}`,
            status: pod.status?.phase ?? 'Unknown',
            restarts,
            node: pod.spec?.nodeName ?? '',
            ageMs: ageMs(pod.metadata?.creationTimestamp),
            containers: containers.map((c) => c.name).filter(Boolean) as string[],
            containerPorts: [...new Set(ports.filter((p): p is number => typeof p === 'number'))]
          }
        })
        .sort((a, b) => byName(a.name, b.name) || byName(a.namespace, b.namespace))
    },

    async listWorkloads(namespace: string | 'all'): Promise<K8sWorkloadRow[]> {
      const k8s = await loadK8s()
      const api = requireConnected().makeApiClient(k8s.AppsV1Api)
      const [deps, sts, ds] = await Promise.all([
        namespace === 'all'
          ? api.listDeploymentForAllNamespaces()
          : api.listNamespacedDeployment({ namespace }),
        namespace === 'all'
          ? api.listStatefulSetForAllNamespaces()
          : api.listNamespacedStatefulSet({ namespace }),
        namespace === 'all'
          ? api.listDaemonSetForAllNamespaces()
          : api.listNamespacedDaemonSet({ namespace })
      ])

      const rows: K8sWorkloadRow[] = []
      for (const d of deps.items ?? []) {
        const desired = d.spec?.replicas ?? 0
        const ready = d.status?.readyReplicas ?? 0
        rows.push({
          kind: 'Deployment',
          name: d.metadata?.name ?? '',
          namespace: d.metadata?.namespace ?? '',
          ready: `${ready}/${desired}`,
          replicas: desired,
          ageMs: ageMs(d.metadata?.creationTimestamp)
        })
      }
      for (const s of sts.items ?? []) {
        const desired = s.spec?.replicas ?? 0
        const ready = s.status?.readyReplicas ?? 0
        rows.push({
          kind: 'StatefulSet',
          name: s.metadata?.name ?? '',
          namespace: s.metadata?.namespace ?? '',
          ready: `${ready}/${desired}`,
          replicas: desired,
          ageMs: ageMs(s.metadata?.creationTimestamp)
        })
      }
      for (const d of ds.items ?? []) {
        const desired = d.status?.desiredNumberScheduled ?? 0
        const ready = d.status?.numberReady ?? 0
        rows.push({
          kind: 'DaemonSet',
          name: d.metadata?.name ?? '',
          namespace: d.metadata?.namespace ?? '',
          ready: `${ready}/${desired}`,
          replicas: desired,
          ageMs: ageMs(d.metadata?.creationTimestamp)
        })
      }
      return rows.sort(
        (a, b) => byName(a.kind, b.kind) || byName(a.name, b.name) || byName(a.namespace, b.namespace)
      )
    },

    async listNetwork(namespace: string | 'all') {
      const k8s = await loadK8s()
      const core = requireConnected().makeApiClient(k8s.CoreV1Api)
      const net = requireConnected().makeApiClient(k8s.NetworkingV1Api)

      const [svcRes, ingRes] = await Promise.all([
        namespace === 'all'
          ? core.listServiceForAllNamespaces()
          : core.listNamespacedService({ namespace }),
        namespace === 'all'
          ? net.listIngressForAllNamespaces()
          : net.listNamespacedIngress({ namespace })
      ])

      const services: K8sServiceRow[] = (svcRes.items ?? [])
        .map((s) => ({
          name: s.metadata?.name ?? '',
          namespace: s.metadata?.namespace ?? '',
          type: s.spec?.type ?? 'ClusterIP',
          clusterIP: s.spec?.clusterIP ?? '',
          ports: (s.spec?.ports ?? [])
            .map((p) => {
              const port = p.port
              const target = p.targetPort
              const proto = p.protocol ?? 'TCP'
              return `${port}${target != null ? `:${target}` : ''}/${proto}`
            })
            .join(', '),
          ageMs: ageMs(s.metadata?.creationTimestamp)
        }))
        .sort((a, b) => byName(a.name, b.name) || byName(a.namespace, b.namespace))

      const ingresses: K8sIngressRow[] = (ingRes.items ?? [])
        .map((ing) => {
          const hosts = (ing.spec?.rules ?? [])
            .map((r) => r.host)
            .filter((h): h is string => Boolean(h))
            .join(', ')
          const address = (ing.status?.loadBalancer?.ingress ?? [])
            .map((i) => i.ip || i.hostname)
            .filter(Boolean)
            .join(', ')
          return {
            name: ing.metadata?.name ?? '',
            namespace: ing.metadata?.namespace ?? '',
            hosts: hosts || '*',
            address: address || '',
            ageMs: ageMs(ing.metadata?.creationTimestamp)
          }
        })
        .sort((a, b) => byName(a.name, b.name) || byName(a.namespace, b.namespace))

      return { services, ingresses }
    },

    async startLogs(opts) {
      const k8s = await loadK8s()
      const config = requireConnected()
      const container = await resolveContainer(opts.namespace, opts.pod, opts.container)
      const sessionId = randomUUID()
      const logApi = new k8s.Log(config)

      const stream = new Writable({
        write(chunk, _enc, callback) {
          const data = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
          for (const cb of logListeners) cb({ sessionId, data })
          callback()
        }
      })

      const abort = await logApi.log(opts.namespace, opts.pod, container, stream, {
        follow: opts.follow !== false,
        tailLines: opts.tailLines ?? 200,
        timestamps: false
      })

      logSessions.set(sessionId, { abort, stream })
      abort.signal.addEventListener('abort', () => {
        logSessions.delete(sessionId)
      })
      return { sessionId }
    },

    async stopLogs(sessionId: string) {
      const session = logSessions.get(sessionId)
      if (!session) return false
      try {
        session.abort.abort()
      } catch {
        // ignore
      }
      logSessions.delete(sessionId)
      return true
    },

    async fetchLogs(opts) {
      const k8s = await loadK8s()
      const config = requireConnected()
      const container = await resolveContainer(opts.namespace, opts.pod, opts.container)
      const logApi = new k8s.Log(config)
      const chunks: string[] = []
      const stream = new Writable({
        write(chunk, _enc, callback) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
          callback()
        }
      })
      const abort = await logApi.log(opts.namespace, opts.pod, container, stream, {
        follow: false,
        tailLines: opts.tailLines ?? 5000,
        timestamps: true
      })
      await new Promise<void>((resolve, reject) => {
        const done = (): void => resolve()
        stream.once('finish', done)
        stream.once('close', done)
        stream.once('error', reject)
        abort.signal.addEventListener('abort', done)
        setTimeout(done, 60_000)
      })
      try {
        abort.abort()
      } catch {
        // ignore
      }
      return chunks.join('')
    },

    async startExec(opts) {
      const k8s = await loadK8s()
      const config = requireConnected()
      const container = await resolveContainer(opts.namespace, opts.pod, opts.container)
      const sessionId = randomUUID()
      const stdin = new PassThrough()
      const stdout = new ResizablePassThrough()
      stdout.setSize(opts.cols ?? 80, opts.rows ?? 24)

      stdout.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const data = buf.toString('base64')
        for (const cb of execDataListeners) cb({ sessionId, data })
      })

      const exec = new k8s.Exec(config)
      const command = [
        '/bin/sh',
        '-c',
        'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi'
      ]
      const ws = await exec.exec(
        opts.namespace,
        opts.pod,
        container,
        command,
        stdout,
        stdout,
        stdin,
        true,
        (statusObj) => {
          for (const cb of execExitListeners) {
            cb({ sessionId, reason: statusObj?.status ?? statusObj?.message })
          }
          execSessions.delete(sessionId)
        }
      )
      execSessions.set(sessionId, { ws, stdin, stdout })
      ws.on?.('close', () => {
        if (execSessions.has(sessionId)) {
          for (const cb of execExitListeners) cb({ sessionId })
          execSessions.delete(sessionId)
        }
      })
      return { sessionId }
    },

    async writeExec(sessionId, dataBase64) {
      const session = execSessions.get(sessionId)
      if (!session) return false
      session.stdin.write(Buffer.from(dataBase64, 'base64'))
      return true
    },

    async resizeExec(sessionId, cols, rows) {
      const session = execSessions.get(sessionId)
      if (!session) return false
      session.stdout.setSize(cols, rows)
      return true
    },

    async stopExec(sessionId) {
      const session = execSessions.get(sessionId)
      if (!session) return false
      try {
        session.ws?.close()
      } catch {
        // ignore
      }
      try {
        session.stdin.end()
      } catch {
        // ignore
      }
      execSessions.delete(sessionId)
      return true
    },

    async startPortForward(opts) {
      requireConnected()
      const k8s = await loadK8s()
      const config = requireConnected()
      const id = randomUUID()
      const statusRow: K8sPortForwardStatus = {
        id,
        namespace: opts.namespace,
        pod: opts.pod,
        localPort: opts.localPort,
        remotePort: opts.remotePort,
        state: 'starting'
      }

      const sockets = new Set<Socket>()
      const pf = new k8s.PortForward(config)

      const server = createServer((socket) => {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => {
          sockets.delete(socket)
        })
        void pf
          .portForward(opts.namespace, opts.pod, [opts.remotePort], socket, null, socket)
          .catch((err) => {
            statusRow.state = 'error'
            statusRow.error = errMessage(err)
            broadcastPf()
            try {
              socket.destroy()
            } catch {
              // ignore
            }
          })
      })

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(opts.localPort, '127.0.0.1', () => resolve())
      })

      statusRow.state = 'active'
      portForwards.set(id, { status: statusRow, server, sockets })
      broadcastPf()
      return statusRow
    },

    async stopPortForward(id) {
      const runtime = portForwards.get(id)
      if (!runtime) return false
      for (const s of runtime.sockets) {
        try {
          s.destroy()
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => {
        runtime.server.close(() => resolve())
        setTimeout(() => resolve(), 1000)
      })
      runtime.status.state = 'stopped'
      portForwards.delete(id)
      broadcastPf()
      return true
    },

    listPortForwards() {
      return [...portForwards.values()]
        .map((r) => r.status)
        .sort((a, b) => byName(a.pod, b.pod) || byName(a.namespace, b.namespace))
    },

    stop() {
      for (const id of [...logSessions.keys()]) {
        try {
          logSessions.get(id)?.abort.abort()
        } catch {
          // ignore
        }
        logSessions.delete(id)
      }
      for (const [id, session] of execSessions) {
        try {
          session.ws?.close()
        } catch {
          // ignore
        }
        execSessions.delete(id)
      }
      for (const [id, runtime] of portForwards) {
        for (const s of runtime.sockets) {
          try {
            s.destroy()
          } catch {
            // ignore
          }
        }
        try {
          runtime.server.close()
        } catch {
          // ignore
        }
        portForwards.delete(id)
      }
      kc = null
      status = {
        state: 'disconnected',
        clusterId: null,
        clusterName: null,
        context: null,
        server: null
      }
    }
  }
}
