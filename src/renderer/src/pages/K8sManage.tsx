import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Switch,
  Empty,
  Pagination
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CloudServerOutlined,
  LinkOutlined,
  DisconnectOutlined,
  ReloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  FileTextOutlined,
  DownloadOutlined,
  CodeOutlined,
  ApiOutlined,
  StopOutlined,
  ArrowDownOutlined,
  SearchOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function statusColor(state: K8sConnectionState): string {
  if (state === 'connected') return 'success'
  if (state === 'connecting') return 'processing'
  if (state === 'error') return 'error'
  return 'default'
}

function matchName(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const n = name.toLowerCase()
  return q.split(/\s+/).every((token) => n.includes(token))
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function K8sManage(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [clusters, setClusters] = useState<K8sCluster[]>([])
  const [status, setStatus] = useState<K8sStatus | null>(null)
  const [selectedClusterId, setSelectedClusterId] = useState<string>()
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [namespace, setNamespace] = useState<string>('all')
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [pods, setPods] = useState<K8sPodRow[]>([])
  const [workloads, setWorkloads] = useState<K8sWorkloadRow[]>([])
  const [services, setServices] = useState<K8sServiceRow[]>([])
  const [ingresses, setIngresses] = useState<K8sIngressRow[]>([])
  const [portForwards, setPortForwards] = useState<K8sPortForwardStatus[]>([])

  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<'file' | 'paste'>('file')
  const [kubeconfigPath, setKubeconfigPath] = useState('')
  const [kubeconfigContent, setKubeconfigContent] = useState('')
  const [contentParsed, setContentParsed] = useState(false)
  const [contexts, setContexts] = useState<K8sContextInfo[]>([])
  const [parsing, setParsing] = useState(false)
  const [addForm] = Form.useForm<{ name: string; context: string }>()

  const [logOpen, setLogOpen] = useState(false)
  const [logPod, setLogPod] = useState<K8sPodRow | null>(null)
  const [logContainer, setLogContainer] = useState<string>()
  const [logFollow, setLogFollow] = useState(true)
  const [logWrap, setLogWrap] = useState(false)
  const [logAutoScroll, setLogAutoScroll] = useState(true)
  const [logText, setLogText] = useState('')
  const [logSessionId, setLogSessionId] = useState<string | null>(null)
  const logPreRef = useRef<HTMLPreElement>(null)
  const logAutoScrollRef = useRef(logAutoScroll)
  const ignoreLogScrollRef = useRef(false)
  logAutoScrollRef.current = logAutoScroll

  const scrollLogsToBottom = (): void => {
    const el = logPreRef.current
    if (!el) return
    ignoreLogScrollRef.current = true
    el.scrollTop = el.scrollHeight
    requestAnimationFrame(() => {
      ignoreLogScrollRef.current = false
    })
  }

  const onLogScroll = (): void => {
    if (ignoreLogScrollRef.current || !logAutoScrollRef.current) return
    const el = logPreRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance > 24) setLogAutoScroll(false)
  }

  const toggleLogAutoScroll = (): void => {
    setLogAutoScroll((prev) => {
      const next = !prev
      if (next) {
        requestAnimationFrame(scrollLogsToBottom)
      }
      return next
    })
  }

  const [execOpen, setExecOpen] = useState(false)
  const [execPod, setExecPod] = useState<K8sPodRow | null>(null)
  const [execContainer, setExecContainer] = useState<string>()
  const [execSessionId, setExecSessionId] = useState<string | null>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const execSessionRef = useRef<string | null>(null)

  const [pfOpen, setPfOpen] = useState(false)
  const [pfPod, setPfPod] = useState<K8sPodRow | null>(null)
  const [pfForm] = Form.useForm<{ localPort: number; remotePort: number }>()
  const [activeTab, setActiveTab] = useState('pods')
  const [networkSubTab, setNetworkSubTab] = useState<'services' | 'ingress'>('services')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [nameQuery, setNameQuery] = useState('')
  const [tableScrollY, setTableScrollY] = useState(360)
  const bodyRef = useRef<HTMLDivElement>(null)

  const connected = status?.state === 'connected'
  const bodyScrollable = !connected

  const filteredPods = pods.filter((p) => matchName(p.name, nameQuery))
  const filteredWorkloads = workloads.filter((w) => matchName(w.name, nameQuery))
  const filteredServices = services.filter((s) => matchName(s.name, nameQuery))
  const filteredIngresses = ingresses.filter((i) => matchName(i.name, nameQuery))
  const filteredPortForwards = portForwards.filter((pf) => matchName(pf.pod, nameQuery))

  useEffect(() => {
    const el = bodyRef.current
    if (!el || bodyScrollable) return

    const update = (): void => {
      const styles = getComputedStyle(el)
      const pad =
        (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
      setTableScrollY(Math.max(120, Math.floor(el.clientHeight - pad)))
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bodyScrollable, connected, activeTab])

  const connectionStatus = (
    <span className="inline-flex items-center gap-2 max-w-[420px] min-w-0">
      <Tag
        icon={<CloudServerOutlined />}
        color={statusColor(status?.state ?? 'disconnected')}
        className="m-0"
      >
        {status?.state ?? 'disconnected'}
        {status?.context ? ` · ${status.context}` : ''}
      </Tag>
      {status?.server && (
        <span className="text-xs text-[var(--text-secondary)] truncate">{status.server}</span>
      )}
      {status?.error && (
        <span className="text-xs text-red-500 truncate">{status.error}</span>
      )}
    </span>
  )

  const paged = <T,>(list: T[]): T[] => {
    const start = (page - 1) * pageSize
    return list.slice(start, start + pageSize)
  }

  const footerTotal =
    activeTab === 'pods'
      ? filteredPods.length
      : activeTab === 'workloads'
        ? filteredWorkloads.length
        : activeTab === 'portforwards'
          ? filteredPortForwards.length
          : activeTab === 'network'
            ? networkSubTab === 'services'
              ? filteredServices.length
              : filteredIngresses.length
            : 0

  const showFooterPager = connected && footerTotal > pageSize

  const refreshClusters = useCallback(async () => {
    const list = await window.api.k8s.listClusters()
    setClusters(list)
    setSelectedClusterId((prev) => prev ?? list[0]?.id)
  }, [])

  const refreshResources = useCallback(async () => {
    if (!connected) return
    setLoading(true)
    try {
      const ns = namespace || 'all'
      const [podList, wl, net, pfs] = await Promise.all([
        window.api.k8s.listPods(ns),
        window.api.k8s.listWorkloads(ns),
        window.api.k8s.listNetwork(ns),
        window.api.k8s.listPortForwards()
      ])
      setPods(podList)
      setWorkloads(wl)
      setServices(net.services)
      setIngresses(net.ingresses)
      setPortForwards(pfs)
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('k8sLoadFail'))
    } finally {
      setLoading(false)
    }
  }, [connected, namespace, message, t])

  useEffect(() => {
    let mounted = true
    Promise.all([window.api.k8s.listClusters(), window.api.k8s.status()])
      .then(([list, st]) => {
        if (!mounted) return
        setClusters(list)
        setSelectedClusterId((prev) => prev ?? list[0]?.id)
        setStatus(st)
      })
      .catch(() => {})
    const offStatus = window.api.k8s.onStatusChange(setStatus)
    const offPf = window.api.k8s.onPortForwardStatus(setPortForwards)
    return () => {
      mounted = false
      offStatus()
      offPf()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    if (!connected) {
      startTransition(() => {
        if (!mounted) return
        setNamespaces([])
        setPods([])
        setWorkloads([])
        setServices([])
        setIngresses([])
      })
      return () => {
        mounted = false
      }
    }
    const ns = namespace || 'all'
    void Promise.resolve()
      .then(() => {
        if (mounted) setLoading(true)
        return Promise.all([
          window.api.k8s.listNamespaces(),
          window.api.k8s.listPods(ns),
          window.api.k8s.listWorkloads(ns),
          window.api.k8s.listNetwork(ns),
          window.api.k8s.listPortForwards()
        ])
      })
      .then(([nsList, podList, wl, net, pfs]) => {
        if (!mounted) return
        setNamespaces(nsList)
        setPods(podList)
        setWorkloads(wl)
        setServices(net.services)
        setIngresses(net.ingresses)
        setPortForwards(pfs)
      })
      .catch((err) => {
        if (mounted) message.error(err instanceof Error ? err.message : t('k8sLoadFail'))
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [connected, namespace, message, t])

  useEffect(() => {
    if (!logOpen || !logSessionId) return
    const off = window.api.k8s.onLogChunk((chunk) => {
      if (chunk.sessionId !== logSessionId) return
      setLogText((prev) => prev + chunk.data)
    })
    return off
  }, [logOpen, logSessionId])

  useEffect(() => {
    if (!logAutoScroll) return
    scrollLogsToBottom()
  }, [logText, logAutoScroll])

  useEffect(() => {
    execSessionRef.current = execSessionId
  }, [execSessionId])

  useEffect(() => {
    if (!execOpen) return
    const offData = window.api.k8s.onExecData((data) => {
      if (data.sessionId !== execSessionRef.current) return
      const bytes = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))
      terminalRef.current?.write(bytes)
    })
    const offExit = window.api.k8s.onExecExit((data) => {
      if (data.sessionId !== execSessionRef.current) return
      terminalRef.current?.writeln(`\r\n\x1b[90m[${t('k8sExecClosed')}]\x1b[0m`)
      setExecSessionId(null)
    })
    return () => {
      offData()
      offExit()
    }
  }, [execOpen, t])

  const handleConnect = async (): Promise<void> => {
    if (!selectedClusterId) {
      message.warning(t('k8sSelectCluster'))
      return
    }
    setConnecting(true)
    try {
      await window.api.k8s.connect(selectedClusterId)
      message.success(t('k8sConnected'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('k8sConnectFail'))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    await window.api.k8s.disconnect()
    message.success(t('k8sDisconnected'))
  }

  const openAddCluster = async (): Promise<void> => {
    setAddMode('file')
    setKubeconfigPath('')
    setKubeconfigContent('')
    setContentParsed(false)
    setContexts([])
    setAddOpen(true)
  }

  useEffect(() => {
    if (addOpen) addForm.resetFields()
  }, [addOpen, addForm])

  const pickKubeconfig = async (): Promise<void> => {
    const path = await window.api.k8s.chooseKubeconfig()
    if (!path) return
    await loadContextsFromFile(path)
  }

  const pickDefaultKubeconfig = async (): Promise<void> => {
    const path = await window.api.k8s.defaultKubeconfig()
    await loadContextsFromFile(path)
  }

  const applyContexts = (list: K8sContextInfo[]): void => {
    setContexts(list)
    if (list[0]) {
      addForm.setFieldsValue({
        context: list[0].name,
        name: list[0].cluster || list[0].name
      })
    }
  }

  const loadContextsFromFile = async (path: string): Promise<void> => {
    setParsing(true)
    try {
      const list = await window.api.k8s.parseContexts(path)
      setKubeconfigPath(path)
      setKubeconfigContent('')
      setContentParsed(false)
      applyContexts(list)
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('k8sParseFail'))
    } finally {
      setParsing(false)
    }
  }

  const parsePastedContent = async (): Promise<void> => {
    if (!kubeconfigContent.trim()) {
      message.warning(t('k8sPasteRequired'))
      return
    }
    setParsing(true)
    try {
      const list = await window.api.k8s.parseContextsFromContent(kubeconfigContent)
      setKubeconfigPath('')
      setContentParsed(true)
      applyContexts(list)
      message.success(t('k8sParseOk'))
    } catch (err) {
      setContentParsed(false)
      setContexts([])
      message.error(err instanceof Error ? err.message : t('k8sParseFail'))
    } finally {
      setParsing(false)
    }
  }

  const saveCluster = async (): Promise<void> => {
    const values = await addForm.validateFields()
    if (addMode === 'paste') {
      if (!contentParsed || !kubeconfigContent.trim()) {
        message.warning(t('k8sParseFirst'))
        return
      }
      await window.api.k8s.saveCluster({
        name: values.name,
        kubeconfigContent,
        context: values.context
      })
    } else {
      if (!kubeconfigPath) {
        message.warning(t('k8sPickKubeconfig'))
        return
      }
      await window.api.k8s.saveCluster({
        name: values.name,
        kubeconfigPath,
        context: values.context
      })
    }
    message.success(t('k8sClusterSaved'))
    setAddOpen(false)
    await refreshClusters()
  }

  const deleteCluster = async (id: string): Promise<void> => {
    await window.api.k8s.deleteCluster(id)
    if (selectedClusterId === id) setSelectedClusterId(undefined)
    await refreshClusters()
    message.success(t('k8sClusterDeleted'))
  }

  const stopLogs = useCallback(async () => {
    if (logSessionId) {
      await window.api.k8s.stopLogs(logSessionId)
      setLogSessionId(null)
    }
  }, [logSessionId])

  const startLogs = async (pod: K8sPodRow, container?: string, follow = true): Promise<void> => {
    await stopLogs()
    setLogText('')
    try {
      const { sessionId } = await window.api.k8s.startLogs({
        namespace: pod.namespace,
        pod: pod.name,
        container,
        follow,
        tailLines: 200
      })
      setLogSessionId(sessionId)
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('k8sLogFail'))
    }
  }

  const openLogs = async (pod: K8sPodRow): Promise<void> => {
    setLogPod(pod)
    const container = pod.containers[0]
    setLogContainer(container)
    setLogFollow(true)
    setLogAutoScroll(true)
    setLogOpen(true)
    await startLogs(pod, container, true)
  }

  const closeLogs = async (): Promise<void> => {
    await stopLogs()
    setLogOpen(false)
    setLogPod(null)
  }

  const downloadLogs = async (pod: K8sPodRow, container?: string): Promise<void> => {
    const result = await window.api.k8s.downloadLogs({
      namespace: pod.namespace,
      pod: pod.name,
      container: container ?? pod.containers[0],
      tailLines: 10000
    })
    if (result.canceled) return
    if (result.ok) message.success(t('k8sLogDownloaded'))
    else message.error(result.error || t('k8sLogFail'))
  }

  const destroyTerminal = (): void => {
    terminalRef.current?.dispose()
    terminalRef.current = null
    fitRef.current = null
  }

  const closeExec = async (): Promise<void> => {
    if (execSessionId) await window.api.k8s.stopExec(execSessionId)
    setExecSessionId(null)
    destroyTerminal()
    setExecOpen(false)
    setExecPod(null)
  }

  const openExec = async (pod: K8sPodRow): Promise<void> => {
    setExecPod(pod)
    setExecContainer(pod.containers[0])
    setExecOpen(true)
  }

  useEffect(() => {
    if (!execOpen || !execPod || !termRef.current) return
    destroyTerminal()
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: isDark
        ? { background: '#1e1e1e', foreground: '#d4d4d4' }
        : { background: '#fafafa', foreground: '#1f1f1f' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termRef.current)
    fit.fit()
    terminalRef.current = term
    fitRef.current = fit

    let disposed = false
    let activeSession: string | null = null
    const boot = async (): Promise<void> => {
      try {
        const { sessionId } = await window.api.k8s.startExec({
          namespace: execPod.namespace,
          pod: execPod.name,
          container: execContainer,
          cols: term.cols,
          rows: term.rows
        })
        if (disposed) {
          await window.api.k8s.stopExec(sessionId)
          return
        }
        activeSession = sessionId
        setExecSessionId(sessionId)
        term.onData((data) => {
          void window.api.k8s.writeExec(sessionId, toBase64(data))
        })
        term.onResize(({ cols, rows }) => {
          void window.api.k8s.resizeExec(sessionId, cols, rows)
        })
      } catch (err) {
        term.writeln(`\x1b[31m${err instanceof Error ? err.message : t('k8sExecFail')}\x1b[0m`)
      }
    }
    void boot()

    const onResize = (): void => fit.fit()
    window.addEventListener('resize', onResize)
    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      if (activeSession) void window.api.k8s.stopExec(activeSession)
      destroyTerminal()
    }
  }, [execOpen, execPod, execContainer, t])

  const openPortForward = (pod: K8sPodRow): void => {
    setPfPod(pod)
    setPfOpen(true)
  }

  useEffect(() => {
    if (!pfOpen || !pfPod) return
    const port = pfPod.containerPorts[0]
    pfForm.setFieldsValue({
      localPort: port || 8080,
      remotePort: port || 80
    })
  }, [pfOpen, pfPod, pfForm])

  const startPortForward = async (): Promise<void> => {
    if (!pfPod) return
    const values = await pfForm.validateFields()
    try {
      await window.api.k8s.startPortForward({
        namespace: pfPod.namespace,
        pod: pfPod.name,
        localPort: values.localPort,
        remotePort: values.remotePort
      })
      message.success(t('k8sPfStarted'))
      setPfOpen(false)
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('k8sPfFail'))
    }
  }

  const stopPortForward = async (id: string): Promise<void> => {
    try {
      await window.api.k8s.stopPortForward(id)
      message.success(t('k8sPfStopped'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('k8sPfFail'))
    }
  }

  const restartPortForward = async (id: string): Promise<void> => {
    try {
      await window.api.k8s.startPortForward({ id })
      message.success(t('k8sPfStarted'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('k8sPfFail'))
    }
  }

  const deletePortForward = async (id: string): Promise<void> => {
    try {
      await window.api.k8s.deletePortForward(id)
      message.success(t('k8sPfDeleted'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('k8sPfFail'))
    }
  }

  const podColumns: ColumnsType<K8sPodRow> = [
    {
      title: t('k8sColName'),
      dataIndex: 'name',
      width: 200,
      ellipsis: true,
      sorter: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
      defaultSortOrder: 'ascend'
    },
    { title: t('k8sColNamespace'), dataIndex: 'namespace', width: 120, ellipsis: true },
    { title: t('k8sColReady'), dataIndex: 'ready', width: 72 },
    {
      title: t('k8sColStatus'),
      dataIndex: 'status',
      width: 96,
      render: (v: string) => (
        <Tag color={v === 'Running' ? 'success' : v === 'Pending' ? 'processing' : 'default'}>
          {v}
        </Tag>
      )
    },
    { title: t('k8sColRestarts'), dataIndex: 'restarts', width: 72 },
    { title: t('k8sColNode'), dataIndex: 'node', ellipsis: true, width: 140 },
    {
      title: t('k8sColAge'),
      dataIndex: 'ageMs',
      width: 64,
      render: (v: number) => formatAge(v)
    },
    {
      title: t('k8sColActions'),
      key: 'actions',
      width: 128,
      fixed: 'right',
      render: (_, pod) => (
        <Space size={0}>
          <Button
            type="text"
            size="small"
            icon={<FileTextOutlined />}
            title={t('k8sLogs')}
            onClick={() => void openLogs(pod)}
          />
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            title={t('k8sDownloadLogs')}
            onClick={() => void downloadLogs(pod)}
          />
          <Button
            type="text"
            size="small"
            icon={<CodeOutlined />}
            title={t('k8sConsole')}
            onClick={() => void openExec(pod)}
          />
          <Button
            type="text"
            size="small"
            icon={<ApiOutlined />}
            title={t('k8sPortForward')}
            onClick={() => openPortForward(pod)}
          />
        </Space>
      )
    }
  ]

  const podScrollX =
    200 + 120 + 72 + 96 + 72 + 140 + 64 + 128

  const workloadColumns: ColumnsType<K8sWorkloadRow> = [
    { title: t('k8sColKind'), dataIndex: 'kind', width: 120 },
    {
      title: t('k8sColName'),
      dataIndex: 'name',
      ellipsis: true,
      sorter: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
      defaultSortOrder: 'ascend'
    },
    { title: t('k8sColNamespace'), dataIndex: 'namespace', width: 120 },
    { title: t('k8sColReady'), dataIndex: 'ready', width: 90 },
    { title: t('k8sColReplicas'), dataIndex: 'replicas', width: 90 },
    {
      title: t('k8sColAge'),
      dataIndex: 'ageMs',
      width: 70,
      render: (v: number) => formatAge(v)
    }
  ]

  const serviceColumns: ColumnsType<K8sServiceRow> = [
    {
      title: t('k8sColName'),
      dataIndex: 'name',
      ellipsis: true,
      sorter: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
      defaultSortOrder: 'ascend'
    },
    { title: t('k8sColNamespace'), dataIndex: 'namespace', width: 120 },
    { title: t('k8sColType'), dataIndex: 'type', width: 110 },
    { title: 'ClusterIP', dataIndex: 'clusterIP', width: 130 },
    { title: t('k8sColPorts'), dataIndex: 'ports', ellipsis: true },
    {
      title: t('k8sColAge'),
      dataIndex: 'ageMs',
      width: 70,
      render: (v: number) => formatAge(v)
    }
  ]

  const ingressColumns: ColumnsType<K8sIngressRow> = [
    {
      title: t('k8sColName'),
      dataIndex: 'name',
      ellipsis: true,
      sorter: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
      defaultSortOrder: 'ascend'
    },
    { title: t('k8sColNamespace'), dataIndex: 'namespace', width: 120 },
    { title: t('k8sColHosts'), dataIndex: 'hosts', ellipsis: true },
    { title: t('k8sColAddress'), dataIndex: 'address', ellipsis: true },
    {
      title: t('k8sColAge'),
      dataIndex: 'ageMs',
      width: 70,
      render: (v: number) => formatAge(v)
    }
  ]

  const pfColumns: ColumnsType<K8sPortForwardStatus> = [
    { title: t('k8sColNamespace'), dataIndex: 'namespace', width: 120 },
    { title: 'Pod', dataIndex: 'pod', ellipsis: true },
    {
      title: t('k8sColLocalPort'),
      dataIndex: 'localPort',
      width: 100,
      render: (p: number) => `127.0.0.1:${p}`
    },
    { title: t('k8sColRemotePort'), dataIndex: 'remotePort', width: 100 },
    {
      title: t('k8sColStatus'),
      dataIndex: 'state',
      width: 100,
      render: (s: K8sPortForwardState) => (
        <Tag
          color={
            s === 'active' ? 'success' : s === 'error' ? 'error' : s === 'starting' ? 'processing' : 'default'
          }
        >
          {s}
        </Tag>
      )
    },
    {
      title: t('k8sColActions'),
      key: 'actions',
      width: 110,
      render: (_, row) => {
        const running = row.state === 'active' || row.state === 'starting'
        return (
          <Space size={0}>
            {running ? (
              <Button
                type="text"
                size="small"
                danger
                icon={<StopOutlined />}
                title={t('k8sDisconnect')}
                onClick={() => void stopPortForward(row.id)}
              />
            ) : (
              <Button
                type="text"
                size="small"
                icon={<PlayCircleOutlined />}
                title={t('k8sStart')}
                onClick={() => void restartPortForward(row.id)}
              />
            )}
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              title={t('k8sPfDelete')}
              onClick={() => void deletePortForward(row.id)}
            />
          </Space>
        )
      }
    }
  ]

  const tabDefs: Array<{ key: string; label: string }> = [
    { key: 'pods', label: `${t('k8sTabPods')} (${filteredPods.length})` },
    { key: 'workloads', label: `${t('k8sTabWorkloads')} (${filteredWorkloads.length})` },
    {
      key: 'network',
      label: `${t('k8sTabNetwork')} (${filteredServices.length + filteredIngresses.length})`
    },
    {
      key: 'portforwards',
      label: `${t('k8sTabPortForwards')} (${filteredPortForwards.length})`
    }
  ]

  return (
    <div className="k8s-page flex flex-col">
      <div className="k8s-page-header shrink-0 bg-[var(--content-bg)]">
        <p className="text-xs text-[var(--text-secondary)] m-0 pt-4 px-6 pb-2">{t('k8sDesc')}</p>

        <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
          <Select
            className="w-[220px] max-w-full"
            placeholder={t('k8sSelectCluster')}
            value={selectedClusterId}
            onChange={setSelectedClusterId}
            options={clusters.map((c) => ({
              value: c.id,
              label: `${c.name} (${c.context})`
            }))}
          />
          <Button icon={<PlusOutlined />} onClick={() => void openAddCluster()}>
            {t('k8sAddCluster')}
          </Button>
          {selectedClusterId && (
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => void deleteCluster(selectedClusterId)}
            >
              {t('k8sDeleteCluster')}
            </Button>
          )}
          {!connected ? (
            <Button
              type="primary"
              icon={<LinkOutlined />}
              loading={connecting}
              onClick={() => void handleConnect()}
            >
              {t('k8sConnect')}
            </Button>
          ) : (
            <Button icon={<DisconnectOutlined />} onClick={() => void handleDisconnect()}>
              {t('k8sDisconnect')}
            </Button>
          )}
          <Select
            className="w-[130px] max-w-full"
            value={namespace}
            disabled={!connected}
            onChange={(v) => {
              setNamespace(v)
              setPage(1)
            }}
            options={[
              { value: 'all', label: t('k8sAllNamespaces') },
              ...namespaces.map((n) => ({ value: n, label: n }))
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            disabled={!connected}
            loading={loading}
            onClick={() => void refreshResources()}
          >
            {t('k8sRefresh')}
          </Button>
          <Input
            allowClear
            disabled={!connected}
            prefix={<SearchOutlined className="text-[var(--text-secondary)]" />}
            placeholder={t('k8sSearchName')}
            value={nameQuery}
            onChange={(e) => {
              setNameQuery(e.target.value)
              setPage(1)
            }}
            style={{ width: 200, maxWidth: 200 }}
          />
        </div>

        {connected && (
          <div className="flex items-center border-b border-[var(--border-subtle)] px-6">
            {tabDefs.map((tab) => {
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key)
                    setPage(1)
                  }}
                  className={`relative px-3 py-2 text-sm transition-colors cursor-pointer border-none bg-transparent ${
                    active
                      ? 'text-[var(--text-primary)] font-medium'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {tab.label}
                  {active && (
                    <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-[var(--accent)]" />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {connected && activeTab === 'network' && (
          <div className="flex items-center px-6 py-2 border-b border-[var(--border-subtle)]">
            <Segmented
              size="small"
              value={networkSubTab}
              onChange={(v) => {
                setNetworkSubTab(v as 'services' | 'ingress')
                setPage(1)
              }}
              options={[
                {
                  value: 'services',
                  label: `${t('k8sTabServices')} (${filteredServices.length})`
                },
                {
                  value: 'ingress',
                  label: `${t('k8sTabIngress')} (${filteredIngresses.length})`
                }
              ]}
            />
          </div>
        )}
      </div>

      <div
        ref={bodyRef}
        className={`k8s-page-body flex-1 min-h-0 px-6 pt-4 pb-4 ${
          bodyScrollable ? 'overflow-auto' : 'overflow-hidden'
        }`}
      >
        {!connected ? (
          <div className="flex items-center justify-center py-16">
            <Empty description={t('k8sNotConnected')} />
          </div>
        ) : (
          <>
            {activeTab === 'pods' && (
              <Table
                size="small"
                rowKey={(r) => `${r.namespace}/${r.name}`}
                columns={podColumns}
                dataSource={paged(filteredPods)}
                loading={loading}
                pagination={false}
                tableLayout="fixed"
                scroll={{ x: podScrollX, y: tableScrollY }}
              />
            )}
            {activeTab === 'workloads' && (
              <Table
                size="small"
                rowKey={(r) => `${r.kind}/${r.namespace}/${r.name}`}
                columns={workloadColumns}
                dataSource={paged(filteredWorkloads)}
                loading={loading}
                pagination={false}
                scroll={{ y: tableScrollY }}
              />
            )}
            {activeTab === 'network' && networkSubTab === 'services' && (
              <Table
                size="small"
                rowKey={(r) => `${r.namespace}/${r.name}`}
                columns={serviceColumns}
                dataSource={paged(filteredServices)}
                loading={loading}
                pagination={false}
                scroll={{ y: tableScrollY }}
              />
            )}
            {activeTab === 'network' && networkSubTab === 'ingress' && (
              <Table
                size="small"
                rowKey={(r) => `${r.namespace}/${r.name}`}
                columns={ingressColumns}
                dataSource={paged(filteredIngresses)}
                loading={loading}
                pagination={false}
                scroll={{ y: tableScrollY }}
              />
            )}
            {activeTab === 'portforwards' && (
              <Table
                size="small"
                rowKey="id"
                columns={pfColumns}
                dataSource={paged(filteredPortForwards)}
                pagination={false}
                scroll={{ y: tableScrollY }}
                locale={{ emptyText: t('k8sNoPortForwards') }}
              />
            )}
          </>
        )}
      </div>

      <div className="k8s-page-footer shrink-0 flex items-center justify-between gap-3 px-6 py-2 border-t border-[var(--border-subtle)] bg-[var(--content-bg)]">
        {connectionStatus}
        {showFooterPager ? (
          <Pagination
            size="small"
            current={page}
            pageSize={pageSize}
            total={footerTotal}
            hideOnSinglePage
            showSizeChanger
            pageSizeOptions={[20, 50, 100]}
            onChange={(p, ps) => {
              setPage(p)
              setPageSize(ps)
            }}
          />
        ) : (
          <span />
        )}
      </div>

      <Modal
        title={t('k8sAddCluster')}
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void saveCluster()}
        okText={t('memoStickySave')}
        destroyOnHidden
        width={560}
      >
        <div className="flex flex-col gap-3 pt-2">
          <Segmented
            block
            value={addMode}
            onChange={(v) => {
              setAddMode(v as 'file' | 'paste')
              setContexts([])
              setKubeconfigPath('')
              setContentParsed(false)
              addForm.setFieldsValue({ context: undefined })
            }}
            options={[
              { value: 'file', label: t('k8sAddModeFile') },
              { value: 'paste', label: t('k8sAddModePaste') }
            ]}
          />
          {addMode === 'file' ? (
            <>
              <Space wrap>
                <Button loading={parsing} onClick={() => void pickKubeconfig()}>
                  {t('k8sPickKubeconfig')}
                </Button>
                <Button loading={parsing} onClick={() => void pickDefaultKubeconfig()}>
                  {t('k8sUseDefault')}
                </Button>
              </Space>
              {kubeconfigPath && (
                <div className="text-xs text-[var(--text-secondary)] break-all">
                  {kubeconfigPath}
                </div>
              )}
            </>
          ) : (
            <>
              <Input.TextArea
                rows={8}
                value={kubeconfigContent}
                onChange={(e) => {
                  setKubeconfigContent(e.target.value)
                  setContentParsed(false)
                }}
                placeholder={t('k8sPastePlaceholder')}
                style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }}
              />
              <Button
                type="default"
                loading={parsing}
                onClick={() => void parsePastedContent()}
                disabled={!kubeconfigContent.trim()}
              >
                {t('k8sParseContent')}
              </Button>
            </>
          )}
          <Form form={addForm} layout="vertical">
            <Form.Item
              name="name"
              label={t('k8sClusterName')}
              rules={[{ required: true, message: t('k8sClusterNameRequired') }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="context"
              label={t('k8sContext')}
              rules={[{ required: true, message: t('k8sContextRequired') }]}
            >
              <Select
                options={contexts.map((c) => ({
                  value: c.name,
                  label: c.name
                }))}
              />
            </Form.Item>
          </Form>
        </div>
      </Modal>

      <Drawer
        title={logPod ? `${t('k8sLogs')} · ${logPod.namespace}/${logPod.name}` : t('k8sLogs')}
        placement="bottom"
        height="70vh"
        open={logOpen}
        onClose={() => void closeLogs()}
        mask={false}
        maskClosable={false}
        destroyOnHidden
        styles={{ body: { paddingTop: 12, display: 'flex', flexDirection: 'column' } }}
        extra={
          <Space>
            {logPod && logPod.containers.length > 1 && (
              <Select
                size="small"
                className="min-w-[120px]"
                value={logContainer}
                options={logPod.containers.map((c) => ({ value: c, label: c }))}
                onChange={(v) => {
                  setLogContainer(v)
                  if (logPod) void startLogs(logPod, v, logFollow)
                }}
              />
            )}
            <span className="text-xs text-[var(--text-secondary)]">{t('k8sFollow')}</span>
            <Switch
              size="small"
              checked={logFollow}
              onChange={(v) => {
                setLogFollow(v)
                if (logPod) void startLogs(logPod, logContainer, v)
              }}
            />
            <span className="text-xs text-[var(--text-secondary)]">{t('k8sLogWrap')}</span>
            <Switch size="small" checked={logWrap} onChange={setLogWrap} />
            <Button
              size="small"
              type={logAutoScroll ? 'primary' : 'default'}
              icon={<ArrowDownOutlined />}
              title={t('k8sLogAutoScroll')}
              onClick={toggleLogAutoScroll}
            />
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => logPod && void downloadLogs(logPod, logContainer)}
            />
          </Space>
        }
      >
        <pre
          ref={logPreRef}
          onScroll={onLogScroll}
          className={`m-0 p-3 rounded-lg text-xs overflow-auto flex-1 min-h-0 ${
            logWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
          }`}
          style={{
            background: 'var(--bg-warm)',
            color: 'var(--text-primary)',
            fontFamily: 'Consolas, monospace'
          }}
        >
          {logText || t('k8sLogWaiting')}
        </pre>
      </Drawer>

      <Drawer
        title={
          execPod ? `${t('k8sConsole')} · ${execPod.namespace}/${execPod.name}` : t('k8sConsole')
        }
        open={execOpen}
        onClose={() => void closeExec()}
        size={800}
        destroyOnHidden
        extra={
          execPod && execPod.containers.length > 1 ? (
            <Select
              size="small"
              className="min-w-[120px]"
              value={execContainer}
              options={execPod.containers.map((c) => ({ value: c, label: c }))}
              onChange={(v) => {
                if (execSessionId) void window.api.k8s.stopExec(execSessionId)
                setExecSessionId(null)
                setExecContainer(v)
              }}
            />
          ) : null
        }
      >
        <div
          ref={termRef}
          className="rounded-lg overflow-hidden"
          style={{ height: 'calc(100vh - 160px)', padding: 8, background: 'var(--bg-warm)' }}
        />
      </Drawer>

      <Modal
        title={t('k8sPortForward')}
        open={pfOpen}
        onCancel={() => setPfOpen(false)}
        onOk={() => void startPortForward()}
        okText={t('k8sStart')}
        destroyOnHidden
      >
        {pfPod && (
          <p className="text-xs text-[var(--text-secondary)] m-0 mb-3 truncate">
            {pfPod.namespace}/{pfPod.name}
          </p>
        )}
        <Form form={pfForm} layout="inline" className="flex flex-nowrap items-center gap-4">
          <Form.Item
            name="localPort"
            label={t('k8sColLocalPort')}
            rules={[{ required: true }]}
            className="!mb-0"
          >
            <InputNumber min={1} max={65535} className="w-[120px]" />
          </Form.Item>
          <Form.Item
            name="remotePort"
            label={t('k8sColRemotePort')}
            rules={[{ required: true }]}
            className="!mb-0"
          >
            <InputNumber min={1} max={65535} className="w-[120px]" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default K8sManage
