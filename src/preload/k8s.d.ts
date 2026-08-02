type K8sConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'
type K8sPortForwardState = 'starting' | 'active' | 'error' | 'stopped'

interface K8sCluster {
  id: string
  name: string
  kubeconfigPath: string
  context: string
  managedConfig?: boolean
  createdAt: number
  updatedAt: number
}

interface K8sClusterInput {
  id?: string
  name: string
  kubeconfigPath?: string
  kubeconfigContent?: string
  context: string
}

interface K8sStatus {
  state: K8sConnectionState
  clusterId: string | null
  clusterName: string | null
  context: string | null
  server: string | null
  error?: string
  connectedAt?: number
}

interface K8sContextInfo {
  name: string
  cluster: string
  user: string
  namespace?: string
}

interface K8sPodRow {
  name: string
  namespace: string
  ready: string
  status: string
  restarts: number
  node: string
  ageMs: number
  containers: string[]
  containerPorts: number[]
}

interface K8sWorkloadRow {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet'
  name: string
  namespace: string
  ready: string
  replicas: number
  ageMs: number
}

interface K8sServiceRow {
  name: string
  namespace: string
  type: string
  clusterIP: string
  ports: string
  ageMs: number
}

interface K8sIngressRow {
  name: string
  namespace: string
  hosts: string
  address: string
  ageMs: number
}

interface K8sLogChunk {
  sessionId: string
  data: string
}

interface K8sExecData {
  sessionId: string
  data: string
}

interface K8sExecExit {
  sessionId: string
  reason?: string
}

interface K8sPortForwardStatus {
  id: string
  namespace: string
  pod: string
  localPort: number
  remotePort: number
  state: K8sPortForwardState
  error?: string
}

interface K8sStartLogsOpts {
  namespace: string
  pod: string
  container?: string
  tailLines?: number
  follow?: boolean
}

interface K8sStartExecOpts {
  namespace: string
  pod: string
  container?: string
  cols?: number
  rows?: number
}

interface K8sStartPortForwardOpts {
  namespace: string
  pod: string
  localPort: number
  remotePort: number
}
