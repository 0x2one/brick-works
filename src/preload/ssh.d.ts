type SshTunnelType = 'local' | 'remote' | 'socks5'
type SshTunnelStatusName = 'starting' | 'running' | 'error'
type SshSessionStateName = 'disconnected' | 'connecting' | 'connected' | 'error'
type SshLogLevel = 'info' | 'warn' | 'error'

interface SshTunnelState {
  id: string
  type: SshTunnelType
  status: SshTunnelStatusName
  error?: string
  localPort?: number
  listenAddr?: string
  remoteHost?: string
  remotePort?: number
  bindAddr?: string
  bindPort?: number
  targetHost?: string
  targetPort?: number
}

interface SshSessionStatus {
  nodeId: string
  nodeName: string
  host: string
  port: number
  username: string
  state: SshSessionStateName
  error?: string
  connectedAt?: number
  tunnels: SshTunnelState[]
}

interface SshLogEntry {
  id: string
  time: number
  level: SshLogLevel
  nodeId: string
  nodeName: string
  message: string
}

interface SshNodeView {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  privateKeyPath: string | null
  hasPassword: boolean
  hasPassphrase: boolean
  jumpHostId: string | null
  createdAt: number
  updatedAt: number
}

interface SshNodeInput {
  id?: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
  /** undefined = keep existing; null / '' = clear */
  jumpHostId?: string | null
}

interface SshTunnelSpec {
  id?: string
  nodeId?: string
  type: SshTunnelType
  name?: string
  localPort?: number
  listenAddr?: string
  remoteHost?: string
  remotePort?: number
  bindAddr?: string
  bindPort?: number
  targetHost?: string
  targetPort?: number
  socksUser?: string
  socksPass?: string
  hasSocksPass?: boolean
}

interface SshShellStartOpts {
  nodeId: string
  cols?: number
  rows?: number
  term?: string
}

interface SshShellData {
  sessionId: string
  data: string
}

interface SshShellExit {
  sessionId: string
  reason?: string
}

interface SshSftpEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifyTime: number
  accessTime: number
  owner?: number
  group?: number
  mode?: number
  /** true when the entry is a symbolic link; `type` is resolved to the link target */
  isSymlink?: boolean
}

interface SshSftpReadResult {
  ok: boolean
  content?: string
  binary?: boolean
  truncated?: boolean
  size?: number
  maxBytes?: number
  error?: string
}
