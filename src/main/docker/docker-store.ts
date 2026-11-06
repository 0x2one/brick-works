import { app, safeStorage } from 'electron'
import { promises as fsp } from 'fs'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  DEFAULT_DOCKER_PIPE_PATH,
  DEFAULT_DOCKER_SOCKET_PATH,
  DEFAULT_DOCKER_TCP_PORT
} from './docker-constants'

export { DEFAULT_DOCKER_PIPE_PATH, DEFAULT_DOCKER_SOCKET_PATH, DEFAULT_DOCKER_TCP_PORT }

export type DockerEndpointType = 'pipe' | 'tcp' | 'wsl' | 'ssh'
export type DockerWslMode = 'cli' | 'tcp'

export interface DockerTlsConfig {
  caPath?: string
  certPath?: string
  keyPath?: string
  /** Private key passphrase — plaintext in memory, encrypted at rest */
  keyPassphrase?: string
}

export interface DockerEndpoint {
  id: string
  name: string
  type: DockerEndpointType
  /** pipe: named pipe path, e.g. //./pipe/docker_engine */
  pipePath?: string
  /** tcp: daemon host / port */
  host?: string
  port?: number
  tls?: DockerTlsConfig
  /** wsl: distro name + transport mode */
  distro?: string
  wslMode?: DockerWslMode
  wslPort?: number
  /** ssh: reuse an existing SSH client node (credentials are not duplicated) */
  sshNodeId?: string | null
  /** ssh: remote unix socket path */
  remoteSocketPath?: string
  /** ssh: remote dockerd TCP endpoint */
  remoteHost?: string
  remotePort?: number
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface DockerEndpointView {
  id: string
  name: string
  type: DockerEndpointType
  pipePath?: string
  host?: string
  port?: number
  tls?: {
    caPath?: string
    certPath?: string
    keyPath?: string
    hasKeyPassphrase: boolean
  }
  distro?: string
  wslMode?: DockerWslMode
  wslPort?: number
  sshNodeId?: string | null
  remoteSocketPath?: string
  remoteHost?: string
  remotePort?: number
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface DockerEndpointInput {
  id?: string
  name: string
  type: DockerEndpointType
  pipePath?: string
  host?: string
  port?: number
  tls?: {
    caPath?: string
    certPath?: string
    keyPath?: string
    /** undefined = keep existing, '' = clear */
    keyPassphrase?: string
  }
  distro?: string
  wslMode?: DockerWslMode
  wslPort?: number
  sshNodeId?: string | null
  remoteSocketPath?: string
  remoteHost?: string
  remotePort?: number
}

interface StoredSecret {
  value: string
  encrypted: boolean
}

interface StoredTls {
  caPath: string | null
  certPath: string | null
  keyPath: string | null
  keyPassphrase: StoredSecret | null
}

interface StoredEndpoint {
  id: string
  name: string
  type: DockerEndpointType
  pipePath: string | null
  host: string | null
  port: number | null
  tls: StoredTls | null
  distro: string | null
  wslMode: DockerWslMode | null
  wslPort: number | null
  sshNodeId: string | null
  remoteSocketPath: string | null
  remoteHost: string | null
  remotePort: number | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

interface StoreFile {
  version: 1
  endpoints: StoredEndpoint[]
}

function encryptSecret(value?: string | null): StoredSecret | null {
  if (!value) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('ENCRYPTION_UNAVAILABLE')
  }
  return { value: safeStorage.encryptString(value).toString('base64'), encrypted: true }
}

function decryptSecret(secret: StoredSecret | null): string | undefined {
  if (!secret) return undefined
  if (secret.encrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(secret.value, 'base64'))
    } catch {
      return undefined
    }
  }
  return secret.value
}

function toView(endpoint: DockerEndpoint): DockerEndpointView {
  return {
    id: endpoint.id,
    name: endpoint.name,
    type: endpoint.type,
    pipePath: endpoint.pipePath,
    host: endpoint.host,
    port: endpoint.port,
    tls: endpoint.tls
      ? {
          caPath: endpoint.tls.caPath,
          certPath: endpoint.tls.certPath,
          keyPath: endpoint.tls.keyPath,
          hasKeyPassphrase: Boolean(endpoint.tls.keyPassphrase)
        }
      : undefined,
    distro: endpoint.distro,
    wslMode: endpoint.wslMode,
    wslPort: endpoint.wslPort,
    sshNodeId: endpoint.sshNodeId ?? null,
    remoteSocketPath: endpoint.remoteSocketPath,
    remoteHost: endpoint.remoteHost,
    remotePort: endpoint.remotePort,
    sortOrder: endpoint.sortOrder,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt
  }
}

function toStored(endpoint: DockerEndpoint): StoredEndpoint {
  return {
    id: endpoint.id,
    name: endpoint.name,
    type: endpoint.type,
    pipePath: endpoint.pipePath ?? null,
    host: endpoint.host ?? null,
    port: endpoint.port ?? null,
    tls: endpoint.tls
      ? {
          caPath: endpoint.tls.caPath ?? null,
          certPath: endpoint.tls.certPath ?? null,
          keyPath: endpoint.tls.keyPath ?? null,
          keyPassphrase: encryptSecret(endpoint.tls.keyPassphrase)
        }
      : null,
    distro: endpoint.distro ?? null,
    wslMode: endpoint.wslMode ?? null,
    wslPort: endpoint.wslPort ?? null,
    sshNodeId: endpoint.sshNodeId ?? null,
    remoteSocketPath: endpoint.remoteSocketPath ?? null,
    remoteHost: endpoint.remoteHost ?? null,
    remotePort: endpoint.remotePort ?? null,
    sortOrder: endpoint.sortOrder,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt
  }
}

