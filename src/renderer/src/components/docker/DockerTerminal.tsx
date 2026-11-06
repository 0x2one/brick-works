import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Dropdown, Select, Tag } from 'antd'
import type { MenuProps } from 'antd'
import {
  ClearOutlined,
  CopyOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SnippetsOutlined,
  ZoomInOutlined,
  ZoomOutOutlined
} from '@ant-design/icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '../../theme/ThemeProvider'

const LS_DOCKER_FONT_SIZE = 'brickworks:dockerExecFontSize'
const FONT_MIN = 10
const FONT_MAX = 26
const DEFAULT_FONT = 13

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function loadFontSize(): number {
  const stored = parseInt(localStorage.getItem(LS_DOCKER_FONT_SIZE) || '', 10)
  return Number.isFinite(stored) ? Math.min(FONT_MAX, Math.max(FONT_MIN, stored)) : DEFAULT_FONT
}

/** Turn the daemon's HTTP status into something a user can act on. */
function mapTerminalError(message: string, t: (key: string) => string): string {
  if (message.includes('(HTTP code 409)')) return t('dockerTerminalNotRunning')
  if (message.includes('(HTTP code 404)')) return t('dockerTerminalNoContainer')
  if (message.includes('DOCKER_CLI_UNAVAILABLE')) return t('dockerTerminalCliUnavailable')
  if (message.includes('DOCKER_NOT_CONNECTED')) return t('dockerTerminalNotConnected')
  return message
}

interface DockerTerminalProps {
  containerId: string
  containerName: string
  active: boolean
  tty: boolean
}

