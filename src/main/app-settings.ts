import { app } from 'electron'
import { promises as fsp } from 'fs'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface AppSettings {
  closeToTray: boolean
}

interface StoreFile {
  version: 1
  closeToTray?: boolean
}

const DEFAULTS: AppSettings = {
  closeToTray: false
}

export interface AppSettingsStore {
  init: () => Promise<void>
  get: () => AppSettings
  setCloseToTray: (value: boolean) => AppSettings
}

export function createAppSettingsStore(): AppSettingsStore {
  const file = join(app.getPath('userData'), 'app-settings.json')
  let settings: AppSettings = { ...DEFAULTS }

  async function readFile(): Promise<void> {
    try {
      const raw = await fsp.readFile(file, 'utf-8')
      const data = JSON.parse(raw) as StoreFile
      settings = {
        closeToTray: typeof data?.closeToTray === 'boolean' ? data.closeToTray : DEFAULTS.closeToTray
      }
    } catch {
      settings = { ...DEFAULTS }
    }
  }

  function persist(): void {
    const payload: StoreFile = { version: 1, closeToTray: settings.closeToTray }
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8')
    } catch {
      // best-effort
    }
  }

  return {
    init: () => readFile(),
    get: () => ({ ...settings }),
    setCloseToTray: (value: boolean) => {
      settings = { ...settings, closeToTray: Boolean(value) }
      persist()
      return { ...settings }
    }
  }
}
