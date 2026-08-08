import { Client, type ClientChannel, type SFTPWrapper, type FileEntry } from 'ssh2'
import { promises as fsp } from 'fs'
import { dirname, join, basename } from 'path'
import { randomUUID } from 'crypto'
import type { SshNode } from './ssh-store'
import { connectViaJump, endClientChain } from './ssh-connect'

export interface SshShellStartOpts {
  nodeId: string
  cols?: number
  rows?: number
  term?: string
}

export interface SshShellData {
  sessionId: string
  data: string
}

export interface SshShellExit {
  sessionId: string
  reason?: string
}

export interface SshSftpEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifyTime: number
  accessTime: number
  owner?: number
  group?: number
  mode?: number
  /** true when the entry is a symbolic link; `type` is resolved to the link target */
  isSymlink?: boolean
}

export interface SshSftpReadResult {
  ok: boolean
  content?: string
  binary?: boolean
  truncated?: boolean
  size?: number
  maxBytes?: number
  error?: string
}

export const SSH_SFTP_READ_MAX_BYTES = 10 * 1024 * 1024

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

export interface SshClientManagerOptions {
  getNode: (nodeId: string) => SshNode | undefined
  verifyHostKey?: (host: string, port: number, key: Buffer) => boolean | Promise<boolean>
}

