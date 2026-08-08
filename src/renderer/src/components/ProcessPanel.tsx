import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Empty, Modal, Select, Spin, Table, Tooltip } from 'antd'
import { CloseOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

function formatRss(kb: number): string {
  if (!Number.isFinite(kb) || kb < 0) return '-'
  const bytes = kb * 1024
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s % 60}s`
  return `${s}s`
}

interface ProcessPanelProps {
  nodeId: string
  onClose: () => void
}

function ProcessPanel({ nodeId, onClose }: ProcessPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [processes, setProcesses] = useState<SshProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [killTarget, setKillTarget] = useState<SshProcessInfo | null>(null)
  const [signal, setSignal] = useState('TERM')
  const [killing, setKilling] = useState(false)
  const aliveRef = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    if (!aliveRef.current) return
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.ssh.listProcesses(nodeId)
      if (aliveRef.current) setProcesses(list)
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

  const confirmKill = useCallback(async (): Promise<void> => {
    if (!killTarget) return
    setKilling(true)
    try {
      await window.api.ssh.killProcess(nodeId, killTarget.pid, signal)
      message.success(t('sshProcKilled', { pid: killTarget.pid }))
      setKillTarget(null)
      void load()
    } catch (err) {
      message.error(t('sshProcKillFail', { msg: err instanceof Error ? err.message : String(err) }))
    } finally {
      setKilling(false)
    }
  }, [killTarget, signal, nodeId, message, load, t])

  const columns: ColumnsType<SshProcessInfo> = [
    {
      title: 'PID',
      dataIndex: 'pid',
      width: 64,
      sorter: (a, b) => a.pid - b.pid
    },
    {
      title: t('sshProcUser'),
      dataIndex: 'user',
      width: 72,
      ellipsis: true
    },
    {
      title: '%CPU',
      dataIndex: 'cpu',
      width: 64,
      sorter: (a, b) => a.cpu - b.cpu,
      render: (v: number) => v.toFixed(1)
    },
    {
      title: '%MEM',
      dataIndex: 'mem',
      width: 64,
      sorter: (a, b) => a.mem - b.mem,
      render: (v: number) => v.toFixed(1)
    },
    {
      title: t('sshProcRss'),
      dataIndex: 'rss',
      width: 80,
      sorter: (a, b) => a.rss - b.rss,
      render: (v: number) => formatRss(v)
    },
    {
      title: t('sshProcTime'),
      dataIndex: 'etimes',
      width: 80,
      render: (v: number) => formatDuration(v)
    },
    {
      title: t('sshProcCmd'),
      dataIndex: 'cmd',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <span className="font-mono text-xs">{v}</span>
        </Tooltip>
      )
    },
    {
      title: '',
      width: 36,
      render: (_: unknown, row: SshProcessInfo) => (
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-red-500"
          title={t('sshProcKill')}
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
    <div className="flex h-full flex-col">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)]">
        <div className="text-xs text-[var(--text-secondary)]">
          {t('sshProcCount', { count: processes.length })}
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
              rowKey="pid"
              columns={columns}
              dataSource={processes}
              pagination={false}
              locale={{ emptyText: t('sshProcEmpty') }}
              scroll={{ y: undefined }}
            />
          </Spin>
        )}
      </div>

      <Modal
        open={!!killTarget}
        title={t('sshProcKillTitle')}
        onCancel={() => setKillTarget(null)}
        onOk={() => void confirmKill()}
        confirmLoading={killing}
        okText={t('sshProcKill')}
        okButtonProps={{ danger: true }}
        cancelText={t('sshCancel')}
        destroyOnHidden
        centered
      >
        <div className="text-sm">
          <p className="mb-2">
            {t('sshProcKillConfirm', {
              pid: killTarget?.pid ?? 0,
              cmd: killTarget?.cmd ?? ''
            })}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)]">{t('sshProcSignal')}</span>
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

export default ProcessPanel
