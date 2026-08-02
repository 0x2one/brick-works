import { app, safeStorage } from 'electron'
import { promises as fsp } from 'fs'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export type SshTunnelType = 'local' | 'remote' | 'socks5'

export interface SshTunnelSpec {
  id?: string
  nodeId?: string
  name?: string
  type: SshTunnelType
  localPort?: number
  remoteHost?: string
  remotePort?: number
  bindAddr?: string
  bindPort?: number
  targetHost?: string
  targetPort?: number
}

export interface SshAuthConfig {
  type: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

export interface SshNode {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: SshAuthConfig
  createdAt: number
  updatedAt: number
}

export interface SshNodeView {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  privateKeyPath: string | null
  hasPassword: boolean
  hasPassphrase: boolean
  createdAt: number
  updatedAt: number
}

export interface SshNodeInput {
  id?: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

interface StoredSecret {
  value: string
  encrypted: boolean
}

interface StoredNode {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password: StoredSecret | null
  privateKeyPath: string | null
  passphrase: StoredSecret | null
  createdAt: number
  updatedAt: number
}

interface StoredTunnel {
  id: string
  nodeId: string
  name: string | null
  type: SshTunnelType
  localPort: number | null
  remoteHost: string | null
  remotePort: number | null
  bindAddr: string | null
  bindPort: number | null
  targetHost: string | null
  targetPort: number | null
}

interface StoreFile {
  version: 1
  nodes: StoredNode[]
  tunnels?: StoredTunnel[]
}

function encryptSecret(value?: string | null): StoredSecret | null {
  if (!value) return null
  if (safeStorage.isEncryptionAvailable()) {
    return { value: safeStorage.encryptString(value).toString('base64'), encrypted: true }
  }
  return { value, encrypted: false }
}

function decryptSecret(secret: StoredSecret | null): string | undefined {
  if (!secret) return undefined
  if (secret.encrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(secret.value, 'base64'))
    } catch {
      return secret.value
    }
  }
  return secret.value
}

function toView(node: SshNode): SshNodeView {
  return {
    id: node.id,
    name: node.name,
    host: node.host,
    port: node.port,
    username: node.username,
    authType: node.auth.type,
    privateKeyPath: node.auth.privateKeyPath ?? null,
    hasPassword: Boolean(node.auth.password),
    hasPassphrase: Boolean(node.auth.passphrase),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt
  }
}

function toStored(node: SshNode): StoredNode {
  return {
    id: node.id,
    name: node.name,
    host: node.host,
    port: node.port,
    username: node.username,
    authType: node.auth.type,
    password: encryptSecret(node.auth.password),
    privateKeyPath: node.auth.privateKeyPath ?? null,
    passphrase: encryptSecret(node.auth.passphrase),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt
  }
}

function fromStored(stored: StoredNode): SshNode {
  return {
    id: stored.id,
    name: stored.name,
    host: stored.host,
    port: stored.port,
    username: stored.username,
    auth: {
      type: stored.authType,
      password: decryptSecret(stored.password),
      privateKeyPath: stored.privateKeyPath ?? undefined,
      passphrase: decryptSecret(stored.passphrase)
    },
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt
  }
}

function toStoredTunnel(spec: SshTunnelSpec): StoredTunnel {
  return {
    id: spec.id!,
    nodeId: spec.nodeId!,
    name: spec.name?.trim() || null,
    type: spec.type,
    localPort: spec.localPort ?? null,
    remoteHost: spec.remoteHost?.trim() || null,
    remotePort: spec.remotePort ?? null,
    bindAddr: spec.bindAddr?.trim() || null,
    bindPort: spec.bindPort ?? null,
    targetHost: spec.targetHost?.trim() || null,
    targetPort: spec.targetPort ?? null
  }
}

function fromStoredTunnel(s: StoredTunnel): SshTunnelSpec {
  return {
    id: s.id,
    nodeId: s.nodeId,
    name: s.name ?? undefined,
    type: s.type,
    localPort: s.localPort ?? undefined,
    remoteHost: s.remoteHost ?? undefined,
    remotePort: s.remotePort ?? undefined,
    bindAddr: s.bindAddr ?? undefined,
    bindPort: s.bindPort ?? undefined,
    targetHost: s.targetHost ?? undefined,
    targetPort: s.targetPort ?? undefined
  }
}

function pickStr(input?: string, existing?: string | null): string | undefined {
  if (input && input.trim()) return input.trim()
  if (existing) return existing
  return undefined
}

