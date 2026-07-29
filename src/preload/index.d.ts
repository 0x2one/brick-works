import { ElectronAPI } from '@electron-toolkit/preload'

interface WindowControls {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void
}

interface Api {
  windowControls: WindowControls
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