function posixJoin(base: string, name: string): string {
  if (base === '/' || base === '') return `/${name}`
  return `${base.replace(/\/+$/, '')}/${name}`
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000
const S_IFREG = 0o100000

function entryType(attrs: {
  mode?: number
  isDirectory?: () => boolean
  isSymbolicLink?: () => boolean
  isFile?: () => boolean
}): SshSftpEntry['type'] {
  if (typeof attrs.isDirectory === 'function') {
    if (attrs.isDirectory()) return 'directory'
    if (attrs.isSymbolicLink?.()) return 'symlink'
    if (attrs.isFile?.()) return 'file'
    return 'other'
  }
  const mode = attrs.mode ?? 0
  const type = mode & S_IFMT
  if (type === S_IFDIR) return 'directory'
  if (type === S_IFLNK) return 'symlink'
  if (type === S_IFREG) return 'file'
  return 'other'
}

interface ShellSession {
  sessionId: string
  nodeId: string
  client: Client
  jumpClients: Client[]
  channel: ClientChannel
}

interface SftpSession {
  nodeId: string
  client: Client
  jumpClients: Client[]
  sftp: SFTPWrapper
}

export function createSshClientManager(options: SshClientManagerOptions): {
  startShell: (opts: SshShellStartOpts) => Promise<{ sessionId: string }>
  writeShell: (sessionId: string, dataBase64: string) => Promise<boolean>
  resizeShell: (sessionId: string, cols: number, rows: number) => Promise<boolean>
  stopShell: (sessionId: string) => Promise<boolean>
  sftpList: (nodeId: string, remotePath: string) => Promise<SshSftpEntry[]>
  sftpDownloadFile: (
    nodeId: string,
    remotePath: string,
    localPath: string
  ) => Promise<{ ok: boolean; error?: string }>
  sftpDownloadDir: (
    nodeId: string,
    remotePath: string,
    localDir: string
  ) => Promise<{ ok: boolean; count: number; error?: string }>
  sftpUploadFiles: (
    nodeId: string,
    remoteDir: string,
    localPaths: string[]
  ) => Promise<{ ok: boolean; count: number; error?: string }>
  sftpMkdir: (nodeId: string, remotePath: string) => Promise<{ ok: boolean; error?: string }>
  sftpWriteFile: (
    nodeId: string,
    remotePath: string,
    content?: string
  ) => Promise<{ ok: boolean; error?: string }>
  sftpReadFile: (
    nodeId: string,
    remotePath: string,
    maxBytes?: number
  ) => Promise<SshSftpReadResult>
  disconnectNode: (nodeId: string) => void
  disconnectSftp: (nodeId: string) => void
  stop: () => void
  onShellData: (cb: (data: SshShellData) => void) => () => void
  onShellExit: (cb: (data: SshShellExit) => void) => () => void
} {
  const shells = new Map<string, ShellSession>()
  const sftps = new Map<string, SftpSession>()
  const sftpInflight = new Map<string, Promise<SftpSession>>()
  const shellDataListeners = new Set<(data: SshShellData) => void>()
  const shellExitListeners = new Set<(data: SshShellExit) => void>()

  function emitShellData(data: SshShellData): void {
    for (const cb of shellDataListeners) cb(data)
  }

  function emitShellExit(data: SshShellExit): void {
    for (const cb of shellExitListeners) cb(data)
  }

  function cleanupShell(sessionId: string, reason?: string, silent = false): void {
    const session = shells.get(sessionId)
    if (!session) return
    shells.delete(sessionId)
    try {
      session.channel.close()
    } catch {
      // ignore
    }
    endClientChain(session.client, session.jumpClients)
    if (!silent) emitShellExit({ sessionId, reason })
  }

  async function openClient(
    nodeId: string
  ): Promise<{ node: SshNode; client: Client; jumpClients: Client[] }> {
    const node = options.getNode(nodeId)
    if (!node) throw new Error('NODE_NOT_FOUND')
    const { client, jumpClients } = await connectViaJump(
      node,
      options.getNode,
      options.verifyHostKey
    )
    return { node, client, jumpClients }
  }

  async function ensureSftp(nodeId: string): Promise<SftpSession> {
    const existing = sftps.get(nodeId)
    if (existing) return existing
    const inflight = sftpInflight.get(nodeId)
    if (inflight) return inflight

    const promise = (async (): Promise<SftpSession> => {
      const { client, jumpClients } = await openClient(nodeId)
      try {
        return await new Promise<SftpSession>((resolve, reject) => {
          client.sftp((err, sftp) => {
            if (err || !sftp) {
              endClientChain(client, jumpClients)
              reject(new Error(err?.message || 'SFTP_FAILED'))
              return
            }
            const session: SftpSession = { nodeId, client, jumpClients, sftp }
            const prev = sftps.get(nodeId)
            if (prev && prev !== session) {
              endClientChain(prev.client, prev.jumpClients)
            }
            sftps.set(nodeId, session)
            client.on('close', () => {
              if (sftps.get(nodeId) === session) {
                sftps.delete(nodeId)
                endClientChain(null, jumpClients)
              }
            })
            client.on('error', () => {
              if (sftps.get(nodeId) === session) {
                sftps.delete(nodeId)
                endClientChain(client, jumpClients)
              }
            })
            resolve(session)
          })
        })
      } finally {
        sftpInflight.delete(nodeId)
      }
    })()

    sftpInflight.set(nodeId, promise)
    try {
      return await promise
    } catch (err) {
      sftpInflight.delete(nodeId)
      throw err
    }
  }

  function statFollow(
    sftp: SFTPWrapper,
    remotePath: string
  ): Promise<{ type: SshSftpEntry['type']; size: number; modifyTime: number }> {
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err || !stats) {
          reject(new Error(err?.message || 'SFTP_STAT_FAILED'))
          return
        }
        resolve({
          type: entryType(stats),
          size: stats.size ?? 0,
          modifyTime: (stats.mtime ?? 0) * 1000
        })
      })
    })
  }

  async function listDir(sftp: SFTPWrapper, remotePath: string): Promise<SshSftpEntry[]> {
    const list = await new Promise<FileEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (err, l) => {
        if (err) {
          reject(new Error(err.message || 'SFTP_LIST_FAILED'))
          return
        }
        resolve((l || []) as FileEntry[])
      })
    })
    const entries: SshSftpEntry[] = list.map((item) => {
      const attrs = item.attrs
      return {
        name: item.filename,
        path: posixJoin(remotePath === '.' ? '/' : remotePath, item.filename),
        type: entryType(attrs),
        size: attrs.size ?? 0,
        modifyTime: (attrs.mtime ?? 0) * 1000,
        accessTime: (attrs.atime ?? 0) * 1000,
        owner: attrs.uid,
        group: attrs.gid,
        mode: attrs.mode
      }
    })
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.type !== 'symlink') return
        try {
          const resolved = await statFollow(sftp, entry.path)
          entry.type = resolved.type
          entry.size = resolved.size
          entry.modifyTime = resolved.modifyTime
          entry.isSymlink = true
        } catch {
          entry.isSymlink = true
        }
      })
    )
    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
    return entries
  }

  function downloadOneFile(
    sftp: SFTPWrapper,
    remotePath: string,
    localPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err) => {
        if (err) reject(new Error(err.message || 'SFTP_DOWNLOAD_FAILED'))
        else resolve()
      })
    })
  }

  function uploadOneFile(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) reject(new Error(err.message || 'SFTP_UPLOAD_FAILED'))
        else resolve()
      })
    })
  }

  function mkdirRemote(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) reject(new Error(err.message || 'SFTP_MKDIR_FAILED'))
        else resolve()
      })
    })
  }

  function writeRemoteFile(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, Buffer.from(content, 'utf8'), (err) => {
        if (err) reject(new Error(err.message || 'SFTP_WRITE_FAILED'))
        else resolve()
      })
    })
  }

  function readRemoteFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      sftp.readFile(remotePath, (err, data) => {
        if (err) reject(new Error(err.message || 'SFTP_READ_FAILED'))
        else resolve(Buffer.isBuffer(data) ? data : Buffer.from(data))
      })
    })
  }

  function looksBinary(buf: Buffer): boolean {
    const limit = Math.min(buf.length, 8192)
    for (let i = 0; i < limit; i++) {
      if (buf[i] === 0) return true
    }
    return false
  }

  function closeSftp(nodeId: string): void {
    const sftp = sftps.get(nodeId)
    if (!sftp) return
    sftps.delete(nodeId)
    endClientChain(sftp.client, sftp.jumpClients)
  }

  async function downloadTree(
    sftp: SFTPWrapper,
    remotePath: string,
    localDir: string
  ): Promise<number> {
    await fsp.mkdir(localDir, { recursive: true })
    const entries = await listDir(sftp, remotePath)
    let count = 0
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      const localPath = join(localDir, entry.name)
      if (entry.type === 'directory' && !entry.isSymlink) {
        count += await downloadTree(sftp, entry.path, localPath)
      } else if (entry.type === 'file' || entry.type === 'symlink') {
        await fsp.mkdir(dirname(localPath), { recursive: true })
        await downloadOneFile(sftp, entry.path, localPath)
        count += 1
      }
    }
    return count
  }

  function statPath(
    sftp: SFTPWrapper,
    remotePath: string
  ): Promise<{ type: SshSftpEntry['type']; size: number }> {
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err || !stats) {
          reject(new Error(err?.message || 'SFTP_STAT_FAILED'))
          return
        }
        resolve({ type: entryType(stats), size: stats.size ?? 0 })
      })
    })
  }

  return {
    async startShell(opts) {
      const cols = Math.max(2, opts.cols ?? 80)
      const rows = Math.max(1, opts.rows ?? 24)
      const term = opts.term || 'xterm-256color'
      const { client, jumpClients } = await openClient(opts.nodeId)
      return new Promise((resolve, reject) => {
        client.shell({ term, cols, rows }, (err, channel) => {
          if (err || !channel) {
            endClientChain(client, jumpClients)
            reject(new Error(normalizeSshError(err?.message || 'SHELL_FAILED')))
            return
          }
          const sessionId = randomUUID()
          const session: ShellSession = {
            sessionId,
            nodeId: opts.nodeId,
            client,
            jumpClients,
            channel
          }
          shells.set(sessionId, session)

          channel.on('data', (chunk: Buffer | string) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            emitShellData({ sessionId, data: buf.toString('base64') })
          })
          channel.stderr?.on('data', (chunk: Buffer | string) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            emitShellData({ sessionId, data: buf.toString('base64') })
          })
          channel.on('close', () => cleanupShell(sessionId))
          channel.on('exit', (_code, _signal, dump, desc) => {
            cleanupShell(sessionId, desc || (dump ? 'dump' : undefined))
          })
          client.on('close', () => cleanupShell(sessionId, 'closed'))
          client.on('error', () => cleanupShell(sessionId, 'error'))

          resolve({ sessionId })
        })
      })
    },

    async writeShell(sessionId, dataBase64) {
      const session = shells.get(sessionId)
      if (!session) return false
      session.channel.write(Buffer.from(dataBase64, 'base64'))
      return true
    },

    async resizeShell(sessionId, cols, rows) {
      const session = shells.get(sessionId)
      if (!session) return false
      try {
        session.channel.setWindow(Math.max(1, rows), Math.max(2, cols), 0, 0)
        return true
      } catch {
        return false
      }
    },

    async stopShell(sessionId) {
      const session = shells.get(sessionId)
      if (!session) return false
      cleanupShell(sessionId, 'stopped')
      return true
    },

    async sftpList(nodeId, remotePath) {
      const session = await ensureSftp(nodeId)
      const path = remotePath?.trim() || '/'
      return listDir(session.sftp, path)
    },

    async sftpDownloadFile(nodeId, remotePath, localPath) {
      try {
        const session = await ensureSftp(nodeId)
        await fsp.mkdir(dirname(localPath), { recursive: true })
        await downloadOneFile(session.sftp, remotePath, localPath)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    async sftpDownloadDir(nodeId, remotePath, localDir) {
      try {
        const session = await ensureSftp(nodeId)
        const stats = await statPath(session.sftp, remotePath)
        if (stats.type !== 'directory') {
          const fileName = basename(remotePath)
          const localPath = join(localDir, fileName)
          await fsp.mkdir(localDir, { recursive: true })
          await downloadOneFile(session.sftp, remotePath, localPath)
          return { ok: true, count: 1 }
        }
        const folderName = basename(remotePath.replace(/\/+$/, '') || 'download')
        const target = join(localDir, folderName)
        const count = await downloadTree(session.sftp, remotePath, target)
        return { ok: true, count }
      } catch (err) {
        return { ok: false, count: 0, error: (err as Error).message }
      }
    },

    async sftpUploadFiles(nodeId, remoteDir, localPaths) {
      try {
        const session = await ensureSftp(nodeId)
        const dir = remoteDir?.trim() || '/'
        let count = 0
        for (const localPath of localPaths) {
          const name = basename(localPath)
          if (!name) continue
          await uploadOneFile(session.sftp, localPath, posixJoin(dir, name))
          count += 1
        }
        return { ok: true, count }
      } catch (err) {
        return { ok: false, count: 0, error: (err as Error).message }
      }
    },

    async sftpMkdir(nodeId, remotePath) {
      try {
        const session = await ensureSftp(nodeId)
        await mkdirRemote(session.sftp, remotePath)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    async sftpWriteFile(nodeId, remotePath, content = '') {
      try {
        const session = await ensureSftp(nodeId)
        await writeRemoteFile(session.sftp, remotePath, content)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    async sftpReadFile(nodeId, remotePath, maxBytes = SSH_SFTP_READ_MAX_BYTES) {
      try {
        const session = await ensureSftp(nodeId)
        const stats = await statPath(session.sftp, remotePath)
        if (stats.type !== 'file') {
          return { ok: false, error: 'SFTP_READ_FAILED' }
        }
        if (stats.size > maxBytes) {
          return { ok: false, error: 'FILE_TOO_LARGE', size: stats.size, maxBytes }
        }
        const buf = await readRemoteFile(session.sftp, remotePath)
        if (buf.length > maxBytes) {
          return { ok: false, error: 'FILE_TOO_LARGE', size: buf.length, maxBytes }
        }
        if (looksBinary(buf)) {
          return { ok: true, binary: true, size: buf.length }
        }
        return { ok: true, content: buf.toString('utf8'), size: buf.length }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    disconnectSftp(nodeId) {
      closeSftp(nodeId)
    },

    disconnectNode(nodeId) {
      for (const [id, session] of shells) {
        if (session.nodeId === nodeId) cleanupShell(id, 'node-removed')
      }
      closeSftp(nodeId)
    },

    stop() {
      for (const id of [...shells.keys()]) cleanupShell(id, 'stopped', true)
      for (const nodeId of [...sftps.keys()]) closeSftp(nodeId)
    },

    onShellData(cb) {
      shellDataListeners.add(cb)
      return () => shellDataListeners.delete(cb)
    },

    onShellExit(cb) {
      shellExitListeners.add(cb)
      return () => shellExitListeners.delete(cb)
    }
  }
}
