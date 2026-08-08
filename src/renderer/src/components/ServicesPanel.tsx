import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Empty, Spin, Table } from 'antd'
import { CloseOutlined, ReloadOutlined } from '@ant-design/icons'
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
}

const ACTIONS: SshServiceAction[] = ['start', 'stop', 'restart', 'reload', 'enable', 'disable']

function ServicesPanel({ nodeId, onClose }: ServicesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const [services, setServices] = useState<SshServiceInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const aliveRef = useRef(true)

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
      ellipsis: true,
      render: (v: string) => <span className="font-mono text-xs">{v}</span>
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
      width: 120,
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
    <div className="flex h-full flex-col">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)]">
        <div className="text-xs text-[var(--text-secondary)]">
          {t('sshSvcCount', { count: services.length })}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)]"
            title={t('sshClientRefresh')}
            onClick={() => void load()}
          >
            <ReloadOutlined />
          </button>
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
      <div className="flex-1 min-h-0 overflow-auto p-2">
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
              dataSource={services}
              pagination={false}
              locale={{ emptyText: t('sshSvcEmpty') }}
            />
          </Spin>
        )}
      </div>
    </div>
  )
}

export default ServicesPanel
