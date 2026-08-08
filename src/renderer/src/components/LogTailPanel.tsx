import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Empty, Input, Select } from 'antd'
import {
  CloseOutlined,
  PauseOutlined,
  CaretRightOutlined,
  ClearOutlined,
  ExpandOutlined,
  CompressOutlined,
  StopOutlined
} from '@ant-design/icons'

const HISTORY_KEY = 'ssh-log-history'
const MAX_HISTORY = 10
const MAX_BUFFER = 400000

function decodeBase64(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

interface LogTailPanelProps {
  nodeId: string
  onClose: () => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}

function LogTailPanel({
  nodeId,
  onClose,
  fullscreen,
  onToggleFullscreen
}: LogTailPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [path, setPath] = useState('')
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as string[]
      return Array.isArray(stored) ? stored : []
    } catch {
      return []
    }
  })
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [buffer, setBuffer] = useState('')
  const [exitReason, setExitReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bufferRef = useRef('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const aliveRef = useRef(true)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const appendData = useCallback((text: string): void => {
    bufferRef.current += text
    if (bufferRef.current.length > MAX_BUFFER) {
      bufferRef.current = bufferRef.current.slice(-MAX_BUFFER * 0.75)
    }
    setBuffer(bufferRef.current)
  }, [])

  useEffect(() => {
    aliveRef.current = true
    sessionIdRef.current = sessionId
    const offData = window.api.ssh.onLogData((payload) => {
      if (payload.sessionId !== sessionIdRef.current) return
      appendData(decodeBase64(payload.data))
    })
    const offExit = window.api.ssh.onLogExit((payload) => {
      if (payload.sessionId !== sessionIdRef.current) return
      sessionIdRef.current = null
      setSessionId(null)
      setRunning(false)
      setExitReason(payload.reason ?? null)
    })
    return () => {
      aliveRef.current = false
      offData()
      offExit()
      if (sessionIdRef.current) void window.api.ssh.stopLogTail(sessionIdRef.current)
    }
  }, [appendData])

  useEffect(() => {
    const el = scrollRef.current
    if (el && !paused) el.scrollTop = el.scrollHeight
  }, [buffer, paused])

  const start = useCallback(async (): Promise<void> => {
    const p = path.trim()
    if (!p) {
      message.warning(t('sshLogPathEmpty'))
      return
    }
    setError(null)
    setExitReason(null)
    try {
      const res = await window.api.ssh.startLogTail(nodeId, p)
      bufferRef.current = ''
      setBuffer('')
      setPaused(false)
      sessionIdRef.current = res.sessionId
      setSessionId(res.sessionId)
      setRunning(true)
      setHistory((prev) => {
        const next = [p, ...prev.filter((x) => x !== p)].slice(0, MAX_HISTORY)
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [path, nodeId, message, t])

  const stop = useCallback(async (): Promise<void> => {
    const id = sessionIdRef.current
    sessionIdRef.current = null
    setSessionId(null)
    setRunning(false)
    if (id) await window.api.ssh.stopLogTail(id)
  }, [])

  const togglePause = useCallback((): void => {
    setPaused((v) => !v)
  }, [])

  const clear = useCallback((): void => {
    bufferRef.current = ''
    setBuffer('')
  }, [])

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--border-subtle)] bg-[var(--surface)]">
        <div className="shrink-0 max-w-44 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate">
            {t('sshToolLogs')}
          </div>
          <div className="text-[10px] text-[var(--text-secondary)] truncate">
            {running ? t('sshLogRunning') : t('sshLogTailHint')}
          </div>
        </div>
        <div className="flex-1 min-w-0 flex items-center justify-end gap-2">
          <Input
            size="small"
            placeholder={t('sshLogPathPlaceholder')}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onPressEnter={() => void start()}
            className="min-w-0 flex-1 max-w-[320px]"
          />
          <Select
            size="small"
            placeholder={t('sshLogHistory')}
            className="min-w-0 flex-1 max-w-[220px]"
            options={history.map((h) => ({ value: h, label: h }))}
            onChange={(v: string) => setPath(v)}
            showSearch
            allowClear
            popupMatchSelectWidth={false}
            getPopupContainer={() => rootRef.current ?? document.body}
            dropdownStyle={{ minWidth: 300, maxWidth: 'min(50vw, 480px)' }}
          />
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)] disabled:opacity-40"
            title={running ? t('sshLogStop') : t('sshLogStart')}
            onClick={() => (running ? void stop() : void start())}
          >
            {running ? <StopOutlined /> : <CaretRightOutlined />}
          </button>
          <button
            type="button"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)]"
            title={paused ? t('sshLogResume') : t('sshLogPause')}
            disabled={!running}
            onClick={togglePause}
          >
            {paused ? <CaretRightOutlined /> : <PauseOutlined />}
          </button>
          <button
            type="button"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)]"
            title={t('sshLogClear')}
            onClick={clear}
          >
            <ClearOutlined />
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
      <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-subtle)] flex items-center gap-3 min-h-6">
        {running && (
          <span className="inline-flex items-center gap-1.5 text-[10px] text-[var(--accent)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            {t('sshLogRunning')}
            {paused && <span className="text-[var(--text-secondary)]">· {t('sshLogPause')}</span>}
          </span>
        )}
        {exitReason && (
          <span className="text-[10px] text-[var(--text-secondary)]">
            {t('sshLogExited', { reason: exitReason })}
          </span>
        )}
        {error && (
          <span className="text-[10px] text-red-500" title={error}>
            {t('sshLogStartFail', { msg: error })}
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto bg-[var(--bg-warm)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-all"
      >
        {!buffer && !error && (
          <div className="h-full flex items-center justify-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('sshLogEmpty')}
              className="scale-90"
            />
          </div>
        )}
        {buffer}
      </div>
    </div>
  )
}

export default LogTailPanel
