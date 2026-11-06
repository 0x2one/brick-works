import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Drawer, Empty, Spin, Table, Tabs, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import DockerLogView from './DockerLogView'
import DockerTerminal from './DockerTerminal'

interface DockerContainerDrawerProps {
  container: DockerContainerRow | null
  tty: boolean
  onClose: () => void
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

export default function DockerContainerDrawer({
  container,
  tty,
  onClose
}: DockerContainerDrawerProps): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [detail, setDetail] = useState<DockerContainerDetail | null>(null)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [tab, setTab] = useState('overview')
  const [stats, setStats] = useState<DockerStatsRow | null>(null)
  const loading = container ? loadedId !== container.id : false

  useEffect(() => {
    const target = container
    if (!target) return
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const result = await window.api.docker.inspectContainer(target.id)
        if (!alive) return
        setDetail(result)
      } catch (err) {
        if (!alive) return
        message.error(err instanceof Error ? err.message : t('dockerDetailLoadFail'))
      } finally {
        if (alive) setLoadedId(target.id)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [container, message, t])

  useEffect(() => {
    if (!container || tab !== 'stats') return
    let alive = true
    const tick = async (): Promise<void> => {
      try {
        const result = await window.api.docker.stats(container.id)
        if (alive) setStats(result)
      } catch {
        // ignore transient failures
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [container, tab])

  const mountColumns: ColumnsType<DockerMountRow> = [
    { title: t('dockerColType'), dataIndex: 'type', width: 90 },
    { title: t('dockerColSource'), dataIndex: 'source', ellipsis: true },
    { title: t('dockerColDestination'), dataIndex: 'destination', ellipsis: true },
    { title: t('dockerColMode'), dataIndex: 'mode', width: 80 }
  ]

  const overview = detail ? (
    <div className="flex flex-col gap-3 text-xs">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-[var(--text-secondary)]">{t('dockerColName')}</span>
        <span className="text-[var(--text-primary)] truncate">{detail.name}</span>
        <span className="text-[var(--text-secondary)]">{t('dockerColImage')}</span>
        <span className="text-[var(--text-primary)] truncate">{detail.image}</span>
        <span className="text-[var(--text-secondary)]">{t('dockerColStatus')}</span>
        <span className="text-[var(--text-primary)]">
          {detail.status || detail.state}
          {detail.health && (
            <Tag color={detail.health === 'healthy' ? 'success' : 'warning'} className="ml-2">
              {detail.health}
            </Tag>
          )}
        </span>
        <span className="text-[var(--text-secondary)]">{t('dockerColCommand')}</span>
        <span className="text-[var(--text-primary)] break-all">{detail.command || '-'}</span>
        <span className="text-[var(--text-secondary)]">{t('dockerColEntrypoint')}</span>
        <span className="text-[var(--text-primary)] break-all">{detail.entrypoint || '-'}</span>
        <span className="text-[var(--text-secondary)]">{t('dockerColIp')}</span>
        <span className="text-[var(--text-primary)]">{detail.ipAddress || '-'}</span>
        <span className="text-[var(--text-secondary)]">{t('dockerColHostname')}</span>
        <span className="text-[var(--text-primary)]">{detail.hostname || '-'}</span>
        <span className="text-[var(--text-secondary)]">{t('dockerColRestart')}</span>
        <span className="text-[var(--text-primary)]">
          {detail.restartPolicy.name}
          {detail.restartPolicy.name === 'on-failure' ? ` (${detail.restartPolicy.maxRetry})` : ''}
          {detail.restartCount ? ` · ${detail.restartCount}` : ''}
        </span>
        <span className="text-[var(--text-secondary)]">{t('dockerColPorts')}</span>
        <span className="text-[var(--text-primary)] break-all">
          {detail.ports.length
            ? detail.ports
                .map(
                  (p) =>
                    `${p.ip ? `${p.ip}:` : ''}${p.publicPort ?? ''}${
                      p.publicPort ? '→' : ''
                    }${p.privatePort}/${p.type}`
                )
                .join(', ')
            : '-'}
        </span>
        <span className="text-[var(--text-secondary)]">{t('dockerColNetworks')}</span>
        <span className="text-[var(--text-primary)]">{detail.networks.join(', ') || '-'}</span>
      </div>

      <div>
        <div className="text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] mb-1">
          {t('dockerColEnv')}
        </div>
        <pre className="m-0 max-h-40 overflow-auto rounded-lg bg-[var(--bg-warm)] p-2 font-mono text-[11px] whitespace-pre-wrap break-all">
          {detail.env.length ? detail.env.join('\n') : '-'}
        </pre>
      </div>

      <div>
        <div className="text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] mb-1">
          {t('dockerColMounts')}
        </div>
        <Table
          size="small"
          rowKey={(row) => `${row.type}:${row.destination}`}
          columns={mountColumns}
          dataSource={detail.mounts}
          pagination={false}
          locale={{ emptyText: '-' }}
        />
      </div>

      <div>
        <div className="text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] mb-1">
          {t('dockerColLabels')}
        </div>
        <pre className="m-0 max-h-32 overflow-auto rounded-lg bg-[var(--bg-warm)] p-2 font-mono text-[11px] whitespace-pre-wrap break-all">
          {Object.keys(detail.labels).length
            ? Object.entries(detail.labels)
                .map(([key, value]) => `${key}=${value}`)
                .join('\n')
            : '-'}
        </pre>
      </div>
    </div>
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dockerNoDetail')} />
  )

  const statsView = stats ? (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <div className="rounded-lg border border-[var(--border-subtle)] p-3">
        <div className="text-[var(--text-secondary)]">{t('dockerStatCpu')}</div>
        <div className="text-lg font-semibold text-[var(--text-primary)]">
          {stats.cpuPercent.toFixed(1)}%
        </div>
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] p-3">
        <div className="text-[var(--text-secondary)]">{t('dockerStatMemory')}</div>
        <div className="text-lg font-semibold text-[var(--text-primary)]">
          {formatBytes(stats.memoryUsage)}
        </div>
        <div className="text-[var(--text-secondary)]">
          {formatBytes(stats.memoryLimit)} · {stats.memoryPercent.toFixed(1)}%
        </div>
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] p-3">
        <div className="text-[var(--text-secondary)]">{t('dockerStatNetwork')}</div>
        <div className="text-[var(--text-primary)]">
          ↓ {formatBytes(stats.networkRx)} · ↑ {formatBytes(stats.networkTx)}
        </div>
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] p-3">
        <div className="text-[var(--text-secondary)]">{t('dockerStatBlock')}</div>
        <div className="text-[var(--text-primary)]">
          ↓ {formatBytes(stats.blockRead)} · ↑ {formatBytes(stats.blockWrite)}
        </div>
        <div className="text-[var(--text-secondary)]">PIDs {stats.pids}</div>
      </div>
    </div>
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dockerNoStats')} />
  )

  return (
    <Drawer
      open={Boolean(container)}
      onClose={onClose}
      width={720}
      /* Render inline (no portal): the drawer is then positioned absolutely
         inside the page container and can never cover the window title bar. */
      getContainer={false}
      title={container ? container.name : ''}
      destroyOnHidden
      extra={
        <span className="text-xs text-[var(--text-secondary)]">
          {container?.image}
          {container?.status ? ` · ${container.status}` : ''}
        </span>
      }
    >
      <Spin spinning={loading && !detail}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'overview', label: t('dockerTabOverview'), children: overview },
            {
              key: 'logs',
              label: t('dockerTabLogs'),
              children: container ? (
                <div className="h-[420px]">
                  <DockerLogView containerId={container.id} containerName={container.name} />
                </div>
              ) : null
            },
            {
              key: 'terminal',
              label: t('dockerTabTerminal'),
              children: container ? (
                <div className="h-[420px]">
                  <DockerTerminal
                    containerId={container.id}
                    containerName={container.name}
                    active={tab === 'terminal'}
                    tty={tty}
                  />
                </div>
              ) : null
            },
            { key: 'stats', label: t('dockerTabStats'), children: statsView }
          ]}
        />
      </Spin>
    </Drawer>
  )
}
