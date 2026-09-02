import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App,
  Button,
  Drawer,
  Dropdown,
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
import type { MenuProps, InputRef } from 'antd'
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
  ArrowUpOutlined,
  SearchOutlined,
  PlayCircleOutlined,
  CopyOutlined,
  ClearOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  SnippetsOutlined,
  CloseOutlined
} from '@ant-design/icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '../theme/ThemeProvider'

const LS_K8S_NAME_QUERY = 'brickworks:k8sNameQuery'
const LS_K8S_NAMESPACE = 'brickworks:k8sNamespace'
const LS_K8S_EXEC_SHELL = 'brickworks:k8sExecShell'
const LS_K8S_EXEC_FONT_SIZE = 'brickworks:k8sExecFontSize'

const FONT_MIN = 10
const FONT_MAX = 26
const DEFAULT_FONT = 13

const BTN_ICON =
  'h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer ' +
  'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function applyTermTheme(term: Terminal): void {
  term.options.theme = {
    background: readCssVar('--bg-warm', '#f1efe9'),
    foreground: readCssVar('--text-primary', '#26211d')
  }
}

function loadExecShell(): 'bash' | 'sh' {
  const raw = localStorage.getItem(LS_K8S_EXEC_SHELL)
  return raw === 'sh' || raw === 'bash' ? raw : 'bash'
}

function loadExecFontSize(): number {
  const stored = parseInt(localStorage.getItem(LS_K8S_EXEC_FONT_SIZE) || '', 10)
  return Number.isFinite(stored) ? Math.min(FONT_MAX, Math.max(FONT_MIN, stored)) : DEFAULT_FONT
}

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

