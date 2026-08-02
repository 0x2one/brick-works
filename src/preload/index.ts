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
  },
  ssh: {
    listNodes: () => ipcRenderer.invoke('ssh:listNodes'),
    saveNode: (input: SshNodeInput) => ipcRenderer.invoke('ssh:saveNode', input),
    deleteNode: (id: string) => ipcRenderer.invoke('ssh:deleteNode', id),
    chooseKeyFile: () => ipcRenderer.invoke('ssh:chooseKeyFile'),
    clearHostKey: (nodeId: string) => ipcRenderer.invoke('ssh:clearHostKey', nodeId),
    status: () => ipcRenderer.invoke('ssh:status'),
    connect: (nodeId: string, type?: SshTunnelType) =>
      ipcRenderer.invoke('ssh:connect', nodeId, type),
    disconnect: (nodeId: string) => ipcRenderer.invoke('ssh:disconnect', nodeId),
    disconnectType: (nodeId: string, type: SshTunnelType) =>
      ipcRenderer.invoke('ssh:disconnectType', nodeId, type),
    disconnectAll: () => ipcRenderer.invoke('ssh:disconnectAll'),
    test: (nodeId: string) => ipcRenderer.invoke('ssh:test', nodeId),
    listTunnels: () => ipcRenderer.invoke('ssh:listTunnels'),
    addTunnel: (nodeId: string, spec: SshTunnelSpec) =>
      ipcRenderer.invoke('ssh:addTunnel', nodeId, spec),
    updateTunnel: (nodeId: string, spec: SshTunnelSpec) =>
      ipcRenderer.invoke('ssh:updateTunnel', nodeId, spec),
    removeTunnel: (nodeId: string, tunnelId: string) =>
      ipcRenderer.invoke('ssh:removeTunnel', nodeId, tunnelId),
    startTunnel: (nodeId: string, tunnelId: string) =>
      ipcRenderer.invoke('ssh:startTunnel', nodeId, tunnelId),
    stopTunnel: (nodeId: string, tunnelId: string) =>
      ipcRenderer.invoke('ssh:stopTunnel', nodeId, tunnelId),
    onStatusChange: (callback: (statuses: SshSessionStatus[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, statuses: SshSessionStatus[]): void =>
        callback(statuses)
      ipcRenderer.on('ssh:status-change', handler)
      return () => {
        ipcRenderer.removeListener('ssh:status-change', handler)
      }
    },
    onLog: (callback: (entry: SshLogEntry) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, entry: SshLogEntry): void =>
        callback(entry)
      ipcRenderer.on('ssh:log', handler)
      return () => {
        ipcRenderer.removeListener('ssh:log', handler)
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
