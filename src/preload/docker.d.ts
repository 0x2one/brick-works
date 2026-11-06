type DockerEndpointType = 'pipe' | 'tcp' | 'wsl' | 'ssh'
type DockerWslMode = 'cli' | 'tcp'

interface DockerEndpointTlsView {
  caPath?: string
  certPath?: string
  keyPath?: string
  hasKeyPassphrase: boolean
}

interface DockerEndpointView {
  id: string
  name: string
  type: DockerEndpointType
  pipePath?: string
  host?: string
  port?: number
  tls?: DockerEndpointTlsView
  distro?: string
  wslMode?: DockerWslMode
  wslPort?: number
  sshNodeId?: string | null
  remoteSocketPath?: string
  remoteHost?: string
  remotePort?: number
  sortOrder: number
  createdAt: number
  updatedAt: number
}

interface DockerEndpointInput {
  id?: string
  name: string
  type: DockerEndpointType
  pipePath?: string
  host?: string
  port?: number
  tls?: {
    caPath?: string
    certPath?: string
    keyPath?: string
    keyPassphrase?: string
  }
  distro?: string
  wslMode?: DockerWslMode
  wslPort?: number
  sshNodeId?: string | null
  remoteSocketPath?: string
  remoteHost?: string
  remotePort?: number
}

type DockerConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'
type DockerBackend = 'engine' | 'cli'

interface DockerStatus {
  state: DockerConnectionState
  endpointId: string | null
  endpointName: string | null
  endpointType: DockerEndpointType | null
  backend: DockerBackend | null
  detail: string | null
  /** The session provides a real TTY (interactive shell with job control) */
  tty?: boolean
  error?: string
  connectedAt?: number
}

interface DockerPortMapping {
  privatePort: number
  publicPort?: number
  type: string
  ip?: string
}

interface DockerContainerRow {
  id: string
  name: string
  image: string
  imageId: string
  state: string
  status: string
  command: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  restartCount: number
  ports: DockerPortMapping[]
  labels: Record<string, string>
  networks: string[]
  mounts: string[]
}

interface DockerMountRow {
  type: string
  source: string
  destination: string
  mode: string
}

interface DockerContainerDetail {
  id: string
  name: string
  image: string
  state: string
  status: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  restartCount: number
  command: string
  entrypoint: string
  workingDir: string
  user: string
  hostname: string
  ipAddress: string
  ports: DockerPortMapping[]
  env: string[]
  labels: Record<string, string>
  mounts: DockerMountRow[]
  networks: string[]
  restartPolicy: { name: string; maxRetry: number }
  health: string
  exitCode: number | null
  error?: string
}

interface DockerImageRow {
  id: string
  repository: string
  tag: string
  size: number
  createdAt: number
  containers: number
  labels: Record<string, string>
}

interface DockerVolumeRow {
  name: string
  driver: string
  mountpoint: string
  scope: string
  labels: Record<string, string>
  size: number | null
}

interface DockerNetworkRow {
  id: string
  name: string
  driver: string
  scope: string
  internal: boolean
  ipv6: boolean
  createdAt: number
  labels: Record<string, string>
  containers: number
}

interface DockerSystemInfo {
  name: string
  serverVersion: string
  os: string
  arch: string
  cpus: number
  memory: number
  containers: number
  containersRunning: number
  containersPaused: number
  containersStopped: number
  images: number
  driver: string
  dockerRootDir: string
  kernelVersion: string
  operatingSystem: string
}

interface DockerStatsRow {
  id: string
  name: string
  cpuPercent: number
  memoryUsage: number
  memoryLimit: number
  memoryPercent: number
  networkRx: number
  networkTx: number
  blockRead: number
  blockWrite: number
  pids: number
}

interface DockerVersionInfo {
  version: string
  apiVersion: string
  os: string
  arch: string
}

interface DockerLogChunk {
  sessionId: string
  data: string
}

interface DockerExecData {
  sessionId: string
  data: string
}

interface DockerExecExit {
  sessionId: string
  reason?: string
}

type DockerContainerAction = 'start' | 'stop' | 'restart' | 'kill' | 'pause' | 'unpause'
