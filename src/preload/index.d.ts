import { ElectronAPI } from '@electron-toolkit/preload'

interface WindowControls {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void
}

interface LanApi {
  getStatus: () => Promise<LanStatus>
  start: (dir?: string) => Promise<LanStatus>
  stop: () => Promise<LanStatus>
  chooseDir: () => Promise<string | null>
  openBrowser: (url: string) => Promise<void>
  openDir: () => Promise<void>
  onStatusChange: (callback: (status: LanStatus) => void) => () => void
}

interface Api {
  fetchImage: (url: string) => Promise<string | null>
  windowControls: WindowControls
  lan: LanApi
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}

export {}
