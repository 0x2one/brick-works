import { app, shell, BrowserWindow, dialog, ipcMain, nativeImage, net } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import iconPng from '../../resources/icon.png?asset'
import { createLanServer, type LanStatus } from './lan-server'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
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

ipcMain.handle('lan:start', async (_event, dir?: string) => {
  if (dir && typeof dir === 'string') lanDir = dir
  if (!lanDir) lanDir = app.getPath('downloads')
  if (lanServer?.isRunning()) return lanStatus()
  lanServer = createLanServer(lanDir)
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

app.on('will-quit', () => {
  lanServer?.stop()
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.brickworks')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
