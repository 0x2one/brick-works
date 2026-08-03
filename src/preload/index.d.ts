import { ElectronAPI } from '@electron-toolkit/preload'

interface WindowControls {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void
}

interface Api {
  fetchImage: (url: string) => Promise<string | null>
  fetchSvg: (url: string) => Promise<string | null>
  windowControls: WindowControls
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
