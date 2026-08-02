import { app } from 'electron'
import { promises as fsp } from 'fs'
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'

export interface K8sCluster {
  id: string
  name: string
  kubeconfigPath: string
  context: string
  /** true when kubeconfig was pasted and stored under userData */
  managedConfig?: boolean
  createdAt: number
  updatedAt: number
}

export interface K8sClusterInput {
  id?: string
  name: string
  kubeconfigPath?: string
  /** when set, content is written to userData and used as kubeconfigPath */
  kubeconfigContent?: string
  context: string
}

interface StoreFile {
  version: 1
  clusters: K8sCluster[]
}

export interface K8sPortForwardRecord {
  id: string
  clusterId: string
  namespace: string
  pod: string
  localPort: number
  remotePort: number
  createdAt: number
  updatedAt: number
}

export interface K8sPortForwardInput {
  id?: string
  clusterId: string
  namespace: string
  pod: string
  localPort: number
  remotePort: number
}

interface PortForwardStoreFile {
  version: 1
  portForwards: K8sPortForwardRecord[]
}

export function defaultKubeconfigPath(): string {
  return join(homedir(), '.kube', 'config')
}

export interface K8sStore {
  init: () => Promise<void>
  list: () => K8sCluster[]
  get: (id: string) => K8sCluster | null
  save: (input: K8sClusterInput) => K8sCluster
  remove: (id: string) => boolean
  listPortForwards: (clusterId?: string) => K8sPortForwardRecord[]
  getPortForward: (id: string) => K8sPortForwardRecord | null
  savePortForward: (input: K8sPortForwardInput) => K8sPortForwardRecord
  removePortForward: (id: string) => boolean
}

export function createK8sStore(): K8sStore {
  const file = join(app.getPath('userData'), 'k8s-clusters.json')
  const pfFile = join(app.getPath('userData'), 'k8s-port-forwards.json')
  const configDir = join(app.getPath('userData'), 'k8s-kubeconfigs')
  let clusters = new Map<string, K8sCluster>()
  let portForwards = new Map<string, K8sPortForwardRecord>()

  function managedConfigPath(id: string): string {
    return join(configDir, `${id}.yaml`)
  }

  function removeManagedFile(cluster: K8sCluster): void {
    if (!cluster.managedConfig) return
    try {
      if (existsSync(cluster.kubeconfigPath)) unlinkSync(cluster.kubeconfigPath)
    } catch {
      // best-effort
    }
  }

  async function load(): Promise<void> {
    try {
      const raw = await fsp.readFile(file, 'utf-8')
      const data = JSON.parse(raw) as StoreFile
      const arr = Array.isArray(data?.clusters) ? data.clusters : []
      clusters = new Map(
        arr
          .filter(
            (c) =>
              c &&
              typeof c.id === 'string' &&
              typeof c.kubeconfigPath === 'string' &&
              typeof c.context === 'string'
          )
          .map((c) => [c.id, c])
      )
    } catch {
      clusters = new Map()
    }
  }

  async function loadPortForwards(): Promise<void> {
    try {
      const raw = await fsp.readFile(pfFile, 'utf-8')
      const data = JSON.parse(raw) as PortForwardStoreFile
      const arr = Array.isArray(data?.portForwards) ? data.portForwards : []
      portForwards = new Map(
        arr
          .filter(
            (r) =>
              r &&
              typeof r.id === 'string' &&
              typeof r.clusterId === 'string' &&
              typeof r.namespace === 'string' &&
              typeof r.pod === 'string' &&
              typeof r.localPort === 'number' &&
              typeof r.remotePort === 'number'
          )
          .map((r) => [r.id, r])
      )
    } catch {
      portForwards = new Map()
    }
  }

  function persist(): void {
    const payload: StoreFile = {
      version: 1,
      clusters: [...clusters.values()]
    }
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8')
    } catch {
      // best-effort
    }
  }

  function persistPortForwards(): void {
    const payload: PortForwardStoreFile = {
      version: 1,
      portForwards: [...portForwards.values()]
    }
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(pfFile, JSON.stringify(payload, null, 2), 'utf-8')
    } catch {
      // best-effort
    }
  }

  return {
    async init(): Promise<void> {
      await Promise.all([load(), loadPortForwards()])
    },
    list(): K8sCluster[] {
      return [...clusters.values()].sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) ||
          a.context.localeCompare(b.context, undefined, { sensitivity: 'base', numeric: true })
      )
    },
    get(id: string): K8sCluster | null {
      return clusters.get(id) ?? null
    },
    save(input: K8sClusterInput): K8sCluster {
      const now = Date.now()
      const existing = input.id ? clusters.get(input.id) : undefined
      const id = existing?.id ?? randomUUID()
      const content = input.kubeconfigContent?.trim()
      let kubeconfigPath = input.kubeconfigPath?.trim() || existing?.kubeconfigPath || ''
      let managedConfig = existing?.managedConfig ?? false

      if (content) {
        mkdirSync(configDir, { recursive: true })
        kubeconfigPath = managedConfigPath(id)
        writeFileSync(kubeconfigPath, content, 'utf-8')
        managedConfig = true
      }

      if (!kubeconfigPath) {
        throw new Error('KUBECONFIG_REQUIRED')
      }

      const cluster: K8sCluster = {
        id,
        name: input.name.trim(),
        kubeconfigPath,
        context: input.context.trim(),
        managedConfig,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      clusters.set(cluster.id, cluster)
      persist()
      return cluster
    },
    remove(id: string): boolean {
      const existing = clusters.get(id)
      if (!existing) return false
      removeManagedFile(existing)
      clusters.delete(id)
      persist()
      for (const [pfId, pf] of [...portForwards]) {
        if (pf.clusterId === id) portForwards.delete(pfId)
      }
      persistPortForwards()
      return true
    },
    listPortForwards(clusterId?: string): K8sPortForwardRecord[] {
      return [...portForwards.values()]
        .filter((r) => !clusterId || r.clusterId === clusterId)
        .sort(
          (a, b) =>
            a.pod.localeCompare(b.pod, undefined, { sensitivity: 'base', numeric: true }) ||
            a.namespace.localeCompare(b.namespace, undefined, {
              sensitivity: 'base',
              numeric: true
            }) ||
            a.localPort - b.localPort
        )
    },
    getPortForward(id: string): K8sPortForwardRecord | null {
      return portForwards.get(id) ?? null
    },
    savePortForward(input: K8sPortForwardInput): K8sPortForwardRecord {
      const now = Date.now()
      const existingById = input.id ? portForwards.get(input.id) : undefined
      const existingByKey = [...portForwards.values()].find(
        (r) =>
          r.clusterId === input.clusterId &&
          r.namespace === input.namespace &&
          r.pod === input.pod &&
          r.localPort === input.localPort &&
          r.remotePort === input.remotePort
      )
      const existing = existingById ?? existingByKey
      const record: K8sPortForwardRecord = {
        id: existing?.id ?? randomUUID(),
        clusterId: input.clusterId,
        namespace: input.namespace.trim(),
        pod: input.pod.trim(),
        localPort: input.localPort,
        remotePort: input.remotePort,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      portForwards.set(record.id, record)
      persistPortForwards()
      return record
    },
    removePortForward(id: string): boolean {
      if (!portForwards.has(id)) return false
      portForwards.delete(id)
      persistPortForwards()
      return true
    }
  }
}
