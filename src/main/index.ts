import { app, shell, BrowserWindow, dialog, ipcMain, nativeImage, net } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import iconPng from '../../resources/icon.png?asset'
import { createLanServer, type LanStatus } from './lan-server'
import { createSshStore, type SshNodeInput } from './ssh-store'
import { createSshManager, type SshTunnelSpec, type SshTunnelType } from './ssh-manager'
import { createK8sStore, defaultKubeconfigPath, type K8sClusterInput } from './k8s-store'
import { createK8sManager } from './k8s-manager'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(iconPng),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximize-change', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximize-change', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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

ipcMain.handle('fetch:image', async (_event, url: string): Promise<string | null> => {
  try {
    const response = await net.fetch(url)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || 'image/png'
    const base64 = buffer.toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
})

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false
})

/* ── LAN transfer service ── */

let lanDir: string | null = null
let lanLang: string = 'zh'
let lanServer: ReturnType<typeof createLanServer> | null = null

function lanStatus(): LanStatus {
  if (!lanServer || !lanServer.isRunning()) {
    return { running: false, ip: null, port: null, url: null, dir: lanDir }
  }
  const info = lanServer.getInfo()
  return { running: true, ip: info.ip, port: info.port, url: info.url, dir: lanDir }
}

function broadcastLanStatus(): void {
  mainWindow?.webContents.send('lan:status-change', lanStatus())
}

ipcMain.handle('lan:status', () => lanStatus())

ipcMain.handle('lan:start', async (_event, dir?: string, lang?: string) => {
  if (dir && typeof dir === 'string') lanDir = dir
  if (lang === 'en' || lang === 'zh') lanLang = lang
  if (!lanDir) lanDir = app.getPath('downloads')
  if (lanServer?.isRunning()) return lanStatus()
  lanServer = createLanServer(lanDir, lanLang)
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

ipcMain.handle('lan:openBrowser', (_event, url: string) => {
  shell.openExternal(url)
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

/* ── SSH tunnel service ── */

const sshStore = createSshStore()
const sshManager = createSshManager({
  verifyHostKey: (host, port, key) => sshStore.verifyHostKey(host, port, key)
})

function broadcastSshStatus(): void {
  mainWindow?.webContents.send('ssh:status-change', sshManager.getStatus())
}

sshManager.onStatusChange(() => broadcastSshStatus())
sshManager.onLog((entry) => {
  mainWindow?.webContents.send('ssh:log', entry)
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
  return null
}

ipcMain.handle('ssh:listNodes', () => sshStore.list())

ipcMain.handle('ssh:saveNode', (_event, input: SshNodeInput) => {
  const err = validateNodeInput(input)
  if (err) throw new Error(err)
  return sshStore.save(input)
})

ipcMain.handle('ssh:deleteNode', (_event, id: string) => {
  sshManager.disconnect(id)
  return sshStore.remove(id)
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
  return result.filePaths[0]
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

ipcMain.handle('ssh:listTunnels', () => sshStore.listTunnels())

ipcMain.handle('ssh:addTunnel', (_event, nodeId: string, spec: SshTunnelSpec) => {
  const err = validateTunnelSpec(spec, nodeId)
  if (err) throw new Error(err)
  const saved = sshStore.saveTunnel({ ...spec, nodeId })
  sshManager.addTunnel(nodeId, saved)
  return saved
})

ipcMain.handle('ssh:updateTunnel', (_event, nodeId: string, spec: SshTunnelSpec) => {
  if (!spec?.id) throw new Error('TUNNEL_NOT_FOUND')
  const existing = sshStore.listTunnels(nodeId).find((t) => t.id === spec.id)
  if (!existing) throw new Error('TUNNEL_NOT_FOUND')
  const err = validateTunnelSpec(spec, nodeId, spec.id)
  if (err) throw new Error(err)
  const saved = sshStore.saveTunnel({ ...spec, nodeId, id: spec.id })
  sshManager.updateTunnel(nodeId, saved)
  return saved
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

/* ── K8s management ── */

const k8sStore = createK8sStore()
const k8sManager = createK8sManager()

function broadcastK8sStatus(): void {
  mainWindow?.webContents.send('k8s:status-change', k8sManager.getStatus())
}

k8sManager.onStatusChange(() => broadcastK8sStatus())
k8sManager.onLogChunk((chunk) => {
  mainWindow?.webContents.send('k8s:log-chunk', chunk)
})
k8sManager.onExecData((data) => {
  mainWindow?.webContents.send('k8s:exec-data', data)
})
k8sManager.onExecExit((data) => {
  mainWindow?.webContents.send('k8s:exec-exit', data)
})
k8sManager.onPortForwardStatus((list) => {
  mainWindow?.webContents.send('k8s:portforward-status', list)
})

ipcMain.handle('k8s:listClusters', () => k8sStore.list())

ipcMain.handle('k8s:saveCluster', (_event, input: K8sClusterInput) => {
  if (!input?.name?.trim()) throw new Error('NAME_REQUIRED')
  if (!input.kubeconfigPath?.trim() && !input.kubeconfigContent?.trim()) {
    throw new Error('KUBECONFIG_REQUIRED')
  }
  if (!input.context?.trim()) throw new Error('CONTEXT_REQUIRED')
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
  return result.filePaths[0]
})

ipcMain.handle('k8s:defaultKubeconfig', () => defaultKubeconfigPath())

ipcMain.handle('k8s:parseContexts', (_event, kubeconfigPath: string) =>
  k8sManager.parseContexts(kubeconfigPath)
)

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
    opts: { namespace: string; pod: string; container?: string; cols?: number; rows?: number }
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
  (_event, opts: { namespace: string; pod: string; localPort: number; remotePort: number }) => {
    const localPort = Number(opts.localPort)
    const remotePort = Number(opts.remotePort)
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
      throw new Error('LOCAL_PORT_INVALID')
    }
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      throw new Error('REMOTE_PORT_INVALID')
    }
    return k8sManager.startPortForward({ ...opts, localPort, remotePort })
  }
)

ipcMain.handle('k8s:stopPortForward', (_event, id: string) => k8sManager.stopPortForward(id))

ipcMain.handle('k8s:listPortForwards', () => k8sManager.listPortForwards())

app.on('will-quit', () => {
  lanServer?.stop()
  sshManager.stop()
  k8sManager.stop()
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.brickworks')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  sshStore
    .init()
    .then(() => broadcastSshStatus())
    .catch(() => {})

  k8sStore
    .init()
    .then(() => broadcastK8sStatus())
    .catch(() => {})

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
