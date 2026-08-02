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

export function defaultKubeconfigPath(): string {
  return join(homedir(), '.kube', 'config')
}

export interface K8sStore {
  init: () => Promise<void>
  list: () => K8sCluster[]
  get: (id: string) => K8sCluster | null
  save: (input: K8sClusterInput) => K8sCluster
  remove: (id: string) => boolean
}

export function createK8sStore(): K8sStore {
  const file = join(app.getPath('userData'), 'k8s-clusters.json')
  const configDir = join(app.getPath('userData'), 'k8s-kubeconfigs')
  let clusters = new Map<string, K8sCluster>()

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

  return {
    async init(): Promise<void> {
      await load()
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
      return true
    }
  }
}
