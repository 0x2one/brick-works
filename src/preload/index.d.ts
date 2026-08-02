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
  start: (dir?: string, lang?: string) => Promise<LanStatus>
  stop: () => Promise<LanStatus>
  chooseDir: () => Promise<string | null>
  openBrowser: (url: string) => Promise<void>
  openDir: () => Promise<void>
  setLang: (lang: string) => Promise<void>
  onStatusChange: (callback: (status: LanStatus) => void) => () => void
}

interface SshApi {
  listNodes: () => Promise<SshNodeView[]>
  saveNode: (input: SshNodeInput) => Promise<SshNodeView>
  deleteNode: (id: string) => Promise<boolean>
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
}

interface Api {
  fetchImage: (url: string) => Promise<string | null>
  windowControls: WindowControls
  lan: LanApi
  ssh: SshApi
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}

export {}
