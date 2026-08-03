import { contextBridge, ipcRenderer } from 'electron'

const api = {
  fetchImage: (url: string) => ipcRenderer.invoke('fetch:image', url),
  app: {
    info: () => ipcRenderer.invoke('app:info')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setCloseToTray: (value: boolean) => ipcRenderer.invoke('settings:setCloseToTray', value),
    setOpenAtLogin: (value: boolean) => ipcRenderer.invoke('settings:setOpenAtLogin', value)
  },
  fetchSvg: (url: string) => ipcRenderer.invoke('fetch:svg', url),
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
    reorderNodes: (ids: string[]) => ipcRenderer.invoke('ssh:reorderNodes', ids),
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
    },
    startShell: (opts: SshShellStartOpts) => ipcRenderer.invoke('ssh:startShell', opts),
    writeShell: (sessionId: string, dataBase64: string) =>
      ipcRenderer.invoke('ssh:writeShell', sessionId, dataBase64),
    resizeShell: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('ssh:resizeShell', sessionId, cols, rows),
    stopShell: (sessionId: string) => ipcRenderer.invoke('ssh:stopShell', sessionId),
    sftpList: (nodeId: string, remotePath: string) =>
      ipcRenderer.invoke('ssh:sftpList', nodeId, remotePath),
    sftpDownload: (nodeId: string, remotePath: string) =>
      ipcRenderer.invoke('ssh:sftpDownload', nodeId, remotePath),
    sftpDownloadDir: (nodeId: string, remotePath: string) =>
      ipcRenderer.invoke('ssh:sftpDownloadDir', nodeId, remotePath),
    sftpUpload: (nodeId: string, remoteDir: string) =>
      ipcRenderer.invoke('ssh:sftpUpload', nodeId, remoteDir),
    sftpMkdir: (nodeId: string, remotePath: string) =>
      ipcRenderer.invoke('ssh:sftpMkdir', nodeId, remotePath),
    sftpWriteFile: (nodeId: string, remotePath: string, content?: string) =>
      ipcRenderer.invoke('ssh:sftpWriteFile', nodeId, remotePath, content),
    sftpDisconnect: (nodeId: string) => ipcRenderer.invoke('ssh:sftpDisconnect', nodeId),
    onShellData: (callback: (data: SshShellData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: SshShellData): void =>
        callback(data)
      ipcRenderer.on('ssh:shell-data', handler)
      return () => {
        ipcRenderer.removeListener('ssh:shell-data', handler)
      }
    },
    onShellExit: (callback: (data: SshShellExit) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: SshShellExit): void =>
        callback(data)
      ipcRenderer.on('ssh:shell-exit', handler)
      return () => {
        ipcRenderer.removeListener('ssh:shell-exit', handler)
      }
    }
  },
  sticky: {
    load: () => ipcRenderer.invoke('sticky:load'),
    save: (data: StickyData) => ipcRenderer.invoke('sticky:save', data)
  },
  k8s: {
    listClusters: () => ipcRenderer.invoke('k8s:listClusters'),
    saveCluster: (input: K8sClusterInput) => ipcRenderer.invoke('k8s:saveCluster', input),
    deleteCluster: (id: string) => ipcRenderer.invoke('k8s:deleteCluster', id),
    chooseKubeconfig: () => ipcRenderer.invoke('k8s:chooseKubeconfig'),
    defaultKubeconfig: () => ipcRenderer.invoke('k8s:defaultKubeconfig'),
    parseContexts: (kubeconfigPath: string) =>
      ipcRenderer.invoke('k8s:parseContexts', kubeconfigPath),
    parseContextsFromContent: (content: string) =>
      ipcRenderer.invoke('k8s:parseContextsFromContent', content),
    status: () => ipcRenderer.invoke('k8s:status'),
    connect: (clusterId: string) => ipcRenderer.invoke('k8s:connect', clusterId),
    disconnect: () => ipcRenderer.invoke('k8s:disconnect'),
    listNamespaces: () => ipcRenderer.invoke('k8s:listNamespaces'),
    listPods: (namespace: string) => ipcRenderer.invoke('k8s:listPods', namespace),
    listWorkloads: (namespace: string) => ipcRenderer.invoke('k8s:listWorkloads', namespace),
    listNetwork: (namespace: string) => ipcRenderer.invoke('k8s:listNetwork', namespace),
    startLogs: (opts: K8sStartLogsOpts) => ipcRenderer.invoke('k8s:startLogs', opts),
    stopLogs: (sessionId: string) => ipcRenderer.invoke('k8s:stopLogs', sessionId),
    downloadLogs: (opts: {
      namespace: string
      pod: string
      container?: string
      tailLines?: number
    }) => ipcRenderer.invoke('k8s:downloadLogs', opts),
    startExec: (opts: K8sStartExecOpts) => ipcRenderer.invoke('k8s:startExec', opts),
    writeExec: (sessionId: string, dataBase64: string) =>
      ipcRenderer.invoke('k8s:writeExec', sessionId, dataBase64),
    resizeExec: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('k8s:resizeExec', sessionId, cols, rows),
    stopExec: (sessionId: string) => ipcRenderer.invoke('k8s:stopExec', sessionId),
    startPortForward: (opts: K8sStartPortForwardOpts) =>
      ipcRenderer.invoke('k8s:startPortForward', opts),
    stopPortForward: (id: string) => ipcRenderer.invoke('k8s:stopPortForward', id),
    deletePortForward: (id: string) => ipcRenderer.invoke('k8s:deletePortForward', id),
    listPortForwards: () => ipcRenderer.invoke('k8s:listPortForwards'),
    onStatusChange: (callback: (status: K8sStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: K8sStatus): void =>
        callback(status)
      ipcRenderer.on('k8s:status-change', handler)
      return () => {
        ipcRenderer.removeListener('k8s:status-change', handler)
      }
    },
    onLogChunk: (callback: (chunk: K8sLogChunk) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chunk: K8sLogChunk): void =>
        callback(chunk)
      ipcRenderer.on('k8s:log-chunk', handler)
      return () => {
        ipcRenderer.removeListener('k8s:log-chunk', handler)
      }
    },
    onExecData: (callback: (data: K8sExecData) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: K8sExecData): void => callback(data)
      ipcRenderer.on('k8s:exec-data', handler)
      return () => {
        ipcRenderer.removeListener('k8s:exec-data', handler)
      }
    },
    onExecExit: (callback: (data: K8sExecExit) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: K8sExecExit): void => callback(data)
      ipcRenderer.on('k8s:exec-exit', handler)
      return () => {
        ipcRenderer.removeListener('k8s:exec-exit', handler)
      }
    },
    onPortForwardStatus: (callback: (list: K8sPortForwardStatus[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, list: K8sPortForwardStatus[]): void =>
        callback(list)
      ipcRenderer.on('k8s:portforward-status', handler)
      return () => {
        ipcRenderer.removeListener('k8s:portforward-status', handler)
      }
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
