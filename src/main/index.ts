import {
  app,
  shell,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  net,
  Tray,
  Menu,
  globalShortcut,
  clipboard
} from 'electron'
import { promises as dns } from 'dns'
import { join, basename } from 'path'
import { promises as fsp } from 'fs'
import { isIP } from 'net'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import iconPng from '../../resources/icon.png?asset'
import { createLanServer, generateLanToken, type LanStatus } from './lan-server'
import { createSshStore, type SshNodeInput, validateJumpHostId } from './ssh-store'
import {
  createSshManager,
  isLoopbackAddr,
  type SshTunnelSpec,
  type SshTunnelType
} from './ssh-manager'
import { createSshClientManager, type SshShellStartOpts } from './ssh-client-manager'
import { createK8sStore, defaultKubeconfigPath, type K8sClusterInput } from './k8s-store'
import { createK8sManager } from './k8s-manager'
import { createStickyStore, type StickyData } from './sticky-store'
import { createAppSettingsStore, DEFAULT_SHOW_SHORTCUT } from './app-settings'
import { createUpdater, type UpdaterStatus } from './updater'
import {
  allowLocalPath,
  assertAllowedLocalPath,
  seedAllowedPaths as seedAllowedPathsInto
} from './path-allowlist'

const gotTheLock = app.requestSingleInstanceLock()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let terminalPasteActive = false
const appSettingsStore = createAppSettingsStore()
const updater = createUpdater(sendToRenderer, () => appSettingsStore.get().autoDownload)

const MAX_FETCH_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_FETCH_SVG_BYTES = 2 * 1024 * 1024

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const wc = win.webContents
  if (!wc || wc.isDestroyed()) return
  wc.send(channel, ...args)
}

function isPrivateIpv4(parts: number[]): boolean {
  if (parts.length !== 4 || parts.some((n) => n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 127 || a === 10 || a === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  return false
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true
  }
  if (host === '169.254.169.254' || host.startsWith('169.254.')) return true

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
  const mappedDotted = host.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (mappedDotted) {
    return isPrivateIpv4(mappedDotted.slice(1).map(Number))
  }
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16)
    const lo = parseInt(mappedHex[2], 16)
    return isPrivateIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff])
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    return isPrivateIpv4(ipv4.slice(1).map(Number))
  }
  // IPv6 ULA / link-local / loopback
  if (host.includes(':')) {
    if (
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80')
    ) {
      return true
    }
  }
  return false
}

function parseSafeHttpUrl(raw: unknown, opts?: { allowPrivate?: boolean }): URL | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!opts?.allowPrivate && isPrivateOrLocalHostname(u.hostname)) return null
    return u
  } catch {
    return null
  }
}

function isPrivateResolvedAddress(address: string, family: number | string): boolean {
  const fam = typeof family === 'string' ? Number(family) : family
  if (fam === 4 || isIP(address) === 4) {
    const parts = address.split('.').map(Number)
    return isPrivateIpv4(parts)
  }
  // IPv6 — reuse hostname checks (loopback / ULA / link-local / mapped)
  return isPrivateOrLocalHostname(address)
}

async function assertSafeFetchUrl(url: string): Promise<URL | null> {
  const parsed = parseSafeHttpUrl(url)
  if (!parsed) return null
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  // Literal IPs already covered by parseSafeHttpUrl; still resolve hostnames.
  if (isIP(host)) return parsed
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true })
    if (!records.length) return null
    if (records.some((r) => isPrivateResolvedAddress(r.address, r.family))) return null
    return parsed
  } catch {
    return null
  }
}

async function openExternalSafe(raw: unknown, opts?: { allowPrivate?: boolean }): Promise<void> {
  const u = parseSafeHttpUrl(raw, opts)
  if (!u) return
  await shell.openExternal(u.toString())
}

async function fetchLimitedBytes(url: string, maxBytes: number): Promise<Buffer | null> {
  // Follow redirects manually so each hop is re-checked (hostname + resolved IPs).
  let current = url
  for (let hop = 0; hop < 5; hop++) {
    if (!(await assertSafeFetchUrl(current))) return null
    const response = await net.fetch(current, { redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location')
      if (!loc) return null
      try {
        current = new URL(loc, current).toString()
      } catch {
        return null
      }
      continue
    }
    if (!response.ok) return null
    if (response.url && !(await assertSafeFetchUrl(response.url))) return null
    const len = response.headers.get('content-length')
    if (len && Number(len) > maxBytes) return null
    const reader = response.body?.getReader()
    if (!reader) {
      const buf = Buffer.from(await response.arrayBuffer())
      return buf.length > maxBytes ? null : buf
    }
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel().catch(() => {})
          return null
        }
        chunks.push(value)
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)))
  }
  return null
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.setSkipTaskbar(false)
  mainWindow.show()
  mainWindow.focus()
}

function hideMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // Only drop from the taskbar when a tray icon exists to re-open it from.
  if (appSettingsStore.get().closeToTray) {
    mainWindow.setSkipTaskbar(true)
  }
  mainWindow.hide()
}

/* ── Global "show window" shortcut ── */

let registeredShortcut: string | null = null

function toggleShowWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  // Second press while the window is in the foreground → hide it.
  if (
    mainWindow.isVisible() &&
    (mainWindow.isFocused() || BrowserWindow.getFocusedWindow() === mainWindow)
  ) {
    hideMainWindow()
    return
  }
  // First press (hidden) or summoned from the background → show + focus.
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.setSkipTaskbar(false)
  mainWindow.show()
  mainWindow.focus()
}

