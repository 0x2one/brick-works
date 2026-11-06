import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import DockerEndpointModal from '../components/docker/DockerEndpointModal'
import DockerContainerDrawer from '../components/docker/DockerContainerDrawer'

const LS_DOCKER_ENDPOINT = 'brickworks:dockerEndpointId'
const LS_DOCKER_QUERY = 'brickworks:dockerQuery'

const PAGE_SIZE = 50
const REFRESH_MS = 10000

type DockerTabData =
  | { tab: 'containers'; rows: DockerContainerRow[] }
  | { tab: 'images'; rows: DockerImageRow[] }
  | { tab: 'volumes'; rows: DockerVolumeRow[] }
  | { tab: 'networks'; rows: DockerNetworkRow[] }
  | { tab: 'system'; info: DockerSystemInfo; version: DockerVersionInfo }

function formatAge(ms: number): string {
  if (!ms) return '-'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function formatBytes(value: number): string {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = value
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function matchName(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q)
}

/** Translate the transport error codes of the main process into readable text. */
function mapDockerError(err: unknown, t: (key: string) => string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  switch (msg) {
    case 'DOCKER_PIPE_CONNECT_FAILED':
      return t('dockerErrPipe')
    case 'DOCKER_TCP_CONNECT_FAILED':
      return t('dockerErrTcp')
    case 'DOCKER_WSL_CLI_CONNECT_FAILED':
      return t('dockerErrWslCli')
    case 'DOCKER_WSL_TCP_CONNECT_FAILED':
      return t('dockerErrWslTcp')
    case 'DOCKER_SSH_CONNECT_FAILED':
    case 'SSH_CONNECT_FAILED':
      return t('dockerErrSsh')
    case 'SSH_NODE_REQUIRED':
    case 'SSH_NODE_NOT_FOUND':
      return t('dockerErrSshNode')
    case 'WSL_UNSUPPORTED':
      return t('dockerErrWslUnsupported')
    case 'ENCRYPTION_UNAVAILABLE':
      return t('dockerErrEncryption')
    case 'TLS_CERT_REQUIRED':
      return t('dockerErrTls')
    default:
      return msg || t('dockerLoadFail')
  }
}

function stateColor(state: string): string {
  switch (state) {
    case 'running':
      return 'success'
    case 'paused':
      return 'warning'
    case 'restarting':
      return 'processing'
    case 'exited':
    case 'dead':
      return 'error'
    default:
      return 'default'
  }
}

interface PagedTableProps<T> {
  rows: T[]
  columns: ColumnsType<T>
  rowKey: string
  scrollX: number
  emptyText: string
  loading: boolean
  page: number
  onPageChange: (page: number) => void
}

/** Table with a pager that only appears when the data spills over one page. */
function PagedTable<T extends object>({
  rows,
  columns,
  rowKey,
  scrollX,
  emptyText,
  loading,
  page,
  onPageChange
}: PagedTableProps<T>): React.JSX.Element {
  const total = rows.length
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(page, maxPage)
  return (
    <>
      <Table<T>
        size="small"
        rowKey={rowKey}
        columns={columns}
        dataSource={rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)}
        loading={loading}
        pagination={false}
        scroll={{ x: scrollX }}
        locale={{ emptyText }}
      />
      {maxPage > 1 && (
        <div className="shrink-0 flex justify-end">
          <Pagination
            size="small"
            current={current}
            pageSize={PAGE_SIZE}
            total={total}
            showSizeChanger={false}
            onChange={onPageChange}
          />
        </div>
      )}
    </>
  )
}

