import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Modal, Select } from 'antd'
import {
  PlayCircleOutlined,
  StopOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  LinkOutlined,
  CopyOutlined,
  GlobalOutlined,
  QrcodeOutlined
} from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import { Btn } from '../components/ui'
import { LABEL_CLS, CARD_CLS } from '../components/ui'
import LanClips from './LanClips'

function LanTransfer(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { message } = App.useApp()
  const [status, setStatus] = useState<LanStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [subdir, setSubdir] = useState('')
  const [qrOpen, setQrOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    window.api.lan
      .getStatus()
      .then((s) => {
        if (mounted) setStatus(s)
      })
      .catch(() => {})
    const off = window.api.lan.onStatusChange((s) => {
      if (mounted) setStatus(s)
    })
    return () => {
      mounted = false
      off()
    }
  }, [])

  const handleToggle = useCallback(async () => {
    try {
      if (status?.running) {
        setStatus(await window.api.lan.stop())
        message.success(t('lanStoppedMsg'))
      } else {
        setStarting(true)
        const appLang = i18n.language === 'en' ? 'en' : 'zh'
        setStatus(await window.api.lan.start(undefined, appLang))
        message.success(t('lanStartedMsg'))
      }
    } catch {
      message.error(t('lanStartFail'))
    } finally {
      setStarting(false)
    }
  }, [status, t, message, i18n.language])

  const handleChooseDir = useCallback(async () => {
    const dir = await window.api.lan.chooseDir()
    if (dir) {
      setStatus((prev) => (prev ? { ...prev, dir } : prev))
    }
  }, [])

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        message.success(t('copied'))
      } catch {
        message.error(t('lanCopyFail'))
      }
    },
    [t, message]
  )

  const running = !!status?.running
  const baseUrl = status?.url ?? ''
  const token = status?.token ?? ''
  const deepLink = (() => {
    if (!baseUrl) return ''
    try {
      const u = new URL(baseUrl)
      if (subdir.trim()) u.searchParams.set('path', subdir.trim().replace(/^\/+/, ''))
      else u.searchParams.delete('path')
      return u.toString()
    } catch {
      return baseUrl
    }
  })()

  return (
    <div className="flex flex-col p-6 gap-4">
      <p className="text-xs text-[var(--text-secondary)]">{t('lanDesc')}</p>

      <div className="flex flex-col gap-4 max-w-[840px]">
        {/* Service status */}
        <section className={CARD_CLS}>
          <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <span className={LABEL_CLS}>{t('lanStatus')}</span>
            <span
              className={`flex items-center gap-1.5 text-xs font-medium ${
                running ? 'text-[var(--success)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${running ? 'bg-[var(--success)]' : 'bg-[var(--border-subtle)]'}`}
              />
              {running ? t('lanRunning') : t('lanStopped')}
            </span>
          </div>
          <div className="px-5 py-4 flex items-center gap-3">
            <Btn
              variant={running ? 'default' : 'primary'}
              icon={running ? <StopOutlined /> : <PlayCircleOutlined />}
              onClick={handleToggle}
              disabled={starting}
            >
              {running ? t('lanStop') : t('lanStart')}
            </Btn>
            {running && status?.port != null && (
              <span className="text-xs text-[var(--text-secondary)]">
                {t('lanPort')}: <span className="font-mono">{status.port}</span>
              </span>
            )}
          </div>
        </section>

        {/* Managed folder */}
        <section className={CARD_CLS}>
          <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
            <span className={LABEL_CLS}>{t('lanManageDir')}</span>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <FolderOutlined style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-mono text-[var(--text-primary)] break-all">
                {status?.dir || '—'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Btn icon={<FolderOpenOutlined />} onClick={handleChooseDir} disabled={running}>
                {t('lanChooseDir')}
              </Btn>
              <Btn
                icon={<FolderOutlined />}
                onClick={() => window.api.lan.openDir()}
                disabled={!status?.dir}
              >
                {t('lanOpenDir')}
              </Btn>
            </div>
            <p className="mt-3 text-[11px] text-[var(--text-secondary)]">
              {running ? t('lanDirRestart') : t('lanDefaultHint')}
            </p>
          </div>
        </section>

        {/* Share link */}
        {running && (
          <section className={CARD_CLS}>
            <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
              <span className={LABEL_CLS}>{t('lanShare')}</span>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-[11px] text-[var(--text-secondary)]">{t('lanUseHint')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-warm)] text-xs font-mono text-[var(--text-primary)] select-all truncate">
                  {baseUrl}
                </code>
                {status?.ips && status.ips.length > 0 && (
                  <Select
                    className="w-[132px] shrink-0"
                    value={status.ip ?? undefined}
                    onChange={(ip) => {
                      void window.api.lan
                        .setIp(ip)
                        .then(setStatus)
                        .catch(() => {})
                    }}
                    options={status.ips.map((ip) => ({ value: ip, label: ip }))}
                    placeholder={t('lanNetworkIp')}
                  />
                )}
                <Btn icon={<CopyOutlined />} onClick={() => handleCopy(baseUrl)}>
                  {t('lanCopy')}
                </Btn>
                <Btn icon={<GlobalOutlined />} onClick={() => window.api.lan.openBrowser(baseUrl)}>
                  {t('lanOpenBrowser')}
                </Btn>
                <Btn icon={<QrcodeOutlined />} onClick={() => setQrOpen(true)}>
                  {t('lanQrCode')}
                </Btn>
              </div>
              {status?.ips && status.ips.length > 0 && (
                <p className="text-[11px] text-[var(--text-secondary)]">{t('lanNetworkIpHint')}</p>
              )}

              {token && (
                <div>
                  <label className={LABEL_CLS}>{t('lanToken')}</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-warm)] text-xs font-mono text-[var(--text-primary)] select-all truncate">
                      {token}
                    </code>
                    <Btn icon={<CopyOutlined />} onClick={() => handleCopy(token)}>
                      {t('lanCopyToken')}
                    </Btn>
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                    {t('lanTokenHint')}
                  </p>
                </div>
              )}

              <div>
                <label className={LABEL_CLS}>{t('lanSubdir')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={subdir}
                    onChange={(e) => setSubdir(e.target.value)}
                    placeholder={t('lanSubdirPlaceholder')}
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]
                      text-xs text-[var(--text-primary)] outline-none
                      focus:border-[var(--accent)] transition-colors duration-150"
                  />
                  <Btn icon={<LinkOutlined />} onClick={() => handleCopy(deepLink)}>
                    {t('lanCopyDeepLink')}
                  </Btn>
                </div>
              </div>
            </div>
          </section>
        )}

        <LanClips />
      </div>

      {/* QR code modal */}
      <Modal
        open={qrOpen}
        title={t('lanQrCode')}
        footer={null}
        onCancel={() => setQrOpen(false)}
        destroyOnHidden
        width={320}
      >
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="p-3 rounded-xl bg-[var(--surface)] shadow-sm">
            <QRCodeSVG
              value={baseUrl}
              size={200}
              fgColor="currentColor"
              bgColor="transparent"
              marginSize={1}
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
          <span className="text-[11px] text-[var(--text-secondary)] text-center">
            {t('lanQrHint')}
          </span>
        </div>
      </Modal>
    </div>
  )
}

export default LanTransfer
