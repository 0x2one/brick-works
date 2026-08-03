import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { networkInterfaces } from 'os'
import { basename, join, resolve, sep } from 'path'
import { createReadStream, createWriteStream, promises as fsp } from 'fs'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import lanWebHtml from './lan-web/index.html?raw'

const TMP_DIR = '.brickworks-tmp'
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024
const SESSION_RE = /^[A-Za-z0-9_-]+$/

export interface LanServerInfo {
  ip: string
  port: number
  url: string
  token: string
  ips: string[]
}

export interface LanStatus {
  running: boolean
  ip: string | null
  port: number | null
  url: string | null
  dir: string | null
  token: string | null
  ips: string[]
}

interface UploadSession {
  nextIndex: number
  total: number
  bytes: number
}

export function getLanIps(): string[] {
  const list: Array<{ ip: string; isPrivate: boolean; isVirtual: boolean }> = []
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        list.push({
          ip: net.address,
          isPrivate: /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address),
          isVirtual:
            /virtual|vmware|vbox|hyper-v|vehternet|tailscale|zerotier|docker|wsl|npcap/i.test(name)
        })
      }
    }
  }
  // Prefer physical private LAN addresses, then other private, then the rest.
  return list
    .sort((a, b) => {
      const score = (x: { isPrivate: boolean; isVirtual: boolean }): number =>
        x.isPrivate ? (x.isVirtual ? 2 : 0) : x.isVirtual ? 3 : 1
      return score(a) - score(b)
    })
    .map((x) => x.ip)
}