export default function DockerTerminal({
  containerId,
  containerName,
  active,
  tty
}: DockerTerminalProps): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { resolved: themeResolved } = useTheme()
  const [shell, setShell] = useState('sh')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState(loadFontSize)
  const [copyEnabled, setCopyEnabled] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const disposersRef = useRef<(() => void) | null>(null)
  const fontSizeRef = useRef(fontSize)
  const running = Boolean(sessionId)

  /** Fit only when the host actually has a size — the drawer animates in. */
  const safeFit = useCallback((): void => {
    const host = hostRef.current
    const fit = fitRef.current
    if (!host || !fit) return
    if (host.clientWidth < 2 || host.clientHeight < 2) return
    try {
      fit.fit()
    } catch {
      // xterm throws when it is not attached yet
    }
  }, [])

  const copySelection = useCallback(async (): Promise<void> => {
    const term = termRef.current
    if (!term) return
    const selection = term.getSelection()
    if (!selection) return
    await window.api.clipboard.writeText(selection)
    term.clearSelection()
    setCopyEnabled(false)
    message.success(t('copied'))
  }, [message, t])

  const pasteClipboard = useCallback(async (): Promise<void> => {
    const term = termRef.current
    if (!term) return
    const text = await window.api.clipboard.readText()
    if (text) term.paste(text)
    term.focus()
  }, [])

  const createTerminal = useCallback((): Terminal | null => {
    const host = hostRef.current
    if (!host) return null
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: fontSizeRef.current,
      scrollback: 5000,
      theme: {
        background: readCssVar('--bg-warm', '#f1efe9'),
        foreground: readCssVar('--text-primary', '#26211d')
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    // Ctrl/Cmd+C copies the selection when there is one, otherwise it is
    // forwarded to the container as SIGINT (^C).
    // Returning false tells xterm not to process the event any further.
    term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      if (event.type !== 'keydown') return true
      if (!event.ctrlKey && !event.metaKey) return true
      if (event.key.toLowerCase() !== 'c') return true
      if (!term.getSelection()) return true
      void copySelection()
      return false
    })

    // Wire the input right away so no keystroke is lost while the session starts.
    const dataDisposer = term.onData((data) => {
      const id = sessionIdRef.current
      if (!id) return
      void window.api.docker.writeExec(id, toBase64(data))
    })

    // Keep the context menu in sync with the current selection.
    const selectionDisposer = term.onSelectionChange(() => {
      setCopyEnabled(Boolean(term.getSelection()))
    })

    // Focus tracking — xterm owns a hidden textarea inside the host element.
    // The app only forwards the paste shortcut while a terminal reports focus.
    const textarea = term.textarea
    const onFocus = (): void => window.api.app.setTermPasteFocus(true)
    const onBlur = (): void => window.api.app.setTermPasteFocus(false)
    textarea?.addEventListener('focus', onFocus)
    textarea?.addEventListener('blur', onBlur)

    // Keep the terminal in sync with its container (drawer resize, tab switch).
    const observer = new ResizeObserver(() => safeFit())
    observer.observe(host)

    disposersRef.current = (): void => {
      dataDisposer.dispose()
      selectionDisposer.dispose()
      textarea?.removeEventListener('focus', onFocus)
      textarea?.removeEventListener('blur', onBlur)
      observer.disconnect()
    }

    // The drawer and the tab pane animate — fit once the layout settled.
    requestAnimationFrame(() => {
      safeFit()
      term.focus()
    })
    window.setTimeout(safeFit, 150)

    return term
  }, [copySelection, safeFit])

  const teardown = useCallback((): void => {
    const id = sessionIdRef.current
    sessionIdRef.current = null
    if (id) void window.api.docker.stopExec(id)
    disposersRef.current?.()
    disposersRef.current = null
    termRef.current?.dispose()
    termRef.current = null
    fitRef.current = null
    setSessionId(null)
    setCopyEnabled(false)
    window.api.app.setTermPasteFocus(false)
  }, [])

  useEffect(() => {
    if (!active) return
    let alive = true
    const begin = async (): Promise<void> => {
      teardown()
      const term = createTerminal()
      if (!term) return
      try {
        const res = await window.api.docker.startExec({ containerId, shell, tty })
        if (!alive) {
          void window.api.docker.stopExec(res.sessionId)
          return
        }
        sessionIdRef.current = res.sessionId
        setSessionId(res.sessionId)
        setError(null)
        safeFit()
        term.focus()
      } catch (err) {
        if (!alive) return
        const raw = err instanceof Error ? err.message : t('dockerTerminalFailed')
        const message = mapTerminalError(raw, t)
        setError(message)
        term.writeln(`${t('dockerTerminalFailed')}: ${message}`)
      }
    }
    void begin()
    const onResize = (): void => safeFit()
    window.addEventListener('resize', onResize)
    return () => {
      alive = false
      window.removeEventListener('resize', onResize)
      teardown()
    }
  }, [active, containerId, shell, tty, createTerminal, teardown, safeFit, t])

  useEffect(() => {
    const offData = window.api.docker.onExecData((payload) => {
      if (payload.sessionId !== sessionIdRef.current) return
      termRef.current?.write(fromBase64(payload.data))
    })
    const offExit = window.api.docker.onExecExit((payload) => {
      if (payload.sessionId !== sessionIdRef.current) return
      sessionIdRef.current = null
      setSessionId(null)
      termRef.current?.writeln(`\r\n${t('dockerTerminalExited', { reason: payload.reason ?? '' })}`)
    })
    return () => {
      offData()
      offExit()
    }
  }, [t])

  useEffect(() => {
    localStorage.setItem(LS_DOCKER_FONT_SIZE, String(fontSize))
    fontSizeRef.current = fontSize
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    safeFit()
  }, [fontSize, safeFit])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    // Defer so the theme variables are applied after the DOM update.
    const id = window.setTimeout(() => {
      term.options.theme = {
        background: readCssVar('--bg-warm', '#f1efe9'),
        foreground: readCssVar('--text-primary', '#26211d')
      }
    }, 0)
    return () => window.clearTimeout(id)
  }, [themeResolved, running])

  // The pane may be hidden while the tab is not active — refit when it returns.
  useEffect(() => {
    if (!active) return
    const id = window.setTimeout(() => safeFit(), 0)
    return () => window.clearTimeout(id)
  }, [active, safeFit])

  // The main process forwards Ctrl/Cmd+V (and the zoom keys) to the renderer
  // when a terminal reports focus — the default menu would swallow them.
  useEffect(() => {
    const off = window.api.shortcuts.onShortcut((key) => {
      if (!active) return
      if (key === 'v') {
        void pasteClipboard()
        return
      }
      if (key === '=' || key === '+') {
        setFontSize((v) => Math.min(FONT_MAX, v + 1))
        return
      }
      if (key === '-' || key === '_') {
        setFontSize((v) => Math.max(FONT_MIN, v - 1))
        return
      }
      if (key === '0') {
        setFontSize(DEFAULT_FONT)
      }
    })
    return off
  }, [active, pasteClipboard])

  const termMenu = useMemo<MenuProps>(
    () => ({
      items: [
        {
          key: 'copy',
          icon: <CopyOutlined />,
          label: t('dockerTermCopy'),
          disabled: !copyEnabled
        },
        { key: 'paste', icon: <SnippetsOutlined />, label: t('dockerTermPaste') },
        { key: 'clear', icon: <ClearOutlined />, label: t('dockerTermClear') },
        { key: 'selectall', icon: <FileTextOutlined />, label: t('dockerTermSelectAll') },
        { type: 'divider' },
        { key: 'font-inc', icon: <ZoomInOutlined />, label: t('dockerTermFontInc') },
        { key: 'font-dec', icon: <ZoomOutOutlined />, label: t('dockerTermFontDec') },
        { key: 'font-reset', icon: <ReloadOutlined />, label: t('dockerTermFontReset') }
      ],
      onClick: ({ key }) => {
        switch (key) {
          case 'copy':
            void copySelection()
            break
          case 'paste':
            void pasteClipboard()
            break
          case 'clear':
            termRef.current?.clear()
            break
          case 'selectall':
            termRef.current?.selectAll()
            break
          case 'font-inc':
            setFontSize((v) => Math.min(FONT_MAX, v + 1))
            break
          case 'font-dec':
            setFontSize((v) => Math.max(FONT_MIN, v - 1))
            break
          case 'font-reset':
            setFontSize(DEFAULT_FONT)
            break
        }
      }
    }),
    [copyEnabled, copySelection, pasteClipboard, t]
  )

  const restart = useCallback((): void => {
    setSessionId(null)
    setError(null)
    teardown()
    const term = createTerminal()
    if (!term) return
    void window.api.docker
      .startExec({ containerId, shell, tty })
      .then((res) => {
        sessionIdRef.current = res.sessionId
        setSessionId(res.sessionId)
        safeFit()
        term.focus()
      })
      .catch((err: unknown) => {
        const raw = err instanceof Error ? err.message : t('dockerTerminalFailed')
        const message = mapTerminalError(raw, t)
        setError(message)
        term.writeln(`${t('dockerTerminalFailed')}: ${message}`)
      })
  }, [containerId, shell, tty, createTerminal, teardown, safeFit, t])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-[var(--text-primary)] truncate max-w-[220px]">
            {containerName}
          </span>
          {running ? (
            <Tag color="success">{t('dockerTerminalRunning')}</Tag>
          ) : (
            <Tag>{t('dockerTerminalStopped')}</Tag>
          )}
          {!tty && <Tag color="warning">{t('dockerTerminalNoTty')}</Tag>}
          {error && <Tag color="error">{error}</Tag>}
        </div>
        <div className="flex items-center gap-2">
          <Select
            size="small"
            value={shell}
            onChange={setShell}
            className="w-[130px]"
            options={[
              { value: 'sh', label: 'sh' },
              { value: 'bash', label: 'bash' },
              { value: 'cmd', label: 'cmd' },
              { value: 'powershell', label: 'powershell' }
            ]}
          />
          <Button size="small" icon={<ReloadOutlined />} onClick={restart}>
            {t('dockerTerminalRestart')}
          </Button>
        </div>
      </div>
      <Dropdown
        trigger={['contextMenu']}
        menu={termMenu}
        onOpenChange={(open) => {
          if (!open) return
          setCopyEnabled(Boolean(termRef.current?.getSelection()))
        }}
      >
        <div
          ref={hostRef}
          className="flex-1 min-h-0 overflow-hidden bg-[var(--bg-warm)] p-1"
          onMouseDown={() => termRef.current?.focus()}
        />
      </Dropdown>
    </div>
  )
}