function mapK8sError(err: unknown, fallback: string, t: (key: string) => string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (msg === 'KUBECONFIG_EXEC_FORBIDDEN') return t('k8sExecForbidden')
  return msg || fallback
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

function K8sManage({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { resolved: themeResolved } = useTheme()
  const pageRef = useRef<HTMLDivElement>(null)
  const overlayContainer = (): HTMLElement => pageRef.current || document.body

  const [clusters, setClusters] = useState<K8sCluster[]>([])
  const [status, setStatus] = useState<K8sStatus | null>(null)
  const [selectedClusterId, setSelectedClusterId] = useState<string>()
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [namespace, setNamespace] = useState<string>(
    () => localStorage.getItem(LS_K8S_NAMESPACE) || 'all'
  )
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
  const logSessionIdRef = useRef<string | null>(null)
  const LOG_TEXT_MAX = 512 * 1024
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

  const [execPickerOpen, setExecPickerOpen] = useState(false)
  const [execOpen, setExecOpen] = useState(false)
  const [execReady, setExecReady] = useState(false)
  const [execPod, setExecPod] = useState<K8sPodRow | null>(null)
  const [execContainer, setExecContainer] = useState<string>()
  const [execShell, setExecShell] = useState<'bash' | 'sh'>(loadExecShell)
  const [execSessionId, setExecSessionId] = useState<string | null>(null)
  const [execFontSize, setExecFontSize] = useState(loadExecFontSize)
  const [copyEnabled, setCopyEnabled] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchMatch, setSearchMatch] = useState<{ index: number; count: number } | null>(null)
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<InputRef>(null)
  const execSessionRef = useRef<string | null>(null)
  const activeRef = useRef(active)
  const execOpenRef = useRef(execOpen)
  const execFocusedRef = useRef(false)
  const syncExecFocus = useCallback((): void => {
    window.api.app.setTermPasteFocus(
      Boolean(activeRef.current && execOpenRef.current && execFocusedRef.current)
    )
  }, [])

  useEffect(() => {
    activeRef.current = active
    execOpenRef.current = execOpen
    syncExecFocus()
  }, [active, execOpen, syncExecFocus])

  const [pfOpen, setPfOpen] = useState(false)
  const [pfPod, setPfPod] = useState<K8sPodRow | null>(null)
  const [pfForm] = Form.useForm<{ localPort: number; remotePort: number }>()
  const [activeTab, setActiveTab] = useState('pods')
  const [networkSubTab, setNetworkSubTab] = useState<'services' | 'ingress'>('services')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [nameQuery, setNameQuery] = useState(() => localStorage.getItem(LS_K8S_NAME_QUERY) ?? '')
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
      const pad = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
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
        <span className="text-xs text-[var(--danger)] truncate">
          {status.error === 'KUBECONFIG_EXEC_FORBIDDEN' ? t('k8sExecForbidden') : status.error}
        </span>
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
    logSessionIdRef.current = logSessionId
  }, [logSessionId])

  useEffect(() => {
    if (!logOpen || !logSessionId) return
    const off = window.api.k8s.onLogChunk((chunk) => {
      if (chunk.sessionId !== logSessionIdRef.current) return
      setLogText((prev) => {
        const next = prev + chunk.data
        return next.length > LOG_TEXT_MAX ? next.slice(-LOG_TEXT_MAX) : next
      })
    })
    return off
  }, [logOpen, logSessionId])

  useEffect(() => {
    return () => {
      const id = logSessionIdRef.current
      if (id) void window.api.k8s.stopLogs(id)
    }
  }, [])

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
      execSessionRef.current = null
      setExecSessionId(null)
      destroyTerminal()
      setExecReady(false)
      setExecOpen(false)
      setExecPod(null)
      message.info(t('k8sExecClosed'))
    })
    return () => {
      offData()
      offExit()
    }
  }, [execOpen, t, message])

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
      message.error(mapK8sError(err, t('k8sConnectFail'), t))
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
      message.error(mapK8sError(err, t('k8sParseFail'), t))
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
      message.error(mapK8sError(err, t('k8sParseFail'), t))
    } finally {
      setParsing(false)
    }
  }

  const saveCluster = async (): Promise<void> => {
    try {
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
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(mapK8sError(err, t('k8sParseFail'), t))
    }
  }

  const deleteCluster = (id: string): void => {
    const cluster = clusters.find((c) => c.id === id)
    Modal.confirm({
      title: t('k8sDeleteCluster'),
      content: t('k8sDeleteClusterConfirm', {
        name: cluster ? `${cluster.name} (${cluster.context})` : id
      }),
      okText: t('k8sDeleteCluster'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.api.k8s.deleteCluster(id)
        if (selectedClusterId === id) setSelectedClusterId(undefined)
        await refreshClusters()
        message.success(t('k8sClusterDeleted'))
      }
    })
  }

  const stopLogs = useCallback(async () => {
    const id = logSessionIdRef.current
    if (id) {
      logSessionIdRef.current = null
      setLogSessionId(null)
      await window.api.k8s.stopLogs(id)
    }
  }, [])

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
      logSessionIdRef.current = sessionId
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
    searchRef.current = null
    execFocusedRef.current = false
    syncExecFocus()
  }

  const closeExec = useCallback(async (): Promise<void> => {
    if (execSessionId) await window.api.k8s.stopExec(execSessionId)
    setExecSessionId(null)
    destroyTerminal()
    setExecReady(false)
    setExecOpen(false)
    setExecPod(null)
    setSearchOpen(false)
    setSearchText('')
    setSearchMatch(null)
  }, [execSessionId])

  const openExecPicker = (pod: K8sPodRow): void => {
    setExecPod(pod)
    setExecContainer(pod.containers[0])
    setExecPickerOpen(true)
  }

  const confirmExec = (): void => {
    setExecPickerOpen(false)
    setExecReady(false)
    setExecOpen(true)
  }

  const pasteExecClipboard = useCallback(async (): Promise<void> => {
    const sessionId = execSessionRef.current
    if (!sessionId) return
    const text = await window.api.clipboard.readText()
    // Route through the terminal so pasted text is normalized (CRLF -> CR) and
    // wrapped in bracketed-paste sequences when the remote enables that mode;
    // the existing onData handler then writes it to the exec channel.
    if (text) terminalRef.current?.paste(text)
    terminalRef.current?.focus()
  }, [])

  const copyExecSelection = useCallback(async (): Promise<void> => {
    const term = terminalRef.current
    if (!term) return
    const text = term.getSelection()
    if (!text) return
    await window.api.clipboard.writeText(text)
    message.success(t('copied'))
  }, [message, t])

  const clearExecTerminal = useCallback((): void => {
    terminalRef.current?.clear()
  }, [])

  const selectAllExecTerminal = useCallback((): void => {
    terminalRef.current?.selectAll()
  }, [])

  const runExecSearch = useCallback(
    (dir: 'next' | 'prev'): void => {
      const search = searchRef.current
      if (!search || !searchText) return
      const opts = {
        caseSensitive: false,
        wholeWord: false,
        // Decorations must be enabled for onDidChangeResults (match count) to fire.
        // Use transparent overview ruler colors so the visuals stay unchanged.
        decorations: {
          matchOverviewRuler: '#00000000',
          activeMatchColorOverviewRuler: '#00000000'
        } as const
      }
      if (dir === 'next') search.findNext(searchText, opts)
      else search.findPrevious(searchText, opts)
    },
    [searchText]
  )

  const buildTermMenu = useCallback(
    (): MenuProps => ({
      items: [
        {
          key: 'copy',
          icon: <CopyOutlined />,
          label: t('k8sTermCopy'),
          disabled: !copyEnabled
        },
        { key: 'paste', icon: <SnippetsOutlined />, label: t('k8sTermPaste') },
        { key: 'clear', icon: <ClearOutlined />, label: t('k8sTermClear') },
        { key: 'selectall', icon: <FileTextOutlined />, label: t('k8sTermSelectAll') },
        { type: 'divider' },
        { key: 'font-inc', icon: <ZoomInOutlined />, label: t('k8sTermFontInc') },
        { key: 'font-dec', icon: <ZoomOutOutlined />, label: t('k8sTermFontDec') },
        { key: 'font-reset', icon: <ReloadOutlined />, label: t('k8sTermFontReset') },
        { type: 'divider' },
        { key: 'search', icon: <SearchOutlined />, label: t('k8sTermSearch') }
      ],
      onClick: ({ key }) => {
        switch (key) {
          case 'copy':
            void copyExecSelection()
            break
          case 'paste':
            void pasteExecClipboard()
            break
          case 'clear':
            clearExecTerminal()
            break
          case 'selectall':
            selectAllExecTerminal()
            break
          case 'font-inc':
            setExecFontSize((v) => Math.min(FONT_MAX, v + 1))
            break
          case 'font-dec':
            setExecFontSize((v) => Math.max(FONT_MIN, v - 1))
            break
          case 'font-reset':
            setExecFontSize(DEFAULT_FONT)
            break
          case 'search':
            setSearchOpen(true)
            break
        }
      }
    }),
    [
      clearExecTerminal,
      copyEnabled,
      copyExecSelection,
      pasteExecClipboard,
      selectAllExecTerminal,
      t
    ]
  )

  useEffect(() => {
    const off = window.api.shortcuts.onShortcut((key) => {
      if (!active) return
      if (key === 'v') {
        void pasteExecClipboard()
        return
      }
      if (key === 'f') {
        setSearchOpen((v) => !v)
        return
      }
      const inFormField = Boolean(
        document.activeElement?.closest('.ant-input, .ant-select, .ant-input-number')
      )
      if (inFormField) return
      if (key === '=' || key === '+') {
        setExecFontSize((v) => Math.min(FONT_MAX, v + 1))
      } else if (key === '-' || key === '_') {
        setExecFontSize((v) => Math.max(FONT_MIN, v - 1))
      } else if (key === '0') {
        setExecFontSize(DEFAULT_FONT)
      }
    })
    return off
  }, [active, pasteExecClipboard])

  useEffect(() => {
    if (!execReady || !execOpen || !execPod) return
    const host = termRef.current
    if (!host) return

    destroyTerminal()
    const term = new Terminal({
      cursorBlink: true,
      fontSize: loadExecFontSize(),
      fontFamily: 'Consolas, "Courier New", monospace',
      // Search decorations (used to report the match count) require the proposed API.
      allowProposedApi: true
    })
    applyTermTheme(term)
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setSearchMatch({ index: resultIndex, count: resultCount })
    })
    term.open(host)
    terminalRef.current = term
    fitRef.current = fit
    searchRef.current = search
    fit.fit()
    term.focus()

    const textarea = term.textarea
    if (textarea) {
      textarea.addEventListener('focus', () => {
        execFocusedRef.current = true
        syncExecFocus()
      })
      textarea.addEventListener('blur', () => {
        execFocusedRef.current = false
        syncExecFocus()
      })
    }

    let disposed = false
    let activeSession: string | null = null
    const boot = async (): Promise<void> => {
      try {
        fit.fit()
        const { sessionId } = await window.api.k8s.startExec({
          namespace: execPod.namespace,
          pod: execPod.name,
          container: execContainer,
          shell: execShell,
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
        fit.fit()
        await window.api.k8s.resizeExec(sessionId, term.cols, term.rows)
        window.setTimeout(() => {
          if (disposed) return
          fit.fit()
          void window.api.k8s.resizeExec(sessionId, term.cols, term.rows)
          term.focus()
        }, 80)
        term.focus()
      } catch (err) {
        term.writeln(`\x1b[31m${err instanceof Error ? err.message : t('k8sExecFail')}\x1b[0m`)
      }
    }
    void boot()

    const onResize = (): void => {
      fit.fit()
    }
    window.addEventListener('resize', onResize)
    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      if (activeSession) void window.api.k8s.stopExec(activeSession)
      destroyTerminal()
    }
  }, [execReady, execOpen, execPod, execContainer, execShell, syncExecFocus, t])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (searchOpen) {
        setSearchOpen(false)
      } else if (execOpen) {
        void closeExec()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, searchOpen, execOpen, closeExec])

  useEffect(() => {
    localStorage.setItem(LS_K8S_EXEC_FONT_SIZE, String(execFontSize))
    const term = terminalRef.current
    if (!term) return
    term.options.fontSize = execFontSize
    // fit() fires onResize (-> resizeExec) when the new font changes cols/rows,
    // so no explicit resize is needed here.
    fitRef.current?.fit()
  }, [execFontSize])

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
      return
    }
    searchRef.current?.clearDecorations()
    const id = window.setTimeout(() => setSearchMatch(null), 0)
    return () => window.clearTimeout(id)
  }, [searchOpen])

  useEffect(() => {
    if (!execOpen) return
    const term = terminalRef.current
    if (!term) return
    // Defer so ThemeProvider's data-theme update is applied first
    const id = window.setTimeout(() => applyTermTheme(term), 0)
    return () => window.clearTimeout(id)
  }, [themeResolved, execOpen, execReady])

  useEffect(() => {
    if (!active || !execOpen) return
    const id = window.setTimeout(() => {
      const fit = fitRef.current
      const term = terminalRef.current
      const sessionId = execSessionRef.current
      if (!fit || !term) return
      fit.fit()
      if (sessionId) void window.api.k8s.resizeExec(sessionId, term.cols, term.rows)
      term.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [active, execOpen])

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
      sorter: (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
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
            onClick={() => openExecPicker(pod)}
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

  const podScrollX = 200 + 120 + 72 + 96 + 72 + 140 + 64 + 128

  const workloadColumns: ColumnsType<K8sWorkloadRow> = [
    { title: t('k8sColKind'), dataIndex: 'kind', width: 120 },
    {
      title: t('k8sColName'),
      dataIndex: 'name',
      ellipsis: true,
      sorter: (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
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
      sorter: (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
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
      sorter: (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
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
      width: 150,
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
            s === 'active'
              ? 'success'
              : s === 'error'
                ? 'error'
                : s === 'starting'
                  ? 'processing'
                  : 'default'
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
    <div
      ref={pageRef}
      className={`k8s-page flex flex-col${active ? '' : ' hidden'}`}
      aria-hidden={!active}
    >
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
              onClick={() => deleteCluster(selectedClusterId)}
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
              localStorage.setItem(LS_K8S_NAMESPACE, v)
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
              const next = e.target.value
              setNameQuery(next)
              localStorage.setItem(LS_K8S_NAME_QUERY, next)
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
        getContainer={overlayContainer}
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
        size="70vh"
        open={logOpen}
        onClose={() => void closeLogs()}
        mask={false}
        maskClosable={false}
        destroyOnHidden
        getContainer={overlayContainer}
        focusable={{ trap: false }}
        rootClassName="k8s-drawer-no-mask"
        styles={{
          root: { pointerEvents: 'none' },
          section: { pointerEvents: 'auto' },
          body: { paddingTop: 12, display: 'flex', flexDirection: 'column' }
        }}
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
        title={t('k8sConsole')}
        placement="bottom"
        size={220}
        open={execPickerOpen}
        onClose={() => {
          setExecPickerOpen(false)
          if (!execOpen) setExecPod(null)
        }}
        mask={false}
        maskClosable={false}
        destroyOnHidden
        getContainer={overlayContainer}
        focusable={{ trap: false }}
        rootClassName="k8s-drawer-no-mask"
        styles={{
          root: { pointerEvents: 'none' },
          section: { pointerEvents: 'auto' }
        }}
      >
        {execPod && (
          <p className="text-xs text-[var(--text-secondary)] m-0 mb-3 truncate">
            {execPod.namespace}/{execPod.name}
          </p>
        )}
        <div className="flex flex-col gap-3">
          {execPod && execPod.containers.length > 1 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--text-secondary)] shrink-0">Container</span>
              <Select
                className="min-w-[160px]"
                value={execContainer}
                options={execPod.containers.map((c) => ({ value: c, label: c }))}
                onChange={setExecContainer}
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text-secondary)] shrink-0">
              {t('k8sExecShell')}
            </span>
            <Segmented
              value={execShell}
              onChange={(v) => {
                const next = v as 'bash' | 'sh'
                setExecShell(next)
                localStorage.setItem(LS_K8S_EXEC_SHELL, next)
              }}
              options={[
                { value: 'bash', label: 'bash' },
                { value: 'sh', label: 'sh' }
              ]}
            />
          </div>
          <div className="flex justify-end">
            <Button type="primary" onClick={confirmExec}>
              {t('k8sExecOpen')}
            </Button>
          </div>
        </div>
      </Drawer>

      <Drawer
        title={
          execPod
            ? `${t('k8sConsole')} · ${execPod.namespace}/${execPod.name} · ${execShell}`
            : t('k8sConsole')
        }
        placement="bottom"
        size="70vh"
        open={execOpen}
        onClose={() => void closeExec()}
        afterOpenChange={(open) => {
          setExecReady(open)
          if (!open) destroyTerminal()
        }}
        mask={false}
        maskClosable={false}
        destroyOnHidden
        getContainer={overlayContainer}
        focusable={{ trap: false }}
        keyboard={false}
        rootClassName="k8s-drawer-no-mask"
        styles={{
          root: { pointerEvents: 'none' },
          section: { pointerEvents: 'auto' },
          body: { paddingTop: 12, display: 'flex', flexDirection: 'column', minHeight: 0 }
        }}
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
        <div className="relative flex-1 min-h-0 w-full">
          <Dropdown
            trigger={['contextMenu']}
            menu={buildTermMenu()}
            onOpenChange={(open) => {
              if (!open) return
              setCopyEnabled(Boolean(terminalRef.current?.getSelection()))
            }}
          >
            <div
              ref={termRef}
              className="rounded-lg overflow-hidden h-full min-h-0 w-full"
              style={{ padding: 8, background: 'var(--bg-warm)', minHeight: 200 }}
              onMouseDown={() => terminalRef.current?.focus()}
            />
          </Dropdown>
          {searchOpen && (
            <div className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1 shadow-sm">
              <Input
                ref={searchInputRef}
                size="small"
                allowClear
                placeholder={t('k8sTermSearchPlaceholder')}
                value={searchText}
                onChange={(e) => {
                  const value = e.target.value
                  setSearchText(value)
                  setSearchMatch(null)
                  if (!value) searchRef.current?.clearDecorations()
                }}
                onPressEnter={() => runExecSearch('next')}
                className="w-44"
              />
              {searchMatch && (
                <span
                  className={`shrink-0 text-[10px] ${
                    searchMatch.count > 0
                      ? 'text-[var(--text-secondary)]'
                      : 'text-[var(--danger)]'
                  }`}
                >
                  {searchMatch.count > 0
                    ? `${searchMatch.index + 1}/${searchMatch.count}`
                    : '0/0'}
                </span>
              )}
              <button
                type="button"
                className={BTN_ICON}
                title={t('k8sTermSearchPrev')}
                onClick={() => runExecSearch('prev')}
              >
                <ArrowUpOutlined />
              </button>
              <button
                type="button"
                className={BTN_ICON}
                title={t('k8sTermSearchNext')}
                onClick={() => runExecSearch('next')}
              >
                <ArrowDownOutlined />
              </button>
              <button
                type="button"
                className={BTN_ICON}
                title={t('k8sTermSearchClose')}
                onClick={() => setSearchOpen(false)}
              >
                <CloseOutlined />
              </button>
            </div>
          )}
        </div>
      </Drawer>

      <Modal
        title={t('k8sPortForward')}
        open={pfOpen}
        onCancel={() => setPfOpen(false)}
        onOk={() => void startPortForward()}
        getContainer={overlayContainer}
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