function DockerManage({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [endpoints, setEndpoints] = useState<DockerEndpointView[]>([])
  const [status, setStatus] = useState<DockerStatus | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => localStorage.getItem(LS_DOCKER_ENDPOINT) ?? undefined
  )
  const [sshNodes, setSshNodes] = useState<SshNodeView[]>([])
  const [wslDistros, setWslDistros] = useState<string[]>([])

  const [containers, setContainers] = useState<DockerContainerRow[]>([])
  const [images, setImages] = useState<DockerImageRow[]>([])
  const [volumes, setVolumes] = useState<DockerVolumeRow[]>([])
  const [networks, setNetworks] = useState<DockerNetworkRow[]>([])
  const [info, setInfo] = useState<DockerSystemInfo | null>(null)
  const [version, setVersion] = useState<DockerVersionInfo | null>(null)

  const [activeTab, setActiveTab] = useState('containers')
  const [query, setQuery] = useState(() => localStorage.getItem(LS_DOCKER_QUERY) ?? '')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<DockerEndpointView | null>(null)
  const [pullOpen, setPullOpen] = useState(false)
  const [pullRef, setPullRef] = useState('')
  const [drawerContainer, setDrawerContainer] = useState<DockerContainerRow | null>(null)

  const connected = status?.state === 'connected'
  const ttySupported = status?.tty ?? false

  const loadEndpoints = useCallback(async (): Promise<void> => {
    const list = await window.api.docker.listEndpoints()
    setEndpoints(list)
    setSelectedId((prev) => {
      if (prev && list.some((e) => e.id === prev)) return prev
      const stored = localStorage.getItem(LS_DOCKER_ENDPOINT)
      if (stored && list.some((e) => e.id === stored)) return stored
      return list[0]?.id
    })
  }, [])

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const list = await window.api.docker.listEndpoints()
        if (!alive) return
        setEndpoints(list)
        setSelectedId((prev) => {
          if (prev && list.some((e) => e.id === prev)) return prev
          const stored = localStorage.getItem(LS_DOCKER_ENDPOINT)
          if (stored && list.some((e) => e.id === stored)) return stored
          return list[0]?.id
        })
        const [nodes, distros, current] = await Promise.all([
          window.api.ssh.listNodes(),
          window.api.docker.listWslDistros(),
          window.api.docker.status()
        ])
        if (!alive) return
        setSshNodes(nodes)
        setWslDistros(distros)
        setStatus(current)
      } catch {
        // The endpoint list stays empty when the daemon cannot be reached.
      }
    }
    void load()
    const off = window.api.docker.onStatusChange(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    if (selectedId) localStorage.setItem(LS_DOCKER_ENDPOINT, selectedId)
  }, [selectedId])

  const fetchTab = useCallback(async (tab: string): Promise<DockerTabData> => {
    if (tab === 'containers') {
      return { tab: 'containers', rows: await window.api.docker.listContainers() }
    }
    if (tab === 'images') {
      return { tab: 'images', rows: await window.api.docker.listImages() }
    }
    if (tab === 'volumes') {
      return { tab: 'volumes', rows: await window.api.docker.listVolumes() }
    }
    if (tab === 'networks') {
      return { tab: 'networks', rows: await window.api.docker.listNetworks() }
    }
    const [systemInfo, systemVersion] = await Promise.all([
      window.api.docker.info(),
      window.api.docker.version()
    ])
    return { tab: 'system', info: systemInfo, version: systemVersion }
  }, [])

  const applyTabData = useCallback((data: DockerTabData): void => {
    switch (data.tab) {
      case 'containers':
        setContainers(data.rows)
        break
      case 'images':
        setImages(data.rows)
        break
      case 'volumes':
        setVolumes(data.rows)
        break
      case 'networks':
        setNetworks(data.rows)
        break
      case 'system':
        setInfo(data.info)
        setVersion(data.version)
        break
    }
  }, [])

  const refresh = useCallback(
    async (tab = activeTab): Promise<void> => {
      if (!connected) return
      setLoading(true)
      try {
        const data = await fetchTab(tab)
        applyTabData(data)
      } catch (err) {
        message.error(mapDockerError(err, t))
      } finally {
        setLoading(false)
      }
    },
    [activeTab, connected, fetchTab, applyTabData, message, t]
  )

  useEffect(() => {
    if (!connected) return
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const data = await fetchTab(activeTab)
        if (!alive) return
        applyTabData(data)
      } catch (err) {
        if (!alive) return
        message.error(mapDockerError(err, t))
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [connected, activeTab, fetchTab, applyTabData, message, t])

  useEffect(() => {
    if (!connected || !active) return
    const timer = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [connected, active, refresh])

  const handleConnect = async (): Promise<void> => {
    if (!selectedId) return
    setConnecting(true)
    try {
      const next = await window.api.docker.connect(selectedId)
      setStatus(next)
      message.success(t('dockerConnected'))
    } catch (err) {
      message.error(mapDockerError(err, t))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    try {
      setStatus(await window.api.docker.disconnect())
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('dockerLoadFail'))
    }
  }

  const saveEndpoint = async (input: DockerEndpointInput): Promise<void> => {
    const view = await window.api.docker.saveEndpoint(input)
    await loadEndpoints()
    setSelectedId(view.id)
    setModalOpen(false)
    message.success(t('dockerEndpointSaved'))
  }

  const deleteEndpoint = async (id: string): Promise<void> => {
    await window.api.docker.deleteEndpoint(id)
    await loadEndpoints()
    message.success(t('dockerEndpointDeleted'))
  }

  const runAction = async (
    id: string,
    action: DockerContainerAction,
    successKey: string
  ): Promise<void> => {
    try {
      await window.api.docker.containerAction(id, action)
      message.success(t(successKey))
      await refresh('containers')
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('dockerActionFail'))
    }
  }

  const removeContainer = async (row: DockerContainerRow): Promise<void> => {
    try {
      await window.api.docker.removeContainer(row.id, { force: true })
      message.success(t('dockerRemoved'))
      await refresh('containers')
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('dockerActionFail'))
    }
  }

  const pullImage = async (): Promise<void> => {
    const ref = pullRef.trim()
    if (!ref) return
    try {
      await window.api.docker.pullImage(ref)
      message.success(t('dockerPulled'))
      setPullOpen(false)
      setPullRef('')
      await refresh('images')
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('dockerActionFail'))
    }
  }

  const removeImage = async (row: DockerImageRow): Promise<void> => {
    try {
      await window.api.docker.removeImage(row.id, true)
      message.success(t('dockerRemoved'))
      await refresh('images')
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('dockerActionFail'))
    }
  }

  const removeVolume = async (row: DockerVolumeRow): Promise<void> => {
    try {
      await window.api.docker.removeVolume(row.name, true)
      message.success(t('dockerRemoved'))
      await refresh('volumes')
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('dockerActionFail'))
    }
  }

  const removeNetwork = async (row: DockerNetworkRow): Promise<void> => {
    try {
      await window.api.docker.removeNetwork(row.id)
      message.success(t('dockerRemoved'))
      await refresh('networks')
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('dockerActionFail'))
    }
  }

  const filteredContainers = useMemo(
    () => containers.filter((c) => matchName(c.name, query) || matchName(c.image, query)),
    [containers, query]
  )
  const filteredImages = useMemo(
    () =>
      images.filter(
        (i) => matchName(i.repository, query) || matchName(i.tag, query) || matchName(i.id, query)
      ),
    [images, query]
  )
  const filteredVolumes = useMemo(
    () => volumes.filter((v) => matchName(v.name, query)),
    [volumes, query]
  )
  const filteredNetworks = useMemo(
    () => networks.filter((n) => matchName(n.name, query)),
    [networks, query]
  )

  const containerColumns: ColumnsType<DockerContainerRow> = [
    {
      title: t('dockerColName'),
      dataIndex: 'name',
      width: 180,
      ellipsis: true,
      sorter: (a, b) => a.name.localeCompare(b.name)
    },
    { title: t('dockerColImage'), dataIndex: 'image', width: 200, ellipsis: true },
    {
      title: t('dockerColState'),
      dataIndex: 'state',
      width: 100,
      render: (v: string) => <Tag color={stateColor(v)}>{v}</Tag>
    },
    { title: t('dockerColStatus'), dataIndex: 'status', width: 150, ellipsis: true },
    {
      title: t('dockerColPorts'),
      dataIndex: 'ports',
      width: 170,
      render: (ports: DockerPortMapping[]) =>
        ports.length ? (
          <span className="text-[11px]">
            {ports
              .map(
                (p) =>
                  `${p.ip ? `${p.ip}:` : ''}${p.publicPort ?? ''}${
                    p.publicPort ? '→' : ''
                  }${p.privatePort}/${p.type}`
              )
              .join(', ')}
          </span>
        ) : (
          '-'
        )
    },
    {
      title: t('dockerColCreated'),
      dataIndex: 'createdAt',
      width: 90,
      render: (v: number) => formatAge(Date.now() - v)
    },
    {
      title: t('dockerColActions'),
      key: 'actions',
      width: 150,
      render: (_, row) => (
        <Space size={0}>
          {row.state === 'running' ? (
            <Tooltip title={t('dockerStop')}>
              <Button
                type="text"
                size="small"
                icon={<PauseCircleOutlined />}
                onClick={() => void runAction(row.id, 'stop', 'dockerStopped')}
              />
            </Tooltip>
          ) : (
            <Tooltip title={t('dockerStart')}>
              <Button
                type="text"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() => void runAction(row.id, 'start', 'dockerStarted')}
              />
            </Tooltip>
          )}
          <Tooltip title={t('dockerRestart')}>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void runAction(row.id, 'restart', 'dockerRestarted')}
            />
          </Tooltip>
          <Tooltip title={t('dockerDetail')}>
            <Button
              type="text"
              size="small"
              icon={<ThunderboltOutlined />}
              onClick={() => setDrawerContainer(row)}
            />
          </Tooltip>
          <Popconfirm
            title={t('dockerRemoveConfirm')}
            okText={t('dockerConfirm')}
            cancelText={t('dockerCancel')}
            onConfirm={() => void removeContainer(row)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  const imageColumns: ColumnsType<DockerImageRow> = [
    {
      title: t('dockerColRepository'),
      dataIndex: 'repository',
      width: 220,
      ellipsis: true,
      sorter: (a, b) => a.repository.localeCompare(b.repository)
    },
    { title: t('dockerColTag'), dataIndex: 'tag', width: 140, ellipsis: true },
    {
      title: t('dockerColId'),
      dataIndex: 'id',
      width: 150,
      ellipsis: true,
      render: (v: string) => v.replace('sha256:', '').slice(0, 12)
    },
    {
      title: t('dockerColSize'),
      dataIndex: 'size',
      width: 110,
      render: (v: number) => formatBytes(v)
    },
    {
      title: t('dockerColCreated'),
      dataIndex: 'createdAt',
      width: 100,
      render: (v: number) => formatAge(Date.now() - v)
    },
    {
      title: t('dockerColActions'),
      key: 'actions',
      width: 60,
      render: (_, row) => (
        <Popconfirm
          title={t('dockerRemoveConfirm')}
          okText={t('dockerConfirm')}
          cancelText={t('dockerCancel')}
          onConfirm={() => void removeImage(row)}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ]

  const volumeColumns: ColumnsType<DockerVolumeRow> = [
    { title: t('dockerColName'), dataIndex: 'name', width: 220, ellipsis: true },
    { title: t('dockerColDriver'), dataIndex: 'driver', width: 120 },
    { title: t('dockerColMountpoint'), dataIndex: 'mountpoint', ellipsis: true },
    {
      title: t('dockerColSize'),
      dataIndex: 'size',
      width: 110,
      render: (v: number | null) => (v === null ? '-' : formatBytes(v))
    },
    {
      title: t('dockerColActions'),
      key: 'actions',
      width: 60,
      render: (_, row) => (
        <Popconfirm
          title={t('dockerRemoveConfirm')}
          okText={t('dockerConfirm')}
          cancelText={t('dockerCancel')}
          onConfirm={() => void removeVolume(row)}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ]

  const networkColumns: ColumnsType<DockerNetworkRow> = [
    { title: t('dockerColName'), dataIndex: 'name', width: 200, ellipsis: true },
    { title: t('dockerColDriver'), dataIndex: 'driver', width: 120 },
    { title: t('dockerColScope'), dataIndex: 'scope', width: 100 },
    {
      title: t('dockerColInternal'),
      dataIndex: 'internal',
      width: 90,
      render: (v: boolean) => (v ? t('dockerYes') : t('dockerNo'))
    },
    { title: t('dockerColContainers'), dataIndex: 'containers', width: 100 },
    {
      title: t('dockerColActions'),
      key: 'actions',
      width: 60,
      render: (_, row) => (
        <Popconfirm
          title={t('dockerRemoveConfirm')}
          okText={t('dockerConfirm')}
          cancelText={t('dockerCancel')}
          onConfirm={() => void removeNetwork(row)}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )
    }
  ]

  const tabDefs = [
    { key: 'containers', label: t('dockerTabContainers') },
    { key: 'images', label: t('dockerTabImages') },
    { key: 'volumes', label: t('dockerTabVolumes') },
    { key: 'networks', label: t('dockerTabNetworks') },
    { key: 'system', label: t('dockerTabSystem') }
  ]

  const statusTag = (): React.JSX.Element => {
    if (!status) return <Tag>{t('dockerDisconnected')}</Tag>
    if (status.state === 'connecting') return <Tag color="processing">{t('dockerConnecting')}</Tag>
    if (status.state === 'error') return <Tag color="error">{t('dockerConnectFail')}</Tag>
    if (status.state === 'connected')
      return (
        <Tag color="success">
          {status.endpointName} · {status.detail ?? status.backend}
        </Tag>
      )
    return <Tag>{t('dockerDisconnected')}</Tag>
  }

  const systemView = (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <div className="rounded-lg border border-[var(--border-subtle)] p-3 flex flex-col gap-1">
        <div className="text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]">
          {t('dockerInfoDaemon')}
        </div>
        <div>
          {t('dockerInfoName')}: {info?.name || '-'}
        </div>
        <div>
          {t('dockerInfoVersion')}: {version?.version || info?.serverVersion || '-'}
        </div>
        <div>
          {t('dockerInfoApi')}: {version?.apiVersion || '-'}
        </div>
        <div>
          {t('dockerInfoOs')}: {info?.operatingSystem || info?.os || '-'} ({info?.arch || '-'})
        </div>
        <div>
          {t('dockerInfoKernel')}: {info?.kernelVersion || '-'}
        </div>
        <div>
          {t('dockerInfoDriver')}: {info?.driver || '-'}
        </div>
        <div className="break-all">
          {t('dockerInfoRoot')}: {info?.dockerRootDir || '-'}
        </div>
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] p-3 flex flex-col gap-1">
        <div className="text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]">
          {t('dockerInfoResources')}
        </div>
        <div>
          {t('dockerInfoCpus')}: {info?.cpus ?? '-'}
        </div>
        <div>
          {t('dockerInfoMemory')}: {info ? formatBytes(info.memory) : '-'}
        </div>
        <div>
          {t('dockerInfoContainers')}: {info?.containers ?? '-'}
        </div>
        <div>
          {t('dockerInfoRunning')}: {info?.containersRunning ?? '-'}
        </div>
        <div>
          {t('dockerInfoPaused')}: {info?.containersPaused ?? '-'}
        </div>
        <div>
          {t('dockerInfoStopped')}: {info?.containersStopped ?? '-'}
        </div>
        <div>
          {t('dockerInfoImages')}: {info?.images ?? '-'}
        </div>
      </div>
    </div>
  )

  return (
    <div className={`docker-page flex flex-col${active ? '' : ' hidden'}`} aria-hidden={!active}>
      <div className="shrink-0 bg-[var(--content-bg)]">
        <div className="flex items-start justify-between gap-3 px-6 pt-4 pb-2">
          <p className="text-xs text-[var(--text-secondary)] m-0 min-w-0">{t('dockerDesc')}</p>
          <span className="shrink-0">{statusTag()}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
          <Select
            allowClear
            className="w-[240px] max-w-full"
            placeholder={t('dockerSelectEndpoint')}
            value={selectedId}
            onChange={(value) => setSelectedId(value)}
            options={endpoints.map((e) => ({
              value: e.id,
              label: `${e.name} (${e.type})`
            }))}
          />
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null)
              setModalOpen(true)
            }}
          >
            {t('dockerAddEndpoint')}
          </Button>
          {selectedId && (
            <>
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  setEditing(endpoints.find((e) => e.id === selectedId) ?? null)
                  setModalOpen(true)
                }}
              >
                {t('dockerEditEndpoint')}
              </Button>
              <Popconfirm
                title={t('dockerEndpointDeleteConfirm')}
                okText={t('dockerConfirm')}
                cancelText={t('dockerCancel')}
                onConfirm={() => void deleteEndpoint(selectedId)}
              >
                <Button danger icon={<DeleteOutlined />}>
                  {t('dockerDeleteEndpoint')}
                </Button>
              </Popconfirm>
            </>
          )}
          {connected ? (
            <Button icon={<DisconnectOutlined />} onClick={() => void handleDisconnect()}>
              {t('dockerDisconnect')}
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<LinkOutlined />}
              loading={connecting}
              disabled={!selectedId}
              onClick={() => void handleConnect()}
            >
              {t('dockerConnect')}
            </Button>
          )}
          <Button
            icon={<ReloadOutlined />}
            disabled={!connected}
            loading={loading}
            onClick={() => void refresh()}
          >
            {t('dockerRefresh')}
          </Button>
          <Input
            allowClear
            disabled={!connected}
            prefix={<SearchOutlined className="text-[var(--text-secondary)]" />}
            placeholder={t('dockerSearch')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              localStorage.setItem(LS_DOCKER_QUERY, e.target.value)
              setPage(1)
            }}
            style={{ width: 200, maxWidth: 200 }}
          />
          {activeTab === 'images' && (
            <Button icon={<CloudDownloadOutlined />} onClick={() => setPullOpen(true)}>
              {t('dockerPullImage')}
            </Button>
          )}
        </div>

        {connected && (
          <div className="flex items-center border-b border-[var(--border-subtle)] px-6">
            {tabDefs.map((tab) => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key)
                    setPage(1)
                  }}
                  className={`relative px-3 py-2 text-sm transition-colors cursor-pointer border-none bg-transparent ${
                    isActive
                      ? 'text-[var(--text-primary)] font-medium'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {tab.label}
                  {isActive && (
                    <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-[var(--accent)]" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {!connected ? (
          <div className="p-6">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dockerNotConnected')} />
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-3">
            {activeTab === 'containers' && (
              <PagedTable
                rows={filteredContainers}
                columns={containerColumns}
                rowKey="id"
                scrollX={900}
                emptyText={t('dockerEmptyContainers')}
                loading={loading}
                page={page}
                onPageChange={setPage}
              />
            )}
            {activeTab === 'images' && (
              <PagedTable
                rows={filteredImages}
                columns={imageColumns}
                rowKey="id"
                scrollX={760}
                emptyText={t('dockerEmptyImages')}
                loading={loading}
                page={page}
                onPageChange={setPage}
              />
            )}
            {activeTab === 'volumes' && (
              <PagedTable
                rows={filteredVolumes}
                columns={volumeColumns}
                rowKey="name"
                scrollX={720}
                emptyText={t('dockerEmptyVolumes')}
                loading={loading}
                page={page}
                onPageChange={setPage}
              />
            )}
            {activeTab === 'networks' && (
              <PagedTable
                rows={filteredNetworks}
                columns={networkColumns}
                rowKey="id"
                scrollX={700}
                emptyText={t('dockerEmptyNetworks')}
                loading={loading}
                page={page}
                onPageChange={setPage}
              />
            )}
            {activeTab === 'system' && systemView}
          </div>
        )}
      </div>

      <DockerEndpointModal
        open={modalOpen}
        endpoint={editing}
        sshNodes={sshNodes}
        wslDistros={wslDistros}
        onClose={() => setModalOpen(false)}
        onSubmit={saveEndpoint}
      />

      <DockerContainerDrawer
        container={drawerContainer}
        tty={ttySupported}
        onClose={() => setDrawerContainer(null)}
      />

      <Modal
        open={pullOpen}
        title={t('dockerPullImage')}
        okText={t('dockerConfirm')}
        cancelText={t('dockerCancel')}
        confirmLoading={loading}
        /* Render inline (no portal) so the dialog stays inside the page area */
        getContainer={false}
        onOk={() => void pullImage()}
        onCancel={() => setPullOpen(false)}
        destroyOnHidden
      >
        <Input
          className="mt-2"
          placeholder="nginx:alpine"
          value={pullRef}
          onChange={(e) => setPullRef(e.target.value)}
          onPressEnter={() => void pullImage()}
        />
      </Modal>
    </div>
  )
}

export default DockerManage
