import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Empty, Input, Spin, Table, Tooltip } from 'antd'
import {
  CloseOutlined,
  ReloadOutlined,
  ExpandOutlined,
  CompressOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

function statusColor(active: string): string {
  switch (active) {
    case 'active':
      return 'text-green-600'
    case 'failed':
      return 'text-red-500'
    case 'inactive':
      return 'text-[var(--text-secondary)]'
    default:
      return 'text-[var(--text-secondary)]'
  }
}

interface ServicesPanelProps {
  nodeId: string
  onClose: () => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}

const ACTIONS: SshServiceAction[] = ['start', 'stop', 'restart', 'reload', 'enable', 'disable']

function ServicesPanel({
  nodeId,
  onClose,
  fullscreen,
  onToggleFullscreen
}: ServicesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const [services, setServices] = useState<SshServiceInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
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
      const list = await window.api.ssh.listServices(nodeId)
      if (aliveRef.current) setServices(list)
    } catch (err) {
      if (aliveRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [nodeId])

  useEffect(() => {
    aliveRef.current = true
    const first = window.setTimeout(() => void load(), 0)
    const id = window.setInterval(() => void load(), 10000)
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return services
    return services.filter((s) => s.unit.toLowerCase().includes(q))
  }, [services, query])

  const runAction = useCallback(
    async (unit: string, action: SshServiceAction): Promise<void> => {
      setActing(`${unit}:${action}`)
      try {
        const res = await window.api.ssh.serviceAction(nodeId, unit, action)
        if (res.ok) message.success(`${action} ${unit}`)
      } catch (err) {
        message.error(t('sshSvcActionFail', { msg: err instanceof Error ? err.message : String(err) }))
      } finally {
        setActing(null)
        void load()
      }
    },
    [nodeId, message, t, load]
  )

  const requestAction = useCallback(
    (row: SshServiceInfo, action: SshServiceAction): void => {
      if (action === 'stop') {
        modal.confirm({
          title: t('sshSvcStopTitle'),
          content: t('sshSvcStopConfirm', { unit: row.unit }),
          okText: t('sshSvcStop'),
          cancelText: t('sshCancel'),
          okButtonProps: { danger: true },
          onOk: () => runAction(row.unit, 'stop')
        })
        return
      }
      void runAction(row.unit, action)
    },
    [modal, runAction, t]
  )

  const columns: ColumnsType<SshServiceInfo> = [
    {
      title: t('sshSvcUnit'),
      dataIndex: 'unit',
      width: 280,
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
      title: t('sshSvcStatus'),
      dataIndex: 'active',
      width: 88,
      render: (v: string, row: SshServiceInfo) => (
        <span className={`text-xs font-medium ${statusColor(v)}`}>
          {row.sub || v}
        </span>
      )
    },
    {
      title: '',
      width: 160,
      render: (_: unknown, row: SshServiceInfo) => (
        <div className="flex items-center gap-0.5">
          {ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              disabled={acting === `${row.unit}:${a}`}
              className="px-1.5 h-6 rounded text-[10px] font-medium border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)] disabled:opacity-40"
              title={`${a} ${row.unit}`}
              onClick={() => requestAction(row, a)}
            >
              {a}
            </button>
          ))}
        </div>
      )
    }
  ]

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="h-10 shrink-0 flex items-center gap-3 px-3 border-b border-[var(--border-subtle)] bg-[var(--surface)]">
        <div className="shrink-0 flex items-baseline gap-1.5 min-w-0">
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {t('sshToolServices')}
          </span>
          <span className="text-[10px] text-[var(--text-secondary)] shrink-0">
            {t('sshSvcCount', { count: filtered.length })}
          </span>
        </div>
        <div className="flex-1 min-w-0 flex justify-end">
          <Input
            size="small"
            allowClear
            prefix={<SearchOutlined className="text-xs text-[var(--text-secondary)]" />}
            placeholder={t('sshSvcSearch')}
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
              rowKey="unit"
              columns={columns}
              dataSource={filtered}
              pagination={false}
              locale={{ emptyText: t('sshSvcEmpty') }}
              tableLayout="fixed"
              scroll={{ y: tableScrollY }}
              sticky
            />
          </Spin>
        )}
      </div>
    </div>
  )
}

export default ServicesPanel
