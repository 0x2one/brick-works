import { Client, type ConnectConfig, type ClientChannel } from 'ssh2'
import { promises as fsp } from 'fs'
import type { SshNode } from './ssh-store'
import { assertAllowedLocalPath } from './path-allowlist'

const MAX_JUMP_DEPTH = 5

export type HostKeyVerifier = (host: string, port: number, key: Buffer) => boolean

export interface SshConnectResult {
  /** Innermost client (the target node) */
  client: Client
  /** Upstream jump clients, outermost first */
  jumpClients: Client[]
}

function normalizeSshError(message: string): string {
  if (/host key|host denied|verification failed/i.test(message)) return 'HOST_KEY_MISMATCH'
  if (
    /authentication failed|all configured authentication|permission denied|unable to authenticate/i.test(
      message
    )
  ) {
    return 'AUTH_FAILED'
  }
  return message
}

export async function makeConnectConfig(
  node: SshNode,
  verifyHostKey?: HostKeyVerifier,
  sock?: ClientChannel
): Promise<ConnectConfig> {
  const cfg: ConnectConfig = {
    username: node.username,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    readyTimeout: 15000,
    timeout: 30000
  }
  if (sock) {
    cfg.sock = sock
  } else {
    cfg.host = node.host
    cfg.port = node.port
  }
  if (node.auth.type === 'password' && node.auth.password) {
    cfg.password = node.auth.password
  } else if (node.auth.type === 'privateKey' && node.auth.privateKeyPath) {
    assertAllowedLocalPath(node.auth.privateKeyPath)
    cfg.privateKey = await fsp.readFile(node.auth.privateKeyPath)
    if (node.auth.passphrase) cfg.passphrase = node.auth.passphrase
  }
  if (verifyHostKey) {
    cfg.hostVerifier = (key: Buffer) => verifyHostKey(node.host, node.port, key)
  }
  return cfg
}

/** Build hop chain from outermost jump → … → target */
export function resolveHopChain(
  node: SshNode,
  getNode: (id: string) => SshNode | null | undefined
): SshNode[] {
  const chain: SshNode[] = [node]
  const seen = new Set<string>([node.id])
  let current = node
  while (current.jumpHostId) {
    if (chain.length > MAX_JUMP_DEPTH) throw new Error('JUMP_TOO_DEEP')
    const jump = getNode(current.jumpHostId)
    if (!jump) throw new Error('JUMP_NOT_FOUND')
    if (seen.has(jump.id)) throw new Error('JUMP_CYCLE')
    seen.add(jump.id)
    chain.unshift(jump)
    current = jump
  }
  return chain
}

function connectClient(cfg: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    const succeed = (): void => {
      if (settled) return
      settled = true
      resolve(client)
    }
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      try {
        client.end()
      } catch {
        // ignore
      }
      reject(err)
    }
    client.on('ready', () => succeed())
    client.on('error', (err) => fail(new Error(normalizeSshError(err.message))))
    try {
      client.connect(cfg)
    } catch (err) {
      fail(err as Error)
    }
  })
}

function forwardOut(
  client: Client,
  host: string,
  port: number
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
      if (err || !stream) {
        reject(new Error(normalizeSshError(err?.message || 'JUMP_FORWARD_FAILED')))
        return
      }
      resolve(stream)
    })
  })
}

/** End target then jump clients (innermost jump first). Safe to call multiple times. */
export function endClientChain(client: Client | null | undefined, jumpClients: Client[] = []): void {
  if (client) {
    try {
      client.end()
    } catch {
      // ignore
    }
  }
  for (let i = jumpClients.length - 1; i >= 0; i--) {
    try {
      jumpClients[i].end()
    } catch {
      // ignore
    }
  }
}

/**
 * Connect to `node`, optionally through its jumpHostId chain (ProxyJump).
 * Caller must call `endClientChain(result.client, result.jumpClients)` when done.
 */
export async function connectViaJump(
  node: SshNode,
  getNode: (id: string) => SshNode | null | undefined,
  verifyHostKey?: HostKeyVerifier
): Promise<SshConnectResult> {
  const chain = resolveHopChain(node, getNode)
  const jumpClients: Client[] = []
  let current: Client | null = null

  try {
    for (let i = 0; i < chain.length; i++) {
      const hop = chain[i]
      let sock: ClientChannel | undefined
      if (i > 0 && current) {
        sock = await forwardOut(current, hop.host, hop.port)
        jumpClients.push(current)
        current = null
      }
      const cfg = await makeConnectConfig(hop, verifyHostKey, sock)
      current = await connectClient(cfg)
    }
    if (!current) throw new Error('CONNECTION_FAILED')
    return { client: current, jumpClients }
  } catch (err) {
    endClientChain(current, jumpClients)
    throw err
  }
}