export function generateLanToken(): string {
  return randomBytes(24).toString('base64url')
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const ERR_MSGS: Record<string, { zh: string; en: string }> = {
  OUT_OF_RANGE: { zh: '路径超出管理目录范围', en: 'Path is outside the managed folder' },
  INVALID_NAME: { zh: '文件名无效', en: 'Invalid file name' },
  INVALID_SESSION: { zh: '上传会话无效', en: 'Invalid upload session' },
  AUTH_REQUIRED: { zh: '需要访问口令', en: 'Access token required' },
  TOO_LARGE: { zh: '文件过大', en: 'File too large' },
  NOT_FOUND: { zh: '接口不存在', en: 'Endpoint not found' },
  NOT_FILE: { zh: '不是文件', en: 'Not a file' },
  INTERNAL: { zh: '服务器内部错误', en: 'Internal server error' }
}

class HttpError extends Error {
  code: string
  status: number

  constructor(code: string, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

function errMessage(code: string, lang: string): string {
  return ERR_MSGS[code]?.[lang === 'en' ? 'en' : 'zh'] ?? code
}

function langFromUrl(url: string): string {
  const query = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '')
  return query.get('lang') === 'en' ? 'en' : 'zh'
}

function extractToken(req: IncomingMessage): string {
  const header = req.headers['x-lan-token']
  if (typeof header === 'string' && header.trim()) return header.trim()
  if (Array.isArray(header) && header[0]?.trim()) return header[0].trim()
  return ''
}

function isInsideRoot(rootDir: string, target: string): boolean {
  return target === rootDir || target.startsWith(rootDir + sep)
}

export interface LanServer {
  isRunning: () => boolean
  getInfo: () => LanServerInfo
  start: () => Promise<LanServerInfo>
  stop: () => Promise<void>
  setLang: (lang: string) => void
  setIp: (ip: string | null) => void
}

export function createLanServer(rootDir: string, initialLang = 'zh', token: string): LanServer {
  let server: Server | null = null
  let port = 0
  let lang: string = initialLang === 'en' ? 'en' : 'zh'
  let selectedIp: string | null = null
  const tmpRoot = join(rootDir, TMP_DIR)
  const uploadSessions = new Map<string, UploadSession>()

  async function assertPathInRoot(target: string): Promise<void> {
    if (!isInsideRoot(rootDir, target)) throw new HttpError('OUT_OF_RANGE')
    try {
      const lst = await fsp.lstat(target)
      if (lst.isSymbolicLink()) throw new HttpError('OUT_OF_RANGE')
      const real = await fsp.realpath(target)
      if (!isInsideRoot(rootDir, real)) throw new HttpError('OUT_OF_RANGE')
    } catch (err) {
      if (err instanceof HttpError) throw err
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Missing path: walk up to nearest existing ancestor and validate it.
        let ancestor = resolve(target, '..')
        for (;;) {
          try {
            const lst = await fsp.lstat(ancestor)
            if (lst.isSymbolicLink()) throw new HttpError('OUT_OF_RANGE')
            const real = await fsp.realpath(ancestor)
            if (!isInsideRoot(rootDir, real)) throw new HttpError('OUT_OF_RANGE')
            return
          } catch (e) {
            if (e instanceof HttpError) throw e
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new HttpError('OUT_OF_RANGE')
            if (ancestor === rootDir || !isInsideRoot(rootDir, ancestor)) {
              throw new HttpError('OUT_OF_RANGE')
            }
            ancestor = resolve(ancestor, '..')
          }
        }
      }
      throw new HttpError('OUT_OF_RANGE')
    }
  }

  async function resolveSafe(rel: string): Promise<string> {
    const clean = decodeURIComponent(rel).replace(/\\/g, '/').replace(/^\/+/, '')
    const target = resolve(rootDir, clean)
    if (!isInsideRoot(rootDir, target)) {
      throw new HttpError('OUT_OF_RANGE')
    }
    await assertPathInRoot(target)
    return target
  }

  function resolveTmpFile(session: string): string {
    const safe = basename(session)
    if (!safe || !SESSION_RE.test(safe) || safe !== session) {
      throw new HttpError('INVALID_SESSION')
    }
    return join(tmpRoot, `${safe}.part`)
  }

  function getInfo(): LanServerInfo {
    const ips = getLanIps()
    const ip = selectedIp && ips.includes(selectedIp) ? selectedIp : (ips[0] ?? '127.0.0.1')
    return { ip, port, url: `http://${ip}:${port}/?token=${encodeURIComponent(token)}`, token, ips }
  }

  function assertAuth(req: IncomingMessage): void {
    if (extractToken(req) !== token) {
      throw new HttpError('AUTH_REQUIRED', 401)
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let reqLang = 'zh'
    try {
      const url = req.url ?? '/'
      const pathname = url.split('?')[0]
      const query = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '')
      reqLang = langFromUrl(url)

      if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(lanWebHtml)
        return
      }
      if (pathname === '/favicon.ico') {
        res.writeHead(204)
        res.end()
        return
      }

      if (!pathname.startsWith('/api/')) {
        throw new HttpError('NOT_FOUND', 404)
      }
      assertAuth(req)

      if (pathname === '/api/info') {
        let total = 0
        let free = 0
        try {
          const s = await fsp.statfs(rootDir)
          total = s.blocks * s.bsize
          free = s.bavail * s.bsize
        } catch {
          // statfs may be unsupported on some platforms
        }
        sendJson(res, 200, { root: rootDir, total, free, lang })
        return
      }

      if (pathname === '/api/list') {
        const dir = await resolveSafe(query.get('path') ?? '')
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        const items: Array<{ name: string; isDir: boolean; size: number; mtime: number }> = []
        for (const entry of entries) {
          if (entry.name === TMP_DIR) continue
          const full = join(dir, entry.name)
          try {
            const lst = await fsp.lstat(full)
            if (lst.isSymbolicLink()) continue
            const s = lst.isDirectory() ? lst : await fsp.stat(full)
            items.push({
              name: entry.name,
              isDir: lst.isDirectory(),
              size: lst.isDirectory() ? 0 : s.size,
              mtime: s.mtimeMs
            })
          } catch {
            // broken entry etc.
          }
        }
        items.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name, 'zh-Hans-CN')
        })
        sendJson(res, 200, { path: query.get('path') ?? '', items })
        return
      }

      if (pathname === '/api/upload' && req.method === 'POST') {
        await fsp.mkdir(tmpRoot, { recursive: true })
        const dir = await resolveSafe(query.get('dir') ?? '')
        const name = basename(decodeURIComponent(query.get('name') ?? ''))
        if (!name || name === '.' || name === '..') {
          throw new HttpError('INVALID_NAME')
        }
        const rawSession =
          decodeURIComponent(query.get('session') ?? '') || randomBytes(16).toString('hex')
        const tmpFile = resolveTmpFile(rawSession)
        const sessionKey = basename(rawSession)
        const index = Number(query.get('index') ?? '0')
        const total = Number(query.get('total') ?? '1')
        if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1) {
          throw new HttpError('INVALID_SESSION')
        }

        let session = uploadSessions.get(sessionKey)
        if (index === 0) {
          await fsp.rm(tmpFile, { force: true }).catch(() => {})
          session = { nextIndex: 0, total, bytes: 0 }
          uploadSessions.set(sessionKey, session)
        } else if (!session || session.total !== total || index !== session.nextIndex) {
          throw new HttpError('INVALID_SESSION')
        }

        const limiter = new Transform({
          transform(chunk, _enc, cb) {
            const cur = uploadSessions.get(sessionKey)
            if (!cur) {
              cb(new HttpError('INVALID_SESSION'))
              return
            }
            const next = cur.bytes + chunk.length
            if (next > MAX_UPLOAD_BYTES) {
              cb(new HttpError('TOO_LARGE', 413))
              return
            }
            cur.bytes = next
            cb(null, chunk)
          }
        })

        try {
          await pipeline(
            req,
            limiter,
            createWriteStream(tmpFile, { flags: index === 0 ? 'w' : 'a' })
          )
        } catch (err) {
          await fsp.rm(tmpFile, { force: true }).catch(() => {})
          uploadSessions.delete(sessionKey)
          throw err
        }

        session = uploadSessions.get(sessionKey)
        if (!session) throw new HttpError('INVALID_SESSION')
        session.nextIndex = index + 1
        const done = session.nextIndex >= session.total
        if (done) {
          await fsp.rename(tmpFile, join(dir, name))
          uploadSessions.delete(sessionKey)
        }
        sendJson(res, 200, { ok: true, done })
        return
      }

      if (pathname === '/api/download') {
        const file = await resolveSafe(query.get('path') ?? '')
        const lst = await fsp.lstat(file)
        if (lst.isSymbolicLink() || !lst.isFile()) {
          throw new HttpError(lst.isSymbolicLink() ? 'OUT_OF_RANGE' : 'NOT_FILE')
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': lst.size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`
        })
        await pipeline(createReadStream(file), res)
        return
      }

      if (pathname === '/api/mkdir' && req.method === 'POST') {
        const dir = await resolveSafe(query.get('path') ?? '')
        await fsp.mkdir(dir, { recursive: true })
        sendJson(res, 200, { ok: true })
        return
      }

      throw new HttpError('NOT_FOUND', 404)
    } catch (err) {
      if (res.headersSent) {
        res.destroy()
        return
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: errMessage(err.code, reqLang), code: err.code })
        return
      }
      sendJson(res, 500, { error: errMessage('INTERNAL', reqLang), code: 'INTERNAL' })
    }
  }

  return {
    isRunning: (): boolean => server !== null,
    getInfo,
    async start(): Promise<LanServerInfo> {
      if (server) return getInfo()
      await fsp.mkdir(rootDir, { recursive: true })
      await fsp.rm(tmpRoot, { recursive: true, force: true })
      uploadSessions.clear()
      await new Promise<void>((resolveStart, rejectStart) => {
        const srv = createServer((req, res) => {
          handle(req, res).catch(() => {
            if (!res.headersSent) {
              const l = langFromUrl(req.url ?? '')
              sendJson(res, 500, { error: errMessage('INTERNAL', l), code: 'INTERNAL' })
            }
          })
        })
        server = srv
        srv.once('error', (err) => {
          server = null
          rejectStart(err)
        })
        srv.listen(0, '0.0.0.0', () => {
          const addr = srv.address()
          if (addr && typeof addr === 'object') port = addr.port
          resolveStart()
        })
      })
      return getInfo()
    },
    async stop(): Promise<void> {
      const srv = server
      server = null
      if (srv) {
        await new Promise<void>((r) => {
          srv.closeAllConnections?.()
          srv.close(() => r())
        })
      }
      port = 0
      uploadSessions.clear()
      await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
    },
    setLang(next: string): void {
      lang = next === 'en' ? 'en' : 'zh'
    },
    setIp(next: string | null): void {
      selectedIp = next && getLanIps().includes(next) ? next : null
    }
  }
}