function tryRegisterAccel(accel: string): 'ok' | 'conflict' | 'invalid' {
  try {
    if (globalShortcut.register(accel, () => toggleShowWindow())) {
      registeredShortcut = accel
      return 'ok'
    }
    // register() returns false when another application (or the OS) already
    // owns this accelerator — it is silently taken, never delivered to us.
    return 'conflict'
  } catch {
    // Invalid accelerator string
    return 'invalid'
  }
}

function applyShowShortcut(accel: string | null): {
  ok: boolean
  error?: string
  shortcut: string
} {
  const prev = registeredShortcut
  const trimmed = accel?.trim() ?? ''
  if (prev) {
    globalShortcut.unregister(prev)
    registeredShortcut = null
  }
  if (!trimmed) return { ok: true, shortcut: '' }
  const result = tryRegisterAccel(trimmed)
  if (result === 'ok') return { ok: true, shortcut: trimmed }
  // Registration failed — restore the previous shortcut and report why.
  if (prev) tryRegisterAccel(prev)
  return { ok: false, error: result === 'conflict' ? 'CONFLICT' : 'INVALID', shortcut: prev ?? '' }
}

function trayLabels(): { show: string; quit: string } {
  const zh = app.getLocale().toLowerCase().startsWith('zh')
  return zh ? { show: '显示窗口', quit: '退出' } : { show: 'Show', quit: 'Quit' }
}

function destroyTray(): void {
  if (!tray) return
  tray.destroy()
  tray = null
}

