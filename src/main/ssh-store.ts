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
  listenAddr?: string
  remoteHost?: string
  remotePort?: number
  bindAddr?: string
  bindPort?: number
  targetHost?: string
  targetPort?: number
  /** SOCKS5 username (optional; required with socksPass for non-loopback listen) */
  socksUser?: string
  /** SOCKS5 password — plaintext in memory; encrypted at rest */
  socksPass?: string
  hasSocksPass?: boolean
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
  listenAddr: string | null
  remoteHost: string | null
  remotePort: number | null
  bindAddr: string | null
  bindPort: number | null
  targetHost: string | null
  targetPort: number | null
  socksUser: string | null
  socksPass: StoredSecret | null
}

interface StoreFile {
  /** v1: nodes listed by createdAt; v2+: file array order is display order */
  version: 1 | 2
  nodes: StoredNode[]
  tunnels?: StoredTunnel[]
  knownHosts?: Record<string, string>
}

function hostKeyId(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`
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
  // Legacy plaintext entries written before encryption was required
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

function toStoredTunnel(spec: SshTunnelSpec, socksPass: StoredSecret | null): StoredTunnel {
  return {
    id: spec.id!,
    nodeId: spec.nodeId!,
    name: spec.name?.trim() || null,
    type: spec.type,
    localPort: spec.localPort ?? null,
    listenAddr: spec.listenAddr?.trim() || null,
    remoteHost: spec.remoteHost?.trim() || null,
    remotePort: spec.remotePort ?? null,
    bindAddr: spec.bindAddr?.trim() || null,
    bindPort: spec.bindPort ?? null,
    targetHost: spec.targetHost?.trim() || null,
    targetPort: spec.targetPort ?? null,
    socksUser: spec.socksUser?.trim() || null,
    socksPass
  }
}

function fromStoredTunnel(s: StoredTunnel): SshTunnelSpec {
  const socksPass = decryptSecret(s.socksPass)
  return {
    id: s.id,
    nodeId: s.nodeId,
    name: s.name ?? undefined,
    type: s.type,
    localPort: s.localPort ?? undefined,
    listenAddr: s.listenAddr ?? undefined,
    remoteHost: s.remoteHost ?? undefined,
    remotePort: s.remotePort ?? undefined,
    bindAddr: s.bindAddr ?? undefined,
    bindPort: s.bindPort ?? undefined,
    targetHost: s.targetHost ?? undefined,
    targetPort: s.targetPort ?? undefined,
    socksUser: s.socksUser ?? undefined,
    socksPass,
    hasSocksPass: Boolean(socksPass)
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
  reorder: (ids: string[]) => SshNodeView[]
  listTunnels: (nodeId?: string) => SshTunnelSpec[]
  saveTunnel: (spec: SshTunnelSpec) => SshTunnelSpec
  removeTunnel: (id: string) => boolean
  verifyHostKey: (
    host: string,
    port: number,
    key: Buffer,
    confirmNew?: (fingerprint: string) => boolean
  ) => boolean
  clearHostKey: (host: string, port: number) => boolean
  clearHostKeyByNodeId: (nodeId: string) => boolean
}

export function createSshStore(): SshStore {
  const file = join(app.getPath('userData'), 'ssh-nodes.json')
  let nodes = new Map<string, SshNode>()
  let tunnels = new Map<string, StoredTunnel>()
  let knownHosts = new Map<string, string>()

  function migratePlaintextSecrets(
    storedNodes: StoredNode[],
    storedTunnels: StoredTunnel[]
  ): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    let changed = false
    const migrate = (secret: StoredSecret | null): StoredSecret | null => {
      if (!secret || secret.encrypted) return secret
      const plain = secret.value
      if (!plain) return secret
      try {
        const next = encryptSecret(plain)
        if (next) {
          changed = true
          return next
        }
      } catch {
        // keep plaintext if encryption fails
      }
      return secret
    }
    for (const n of storedNodes) {
      n.password = migrate(n.password)
      n.passphrase = migrate(n.passphrase)
    }
    for (const t of storedTunnels) {
      t.socksPass = migrate(t.socksPass)
    }
    return changed
  }

  async function load(): Promise<void> {
    try {
      const raw = await fsp.readFile(file, 'utf-8')
      const data = JSON.parse(raw) as StoreFile
      let nodeArr = Array.isArray(data?.nodes) ? data.nodes : []
      nodeArr = nodeArr.filter((n) => n && typeof n.id === 'string')
      // v1 listed by createdAt; keep that order when upgrading so UI doesn't jump
      let versionMigrated = false
      if ((data?.version ?? 1) < 2) {
        nodeArr = nodeArr
          .slice()
          .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
        versionMigrated = true
      }
      const storedNodes = nodeArr
      const tunArr = Array.isArray(data?.tunnels) ? data.tunnels : []
      const storedTunnels = tunArr
        .filter((t) => t && typeof t.id === 'string')
        .map((t) => ({
          ...t,
          socksUser: t.socksUser ?? null,
          socksPass: t.socksPass ?? null
        }))
      const secretsMigrated = migratePlaintextSecrets(storedNodes, storedTunnels)
      nodes = new Map(storedNodes.map((n) => [n.id, fromStored(n)]))
      tunnels = new Map(storedTunnels.map((t) => [t.id, t]))
      const hosts = data?.knownHosts && typeof data.knownHosts === 'object' ? data.knownHosts : {}
      knownHosts = new Map(
        Object.entries(hosts).filter(([k, v]) => typeof k === 'string' && typeof v === 'string')
      )
      if (secretsMigrated || versionMigrated) persist()
    } catch {
      nodes = new Map()
      tunnels = new Map()
      knownHosts = new Map()
    }
  }

  function persist(): void {
    const payload: StoreFile = {
      version: 2,
      nodes: [...nodes.values()].map(toStored),
      tunnels: [...tunnels.values()],
      knownHosts: Object.fromEntries(knownHosts)
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
      return [...nodes.values()].map(toView)
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
      const host = input.host.trim()
      const port = input.port
      if (
        existing &&
        (existing.host.trim().toLowerCase() !== host.toLowerCase() || existing.port !== port)
      ) {
        knownHosts.delete(hostKeyId(existing.host, existing.port))
      }
      const node: SshNode = {
        id: existing?.id ?? randomUUID(),
        name: input.name.trim(),
        host,
        port,
        username: input.username.trim(),
        auth,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      // Map.set keeps existing key order; new ids append at the end
      nodes.set(node.id, node)
      persist()
      return toView(node)
    },
    remove(id: string): boolean {
      const node = nodes.get(id)
      const existed = nodes.delete(id)
      for (const tunnel of tunnels.values()) {
        if (tunnel.nodeId === id) tunnels.delete(tunnel.id)
      }
      if (node) knownHosts.delete(hostKeyId(node.host, node.port))
      if (existed) persist()
      return existed
    },
    reorder(ids: string[]): SshNodeView[] {
      const next = new Map<string, SshNode>()
      for (const id of ids) {
        const node = nodes.get(id)
        if (node) next.set(id, node)
      }
      for (const [id, node] of nodes) {
        if (!next.has(id)) next.set(id, node)
      }
      nodes = next
      persist()
      return this.list()
    },
    listTunnels(nodeId?: string): SshTunnelSpec[] {
      const list = [...tunnels.values()]
        .filter((t) => !nodeId || t.nodeId === nodeId)
        .map(fromStoredTunnel)
      return list.sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
    },
    saveTunnel(input: SshTunnelSpec): SshTunnelSpec {
      if (!input.nodeId) throw new Error('NODE_REQUIRED')
      const existingStored = input.id ? tunnels.get(input.id) : undefined
      const existing = existingStored ? fromStoredTunnel(existingStored) : undefined

      // socksPass: undefined = keep existing; '' = clear; non-empty = replace
      let socksPassSecret: StoredSecret | null = existingStored?.socksPass ?? null
      let socksUser = pickStr(input.socksUser, existing?.socksUser) ?? null
      if (input.socksPass !== undefined) {
        if (!input.socksPass.trim()) {
          socksPassSecret = null
          if (input.socksUser !== undefined && !input.socksUser.trim()) socksUser = null
        } else {
          socksPassSecret = encryptSecret(input.socksPass.trim())
        }
      }
      if (input.socksUser !== undefined) {
        socksUser = input.socksUser.trim() || null
      }

      const spec: SshTunnelSpec = {
        id: existing?.id ?? randomUUID(),
        nodeId: input.nodeId,
        name: pickStr(input.name, existing?.name),
        type: input.type,
        localPort: input.localPort ?? existing?.localPort ?? undefined,
        listenAddr: pickStr(input.listenAddr, existing?.listenAddr),
        remoteHost: pickStr(input.remoteHost, existing?.remoteHost),
        remotePort: input.remotePort ?? existing?.remotePort ?? undefined,
        bindAddr: pickStr(input.bindAddr, existing?.bindAddr),
        bindPort: input.bindPort ?? existing?.bindPort ?? undefined,
        targetHost: pickStr(input.targetHost, existing?.targetHost),
        targetPort: input.targetPort ?? existing?.targetPort ?? undefined,
        socksUser: socksUser ?? undefined
      }
      const stored = toStoredTunnel(spec, socksPassSecret)
      tunnels.set(spec.id!, stored)
      persist()
      return fromStoredTunnel(stored)
    },
    removeTunnel(id: string): boolean {
      const existed = tunnels.delete(id)
      if (existed) persist()
      return existed
    },
    verifyHostKey(
      host: string,
      port: number,
      key: Buffer,
      confirmNew?: (fingerprint: string) => boolean
    ): boolean {
      const id = hostKeyId(host, port)
      const fingerprint = key.toString('base64')
      const known = knownHosts.get(id)
      if (!known) {
        if (confirmNew && !confirmNew(fingerprint)) return false
        knownHosts.set(id, fingerprint)
        persist()
        return true
      }
      return known === fingerprint
    },
    clearHostKey(host: string, port: number): boolean {
      const existed = knownHosts.delete(hostKeyId(host, port))
      if (existed) persist()
      return existed
    },
    clearHostKeyByNodeId(nodeId: string): boolean {
      const node = nodes.get(nodeId)
      if (!node) return false
      return this.clearHostKey(node.host, node.port)
    }
  }
}
