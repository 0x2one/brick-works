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
}

interface SshTunnelSpec {
  id?: string
  nodeId?: string
  type: SshTunnelType
  name?: string
  localPort?: number
  remoteHost?: string
  remotePort?: number
  bindAddr?: string
  bindPort?: number
  targetHost?: string
  targetPort?: number
}
