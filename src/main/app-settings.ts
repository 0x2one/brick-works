import { app } from 'electron'
import { promises as fsp } from 'fs'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export const DEFAULT_SHOW_SHORTCUT = 'Alt+Space'

export interface AppSettings {
  closeToTray: boolean
  openAtLogin: boolean
  showShortcut: string
  autoDownload: boolean
}

interface StoreFile {
  version: 1
  closeToTray?: boolean
  openAtLogin?: boolean
  showShortcut?: string
  autoDownload?: boolean
}

const DEFAULTS: AppSettings = {
  closeToTray: false,
  openAtLogin: false,
  showShortcut: DEFAULT_SHOW_SHORTCUT,
  autoDownload: true
}

export interface AppSettingsStore {
  init: () => Promise<void>
  get: () => AppSettings
  setCloseToTray: (value: boolean) => AppSettings
  setOpenAtLogin: (value: boolean) => AppSettings
  setShowShortcut: (value: string | null) => AppSettings
  setAutoDownload: (value: boolean) => AppSettings
}

function applyOpenAtLogin(enabled: boolean): void {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return
  }
  // Dev: register electron + app path so the project can still launch.
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [app.getAppPath()]
  })
}

function readOpenAtLoginFromOs(): boolean {
  try {
    if (app.isPackaged) {
      return Boolean(app.getLoginItemSettings().openAtLogin)
    }
    return Boolean(
      app.getLoginItemSettings({
        path: process.execPath,
        args: [app.getAppPath()]
      }).openAtLogin
    )
  } catch {
    return false
  }
}

export function createAppSettingsStore(): AppSettingsStore {
  const file = join(app.getPath('userData'), 'app-settings.json')
  let settings: AppSettings = { ...DEFAULTS }

  async function readFile(): Promise<void> {
    try {
      const raw = await fsp.readFile(file, 'utf-8')
      const data = JSON.parse(raw) as StoreFile
      settings = {
        closeToTray:
          typeof data?.closeToTray === 'boolean' ? data.closeToTray : DEFAULTS.closeToTray,
        openAtLogin:
          typeof data?.openAtLogin === 'boolean' ? data.openAtLogin : DEFAULTS.openAtLogin,
        showShortcut:
          typeof data?.showShortcut === 'string' ? data.showShortcut : DEFAULTS.showShortcut,
        autoDownload:
          typeof data?.autoDownload === 'boolean' ? data.autoDownload : DEFAULTS.autoDownload
      }
    } catch {
      settings = { ...DEFAULTS }
    }
  }

  function persist(): void {
    const payload: StoreFile = {
      version: 1,
      closeToTray: settings.closeToTray,
      openAtLogin: settings.openAtLogin,
      showShortcut: settings.showShortcut,
      autoDownload: settings.autoDownload
    }
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8')
    } catch {
      // best-effort
    }
  }

  return {
    init: async () => {
      await readFile()
      // Prefer OS registry as source of truth (user may disable via Task Manager).
      settings = { ...settings, openAtLogin: readOpenAtLoginFromOs() }
      persist()
    },
    get: () => ({ ...settings, openAtLogin: readOpenAtLoginFromOs() }),
    setCloseToTray: (value: boolean) => {
      settings = { ...settings, closeToTray: Boolean(value) }
      persist()
      return { ...settings, openAtLogin: readOpenAtLoginFromOs() }
    },
    setOpenAtLogin: (value: boolean) => {
      const enabled = Boolean(value)
      applyOpenAtLogin(enabled)
      settings = { ...settings, openAtLogin: enabled }
      persist()
      return { ...settings, openAtLogin: readOpenAtLoginFromOs() }
    },
    setShowShortcut: (value: string | null) => {
      const shortcut = typeof value === 'string' ? value.trim() : ''
      settings = { ...settings, showShortcut: shortcut }
      persist()
      return { ...settings, openAtLogin: readOpenAtLoginFromOs() }
    },
    setAutoDownload: (value: boolean) => {
      settings = { ...settings, autoDownload: Boolean(value) }
      persist()
      return { ...settings, openAtLogin: readOpenAtLoginFromOs() }
    }
  }
}
