import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  fetchImage: (url: string) => ipcRenderer.invoke('fetch:image', url),
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (callback: (maximized: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
        callback(maximized)
      ipcRenderer.on('window:maximize-change', handler)
      return () => {
        ipcRenderer.removeListener('window:maximize-change', handler)
      }
    }
  },
  lan: {
    getStatus: () => ipcRenderer.invoke('lan:status'),
    start: (dir?: string, lang?: string) => ipcRenderer.invoke('lan:start', dir, lang),
    stop: () => ipcRenderer.invoke('lan:stop'),
    chooseDir: () => ipcRenderer.invoke('lan:chooseDir'),
    openBrowser: (url: string) => ipcRenderer.invoke('lan:openBrowser', url),
    openDir: () => ipcRenderer.invoke('lan:openDir'),
    setLang: (lang: string) => ipcRenderer.invoke('lan:setLang', lang),
    onStatusChange: (callback: (status: LanStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: LanStatus): void =>
        callback(status)
      ipcRenderer.on('lan:status-change', handler)
      return () => {
        ipcRenderer.removeListener('lan:status-change', handler)
      }
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
