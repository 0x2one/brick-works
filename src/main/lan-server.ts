import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { networkInterfaces } from 'os'
import { basename, join, resolve, sep } from 'path'
import { createReadStream, createWriteStream, promises as fsp } from 'fs'
import { pipeline } from 'stream/promises'
import lanWebHtml from './lan-web/index.html?raw'

const TMP_DIR = '.brickworks-tmp'

export interface LanServerInfo {
  ip: string
  port: number
  url: string
}

export interface LanStatus {
  running: boolean
  ip: string | null
  port: number | null
  url: string | null
  dir: string | null
}

export function getLanIps(): string[] {
  const ips: string[] = []
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address)
    }
  }
  const isPrivate = (ip: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
  return ips.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)))
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const ERR_MSGS: Record<string, { zh: string; en: string }> = {
  OUT_OF_RANGE: { zh: '路径超出管理目录范围', en: 'Path is outside the managed folder' },
  INVALID_NAME: { zh: '文件名无效', en: 'Invalid file name' },
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

export interface LanServer {
  isRunning: () => boolean
  getInfo: () => LanServerInfo
  start: () => Promise<LanServerInfo>
  stop: () => Promise<void>
  setLang: (lang: string) => void
}

export function createLanServer(rootDir: string, initialLang = 'zh'): LanServer {
  let server: Server | null = null
  let port = 0
  let lang: string = initialLang === 'en' ? 'en' : 'zh'
  const tmpRoot = join(rootDir, TMP_DIR)

  function resolveSafe(rel: string): string {
    const clean = decodeURIComponent(rel).replace(/\\/g, '/').replace(/^\/+/, '')
    const target = resolve(rootDir, clean)
    if (target !== rootDir && !target.startsWith(rootDir + sep)) {
      throw new HttpError('OUT_OF_RANGE')
    }
    return target
  }

  function getInfo(): LanServerInfo {
    const ip = getLanIps()[0] ?? '127.0.0.1'
    return { ip, port, url: `http://${ip}:${port}/` }
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
        const dir = resolveSafe(query.get('path') ?? '')
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        const items: Array<{ name: string; isDir: boolean; size: number; mtime: number }> = []
        for (const entry of entries) {
          if (entry.name === TMP_DIR) continue
          let size = 0
          let mtime = 0
          try {
            const s = await fsp.stat(join(dir, entry.name))
            size = s.size
            mtime = s.mtimeMs
          } catch {
            // broken symlink etc.
          }
          items.push({ name: entry.name, isDir: entry.isDirectory(), size, mtime })
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
        const dir = resolveSafe(query.get('dir') ?? '')
        const name = basename(decodeURIComponent(query.get('name') ?? ''))
        if (!name || name === '.' || name === '..') {
          throw new HttpError('INVALID_NAME')
        }
        const session = decodeURIComponent(query.get('session') ?? '') || String(Date.now())
        const index = Number(query.get('index') ?? '0')
        const total = Number(query.get('total') ?? '1')
        const tmpFile = join(tmpRoot, `${session}.part`)
        await pipeline(req, createWriteStream(tmpFile, { flags: 'a' }))
        const isLast = index + 1 >= total
        if (isLast) {
          await fsp.rename(tmpFile, join(dir, name))
        }
        sendJson(res, 200, { ok: true, done: isLast })
        return
      }

      if (pathname === '/api/download') {
        const file = resolveSafe(query.get('path') ?? '')
        const s = await fsp.stat(file)
        if (!s.isFile()) {
          throw new HttpError('NOT_FILE')
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': s.size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`
        })
        await pipeline(createReadStream(file), res)
        return
      }

      if (pathname === '/api/mkdir' && req.method === 'POST') {
        const dir = resolveSafe(query.get('path') ?? '')
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
      await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
    },
    setLang(next: string): void {
      lang = next === 'en' ? 'en' : 'zh'
    }
  }
}
