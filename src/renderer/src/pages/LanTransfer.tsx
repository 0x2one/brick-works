import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Modal } from 'antd'
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

const LABEL_CLS =
  'block text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] mb-1.5'

const CARD_CLS =
  'rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden'

const BTN_CLS =
  'px-3 h-8 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none ' +
  'bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

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
  const deepLink = subdir.trim()
    ? `${baseUrl.replace(/\/$/, '')}/?path=${encodeURIComponent(subdir.trim())}`
    : baseUrl

  return (
    <div className="flex flex-col p-6 gap-4" style={{ height: 'calc(100vh - 56px)' }}>
      <div>
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{t('lanTransfer')}</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">{t('lanDesc')}</p>
      </div>

      <div className="flex flex-col gap-4 max-w-[720px] overflow-auto pb-4">
        {/* Service status */}
        <section className={CARD_CLS}>
          <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <span className={LABEL_CLS}>{t('lanStatus')}</span>
            <span
              className={`flex items-center gap-1.5 text-xs font-medium ${
                running ? 'text-green-600' : 'text-[var(--text-secondary)]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${running ? 'bg-green-500' : 'bg-[var(--border-subtle)]'}`}
              />
              {running ? t('lanRunning') : t('lanStopped')}
            </span>
          </div>
          <div className="px-5 py-4 flex items-center gap-3">
            <button
              onClick={handleToggle}
              disabled={starting}
              className={
                running
                  ? 'px-4 h-8 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)]'
                  : 'px-4 h-8 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none bg-[var(--accent)] text-white hover:brightness-110 active:brightness-90'
              }
            >
              {running ? <StopOutlined /> : <PlayCircleOutlined />}
              {running ? t('lanStop') : t('lanStart')}
            </button>
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
              <button onClick={handleChooseDir} className={BTN_CLS}>
                <FolderOpenOutlined />
                {t('lanChooseDir')}
              </button>
              <button
                onClick={() => window.api.lan.openDir()}
                disabled={!status?.dir}
                className={BTN_CLS}
              >
                <FolderOutlined />
                {t('lanOpenDir')}
              </button>
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
                <button onClick={() => handleCopy(baseUrl)} className={BTN_CLS}>
                  <CopyOutlined />
                  {t('lanCopy')}
                </button>
                <button onClick={() => window.api.lan.openBrowser(baseUrl)} className={BTN_CLS}>
                  <GlobalOutlined />
                  {t('lanOpenBrowser')}
                </button>
                <button onClick={() => setQrOpen(true)} className={BTN_CLS}>
                  <QrcodeOutlined />
                  {t('lanQrCode')}
                </button>
              </div>

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
                  <button onClick={() => handleCopy(deepLink)} className={BTN_CLS}>
                    <LinkOutlined />
                    {t('lanCopyDeepLink')}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
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
          <div className="p-3 rounded-xl bg-white shadow-sm">
            <QRCodeSVG
              value={baseUrl}
              size={200}
              fgColor="#1a1a1a"
              bgColor="#ffffff"
              marginSize={1}
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
