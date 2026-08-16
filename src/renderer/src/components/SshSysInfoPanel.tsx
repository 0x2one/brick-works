import { useTranslation } from 'react-i18next'
import { Button, Empty, Progress, Spin, Tooltip } from 'antd'
import { DatabaseOutlined, DesktopOutlined, HddOutlined, RiseOutlined } from '@ant-design/icons'

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${rest}s`
  return `${rest}s`
}

function getAccent(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return value || '#1677ff'
}

function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-[var(--text-secondary)]">{label}</span>
      <Tooltip title={value}>
        <span className="min-w-0 truncate text-right font-mono text-[var(--text-primary)]">
          {value}
        </span>
      </Tooltip>
    </div>
  )
}

function CardTitle({ icon, text }: { icon: React.ReactNode; text: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[var(--accent)]">{icon}</span>
      <span className="text-sm font-semibold text-[var(--text-primary)]">{text}</span>
    </div>
  )
}

interface SshSysInfoPanelProps {
  info: SshSysInfo | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}

function SshSysInfoPanel({
  info,
  loading,
  error,
  onRefresh
}: SshSysInfoPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const accent = getAccent()

  if (loading && !info) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spin />
      </div>
    )
  }

  const unsupported = error === 'SYSINFO_UNSUPPORTED'
  if (!info) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            error
              ? unsupported
                ? t('sshClientInfoUnsupported')
                : t('sshClientInfoLoadFail')
              : t('sshClientInfoNoData')
          }
        />
        {error && !unsupported && (
          <div
            className="max-w-full truncate font-mono text-[10px] text-[var(--text-secondary)]"
            title={error}
          >
            {error}
          </div>
        )}
        <Button size="small" onClick={onRefresh}>
          {t('sshClientRefresh')}
        </Button>
      </div>
    )
  }

  const data = info
  const cpuPct = data.cpu.usage == null ? null : Math.round(data.cpu.usage)
  const memPct = data.mem.total > 0 ? Math.round((data.mem.used / data.mem.total) * 100) : 0
  const swapPct = data.swap.total > 0 ? Math.round((data.swap.used / data.swap.total) * 100) : null

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
        <div className="flex items-center gap-2">
          <span className="text-[var(--accent)]">
            <DesktopOutlined />
          </span>
          <Tooltip title={data.hostname || data.os.name}>
            <span className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
              {data.hostname || data.os.name}
            </span>
          </Tooltip>
        </div>
        <div className="mt-2 space-y-1 text-xs">
          <InfoRow label={t('sshClientInfoOs')} value={data.os.name || t('sshClientInfoUnknown')} />
          <InfoRow
            label={t('sshClientInfoKernel')}
            value={data.os.kernel || t('sshClientInfoUnknown')}
          />
          <InfoRow
            label={t('sshClientInfoArch')}
            value={data.os.arch || t('sshClientInfoUnknown')}
          />
          <InfoRow label={t('sshClientInfoUptime')} value={formatUptime(data.uptime)} />
          <InfoRow
            label={t('sshClientInfoLoad')}
            value={data.loadavg.map((n) => n.toFixed(2)).join(' / ')}
          />
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
        <CardTitle icon={<RiseOutlined />} text={t('sshClientInfoCpu')} />
        <div className="mt-2 flex items-center gap-3">
          <Progress
            type="circle"
            size={84}
            percent={cpuPct ?? 0}
            strokeColor={accent}
            format={(p) => (cpuPct == null ? '-' : `${p}%`)}
          />
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            <Tooltip title={data.cpu.model || t('sshClientInfoUnknown')}>
              <div className="truncate text-[var(--text-primary)]">
                {data.cpu.model || t('sshClientInfoUnknown')}
              </div>
            </Tooltip>
            <div className="text-[var(--text-secondary)]">
              {t('sshClientInfoCores')}: {data.cpu.cores}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
        <CardTitle icon={<DatabaseOutlined />} text={t('sshClientInfoMemory')} />
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-mono">
              {formatSize(data.mem.used)} / {formatSize(data.mem.total)}
            </span>
            <span>{memPct}%</span>
          </div>
          <Progress percent={memPct} strokeColor={accent} showInfo={false} size="small" />
        </div>
        {data.swap.total > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span className="font-mono">
                {t('sshClientInfoSwap')}: {formatSize(data.swap.used)} /{' '}
                {formatSize(data.swap.total)}
              </span>
              <span>{swapPct ?? 0}%</span>
            </div>
            <Progress percent={swapPct ?? 0} strokeColor={accent} showInfo={false} size="small" />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
        <CardTitle icon={<HddOutlined />} text={t('sshClientInfoDisk')} />
        <div className="mt-2 space-y-3">
          {data.disks.length === 0 ? (
            <div className="text-xs text-[var(--text-secondary)]">{t('sshClientInfoUnknown')}</div>
          ) : (
            data.disks.slice(0, 6).map((d) => (
              <div key={`${d.mount}-${d.filesystem}`}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-mono text-[var(--text-primary)]">{d.mount}</span>
                  <span className="shrink-0 text-[var(--text-secondary)]">
                    {d.usePercent}% · {formatSize(d.used)} / {formatSize(d.size)}
                  </span>
                </div>
                <Progress
                  percent={d.usePercent}
                  strokeColor={accent}
                  showInfo={false}
                  size="small"
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default SshSysInfoPanel