export interface SshStore {
  init: () => Promise<void>
  list: () => SshNodeView[]
  get: (id: string) => SshNode | null
  save: (input: SshNodeInput) => SshNodeView
  remove: (id: string) => boolean
  listTunnels: (nodeId?: string) => SshTunnelSpec[]
  saveTunnel: (spec: SshTunnelSpec) => SshTunnelSpec
  removeTunnel: (id: string) => boolean
}

export function createSshStore(): SshStore {
  const file = join(app.getPath('userData'), 'ssh-nodes.json')
  let nodes = new Map<string, SshNode>()
  let tunnels = new Map<string, StoredTunnel>()

  async function load(): Promise<void> {
    try {
      const raw = await fsp.readFile(file, 'utf-8')
      const data = JSON.parse(raw) as StoreFile
      const nodeArr = Array.isArray(data?.nodes) ? data.nodes : []
      nodes = new Map(
        nodeArr.filter((n) => n && typeof n.id === 'string').map((n) => [n.id, fromStored(n)])
      )
      const tunArr = Array.isArray(data?.tunnels) ? data.tunnels : []
      tunnels = new Map(tunArr.filter((t) => t && typeof t.id === 'string').map((t) => [t.id, t]))
    } catch {
      nodes = new Map()
      tunnels = new Map()
    }
  }

  function persist(): void {
    const payload: StoreFile = {
      version: 1,
      nodes: [...nodes.values()].map(toStored),
      tunnels: [...tunnels.values()]
    }
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8')
    } catch {
      // best-effort persistence
    }
  }

  return {
    async init(): Promise<void> {
      await load()
    },
    list(): SshNodeView[] {
      return [...nodes.values()].sort((a, b) => a.createdAt - b.createdAt).map(toView)
    },
    get(id: string): SshNode | null {
      return nodes.get(id) ?? null
    },
    save(input: SshNodeInput): SshNodeView {
      const now = Date.now()
      const existing = input.id ? nodes.get(input.id) : undefined
      let auth: SshAuthConfig
      if (input.authType === 'password') {
        auth = {
          type: 'password',
          password:
            input.password && input.password.trim() ? input.password : existing?.auth.password
        }
      } else {
        auth = {
          type: 'privateKey',
          privateKeyPath: input.privateKeyPath?.trim() || existing?.auth.privateKeyPath,
          passphrase:
            input.passphrase && input.passphrase.trim()
              ? input.passphrase
              : existing?.auth.passphrase
        }
      }
      const node: SshNode = {
        id: existing?.id ?? randomUUID(),
        name: input.name.trim(),
        host: input.host.trim(),
        port: input.port,
        username: input.username.trim(),
        auth,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      nodes.set(node.id, node)
      persist()
      return toView(node)
    },
    remove(id: string): boolean {
      const existed = nodes.delete(id)
      for (const tunnel of tunnels.values()) {
        if (tunnel.nodeId === id) tunnels.delete(tunnel.id)
      }
      if (existed) persist()
      return existed
    },
    listTunnels(nodeId?: string): SshTunnelSpec[] {
      const list = [...tunnels.values()]
        .filter((t) => !nodeId || t.nodeId === nodeId)
        .map(fromStoredTunnel)
      return list.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
    },
    saveTunnel(input: SshTunnelSpec): SshTunnelSpec {
      if (!input.nodeId) throw new Error('NODE_REQUIRED')
      const existing = input.id ? tunnels.get(input.id) : undefined
      const spec: SshTunnelSpec = {
        id: existing?.id ?? randomUUID(),
        nodeId: input.nodeId,
        name: pickStr(input.name, existing?.name),
        type: input.type,
        localPort: input.localPort ?? existing?.localPort ?? undefined,
        remoteHost: pickStr(input.remoteHost, existing?.remoteHost),
        remotePort: input.remotePort ?? existing?.remotePort ?? undefined,
        bindAddr: pickStr(input.bindAddr, existing?.bindAddr),
        bindPort: input.bindPort ?? existing?.bindPort ?? undefined,
        targetHost: pickStr(input.targetHost, existing?.targetHost),
        targetPort: input.targetPort ?? existing?.targetPort ?? undefined
      }
      tunnels.set(spec.id!, toStoredTunnel(spec))
      persist()
      return spec
    },
    removeTunnel(id: string): boolean {
      const existed = tunnels.delete(id)
      if (existed) persist()
      return existed
    }
  }
}