function fromStored(stored: StoredEndpoint, fallbackOrder: number): DockerEndpoint {
  return {
    id: stored.id,
    name: stored.name,
    type: stored.type,
    pipePath: stored.pipePath ?? undefined,
    host: stored.host ?? undefined,
    port: stored.port ?? undefined,
    tls: stored.tls
      ? {
          caPath: stored.tls.caPath ?? undefined,
          certPath: stored.tls.certPath ?? undefined,
          keyPath: stored.tls.keyPath ?? undefined,
          keyPassphrase: decryptSecret(stored.tls.keyPassphrase)
        }
      : undefined,
    distro: stored.distro ?? undefined,
    wslMode: stored.wslMode ?? undefined,
    wslPort: stored.wslPort ?? undefined,
    sshNodeId: stored.sshNodeId ?? null,
    remoteSocketPath: stored.remoteSocketPath ?? undefined,
    remoteHost: stored.remoteHost ?? undefined,
    remotePort: stored.remotePort ?? undefined,
    sortOrder: typeof stored.sortOrder === 'number' ? stored.sortOrder : fallbackOrder,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt
  }
}

export interface DockerStore {
  init: () => Promise<void>
  list: () => DockerEndpointView[]
  get: (id: string) => DockerEndpoint | null
  save: (input: DockerEndpointInput) => DockerEndpointView
  remove: (id: string) => boolean
}

export function createDockerStore(): DockerStore {
  const file = join(app.getPath('userData'), 'docker-endpoints.json')
  let endpoints = new Map<string, DockerEndpoint>()

  async function load(): Promise<void> {
    try {
      const raw = await fsp.readFile(file, 'utf-8')
      const data = JSON.parse(raw) as StoreFile
      const arr = Array.isArray(data?.endpoints) ? data.endpoints : []
      endpoints = new Map(
        arr
          .filter((e) => e && typeof e.id === 'string' && typeof e.type === 'string')
          .map((e, i) => [e.id, fromStored(e, i)])
      )
    } catch {
      endpoints = new Map()
    }
  }

  function persist(): void {
    const ordered = [...endpoints.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    )
    const payload: StoreFile = {
      version: 1,
      endpoints: ordered.map(toStored)
    }
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8')
  }

  return {
    async init(): Promise<void> {
      await load()
    },
    list(): DockerEndpointView[] {
      return [...endpoints.values()]
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
        )
        .map(toView)
    },
    get(id: string): DockerEndpoint | null {
      return endpoints.get(id) ?? null
    },
    save(input: DockerEndpointInput): DockerEndpointView {
      const name = input.name?.trim()
      if (!name) throw new Error('NAME_REQUIRED')
      const now = Date.now()
      const existing = input.id ? endpoints.get(input.id) : undefined

      let tls: DockerTlsConfig | undefined
      const existingTls = existing?.tls
      const inputTls = input.tls
      if (inputTls || existingTls) {
        let keyPassphrase = existingTls?.keyPassphrase
        if (inputTls?.keyPassphrase !== undefined) {
          keyPassphrase = inputTls.keyPassphrase.trim() ? inputTls.keyPassphrase : undefined
        }
        tls = {
          caPath: inputTls?.caPath?.trim() || existingTls?.caPath,
          certPath: inputTls?.certPath?.trim() || existingTls?.certPath,
          keyPath: inputTls?.keyPath?.trim() || existingTls?.keyPath,
          keyPassphrase
        }
      }

      const maxOrder = [...endpoints.values()].reduce((m, e) => Math.max(m, e.sortOrder), -1)
      const endpoint: DockerEndpoint = {
        id: existing?.id ?? randomUUID(),
        name,
        type: input.type,
        pipePath:
          input.type === 'pipe'
            ? input.pipePath?.trim() || DEFAULT_DOCKER_PIPE_PATH
            : existing?.pipePath,
        host: input.type === 'tcp' ? input.host?.trim() || existing?.host : existing?.host,
        port: input.type === 'tcp' ? (input.port ?? existing?.port) : existing?.port,
        tls,
        distro: input.type === 'wsl' ? input.distro?.trim() || existing?.distro : existing?.distro,
        wslMode:
          input.type === 'wsl' ? (input.wslMode ?? existing?.wslMode ?? 'cli') : existing?.wslMode,
        wslPort:
          input.type === 'wsl'
            ? (input.wslPort ?? existing?.wslPort ?? DEFAULT_DOCKER_TCP_PORT)
            : existing?.wslPort,
        sshNodeId:
          input.type === 'ssh'
            ? (input.sshNodeId ?? existing?.sshNodeId ?? null)
            : existing?.sshNodeId,
        remoteSocketPath:
          input.type === 'ssh'
            ? input.remoteSocketPath?.trim() ||
              existing?.remoteSocketPath ||
              DEFAULT_DOCKER_SOCKET_PATH
            : existing?.remoteSocketPath,
        remoteHost:
          input.type === 'ssh'
            ? input.remoteHost?.trim() || existing?.remoteHost
            : existing?.remoteHost,
        remotePort:
          input.type === 'ssh'
            ? (input.remotePort ?? existing?.remotePort ?? DEFAULT_DOCKER_TCP_PORT)
            : existing?.remotePort,
        sortOrder: existing?.sortOrder ?? maxOrder + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      endpoints.set(endpoint.id, endpoint)
      persist()
      return toView(endpoint)
    },
    remove(id: string): boolean {
      const existed = endpoints.delete(id)
      if (existed) {
        const ordered = [...endpoints.values()].sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
        )
        ordered.forEach((e, i) => {
          if (e.sortOrder !== i) endpoints.set(e.id, { ...e, sortOrder: i })
        })
        persist()
      }
      return existed
    }
  }
}
