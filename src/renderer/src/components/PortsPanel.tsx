import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Empty, Input, Modal, Select, Spin, Table, Tooltip } from 'antd'
import {
  CloseOutlined,
  ReloadOutlined,
  ExpandOutlined,
  CompressOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

interface PortsPanelProps {
  nodeId: string
  onClose: () => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}

function PortsPanel({
  nodeId,
  onClose,
  fullscreen,
  onToggleFullscreen
}: PortsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [ports, setPorts] = useState<SshPortInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [killTarget, setKillTarget] = useState<SshPortInfo | null>(null)
  const [signal, setSignal] = useState('TERM')
  const [killing, setKilling] = useState(false)
  const [query, setQuery] = useState('')
  const aliveRef = useRef(true)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollY, setTableScrollY] = useState(360)

  const load = useCallback(async (): Promise<void> => {
    if (!aliveRef.current) return
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.ssh.listPorts(nodeId)
      if (aliveRef.current) setPorts(list)
    } catch (err) {
      if (aliveRef.current) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [nodeId])

  useEffect(() => {
    aliveRef.current = true
    const first = window.setTimeout(() => void load(), 0)
    const id = window.setInterval(() => void load(), 5000)
    return () => {
      aliveRef.current = false
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [load])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const update = (): void => {
      setTableScrollY(Math.max(120, Math.floor(el.clientHeight)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const confirmKill = useCallback(async (): Promise<void> => {
    if (!killTarget || killTarget.pid == null) return
    setKilling(true)
    try {
      await window.api.ssh.killProcess(nodeId, killTarget.pid, signal)
      message.success(t('sshPortKilled', { pid: killTarget.pid, port: killTarget.port }))
      setKillTarget(null)
      void load()
    } catch (err) {
      message.error(t('sshPortKillFail', { msg: err instanceof Error ? err.message : String(err) }))
    } finally {
      setKilling(false)
    }
  }, [killTarget, signal, nodeId, message, load, t])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ports
    return ports.filter(
      (p) =>
        p.process.toLowerCase().includes(q) ||
        String(p.port).includes(q) ||
        (p.pid != null && String(p.pid).includes(q)) ||
        p.address.toLowerCase().includes(q)
    )
  }, [ports, query])

  const columns: ColumnsType<SshPortInfo> = [
    {
      title: t('sshPortProto'),
      dataIndex: 'protocol',
      width: 64,
      sorter: (a, b) => (a.protocol < b.protocol ? -1 : a.protocol > b.protocol ? 1 : 0)
    },
    {
      title: t('sshPortAddr'),
      dataIndex: 'address',
      width: 160,
      ellipsis: true,
      render: (v: string) => <span className="font-mono text-xs">{v}</span>
    },
    {
      title: t('sshPortPort'),
      dataIndex: 'port',
      width: 72,
      sorter: (a, b) => a.port - b.port,
      render: (v: number) => <span className="font-mono text-xs">{v}</span>
    },
    {
      title: t('sshPortState'),
      dataIndex: 'state',
      width: 88,
      ellipsis: true
    },
    {
      title: 'PID',
      dataIndex: 'pid',
      width: 64,
      sorter: (a, b) => (a.pid ?? 0) - (b.pid ?? 0),
      render: (v: number | null) => (v == null ? '-' : <span className="font-mono text-xs">{v}</span>)
    },
    {
      title: t('sshPortProc'),
      dataIndex: 'process',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip
          title={v}
          placement="topLeft"
          getPopupContainer={() => rootRef.current ?? document.body}
          styles={{ container: { maxWidth: 'min(60vw, 720px)', wordBreak: 'break-all' } }}
        >
          <span className="font-mono text-xs">{v}</span>
        </Tooltip>
      )
    },
    {
      title: '',
      width: 36,
      render: (_: unknown, row: SshPortInfo) => (
        <button
          type="button"
          disabled={row.pid == null}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
          title={t('sshPortKill')}
          onClick={() => {
            setKillTarget(row)
            setSignal('TERM')
          }}
        >
          <CloseOutlined className="text-xs" />
        </button>
      )
    }
  ]

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="h-10 shrink-0 flex items-center gap-3 px-3 border-b border-[var(--border-subtle)] bg-[var(--surface)]">
        <div className="shrink-0 flex items-baseline gap-1.5 min-w-0">
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {t('sshToolPorts')}
          </span>
          <span className="text-[10px] text-[var(--text-secondary)] shrink-0">
            {t('sshPortCount', { count: filtered.length })}
          </span>
        </div>
        <div className="flex-1 min-w-0 flex justify-end">
          <Input
            size="small"
            allowClear
            prefix={<SearchOutlined className="text-xs text-[var(--text-secondary)]" />}
            placeholder={t('sshPortSearch')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full max-w-[240px]"
          />
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)]"
            title={t('sshClientRefresh')}
            onClick={() => void load()}
          >
            <ReloadOutlined />
          </button>
          {onToggleFullscreen && (
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)]"
              title={fullscreen ? t('sshClientExitFullscreen') : t('sshClientFullscreen')}
              onClick={onToggleFullscreen}
            >
              {fullscreen ? <CompressOutlined /> : <ExpandOutlined />}
            </button>
          )}
          <button
            type="button"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)]"
            title={t('sshClientClose')}
            onClick={onClose}
          >
            <CloseOutlined />
          </button>
        </div>
      </div>
      <div ref={bodyRef} className="flex-1 min-h-0">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error} />
            <Button size="small" onClick={() => void load()}>
              {t('sshClientRefresh')}
            </Button>
          </div>
        ) : (
          <Spin spinning={loading} className="min-h-full">
            <Table
              size="small"
              rowKey={(r) => `${r.protocol}-${r.port}-${r.pid ?? 'none'}-${r.address}`}
              columns={columns}
              dataSource={filtered}
              pagination={false}
              locale={{ emptyText: t('sshPortEmpty') }}
              tableLayout="fixed"
              scroll={{ y: tableScrollY }}
              sticky
            />
          </Spin>
        )}
      </div>

      <Modal
        open={!!killTarget}
        title={t('sshPortKillTitle')}
        onCancel={() => setKillTarget(null)}
        onOk={() => void confirmKill()}
        confirmLoading={killing}
        okText={t('sshPortKill')}
        okButtonProps={{ danger: true }}
        cancelText={t('sshCancel')}
        destroyOnHidden
        centered
      >
        <div className="text-sm">
          <p className="mb-2">
            {t('sshPortKillConfirm', {
              pid: killTarget?.pid ?? 0,
              port: killTarget?.port ?? 0,
              proc: killTarget?.process ?? ''
            })}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)]">{t('sshPortSignal')}</span>
            <Select
              size="small"
              value={signal}
              onChange={setSignal}
              style={{ width: 120 }}
              options={['TERM', 'KILL', 'INT', 'HUP'].map((s) => ({ value: s, label: s }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default PortsPanel
