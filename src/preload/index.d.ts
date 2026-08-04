interface WindowControls {
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void
}

interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  arch: string
}

interface LanApi {
  getStatus: () => Promise<LanStatus>
  start: (dir?: string, lang?: string) => Promise<LanStatus>
  stop: () => Promise<LanStatus>
  chooseDir: () => Promise<string | null>
  openBrowser: (url: string) => Promise<void>
  openDir: () => Promise<void>
  setLang: (lang: string) => Promise<void>
  setIp: (ip: string | null) => Promise<LanStatus>
  onStatusChange: (callback: (status: LanStatus) => void) => () => void
}

interface SshApi {
  listNodes: () => Promise<SshNodeView[]>
  saveNode: (input: SshNodeInput) => Promise<SshNodeView>
  deleteNode: (id: string) => Promise<boolean>
  reorderNodes: (ids: string[]) => Promise<SshNodeView[]>
  chooseKeyFile: () => Promise<string | null>
  clearHostKey: (nodeId: string) => Promise<boolean>
  status: () => Promise<SshSessionStatus[]>
  connect: (nodeId: string, type?: SshTunnelType) => Promise<SshSessionStatus>
  disconnect: (nodeId: string) => Promise<SshSessionStatus>
  disconnectType: (nodeId: string, type: SshTunnelType) => Promise<SshSessionStatus>
  disconnectAll: () => Promise<SshSessionStatus[]>
  test: (nodeId: string) => Promise<{ ok: boolean; error?: string; latencyMs: number }>
  listTunnels: () => Promise<SshTunnelSpec[]>
  addTunnel: (nodeId: string, spec: SshTunnelSpec) => Promise<SshTunnelSpec>
  updateTunnel: (nodeId: string, spec: SshTunnelSpec) => Promise<SshTunnelSpec>
  removeTunnel: (nodeId: string, tunnelId: string) => Promise<SshSessionStatus>
  startTunnel: (nodeId: string, tunnelId: string) => Promise<SshSessionStatus>
  stopTunnel: (nodeId: string, tunnelId: string) => Promise<SshSessionStatus>
  onStatusChange: (callback: (statuses: SshSessionStatus[]) => void) => () => void
  onLog: (callback: (entry: SshLogEntry) => void) => () => void
  startShell: (opts: SshShellStartOpts) => Promise<{ sessionId: string }>
  writeShell: (sessionId: string, dataBase64: string) => Promise<boolean>
  resizeShell: (sessionId: string, cols: number, rows: number) => Promise<boolean>
  stopShell: (sessionId: string) => Promise<boolean>
  sftpList: (nodeId: string, remotePath: string) => Promise<SshSftpEntry[]>
  sftpDownload: (
    nodeId: string,
    remotePath: string
  ) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  sftpDownloadDir: (
    nodeId: string,
    remotePath: string
  ) => Promise<{ ok: boolean; path?: string; count?: number; canceled?: boolean; error?: string }>
  sftpUpload: (
    nodeId: string,
    remoteDir: string
  ) => Promise<{ ok: boolean; count?: number; canceled?: boolean; error?: string }>
  sftpMkdir: (nodeId: string, remotePath: string) => Promise<{ ok: boolean; error?: string }>
  sftpWriteFile: (
    nodeId: string,
    remotePath: string,
    content?: string
  ) => Promise<{ ok: boolean; error?: string }>
  sftpDisconnect: (nodeId: string) => Promise<boolean>
  onShellData: (callback: (data: SshShellData) => void) => () => void
  onShellExit: (callback: (data: SshShellExit) => void) => () => void
}

interface K8sApi {
  listClusters: () => Promise<K8sCluster[]>
  saveCluster: (input: K8sClusterInput) => Promise<K8sCluster>
  deleteCluster: (id: string) => Promise<boolean>
  chooseKubeconfig: () => Promise<string | null>
  defaultKubeconfig: () => Promise<string>
  parseContexts: (kubeconfigPath: string) => Promise<K8sContextInfo[]>
  parseContextsFromContent: (content: string) => Promise<K8sContextInfo[]>
  status: () => Promise<K8sStatus>
  connect: (clusterId: string) => Promise<K8sStatus>
  disconnect: () => Promise<K8sStatus>
  listNamespaces: () => Promise<string[]>
  listPods: (namespace: string) => Promise<K8sPodRow[]>
  listWorkloads: (namespace: string) => Promise<K8sWorkloadRow[]>
  listNetwork: (
    namespace: string
  ) => Promise<{ services: K8sServiceRow[]; ingresses: K8sIngressRow[] }>
  startLogs: (opts: K8sStartLogsOpts) => Promise<{ sessionId: string }>
  stopLogs: (sessionId: string) => Promise<boolean>
  downloadLogs: (opts: {
    namespace: string
    pod: string
    container?: string
    tailLines?: number
  }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  startExec: (opts: K8sStartExecOpts) => Promise<{ sessionId: string }>
  writeExec: (sessionId: string, dataBase64: string) => Promise<boolean>
  resizeExec: (sessionId: string, cols: number, rows: number) => Promise<boolean>
  stopExec: (sessionId: string) => Promise<boolean>
  startPortForward: (opts: K8sStartPortForwardOpts) => Promise<K8sPortForwardStatus>
  stopPortForward: (id: string) => Promise<boolean>
  deletePortForward: (id: string) => Promise<boolean>
  listPortForwards: () => Promise<K8sPortForwardStatus[]>
  onStatusChange: (callback: (status: K8sStatus) => void) => () => void
  onLogChunk: (callback: (chunk: K8sLogChunk) => void) => () => void
  onExecData: (callback: (data: K8sExecData) => void) => () => void
  onExecExit: (callback: (data: K8sExecExit) => void) => () => void
  onPortForwardStatus: (callback: (list: K8sPortForwardStatus[]) => void) => () => void
}

interface AppApi {
  info: () => Promise<AppInfo>
}

interface AppSettings {
  closeToTray: boolean
  openAtLogin: boolean
  showShortcut: string
  autoDownload: boolean
}

interface SetShowShortcutResult {
  ok: boolean
  error?: string
  shortcut: string
}

interface SettingsApi {
  get: () => Promise<AppSettings>
  setCloseToTray: (value: boolean) => Promise<AppSettings>
  setOpenAtLogin: (value: boolean) => Promise<AppSettings>
  setShowShortcut: (value: string | null) => Promise<SetShowShortcutResult>
  resetShowShortcut: () => Promise<SetShowShortcutResult>
  setAutoDownload: (value: boolean) => Promise<AppSettings>
}

interface UpdaterApi {
  check: () => Promise<UpdaterStatus>
  download: () => Promise<UpdaterStatus>
  install: () => Promise<boolean>
  getStatus: () => Promise<UpdaterStatus>
  onStatus: (callback: (status: UpdaterStatus) => void) => () => void
}

interface Api {
  fetchImage: (url: string) => Promise<string | null>
  fetchSvg: (url: string) => Promise<string | null>
  windowControls: WindowControls
  app: AppApi
  settings: SettingsApi
  updater: UpdaterApi
  lan: LanApi
  ssh: SshApi
  sticky: StickyApi
  k8s: K8sApi
}

declare global {
  interface AppInfo {
    version: string
    electron: string
    chrome: string
    node: string
    v8: string
    platform: string
    arch: string
  }

  interface Window {
    api: Api
  }
}

export {}