function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(iconPng)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('BrickWorks')
  const labels = trayLabels()
  const menu = Menu.buildFromTemplate([
    {
      label: labels.show,
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: labels.quit,
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  // Let the OS place the menu next to the tray icon (avoids wrong manual offsets).
  tray.setContextMenu(menu)
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

function syncTrayWithSettings(): void {
  if (appSettingsStore.get().closeToTray) {
    createTray()
  } else {
    destroyTray()
  }
}

/**
 * Replace the default application menu (which registers a "Find" role that
 * swallows Ctrl/Cmd+F before it reaches the renderer) with a minimal one that
 * keeps the standard edit shortcuts but leaves Ctrl/Cmd+F to the web contents.
 */
function setupAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: 'appMenu' }, { role: 'windowMenu' }] as const) : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const winOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(iconPng),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }
  if (process.platform === 'darwin') {
    // Native macOS traffic lights over a full-width custom title bar
    winOptions.titleBarStyle = 'hiddenInset'
    winOptions.trafficLightPosition = { x: 14, y: 13 }
  } else {
    winOptions.frame = false
  }
  mainWindow = new BrowserWindow(winOptions)

  // Guarantee terminal shortcuts (Ctrl/Cmd+F, Ctrl/Cmd+/-/0, and Ctrl/Cmd+V while a
  // terminal is focused) reach the renderer: the default app menu's find/zoom/paste
  // roles and page-level handlers can swallow them.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    if (!mod || input.alt) return
    const key = input.key.toLowerCase()
    if (
      key === 'f' ||
      key === '=' ||
      key === '+' ||
      key === '-' ||
      key === '_' ||
      key === '0' ||
      (key === 'v' && terminalPasteActive)
    ) {
      event.preventDefault()
      mainWindow?.webContents.send('app:shortcut', key)
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting && appSettingsStore.get().closeToTray) {
      event.preventDefault()
      mainWindow?.setSkipTaskbar(true)
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('maximize', () => {
    sendToRenderer('window:maximize-change', true)
  })

  mainWindow.on('unmaximize', () => {
    sendToRenderer('window:maximize-change', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openExternalSafe(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('settings:get', () => appSettingsStore.get())

ipcMain.handle('settings:setCloseToTray', (_event, value: boolean) => {
  const settings = appSettingsStore.setCloseToTray(Boolean(value))
  syncTrayWithSettings()
  if (!settings.closeToTray && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    showMainWindow()
  }
  return settings
})

ipcMain.handle('settings:setOpenAtLogin', (_event, value: boolean) => {
  return appSettingsStore.setOpenAtLogin(Boolean(value))
})

ipcMain.handle('settings:setShowShortcut', (_event, value: string | null) => {
  const res = applyShowShortcut(value)
  if (res.ok) appSettingsStore.setShowShortcut(res.shortcut)
  return res
})

ipcMain.handle('settings:resetShowShortcut', () => {
  const res = applyShowShortcut(DEFAULT_SHOW_SHORTCUT)
  if (res.ok) appSettingsStore.setShowShortcut(res.shortcut)
  return res
})

ipcMain.handle('settings:setNavShortcut', (_event, value: boolean) => {
  return appSettingsStore.setNavShortcut(Boolean(value))
})

ipcMain.handle('settings:setAutoDownload', (_event, value: boolean) => {
  return appSettingsStore.setAutoDownload(Boolean(value))
})

ipcMain.handle('fetch:image', async (_event, url: string): Promise<string | null> => {
  const safe = await assertSafeFetchUrl(url)
  if (!safe) return null
  try {
    const buffer = await fetchLimitedBytes(safe.toString(), MAX_FETCH_IMAGE_BYTES)
    if (!buffer) return null
    const responseType = 'image/png'
    // Re-fetch headers via HEAD is skipped; sniff from extension / default
    const ext = safe.pathname.toLowerCase()
    const contentType =
      ext.endsWith('.jpg') || ext.endsWith('.jpeg')
        ? 'image/jpeg'
        : ext.endsWith('.gif')
          ? 'image/gif'
          : ext.endsWith('.webp')
            ? 'image/webp'
            : ext.endsWith('.svg')
              ? 'image/svg+xml'
              : responseType
    return `data:${contentType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
})

ipcMain.handle('fetch:svg', async (_event, url: string): Promise<string | null> => {
  const safe = await assertSafeFetchUrl(url)
  if (!safe) return null
  try {
    const buffer = await fetchLimitedBytes(safe.toString(), MAX_FETCH_SVG_BYTES)
    if (!buffer) return null
    return buffer.toString('utf-8')
  } catch {
    return null
  }
})

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false
})

ipcMain.handle('clipboard:readText', () => clipboard.readText())

ipcMain.handle('clipboard:writeText', (_event, text: string) => {
  clipboard.writeText(typeof text === 'string' ? text : '')
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  v8: process.versions.v8,
  platform: process.platform,
  arch: process.arch
}))

// Terminal pages (SSH client / K8s exec) report focus so Ctrl/Cmd+V can be routed
// to the terminal instead of the menu's paste role (which does not reliably reach
// xterm). When no terminal is focused the shortcut is left alone for normal inputs.
ipcMain.on('app:setTermPasteFocus', (_event, focused: boolean) => {
  terminalPasteActive = focused === true
})

/* ── Auto updater ── */

ipcMain.handle('updater:check', () => {
  updater.checkForUpdates()
  return updater.getStatus()
})

ipcMain.handle('updater:download', () => {
  updater.downloadUpdate()
  return updater.getStatus()
})

ipcMain.handle('updater:install', () => {
  updater.quitAndInstall()
  return true
})

ipcMain.handle('updater:getStatus', (): UpdaterStatus => updater.getStatus())

/* ── LAN transfer service ── */

let lanDir: string | null = null
let lanLang: string = 'zh'
let lanServer: ReturnType<typeof createLanServer> | null = null

function lanStatus(): LanStatus {
  if (!lanServer || !lanServer.isRunning()) {
    return { running: false, ip: null, port: null, url: null, dir: lanDir, token: null, ips: [] }
  }
  const info = lanServer.getInfo()
  return {
    running: true,
    ip: info.ip,
    port: info.port,
    url: info.url,
    dir: lanDir,
    token: info.token,
    ips: info.ips
  }
}

function broadcastLanStatus(): void {
  sendToRenderer('lan:status-change', lanStatus())
}

ipcMain.handle('lan:status', () => lanStatus())

ipcMain.handle('lan:start', async (_event, _dir?: string, lang?: string) => {
  // Ignore renderer-supplied dir; only chooseDir / default Downloads may set lanDir.
  if (lang === 'en' || lang === 'zh') lanLang = lang
  if (!lanDir) lanDir = app.getPath('downloads')
  if (lanServer?.isRunning()) return lanStatus()
  lanServer = createLanServer(lanDir, lanLang, generateLanToken())
  try {
    await lanServer.start()
    broadcastLanStatus()
    return lanStatus()
  } catch (err) {
    lanServer = null
    throw err
  }
})

ipcMain.handle('lan:stop', async () => {
  await lanServer?.stop()
  lanServer = null
  broadcastLanStatus()
  return lanStatus()
})

ipcMain.handle('lan:chooseDir', async () => {
  const options: Electron.OpenDialogOptions = {
    title: '选择管理目录',
    properties: ['openDirectory']
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  lanDir = result.filePaths[0]
  return lanDir
})

ipcMain.handle('lan:openBrowser', async (_event, url: string) => {
  // LAN share links intentionally target private IPs on the local network.
  await openExternalSafe(url, { allowPrivate: true })
})

ipcMain.handle('lan:openDir', async () => {
  if (!lanDir) return
  await shell.openPath(lanDir)
})

ipcMain.handle('lan:setLang', (_event, lang?: string) => {
  if (lang === 'en' || lang === 'zh') {
    lanLang = lang
    lanServer?.setLang(lang)
  }
  return lanLang
})

ipcMain.handle('lan:setIp', (_event, ip?: string) => {
  lanServer?.setIp(ip && typeof ip === 'string' ? ip : null)
  broadcastLanStatus()
  return lanStatus()
})

/* ── Path allowlist (dialog-selected + already-persisted paths) ── */

function seedAllowedPaths(): void {
  seedAllowedPathsInto([
    ...sshStore.list().map((n) => n.privateKeyPath),
    ...k8sStore.list().map((c) => c.kubeconfigPath),
    defaultKubeconfigPath()
  ])
}

async function confirmNewHostKey(
  host: string,
  port: number,
  fingerprint: string
): Promise<boolean> {
  const short =
    fingerprint.length > 48 ? `${fingerprint.slice(0, 24)}…${fingerprint.slice(-16)}` : fingerprint
  const zh = lanLang !== 'en'
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: zh ? ['信任并继续', '取消'] : ['Trust', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: zh ? 'SSH 主机密钥确认' : 'SSH Host Key',
    message: zh
      ? `首次连接 ${host}:${port}，是否信任该主机？`
      : `Trust host ${host}:${port} for the first connection?`,
    detail: zh
      ? `指纹 (base64):\n${short}\n\n仅在确认目标主机无误时选择信任。跳板连接时，跳板机与目标机各自需要确认一次。`
      : `Fingerprint (base64):\n${short}\n\nOnly trust this host if you expected this connection. When using a jump host, each hop may ask once.`
  }
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}

/* ── SSH tunnel service ── */

const sshStore = createSshStore()
const sshManager = createSshManager({
  getNode: (nodeId) => sshStore.get(nodeId),
  verifyHostKey: (host, port, key) =>
    sshStore.verifyHostKey(host, port, key, (fp) => confirmNewHostKey(host, port, fp))
})
const sshClientManager = createSshClientManager({
  getNode: (nodeId) => sshStore.get(nodeId) ?? undefined,
  verifyHostKey: (host, port, key) =>
    sshStore.verifyHostKey(host, port, key, (fp) => confirmNewHostKey(host, port, fp))
})

function broadcastSshStatus(): void {
  sendToRenderer('ssh:status-change', sshManager.getStatus())
}

sshManager.onStatusChange(() => broadcastSshStatus())
sshManager.onLog((entry) => {
  sendToRenderer('ssh:log', entry)
})
sshClientManager.onShellData((data) => {
  sendToRenderer('ssh:shell-data', data)
})
sshClientManager.onShellExit((data) => {
  sendToRenderer('ssh:shell-exit', data)
})
sshClientManager.onExecData((data) => {
  sendToRenderer('ssh:log-data', data)
})
sshClientManager.onTailExit((data) => {
  sendToRenderer('ssh:log-exit', data)
})

function validateNodeInput(input: SshNodeInput): string | null {
  if (!input || typeof input !== 'object') return 'INVALID'
  if (!input.name?.trim()) return 'NAME_REQUIRED'
  if (!input.host?.trim()) return 'HOST_REQUIRED'
  if (!input.username?.trim()) return 'USERNAME_REQUIRED'
  const port = Number(input.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'PORT_INVALID'
  if (input.authType !== 'password' && input.authType !== 'privateKey') return 'AUTH_INVALID'
  if (input.authType === 'privateKey' && !input.privateKeyPath?.trim()) {
    return 'KEY_REQUIRED'
  }
  if (input.jumpHostId !== undefined && input.jumpHostId !== null && input.jumpHostId !== '') {
    const jumpErr = validateJumpHostId(
      input.id,
      input.jumpHostId,
      (id) => sshStore.get(id)?.jumpHostId ?? null,
      (id) => Boolean(sshStore.get(id))
    )
    if (jumpErr) return jumpErr
  }
  return null
}

ipcMain.handle('ssh:listNodes', () => sshStore.list())

interface SshConfigCandidate {
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  privateKeyPath?: string
}

function expandHomePath(p: string): string {
  if (p === '~') return app.getPath('home')
  if (p.startsWith('~/')) return join(app.getPath('home'), p.slice(2))
  return p
}

function parseSshConfig(content: string): SshConfigCandidate[] {
  const candidates: SshConfigCandidate[] = []
  let current: Record<string, string> | null = null
  const flush = (cfg: Record<string, string>): void => {
    const patterns = (cfg.host || '').split(/[\s,]+/).filter(Boolean)
    const pattern = patterns[0] ?? ''
    if (!pattern || /[*?]/.test(pattern)) return
    const host = cfg.hostName || pattern
    const port = parseInt(cfg.port || '22', 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return
    const identityRaw = cfg.identityFile || ''
    const identity = identityRaw && !identityRaw.includes('%') ? expandHomePath(identityRaw) : undefined
    candidates.push({
      name: pattern,
      host,
      port,
      username: cfg.user || '',
      authType: identity ? 'privateKey' : 'password',
      privateKeyPath: identity
    })
  }
  const lines = content.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    const parts = eq >= 0 ? [line.slice(0, eq).trim(), line.slice(eq + 1).trim()] : line.split(/\s+/, 2)
    const key = (parts[0] ?? '').toLowerCase()
    const value = parts[1] ?? ''
    if (key === 'host') {
      if (current) flush(current)
      current = { host: value }
      continue
    }
    if (!current) continue
    if (key === 'hostname') current.hostName = value
    else if (key === 'user') current.user = value
    else if (key === 'port') current.port = value
    else if (key === 'identityfile') current.identityFile = value
  }
  if (current) flush(current)
  return candidates
}

ipcMain.handle('ssh:importSshConfig', async () => {
  const configPath = join(app.getPath('home'), '.ssh', 'config')
  try {
    const raw = await fsp.readFile(configPath, 'utf-8')
    allowLocalPath(configPath)
    const candidates = parseSshConfig(raw)
    for (const c of candidates) {
      if (c.privateKeyPath) allowLocalPath(c.privateKeyPath)
    }
    return { ok: true as const, path: configPath, candidates }
  } catch {
    return { ok: false as const, error: 'CONFIG_NOT_FOUND' }
  }
})

ipcMain.handle('ssh:saveNode', (_event, input: SshNodeInput) => {
  const err = validateNodeInput(input)
  if (err) throw new Error(err)
  if (input.authType === 'privateKey' && input.privateKeyPath?.trim()) {
    assertAllowedLocalPath(input.privateKeyPath.trim())
  }
  return sshStore.save(input)
})

ipcMain.handle('ssh:deleteNode', (_event, id: string) => {
  sshManager.disconnect(id)
  sshClientManager.disconnectNode(id)
  return sshStore.remove(id)
})

ipcMain.handle('ssh:reorderNodes', (_event, ids: string[]) => {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new Error('INVALID_IDS')
  }
  return sshStore.reorder(ids)
})

ipcMain.handle('ssh:chooseKeyFile', async () => {
  const options: Electron.OpenDialogOptions = {
    title: '选择私钥文件',
    properties: ['openFile'],
    filters: [
      { name: 'SSH Keys', extensions: ['*'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return allowLocalPath(result.filePaths[0])
})

ipcMain.handle('ssh:status', () => sshManager.getStatus())

ipcMain.handle('ssh:connect', async (_event, nodeId: string, type?: SshTunnelType) => {
  const node = sshStore.get(nodeId)
  if (!node) throw new Error('NODE_NOT_FOUND')
  const tunnels = sshStore.listTunnels(nodeId)
  const selected = type ? tunnels.filter((t) => t.type === type) : tunnels
  if (selected.length === 0) throw new Error('NO_TUNNELS')
  const session = sshManager.getStatus().find((s) => s.nodeId === nodeId)
  if (session?.state === 'connected') {
    return sshManager.startTunnels(nodeId, selected)
  }
  return sshManager.connect(node, selected)
})

ipcMain.handle('ssh:disconnect', (_event, nodeId: string) => sshManager.disconnect(nodeId))

ipcMain.handle('ssh:disconnectType', (_event, nodeId: string, type: SshTunnelType) =>
  sshManager.disconnectType(nodeId, type)
)

ipcMain.handle('ssh:disconnectAll', () => sshManager.disconnectAll())

ipcMain.handle('ssh:test', async (_event, nodeId: string) => {
  const node = sshStore.get(nodeId)
  if (!node) throw new Error('NODE_NOT_FOUND')
  return sshManager.test(node)
})

ipcMain.handle('ssh:clearHostKey', (_event, nodeId: string) => {
  return sshStore.clearHostKeyByNodeId(nodeId)
})

function isValidPort(port: unknown, allowZero = false): boolean {
  if (typeof port !== 'number' || !Number.isInteger(port)) return false
  if (allowZero && port === 0) return true
  return port >= 1 && port <= 65535
}

function validateTunnelSpec(
  spec: SshTunnelSpec,
  nodeId: string,
  excludeId?: string
): string | null {
  if (!spec || typeof spec !== 'object') return 'INVALID'
  if (spec.type !== 'local' && spec.type !== 'remote' && spec.type !== 'socks5') {
    return 'TYPE_INVALID'
  }
  if (spec.type === 'local') {
    if (!spec.remoteHost || !isValidPort(spec.remotePort)) return 'LOCAL_INCOMPLETE'
    if (!isValidPort(spec.localPort)) return 'PORT_INVALID'
  } else if (spec.type === 'remote') {
    if (spec.bindPort === undefined || !spec.targetHost || !isValidPort(spec.targetPort)) {
      return 'REMOTE_INCOMPLETE'
    }
    if (!isValidPort(spec.bindPort, true)) return 'PORT_INVALID'
  } else if (!isValidPort(spec.localPort)) {
    return 'PORT_INVALID'
  }

  if (spec.type === 'local') {
    if (!isLoopbackAddr(spec.listenAddr || '127.0.0.1')) return 'LISTEN_LOOPBACK_REQUIRED'
  }
  if (spec.type === 'socks5') {
    const listenAddr = spec.listenAddr || '127.0.0.1'
    const hasSocksAuth = Boolean(spec.socksUser?.trim() && (spec.socksPass || spec.hasSocksPass))
    if (!isLoopbackAddr(listenAddr) && !hasSocksAuth) return 'SOCKS_AUTH_REQUIRED'
  }

  const all = sshStore.listTunnels()
  if (spec.type === 'local' || spec.type === 'socks5') {
    const listenAddr = spec.listenAddr || '127.0.0.1'
    const conflict = all.some(
      (t) =>
        t.id !== excludeId &&
        (t.type === 'local' || t.type === 'socks5') &&
        t.localPort === spec.localPort &&
        (t.listenAddr || '127.0.0.1') === listenAddr
    )
    if (conflict) return 'PORT_CONFLICT'
  }
  if (spec.type === 'remote' && spec.bindPort !== 0) {
    const conflict = all.some(
      (t) =>
        t.id !== excludeId &&
        t.nodeId === nodeId &&
        t.type === 'remote' &&
        t.bindPort === spec.bindPort &&
        (t.bindAddr || '127.0.0.1') === (spec.bindAddr || '127.0.0.1')
    )
    if (conflict) return 'PORT_CONFLICT'
  }
  return null
}

function toTunnelView(spec: SshTunnelSpec): SshTunnelSpec {
  const { socksPass, ...rest } = spec
  return {
    ...rest,
    hasSocksPass: Boolean(socksPass) || Boolean(spec.hasSocksPass)
  }
}

ipcMain.handle('ssh:listTunnels', () => sshStore.listTunnels().map(toTunnelView))

ipcMain.handle('ssh:addTunnel', (_event, nodeId: string, spec: SshTunnelSpec) => {
  const err = validateTunnelSpec(spec, nodeId)
  if (err) throw new Error(err)
  const saved = sshStore.saveTunnel({ ...spec, nodeId })
  sshManager.addTunnel(nodeId, saved)
  return toTunnelView(saved)
})

ipcMain.handle('ssh:updateTunnel', (_event, nodeId: string, spec: SshTunnelSpec) => {
  if (!spec?.id) throw new Error('TUNNEL_NOT_FOUND')
  const existing = sshStore.listTunnels(nodeId).find((t) => t.id === spec.id)
  if (!existing) throw new Error('TUNNEL_NOT_FOUND')
  const err = validateTunnelSpec(
    {
      ...spec,
      hasSocksPass: Boolean(spec.socksPass?.trim()) || Boolean(existing.hasSocksPass)
    },
    nodeId,
    spec.id
  )
  if (err) throw new Error(err)
  const saved = sshStore.saveTunnel({ ...spec, nodeId, id: spec.id })
  sshManager.updateTunnel(nodeId, saved)
  return toTunnelView(saved)
})

ipcMain.handle('ssh:removeTunnel', (_event, nodeId: string, tunnelId: string) => {
  sshStore.removeTunnel(tunnelId)
  return sshManager.removeTunnel(nodeId, tunnelId)
})

ipcMain.handle('ssh:startTunnel', async (_event, nodeId: string, tunnelId: string) => {
  const spec = sshStore.listTunnels(nodeId).find((t) => t.id === tunnelId)
  if (!spec) throw new Error('TUNNEL_NOT_FOUND')
  const node = sshStore.get(nodeId)
  if (!node) throw new Error('NODE_NOT_FOUND')
  const session = sshManager.getStatus().find((s) => s.nodeId === nodeId)
  if (session?.state === 'connected' || session?.state === 'connecting') {
    return sshManager.startTunnel(nodeId, spec)
  }
  return sshManager.connect(node, [spec])
})

ipcMain.handle('ssh:stopTunnel', (_event, nodeId: string, tunnelId: string) =>
  sshManager.stopTunnel(nodeId, tunnelId)
)

ipcMain.handle('ssh:startShell', (_event, opts: SshShellStartOpts) => {
  if (!opts?.nodeId) throw new Error('NODE_NOT_FOUND')
  return sshClientManager.startShell(opts)
})

ipcMain.handle('ssh:writeShell', (_event, sessionId: string, dataBase64: string) =>
  sshClientManager.writeShell(sessionId, dataBase64)
)

ipcMain.handle('ssh:resizeShell', (_event, sessionId: string, cols: number, rows: number) =>
  sshClientManager.resizeShell(sessionId, cols, rows)
)

ipcMain.handle('ssh:stopShell', (_event, sessionId: string) =>
  sshClientManager.stopShell(sessionId)
)

ipcMain.handle('ssh:sysInfo', async (_event, nodeId: string) => {
  if (!nodeId) throw new Error('NODE_NOT_FOUND')
  return sshClientManager.sysInfo(nodeId)
})

ipcMain.handle('ssh:disconnectSysInfo', (_event, nodeId: string) => {
  sshClientManager.disconnectSysInfo(nodeId)
  return true
})

ipcMain.handle('ssh:listProcesses', async (_event, nodeId: string) => {
  if (!nodeId) throw new Error('NODE_NOT_FOUND')
  return sshClientManager.listProcesses(nodeId)
})

ipcMain.handle('ssh:killProcess', async (_event, nodeId: string, pid: number, signal?: string) => {
  if (!nodeId) throw new Error('NODE_NOT_FOUND')
  return sshClientManager.killProcess(nodeId, pid, signal)
})

ipcMain.handle('ssh:listServices', async (_event, nodeId: string) => {
  if (!nodeId) throw new Error('NODE_NOT_FOUND')
  return sshClientManager.listServices(nodeId)
})

ipcMain.handle('ssh:listPorts', async (_event, nodeId: string) => {
  if (!nodeId) throw new Error('NODE_NOT_FOUND')
  return sshClientManager.listPorts(nodeId)
})

ipcMain.handle(
  'ssh:serviceAction',
  async (
    _event,
    nodeId: string,
    unit: string,
    action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable'
  ) => {
    if (!nodeId) throw new Error('NODE_NOT_FOUND')
    return sshClientManager.serviceAction(nodeId, unit, action)
  }
)

ipcMain.handle('ssh:startLogTail', async (_event, nodeId: string, path: string) => {
  if (!nodeId) throw new Error('NODE_NOT_FOUND')
  return sshClientManager.startLogTail(nodeId, path)
})

ipcMain.handle('ssh:stopLogTail', (_event, sessionId: string) => {
  if (!sessionId) throw new Error('INVALID')
  return sshClientManager.stopLogTail(sessionId)
})

ipcMain.handle('ssh:sftpList', (_event, nodeId: string, remotePath: string) => {
  if (!nodeId) throw new Error('NODE_NOT_FOUND')
  return sshClientManager.sftpList(nodeId, remotePath || '/')
})

ipcMain.handle('ssh:sftpDownload', async (_event, nodeId: string, remotePath: string) => {
  if (!nodeId || !remotePath) throw new Error('INVALID')
  const name = basename(remotePath.replace(/\/+$/, '') || 'download')
  const saveOpts: Electron.SaveDialogOptions = {
    title: 'Save File',
    defaultPath: name
  }
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, saveOpts)
    : await dialog.showSaveDialog(saveOpts)
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  const res = await sshClientManager.sftpDownloadFile(nodeId, remotePath, result.filePath)
  return res.ok ? { ok: true, path: result.filePath } : { ok: false, error: res.error }
})

ipcMain.handle('ssh:sftpDownloadDir', async (_event, nodeId: string, remotePath: string) => {
  if (!nodeId || !remotePath) throw new Error('INVALID')
  const options: Electron.OpenDialogOptions = {
    title: '选择下载目录',
    properties: ['openDirectory', 'createDirectory']
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
  const localDir = result.filePaths[0]
  const res = await sshClientManager.sftpDownloadDir(nodeId, remotePath, localDir)
  return res.ok
    ? { ok: true, path: localDir, count: res.count }
    : { ok: false, error: res.error, count: res.count }
})

ipcMain.handle('ssh:sftpDisconnect', (_event, nodeId: string) => {
  sshClientManager.disconnectSftp(nodeId)
  return true
})

ipcMain.handle('ssh:sftpUpload', async (_event, nodeId: string, remoteDir: string) => {
  if (!nodeId) throw new Error('NODE_NOT_FOUND')
  const options: Electron.OpenDialogOptions = {
    title: '选择要上传的文件',
    properties: ['openFile', 'multiSelections']
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
  const res = await sshClientManager.sftpUploadFiles(nodeId, remoteDir || '/', result.filePaths)
  return res.ok ? { ok: true, count: res.count } : { ok: false, error: res.error, count: res.count }
})

ipcMain.handle(
  'ssh:sftpUploadPaths',
  async (_event, nodeId: string, remoteDir: string, localPaths: string[]) => {
    if (!nodeId) throw new Error('NODE_NOT_FOUND')
    if (!Array.isArray(localPaths) || localPaths.length === 0) {
      throw new Error('INVALID')
    }
    const res = await sshClientManager.sftpUploadFiles(nodeId, remoteDir || '/', localPaths)
    return res.ok ? { ok: true, count: res.count } : { ok: false, error: res.error, count: res.count }
  }
)

ipcMain.handle('ssh:sftpMkdir', async (_event, nodeId: string, remotePath: string) => {
  if (!nodeId || !remotePath) throw new Error('INVALID')
  return sshClientManager.sftpMkdir(nodeId, remotePath)
})

ipcMain.handle(
  'ssh:sftpWriteFile',
  async (_event, nodeId: string, remotePath: string, content?: string) => {
    if (!nodeId || !remotePath) throw new Error('INVALID')
    return sshClientManager.sftpWriteFile(nodeId, remotePath, content)
  }
)

ipcMain.handle('ssh:sftpReadFile', async (_event, nodeId: string, remotePath: string) => {
  if (!nodeId || !remotePath) throw new Error('INVALID')
  return sshClientManager.sftpReadFile(nodeId, remotePath)
})

/* ── K8s management ── */

const k8sStore = createK8sStore()
const k8sManager = createK8sManager(k8sStore)

function broadcastK8sStatus(): void {
  sendToRenderer('k8s:status-change', k8sManager.getStatus())
}

k8sManager.onStatusChange(() => broadcastK8sStatus())
k8sManager.onLogChunk((chunk) => {
  sendToRenderer('k8s:log-chunk', chunk)
})
k8sManager.onExecData((data) => {
  sendToRenderer('k8s:exec-data', data)
})
k8sManager.onExecExit((data) => {
  sendToRenderer('k8s:exec-exit', data)
})
k8sManager.onPortForwardStatus((list) => {
  sendToRenderer('k8s:portforward-status', list)
})

ipcMain.handle('k8s:listClusters', () => k8sStore.list())

ipcMain.handle('k8s:saveCluster', async (_event, input: K8sClusterInput) => {
  if (!input?.name?.trim()) throw new Error('NAME_REQUIRED')
  if (!input.kubeconfigPath?.trim() && !input.kubeconfigContent?.trim()) {
    throw new Error('KUBECONFIG_REQUIRED')
  }
  if (!input.context?.trim()) throw new Error('CONTEXT_REQUIRED')
  if (input.kubeconfigContent?.trim()) {
    await k8sManager.assertKubeconfigContentSafe(input.kubeconfigContent)
  } else if (input.kubeconfigPath?.trim()) {
    assertAllowedLocalPath(input.kubeconfigPath.trim())
    await k8sManager.assertKubeconfigPathSafe(input.kubeconfigPath.trim())
  }
  return k8sStore.save(input)
})

ipcMain.handle('k8s:deleteCluster', (_event, id: string) => {
  const status = k8sManager.getStatus()
  if (status.clusterId === id) {
    void k8sManager.disconnect()
  }
  return k8sStore.remove(id)
})

ipcMain.handle('k8s:chooseKubeconfig', async () => {
  const options: Electron.OpenDialogOptions = {
    title: 'Select kubeconfig',
    properties: ['openFile'],
    filters: [
      { name: 'Kubeconfig', extensions: ['yaml', 'yml', 'config', '*'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return allowLocalPath(result.filePaths[0])
})

ipcMain.handle('k8s:defaultKubeconfig', () => {
  const p = defaultKubeconfigPath()
  if (p) allowLocalPath(p)
  return p
})

ipcMain.handle('k8s:parseContexts', (_event, kubeconfigPath: string) => {
  assertAllowedLocalPath(kubeconfigPath)
  return k8sManager.parseContexts(kubeconfigPath)
})

ipcMain.handle('k8s:parseContextsFromContent', (_event, content: string) =>
  k8sManager.parseContextsFromContent(content)
)

ipcMain.handle('k8s:status', () => k8sManager.getStatus())

ipcMain.handle('k8s:connect', async (_event, clusterId: string) => {
  const cluster = k8sStore.get(clusterId)
  if (!cluster) throw new Error('CLUSTER_NOT_FOUND')
  return k8sManager.connect(cluster)
})

ipcMain.handle('k8s:disconnect', () => k8sManager.disconnect())

ipcMain.handle('k8s:listNamespaces', () => k8sManager.listNamespaces())

ipcMain.handle('k8s:listPods', (_event, namespace: string) =>
  k8sManager.listPods(namespace === 'all' ? 'all' : namespace)
)

ipcMain.handle('k8s:listWorkloads', (_event, namespace: string) =>
  k8sManager.listWorkloads(namespace === 'all' ? 'all' : namespace)
)

ipcMain.handle('k8s:listNetwork', (_event, namespace: string) =>
  k8sManager.listNetwork(namespace === 'all' ? 'all' : namespace)
)

ipcMain.handle(
  'k8s:startLogs',
  (
    _event,
    opts: {
      namespace: string
      pod: string
      container?: string
      tailLines?: number
      follow?: boolean
    }
  ) => k8sManager.startLogs(opts)
)

ipcMain.handle('k8s:stopLogs', (_event, sessionId: string) => k8sManager.stopLogs(sessionId))

ipcMain.handle(
  'k8s:downloadLogs',
  async (
    _event,
    opts: { namespace: string; pod: string; container?: string; tailLines?: number }
  ) => {
    try {
      const content = await k8sManager.fetchLogs(opts)
      const saveOpts: Electron.SaveDialogOptions = {
        title: 'Save Pod Logs',
        defaultPath: `${opts.pod}.log`,
        filters: [{ name: 'Log', extensions: ['log', 'txt'] }]
      }
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, saveOpts)
        : await dialog.showSaveDialog(saveOpts)
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      await fsp.writeFile(result.filePath, content, 'utf-8')
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

ipcMain.handle(
  'k8s:startExec',
  (
    _event,
    opts: {
      namespace: string
      pod: string
      container?: string
      shell?: 'bash' | 'sh'
      cols?: number
      rows?: number
    }
  ) => k8sManager.startExec(opts)
)

ipcMain.handle('k8s:writeExec', (_event, sessionId: string, dataBase64: string) =>
  k8sManager.writeExec(sessionId, dataBase64)
)

ipcMain.handle('k8s:resizeExec', (_event, sessionId: string, cols: number, rows: number) =>
  k8sManager.resizeExec(sessionId, cols, rows)
)

ipcMain.handle('k8s:stopExec', (_event, sessionId: string) => k8sManager.stopExec(sessionId))

ipcMain.handle(
  'k8s:startPortForward',
  async (
    _event,
    opts: {
      id?: string
      namespace?: string
      pod?: string
      localPort?: number
      remotePort?: number
    }
  ) => {
    const st = k8sManager.getStatus()
    if (st.state !== 'connected' || !st.clusterId) {
      throw new Error('NOT_CONNECTED')
    }

    let id = opts.id?.trim()
    if (!id) {
      const localPort = Number(opts.localPort)
      const remotePort = Number(opts.remotePort)
      const namespace = opts.namespace?.trim()
      const pod = opts.pod?.trim()
      if (!namespace || !pod) throw new Error('PORT_FORWARD_OPTS_REQUIRED')
      if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
        throw new Error('LOCAL_PORT_INVALID')
      }
      if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
        throw new Error('REMOTE_PORT_INVALID')
      }
      // Persist first so records survive even if runtime start fails
      const record = k8sStore.savePortForward({
        clusterId: st.clusterId,
        namespace,
        pod,
        localPort,
        remotePort
      })
      id = record.id
    }

    return k8sManager.startPortForward({ id })
  }
)

ipcMain.handle('k8s:stopPortForward', (_event, id: string) => k8sManager.stopPortForward(id))

ipcMain.handle('k8s:deletePortForward', (_event, id: string) => k8sManager.deletePortForward(id))

ipcMain.handle('k8s:listPortForwards', () => k8sManager.listPortForwards())

/* ── Sticky notes ── */

const stickyStore = createStickyStore()

ipcMain.handle('sticky:load', () => stickyStore.load())

ipcMain.handle('sticky:save', (_event, data: StickyData) =>
  stickyStore.save(data ?? { tags: [], notes: [] })
)

let quittingCleaned = false
app.on('before-quit', (event) => {
  isQuitting = true
  destroyTray()
  // globalShortcut throws if used before the app is ready — e.g. when a
  // second instance loses the single-instance lock and calls app.quit()
  // before app.whenReady() resolves.
  if (app.isReady()) globalShortcut.unregisterAll()
  if (quittingCleaned) return
  event.preventDefault()
  quittingCleaned = true
  void Promise.allSettled([
    lanServer?.stop() ?? Promise.resolve(),
    Promise.resolve(sshManager.stop()),
    Promise.resolve(sshClientManager.stop()),
    Promise.resolve(k8sManager.stop())
  ]).finally(() => {
    app.exit(0)
  })
})

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('top.xiaolannet.brickworks')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    ipcMain.on('ping', () => console.log('pong'))

    await Promise.all([
      sshStore.init().catch(() => {}),
      k8sStore.init().catch(() => {}),
      stickyStore.init().catch(() => {}),
      appSettingsStore.init().catch(() => {})
    ])
    seedAllowedPaths()
    broadcastSshStatus()
    broadcastK8sStatus()

    const savedShortcut = appSettingsStore.get().showShortcut
    if (savedShortcut) tryRegisterAccel(savedShortcut)

    setupAppMenu()
    createWindow()
    syncTrayWithSettings()
    updater.init()

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      } else {
        showMainWindow()
      }
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !appSettingsStore.get().closeToTray) {
    app.quit()
  }
})
