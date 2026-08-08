import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App,
  Modal,
  Form,
  Input,
  InputNumber,
  Radio,
  Empty,
  Button,
  Table,
  Breadcrumb,
  Spin,
  Dropdown,
  Tooltip,
  Select
} from 'antd'
import type { MenuProps } from 'antd'
import {
  PlusOutlined,
  ApiOutlined,
  EditOutlined,
  DeleteOutlined,
  CloudServerOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  FileOutlined,
  LinkOutlined,
  LoadingOutlined,
  DownloadOutlined,
  ReloadOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CloseOutlined,
  ExpandOutlined,
  CompressOutlined,
  UploadOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  CodeOutlined,
  HolderOutlined,
  SaveOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Editor } from '@monaco-editor/react'
import '../components/MonacoSetup'
import { useTheme } from '../theme/ThemeProvider'
import { SortableList } from '../components/SortableList'

const BTN_ICON =
  'h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer ' +
  'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

const BTN_TEXT =
  'h-7 px-2 inline-flex items-center gap-1 rounded-md text-xs border-none cursor-pointer ' +
  'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

const BTN_TEXT_ACTIVE =
  'h-7 px-2 inline-flex items-center gap-1 rounded-md text-xs border-none cursor-pointer ' +
  'bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25'

const TITLE_BAR_CLS =
  'h-10 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--border-subtle)] bg-[var(--surface)]'

const SSH_ERROR_CODES = [
  'HOST_KEY_MISMATCH',
  'AUTH_FAILED',
  'NODE_NOT_FOUND',
  'JUMP_NOT_FOUND',
  'JUMP_SELF',
  'JUMP_CYCLE',
  'JUMP_TOO_DEEP',
  'JUMP_FORWARD_FAILED',
  'SFTP_FAILED',
  'SFTP_LIST_FAILED',
  'SFTP_DOWNLOAD_FAILED',
  'SFTP_UPLOAD_FAILED',
  'SFTP_MKDIR_FAILED',
  'SFTP_WRITE_FAILED',
  'SFTP_READ_FAILED',
  'FILE_TOO_LARGE',
  'SHELL_FAILED'
] as const

type MaximizeMode = null | 'console' | 'files'

interface SessionTab {
  id: string
  nodeId: string
  title: string
  subtitle: string
  shellSessionId: string | null
  filesOpen: boolean
  remotePath: string
  connecting: boolean
}

interface TermRuntime {
  term: Terminal
  fit: FitAddon
  shellSessionId: string | null
}

interface SshFileEditorState {
  tabId: string
  nodeId: string
  path: string
  name: string
  content: string
  original: string
  binary: boolean
  size: number
  loading: boolean
  saving: boolean
  error?: string
}

interface EditorValues {
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
  jumpHostId?: string | null
}

function extractSshErrorCode(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : String(raw ?? '')
  if (!message) return ''
  for (const code of SSH_ERROR_CODES) {
    if (message === code || message.endsWith(`: ${code}`) || message.endsWith(`Error: ${code}`)) {
      return code
    }
  }
  return message
}

function mapSshError(
  raw: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const code = extractSshErrorCode(raw)
  if (code === 'HOST_KEY_MISMATCH') return t('sshHostKeyMismatch')
  if (code === 'AUTH_FAILED') return t('sshAuthFailed')
  if (code === 'NODE_NOT_FOUND') return t('sshNodeNotFound')
  if (code === 'JUMP_NOT_FOUND') return t('sshJumpNotFound')
  if (code === 'JUMP_SELF') return t('sshJumpSelf')
  if (code === 'JUMP_CYCLE') return t('sshJumpCycle')
  if (code === 'JUMP_TOO_DEEP') return t('sshJumpTooDeep')
  if (code === 'JUMP_FORWARD_FAILED') return t('sshJumpForwardFailed')
  if (code === 'SFTP_FAILED' || code === 'SFTP_LIST_FAILED') return t('sshClientSftpFail')
  if (code === 'SFTP_DOWNLOAD_FAILED') return t('sshClientDownloadFail')
  if (code === 'SFTP_UPLOAD_FAILED') return t('sshClientUploadFail')
  if (code === 'SFTP_MKDIR_FAILED' || code === 'SFTP_WRITE_FAILED') return t('sshClientCreateFail')
  if (code === 'SFTP_READ_FAILED') return t('sshClientEditReadFail')
  if (code === 'FILE_TOO_LARGE') return t('sshClientEditTooLarge')
  if (code === 'SHELL_FAILED') return t('sshClientShellFail')
  return t('sshConnectFail', { msg: code })
}

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function applyTermTheme(term: Terminal, resolved?: 'light' | 'dark'): void {
  const dark = resolved === 'dark'
  term.options.theme = {
    background: readCssVar('--bg-warm', dark ? '#1a1a1a' : '#f3f0eb'),
    foreground: readCssVar('--text-primary', dark ? '#e0e0e0' : '#2a2520'),
    cursor: readCssVar('--text-primary', dark ? '#e0e0e0' : '#2a2520'),
    selectionBackground: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)'
  }
  term.refresh(0, Math.max(0, term.rows - 1))
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  svg: 'xml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  py: 'python',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  rb: 'ruby',
  sql: 'sql',
  dockerfile: 'dockerfile',
  ini: 'ini',
  toml: 'toml',
  conf: 'ini',
  txt: 'plaintext',
  log: 'plaintext'
}

function extToLang(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) {
    const lower = name.toLowerCase()
    return lower === 'dockerfile' || lower === 'makefile' ? lower : 'plaintext'
  }
  return EXT_TO_LANG[name.slice(idx + 1).toLowerCase()] ?? 'plaintext'
}

function pathSegments(path: string): Array<{ name: string; path: string }> {
  const cleaned = path.replace(/\/+$/, '') || '/'
  if (cleaned === '/') return [{ name: '/', path: '/' }]
  const parts = cleaned.split('/').filter(Boolean)
  const segs: Array<{ name: string; path: string }> = [{ name: '/', path: '/' }]
  let cur = ''
  for (const part of parts) {
    cur += `/${part}`
    segs.push({ name: part, path: cur })
  }
  return segs
}

function posixJoin(base: string, name: string): string {
  if (base === '/' || base === '') return `/${name}`
  return `${base.replace(/\/+$/, '')}/${name}`
}

function newTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function NodeEditor({
  open,
  editing,
  nodes,
  onCancel,
  onSaved
}: {
  open: boolean
  editing: SshNodeView | null
  nodes: SshNodeView[]
  onCancel: () => void
  onSaved: (node: SshNodeView) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<EditorValues>()

  const jumpOptions = useMemo(
    () =>
      nodes
        .filter((n) => n.id !== editing?.id)
        .map((n) => ({
          value: n.id,
          label: `${n.name} (${n.username}@${n.host}:${n.port})`
        })),
    [nodes, editing?.id]
  )

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      name: editing?.name ?? '',
      host: editing?.host ?? '',
      port: editing?.port ?? 22,
      username: editing?.username ?? '',
      authType: editing?.authType ?? 'password',
      password: '',
      privateKeyPath: editing?.privateKeyPath ?? '',
      passphrase: '',
      jumpHostId: editing?.jumpHostId ?? null
    })
  }, [open, editing, form])

  const handleChooseKey = useCallback(async () => {
    const path = await window.api.ssh.chooseKeyFile()
    if (path) form.setFieldValue('privateKeyPath', path)
  }, [form])

  const handleOk = useCallback(async () => {
    try {
      const values = await form.validateFields()
      const node = await window.api.ssh.saveNode({
        id: editing?.id,
        name: values.name,
        host: values.host,
        port: values.port,
        username: values.username,
        authType: values.authType,
        password: values.authType === 'password' ? values.password : undefined,
        privateKeyPath: values.authType === 'privateKey' ? values.privateKeyPath : undefined,
        passphrase: values.authType === 'privateKey' ? values.passphrase : undefined,
        jumpHostId: values.jumpHostId || null
      })
      message.success(t('sshSaved'))
      onSaved(node)
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return
      const msg = mapSshError(err, t)
      message.error(t('sshNodeSaveFail', { msg }))
    }
  }, [form, editing, message, onSaved, t])

  const handleClearHostKey = useCallback(async () => {
    if (!editing) return
    try {
      await window.api.ssh.clearHostKey(editing.id)
      message.success(t('sshHostKeyCleared'))
    } catch {
      message.error(t('sshHostKeyClearFail'))
    }
  }, [editing, message, t])

  return (
    <Modal
      open={open}
      title={editing ? t('sshNodeEdit') : t('sshNodeNew')}
      onCancel={onCancel}
      onOk={handleOk}
      okText={t('sshSave')}
      cancelText={t('sshCancel')}
      destroyOnHidden
      centered
      width={560}
    >
      <Form form={form} layout="vertical" className="mt-1 [&_.ant-form-item]:mb-3" size="middle">
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item name="name" label={t('sshName')} rules={[{ required: true }]}>
            <Input placeholder="cloud-server" />
          </Form.Item>
          <Form.Item name="username" label={t('sshUsername')} rules={[{ required: true }]}>
            <Input placeholder="root" />
          </Form.Item>
        </div>
        <div className="grid grid-cols-3 gap-x-3">
          <Form.Item
            name="host"
            label={t('sshHost')}
            rules={[{ required: true }]}
            className="col-span-2"
          >
            <Input placeholder="example.com" />
          </Form.Item>
          <Form.Item name="port" label={t('sshPort')} rules={[{ required: true }]}>
            <InputNumber min={1} max={65535} className="w-full" />
          </Form.Item>
        </div>
        <div className="grid grid-cols-2 gap-x-3">
          <Form.Item
            name="jumpHostId"
            label={t('sshJumpHost')}
            tooltip={t('sshJumpHostHint')}
          >
            <Select
              allowClear
              placeholder={t('sshJumpHostNone')}
              options={jumpOptions}
              optionFilterProp="label"
              showSearch
            />
          </Form.Item>
          <Form.Item name="authType" label={t('sshAuthType')}>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              className="flex w-full [&>label]:flex-1 [&>label]:text-center"
              options={[
                { label: t('sshAuthPassword'), value: 'password' },
                { label: t('sshAuthKey'), value: 'privateKey' }
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.authType !== cur.authType}>
          {() => {
            const authType = form.getFieldValue('authType') as EditorValues['authType']
            if (authType === 'password') {
              return (
                <Form.Item
                  name="password"
                  label={t('sshPassword')}
                  className="mb-0!"
                  rules={
                    editing?.hasPassword
                      ? []
                      : [{ required: true, message: t('sshPasswordRequired') }]
                  }
                  extra={editing?.hasPassword ? t('sshKeepSecret') : undefined}
                >
                  <Input.Password autoComplete="new-password" />
                </Form.Item>
              )
            }
            if (authType === 'privateKey') {
              return (
                <>
                  <Form.Item
                    name="privateKeyPath"
                    label={t('sshKeyPath')}
                    rules={[{ required: true, message: t('sshKeyRequired') }]}
                  >
                    <Input
                      readOnly
                      placeholder="~/.ssh/id_rsa"
                      addonAfter={
                        <Button
                          type="text"
                          size="small"
                          icon={<FolderOpenOutlined />}
                          onClick={handleChooseKey}
                        >
                          {t('sshChooseKey')}
                        </Button>
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    name="passphrase"
                    label={t('sshPassphrase')}
                    className="mb-0!"
                    extra={editing?.hasPassphrase ? t('sshKeepSecret') : undefined}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                </>
              )
            }
            return null
          }}
        </Form.Item>
        {editing && (
          <div className="mt-1">
            <Tooltip title={t('sshClearHostKeyHint')}>
              <Button type="link" size="small" className="px-0 h-auto" onClick={handleClearHostKey}>
                {t('sshClearHostKey')}
              </Button>
            </Tooltip>
          </div>
        )}
      </Form>
    </Modal>
  )
}

function SshClient({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const { resolved: themeResolved } = useTheme()

  const [nodes, setNodes] = useState<SshNodeView[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<SshNodeView | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const [tabs, setTabs] = useState<SessionTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [maximized, setMaximized] = useState<MaximizeMode>(null)

  const [entriesByTab, setEntriesByTab] = useState<Record<string, SshSftpEntry[]>>({})
  const [filesLoading, setFilesLoading] = useState(false)
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [createOpen, setCreateOpen] = useState<'file' | 'dir' | null>(null)
  const [createName, setCreateName] = useState('')
  const [copyTipVisible, setCopyTipVisible] = useState(false)

  const [editorsByTab, setEditorsByTab] = useState<Record<string, SshFileEditorState[]>>({})
  const [activeEditorPathByTab, setActiveEditorPathByTab] = useState<Record<string, string>>({})
  const [editorHeight, setEditorHeight] = useState(320)

  const termHostsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const termsRef = useRef<Map<string, TermRuntime>>(new Map())
  const tabsRef = useRef<SessionTab[]>([])
  const connectingTabsRef = useRef<Set<string>>(new Set())
  const connectShellRef = useRef<(tabId: string, reconnect?: boolean) => Promise<void>>(
    async () => {}
  )
  const editorsRef = useRef<Record<string, SshFileEditorState[]>>({})
  const activeEditorPathRef = useRef<Record<string, string>>({})
  const consoleHostRef = useRef<HTMLDivElement | null>(null)
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyTipHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifyCopiedRef = useRef<() => void>(() => {})
  const loadDirSeqRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    notifyCopiedRef.current = () => {
      setCopyTipVisible(true)
      if (copyTipHideTimerRef.current) clearTimeout(copyTipHideTimerRef.current)
      copyTipHideTimerRef.current = setTimeout(() => setCopyTipVisible(false), 1200)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current) clearTimeout(copyToastTimerRef.current)
      if (copyTipHideTimerRef.current) clearTimeout(copyTipHideTimerRef.current)
    }
  }, [])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId]
  )

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    editorsRef.current = editorsByTab
  }, [editorsByTab])

  useEffect(() => {
    activeEditorPathRef.current = activeEditorPathByTab
  }, [activeEditorPathByTab])

  const loadNodes = useCallback(() => {
    window.api.ssh
      .listNodes()
      .then(setNodes)
      .catch(() => {})
  }, [])

  const persistNodeOrder = useCallback(
    (next: SshNodeView[]) => {
      setNodes(next)
      void (async () => {
        try {
          if (typeof window.api.ssh.reorderNodes !== 'function') {
            throw new Error('REORDER_UNSUPPORTED')
          }
          const saved = await window.api.ssh.reorderNodes(next.map((n) => n.id))
          setNodes(saved)
        } catch {
          loadNodes()
        }
      })()
    },
    [loadNodes]
  )

  useEffect(() => {
    loadNodes()
  }, [loadNodes])

  useEffect(() => {
    if (active) loadNodes()
  }, [active, loadNodes])

  const destroyTerm = useCallback((tabId: string) => {
    const rt = termsRef.current.get(tabId)
    if (!rt) return
    try {
      rt.term.dispose()
    } catch {
      // ignore
    }
    termsRef.current.delete(tabId)
    connectingTabsRef.current.delete(tabId)
  }, [])

  const stopTabShell = useCallback(
    async (tab: SessionTab): Promise<void> => {
      const rt = termsRef.current.get(tab.id)
      const sid = rt?.shellSessionId ?? tab.shellSessionId
      if (sid) await window.api.ssh.stopShell(sid)
      destroyTerm(tab.id)
    },
    [destroyTerm]
  )

  const closeTab = useCallback(
    async (tabId: string): Promise<void> => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab) return
      await stopTabShell(tab)
      if (tab.filesOpen) {
        const othersOpen = tabsRef.current.some(
          (item) => item.id !== tabId && item.nodeId === tab.nodeId && item.filesOpen
        )
        if (!othersOpen) await window.api.ssh.sftpDisconnect(tab.nodeId)
      }
      setTabs((prev) => {
        const next = prev.filter((item) => item.id !== tabId)
        setActiveTabId((cur) => {
          if (cur !== tabId) return cur
          return next[next.length - 1]?.id ?? null
        })
        return next
      })
      setEntriesByTab((prev) => {
        const next = { ...prev }
        delete next[tabId]
        return next
      })
      setEditorsByTab((prev) => {
        const next = { ...prev }
        delete next[tabId]
        return next
      })
      setActiveEditorPathByTab((prev) => {
        const next = { ...prev }
        delete next[tabId]
        return next
      })
      if (maximized) setMaximized(null)
    },
    [stopTabShell, maximized]
  )

  const connectShell = useCallback(
    async (tabId: string, reconnect = false): Promise<void> => {
      const rt = termsRef.current.get(tabId)
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!rt || !tab) return
      if (rt.shellSessionId || connectingTabsRef.current.has(tabId)) return

      connectingTabsRef.current.add(tabId)
      setTabs((prev) =>
        prev.map((item) => (item.id === tabId ? { ...item, connecting: true } : item))
      )
      if (reconnect) {
        rt.term.writeln(`\x1b[33m[${t('sshClientReconnecting')}]\x1b[0m`)
      }

      try {
        rt.fit.fit()
        const { sessionId } = await window.api.ssh.startShell({
          nodeId: tab.nodeId,
          cols: rt.term.cols,
          rows: rt.term.rows
        })
        const still = tabsRef.current.some((item) => item.id === tabId)
        if (!still) {
          await window.api.ssh.stopShell(sessionId)
          destroyTerm(tabId)
          return
        }
        rt.shellSessionId = sessionId
        setTabs((prev) =>
          prev.map((item) =>
            item.id === tabId ? { ...item, shellSessionId: sessionId, connecting: false } : item
          )
        )
        await window.api.ssh.resizeShell(sessionId, rt.term.cols, rt.term.rows)
        window.setTimeout(() => {
          const cur = termsRef.current.get(tabId)
          if (!cur?.shellSessionId) return
          cur.fit.fit()
          void window.api.ssh.resizeShell(cur.shellSessionId, cur.term.cols, cur.term.rows)
          cur.term.focus()
        }, 80)
        rt.term.focus()
      } catch (err) {
        rt.term.writeln(`\x1b[31m${mapSshError(err, t)}\x1b[0m`)
        rt.term.writeln(`\x1b[33m[${t('sshClientPressEnterReconnect')}]\x1b[0m`)
        setTabs((prev) =>
          prev.map((item) => (item.id === tabId ? { ...item, connecting: false } : item))
        )
      } finally {
        connectingTabsRef.current.delete(tabId)
      }
    },
    [destroyTerm, t]
  )

  useEffect(() => {
    connectShellRef.current = connectShell
  }, [connectShell])

  useEffect(() => {
    const offData = window.api.ssh.onShellData((payload) => {
      for (const rt of termsRef.current.values()) {
        if (rt.shellSessionId !== payload.sessionId) continue
        const binary = atob(payload.data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        rt.term.write(bytes)
        return
      }
    })
    const offExit = window.api.ssh.onShellExit((payload) => {
      for (const [id, rt] of termsRef.current) {
        if (rt.shellSessionId !== payload.sessionId) continue
        rt.shellSessionId = null
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === id ? { ...tab, shellSessionId: null, connecting: false } : tab
          )
        )
        if (payload.reason === 'stopped') return
        rt.term.writeln(
          `\r\n\x1b[33m[${t('sshClientShellClosed')}${payload.reason ? `: ${payload.reason}` : ''}]\x1b[0m`
        )
        rt.term.writeln(`\x1b[33m[${t('sshClientPressEnterReconnect')}]\x1b[0m`)
        return
      }
    })
    return () => {
      offData()
      offExit()
    }
  }, [t])

  useEffect(() => {
    const terms = termsRef.current
    const tabsSnapshot = tabsRef
    return () => {
      for (const [tabId, rt] of terms) {
        if (rt.shellSessionId) void window.api.ssh.stopShell(rt.shellSessionId)
        try {
          rt.term.dispose()
        } catch {
          // ignore
        }
        terms.delete(tabId)
      }
      const nodeIds = new Set(tabsSnapshot.current.map((tab) => tab.nodeId))
      for (const nodeId of nodeIds) void window.api.ssh.sftpDisconnect(nodeId)
    }
  }, [])

  const bootTerminal = useCallback(
    async (tab: SessionTab): Promise<void> => {
      const host = termHostsRef.current.get(tab.id)
      if (!host) return
      if (termsRef.current.has(tab.id)) {
        const existing = termsRef.current.get(tab.id)!
        existing.fit.fit()
        if (existing.shellSessionId) {
          await window.api.ssh.resizeShell(
            existing.shellSessionId,
            existing.term.cols,
            existing.term.rows
          )
        }
        existing.term.focus()
        return
      }

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Consolas, "Courier New", monospace'
      })
      applyTermTheme(term, themeResolved)
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)
      fit.fit()
      const rt: TermRuntime = { term, fit, shellSessionId: null }
      termsRef.current.set(tab.id, rt)

      term.onSelectionChange(() => {
        const text = term.getSelection()
        if (!text) return
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            if (copyToastTimerRef.current) clearTimeout(copyToastTimerRef.current)
            copyToastTimerRef.current = setTimeout(() => {
              notifyCopiedRef.current()
            }, 280)
          })
          .catch(() => {})
      })
      term.onData((data) => {
        const cur = termsRef.current.get(tab.id)
        if (!cur) return
        if (cur.shellSessionId) {
          void window.api.ssh.writeShell(cur.shellSessionId, toBase64(data))
          return
        }
        if (connectingTabsRef.current.has(tab.id)) return
        if (data === '\r' || data === '\n') {
          void connectShellRef.current(tab.id, true)
        }
      })
      term.onResize(({ cols, rows }) => {
        const sid = termsRef.current.get(tab.id)?.shellSessionId
        if (sid) void window.api.ssh.resizeShell(sid, cols, rows)
      })

      await connectShellRef.current(tab.id, false)
    },
    [themeResolved]
  )

  useEffect(() => {
    if (!activeTab) return
    const id = window.requestAnimationFrame(() => {
      void bootTerminal(activeTab)
    })
    return () => window.cancelAnimationFrame(id)
  }, [activeTab, bootTerminal])

  useEffect(() => {
    // Defer so ThemeProvider's data-theme (CSS vars) is applied first
    const id = window.setTimeout(() => {
      for (const rt of termsRef.current.values()) applyTermTheme(rt.term, themeResolved)
    }, 0)
    return () => window.clearTimeout(id)
  }, [themeResolved])

  useEffect(() => {
    const onResize = (): void => {
      if (!active || !activeTabId) return
      const rt = termsRef.current.get(activeTabId)
      if (!rt) return
      rt.fit.fit()
      if (rt.shellSessionId) {
        void window.api.ssh.resizeShell(rt.shellSessionId, rt.term.cols, rt.term.rows)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [active, activeTabId])

  useEffect(() => {
    if (!active || !activeTabId) return
    const id = window.requestAnimationFrame(() => {
      const rt = termsRef.current.get(activeTabId)
      if (!rt) return
      rt.fit.fit()
      if (rt.shellSessionId) {
        void window.api.ssh.resizeShell(rt.shellSessionId, rt.term.cols, rt.term.rows)
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [active, activeTabId])

  const loadDir = useCallback(
    async (tabId: string, nodeId: string, path: string) => {
      const seq = (loadDirSeqRef.current.get(tabId) ?? 0) + 1
      loadDirSeqRef.current.set(tabId, seq)
      setFilesLoading(true)
      try {
        const list = await window.api.ssh.sftpList(nodeId, path)
        if (loadDirSeqRef.current.get(tabId) !== seq) return
        setEntriesByTab((prev) => ({
          ...prev,
          [tabId]: list.filter((e) => e.name !== '.' && e.name !== '..')
        }))
        setTabs((prev) =>
          prev.map((tab) => (tab.id === tabId ? { ...tab, remotePath: path } : tab))
        )
      } catch (err) {
        if (loadDirSeqRef.current.get(tabId) !== seq) return
        message.error(mapSshError(err, t))
      } finally {
        if (loadDirSeqRef.current.get(tabId) === seq) setFilesLoading(false)
      }
    },
    [message, t]
  )

  const openOrFocusTab = useCallback((node: SshNodeView, forceNew = false) => {
    if (!forceNew) {
      const existing = tabsRef.current.find((tab) => tab.nodeId === node.id)
      if (existing) {
        setActiveTabId(existing.id)
        setMaximized(null)
        return
      }
    }
    const tab: SessionTab = {
      id: newTabId(),
      nodeId: node.id,
      title: node.name,
      subtitle: `${node.username}@${node.host}:${node.port}`,
      shellSessionId: null,
      filesOpen: false,
      remotePath: '/',
      connecting: true
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setMaximized(null)
  }, [])

  const requestCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab) return
      const list = editorsRef.current[tabId] ?? []
      const dirty = list.some((e) => e.content !== e.original)
      if (tab.shellSessionId || tab.connecting || dirty) {
        modal.confirm({
          title: dirty ? t('sshClientEditUnsaved') : t('sshClientCloseTab'),
          content: dirty
            ? t('sshClientEditDiscardAllConfirm', { name: tab.title })
            : t('sshClientCloseTabConfirm', { name: tab.title }),
          okText: dirty ? t('sshClientEditDiscard') : t('sshClientClose'),
          cancelText: t('sshCancel'),
          okButtonProps: dirty ? { danger: true } : undefined,
          onOk: () => closeTab(tabId)
        })
        return
      }
      void closeTab(tabId)
    },
    [modal, t, closeTab]
  )

  const openFiles = useCallback(() => {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((tab) => (tab.id === activeTab.id ? { ...tab, filesOpen: true } : tab))
    )
    setMaximized((m) => (m === 'console' ? null : m))
    void loadDir(activeTab.id, activeTab.nodeId, activeTab.remotePath || '/')
  }, [activeTab, loadDir])

  const closeFiles = useCallback(async () => {
    if (!activeTab) return
    const tabId = activeTab.id
    const nodeId = activeTab.nodeId
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, filesOpen: false } : tab)))
    if (maximized === 'files') setMaximized(null)
    const othersOpen = tabsRef.current.some(
      (tab) => tab.id !== tabId && tab.nodeId === nodeId && tab.filesOpen
    )
    if (!othersOpen) await window.api.ssh.sftpDisconnect(nodeId)
  }, [activeTab, maximized])

  const editorHeightRef = useRef(editorHeight)
  useEffect(() => {
    editorHeightRef.current = editorHeight
  }, [editorHeight])

  const fitActiveTerm = useCallback(() => {
    if (!activeTabId) return
    const rt = termsRef.current.get(activeTabId)
    if (!rt) return
    rt.fit.fit()
    if (rt.shellSessionId) {
      void window.api.ssh.resizeShell(rt.shellSessionId, rt.term.cols, rt.term.rows)
    }
  }, [activeTabId])

  const patchEditor = useCallback(
    (tabId: string, path: string, patch: Partial<SshFileEditorState>): void => {
      setEditorsByTab((prev) => {
        const list = prev[tabId]
        if (!list) return prev
        return {
          ...prev,
          [tabId]: list.map((e) => (e.path === path ? { ...e, ...patch } : e))
        }
      })
    },
    []
  )

  const updateEditorContent = useCallback(
    (tabId: string, path: string, content: string): void => {
      setEditorsByTab((prev) => {
        const list = prev[tabId]
        if (!list) return prev
        return { ...prev, [tabId]: list.map((e) => (e.path === path ? { ...e, content } : e)) }
      })
    },
    []
  )

  const focusEditor = useCallback((tabId: string, path: string): void => {
    setActiveEditorPathByTab((prev) => ({ ...prev, [tabId]: path }))
  }, [])

  const confirmCloseEditor = useCallback(
    (tabId: string, path: string): Promise<boolean> =>
      new Promise((resolve) => {
        const ed = (editorsRef.current[tabId] ?? []).find((e) => e.path === path)
        if (!ed || ed.content === ed.original) {
          resolve(true)
          return
        }
        modal.confirm({
          title: t('sshClientEditUnsaved'),
          content: t('sshClientEditDiscardConfirm', { name: ed.name }),
          okText: t('sshClientEditDiscard'),
          cancelText: t('sshCancel'),
          okButtonProps: { danger: true },
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        })
      }),
    [modal, t]
  )

  const confirmDiscardAllEditors = useCallback(
    (tabId: string): Promise<boolean> =>
      new Promise((resolve) => {
        const list = editorsRef.current[tabId] ?? []
        if (!list.some((e) => e.content !== e.original)) {
          resolve(true)
          return
        }
        modal.confirm({
          title: t('sshClientEditUnsaved'),
          content: t('sshClientEditDiscardAllConfirm'),
          okText: t('sshClientEditDiscard'),
          cancelText: t('sshCancel'),
          okButtonProps: { danger: true },
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        })
      }),
    [modal, t]
  )

  const openFileEditor = useCallback(
    async (entry: SshSftpEntry): Promise<void> => {
      if (!activeTab || entry.type !== 'file') return
      const tabId = activeTab.id
      const nodeId = activeTab.nodeId
      const list = editorsRef.current[tabId] ?? []
      const existing = list.find((e) => e.path === entry.path)
      if (existing) {
        if (!existing.loading) focusEditor(tabId, entry.path)
        return
      }
      if (maximized === 'files') setMaximized('console')
      const init: SshFileEditorState = {
        tabId,
        nodeId,
        path: entry.path,
        name: entry.name,
        content: '',
        original: '',
        binary: false,
        size: entry.size,
        loading: true,
        saving: false
      }
      editorsRef.current = { ...editorsRef.current, [tabId]: [...list, init] }
      setEditorsByTab((prev) => ({ ...prev, [tabId]: [...(prev[tabId] ?? []), init] }))
      focusEditor(tabId, entry.path)
      try {
        const res = await window.api.ssh.sftpReadFile(nodeId, entry.path)
        if (!(editorsRef.current[tabId] ?? []).some((e) => e.path === entry.path)) return
        if (res.ok && res.binary) {
          patchEditor(tabId, entry.path, { binary: true, loading: false })
        } else if (res.ok) {
          patchEditor(tabId, entry.path, {
            binary: false,
            loading: false,
            content: res.content ?? '',
            original: res.content ?? ''
          })
        } else if (res.error === 'FILE_TOO_LARGE') {
          patchEditor(tabId, entry.path, {
            loading: false,
            error: t('sshClientEditTooLargeSize', {
              size: formatSize(res.size ?? 0),
              max: formatSize(res.maxBytes ?? 0)
            })
          })
        } else {
          patchEditor(tabId, entry.path, { loading: false, error: mapSshError(res.error ?? '', t) })
        }
      } catch (err) {
        if (!(editorsRef.current[tabId] ?? []).some((e) => e.path === entry.path)) return
        patchEditor(tabId, entry.path, { loading: false, error: mapSshError(err, t) })
      }
    },
    [activeTab, focusEditor, maximized, patchEditor, t]
  )

  const saveFileEditor = useCallback(
    async (tabId: string, path: string): Promise<void> => {
      const ed = (editorsRef.current[tabId] ?? []).find((e) => e.path === path)
      if (!ed || ed.binary || ed.loading || ed.saving || ed.content === ed.original) return
      patchEditor(tabId, path, { saving: true })
      try {
        const res = await window.api.ssh.sftpWriteFile(ed.nodeId, ed.path, ed.content)
        if (!res.ok) {
          patchEditor(tabId, path, { saving: false })
          message.error(mapSshError(res.error ?? '', t))
          return
        }
        patchEditor(tabId, path, { saving: false, original: ed.content })
        message.success(t('sshClientEditSaved'))
        const tab = tabsRef.current.find((item) => item.id === tabId)
        if (tab) void loadDir(tabId, tab.nodeId, tab.remotePath || '/')
      } catch (err) {
        patchEditor(tabId, path, { saving: false })
        message.error(mapSshError(err, t))
      }
    },
    [loadDir, message, patchEditor, t]
  )

  const closeFileEditor = useCallback(
    async (tabId: string, path: string): Promise<void> => {
      if (!(await confirmCloseEditor(tabId, path))) return
      const list = editorsRef.current[tabId] ?? []
      const idx = list.findIndex((e) => e.path === path)
      setEditorsByTab((prev) => {
        const cur = (prev[tabId] ?? []).filter((e) => e.path !== path)
        const next = { ...prev }
        if (cur.length) next[tabId] = cur
        else delete next[tabId]
        return next
      })
      setActiveEditorPathByTab((prev) => {
        if (prev[tabId] !== path) return prev
        const remaining = list.filter((e) => e.path !== path)
        const neighbor = remaining[idx] ?? remaining[idx - 1] ?? remaining[0]
        const next = { ...prev }
        if (neighbor) next[tabId] = neighbor.path
        else delete next[tabId]
        return next
      })
    },
    [confirmCloseEditor]
  )

  const closeEditorPanel = useCallback(
    async (tabId: string): Promise<void> => {
      if (!(await confirmDiscardAllEditors(tabId))) return
      setEditorsByTab((prev) => {
        const next = { ...prev }
        delete next[tabId]
        return next
      })
      setActiveEditorPathByTab((prev) => {
        const next = { ...prev }
        delete next[tabId]
        return next
      })
    },
    [confirmDiscardAllEditors]
  )

  const handleEditorDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const container = consoleHostRef.current
      if (!container) return
      e.preventDefault()
      const startY = e.clientY
      const startH = editorHeightRef.current
      const containerH = container.clientHeight
      const onMove = (ev: PointerEvent): void => {
        const next = startH - (ev.clientY - startY)
        const min = 120
        const max = Math.max(min + 60, containerH - 120)
        setEditorHeight(Math.min(max, Math.max(min, next)))
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        fitActiveTerm()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [fitActiveTerm]
  )

  const handleTest = useCallback(
    async (node: SshNodeView) => {
      setTestingId(node.id)
      try {
        const res = await window.api.ssh.test(node.id)
        if (res.ok) message.success(t('sshTestOk', { ms: res.latencyMs }))
        else message.error(mapSshError(res.error ?? '', t))
      } catch {
        message.error(t('sshTestFail', { msg: '' }))
      } finally {
        setTestingId(null)
      }
    },
    [message, t]
  )

  const handleDeleteNode = useCallback(
    (node: SshNodeView) => {
      modal.confirm({
        title: t('sshDelete'),
        content: t('sshDeleteNodeConfirm', { name: node.name }),
        okText: t('sshDelete'),
        cancelText: t('sshCancel'),
        onOk: async () => {
          const related = tabsRef.current.filter((tab) => tab.nodeId === node.id)
          for (const tab of related) await closeTab(tab.id)
          await window.api.ssh.deleteNode(node.id)
          setNodes((prev) => prev.filter((n) => n.id !== node.id))
          message.success(t('sshDeleted'))
        }
      })
    },
    [modal, message, t, closeTab]
  )

  const handleDownload = useCallback(
    async (entry: SshSftpEntry) => {
      if (!activeTab) return
      setDownloadingPath(entry.path)
      try {
        if (entry.type === 'directory') {
          const res = await window.api.ssh.sftpDownloadDir(activeTab.nodeId, entry.path)
          if (res.canceled) return
          if (res.ok) message.success(t('sshClientDownloadDirOk', { count: res.count ?? 0 }))
          else message.error(mapSshError(res.error ?? '', t))
        } else {
          const res = await window.api.ssh.sftpDownload(activeTab.nodeId, entry.path)
          if (res.canceled) return
          if (res.ok) message.success(t('sshClientDownloadOk'))
          else message.error(mapSshError(res.error ?? '', t))
        }
      } catch (err) {
        message.error(mapSshError(err, t))
      } finally {
        setDownloadingPath(null)
      }
    },
    [activeTab, message, t]
  )

  const handleUpload = useCallback(async () => {
    if (!activeTab) return
    setUploading(true)
    try {
      const res = await window.api.ssh.sftpUpload(activeTab.nodeId, activeTab.remotePath || '/')
      if (res.canceled) return
      if (res.ok) {
        message.success(t('sshClientUploadOk', { count: res.count ?? 0 }))
        void loadDir(activeTab.id, activeTab.nodeId, activeTab.remotePath || '/')
      } else message.error(mapSshError(res.error ?? '', t))
    } catch (err) {
      message.error(mapSshError(err, t))
    } finally {
      setUploading(false)
    }
  }, [activeTab, loadDir, message, t])

  const submitCreate = useCallback(async () => {
    if (!activeTab || !createOpen) return
    const name = createName.trim()
    if (!name || name.includes('/') || name.includes('\\')) {
      message.error(t('sshClientInvalidName'))
      return
    }
    const remotePath = posixJoin(activeTab.remotePath || '/', name)
    try {
      const res =
        createOpen === 'dir'
          ? await window.api.ssh.sftpMkdir(activeTab.nodeId, remotePath)
          : await window.api.ssh.sftpWriteFile(activeTab.nodeId, remotePath, '')
      if (!res.ok) {
        message.error(mapSshError(res.error ?? '', t))
        return
      }
      message.success(createOpen === 'dir' ? t('sshClientMkdirOk') : t('sshClientNewFileOk'))
      setCreateOpen(null)
      setCreateName('')
      void loadDir(activeTab.id, activeTab.nodeId, activeTab.remotePath || '/')
    } catch (err) {
      message.error(mapSshError(err, t))
    }
  }, [activeTab, createOpen, createName, loadDir, message, t])

  const createMenu: MenuProps['items'] = [
    {
      key: 'file',
      icon: <FileAddOutlined />,
      label: t('sshClientNewFile'),
      onClick: () => {
        setCreateName('')
        setCreateOpen('file')
      }
    },
    {
      key: 'dir',
      icon: <FolderAddOutlined />,
      label: t('sshClientNewFolder'),
      onClick: () => {
        setCreateName('')
        setCreateOpen('dir')
      }
    }
  ]

  const filesOpen = !!activeTab?.filesOpen
  const showSidebar = maximized === null
  const showConsole = maximized !== 'files'
  const showFiles = filesOpen && maximized !== 'console'
  const entries = activeTab ? (entriesByTab[activeTab.id] ?? []) : []
  const crumbs = pathSegments(activeTab?.remotePath || '/')
  const tabEditors = activeTab ? (editorsByTab[activeTab.id] ?? []) : []
  const activeEditor = activeTab
    ? (tabEditors.find((e) => e.path === activeEditorPathByTab[activeTab.id]) ??
      tabEditors[0] ??
      null)
    : null
  const activeEditorDirty = activeEditor
    ? activeEditor.content !== activeEditor.original
    : false
  const hasActiveEditor = tabEditors.length > 0

  useEffect(() => {
    if (!active || !activeTabId) return
    const id = window.requestAnimationFrame(fitActiveTerm)
    return () => window.cancelAnimationFrame(id)
  }, [active, activeTabId, hasActiveEditor, fitActiveTerm])

  return (
    <div
      className={`ssh-client-page relative flex flex-1 min-h-0 overflow-hidden${active ? '' : ' hidden'}`}
      aria-hidden={!active}
    >
      {copyTipVisible && (
        <div className="ssh-client-copy-hint pointer-events-none absolute right-3 bottom-3 z-50">
          {t('sshClientCopied')}
        </div>
      )}
      {showSidebar && (
        <aside
          className={`shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface)] flex flex-col min-h-0 transition-[width] duration-150 ${
            sidebarCollapsed ? 'w-12' : 'w-60'
          }`}
        >
          <div className="h-10 shrink-0 flex items-center gap-2 px-2 border-b border-[var(--border-subtle)]">
            <button
              type="button"
              className={BTN_ICON}
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? t('sshClientExpandSidebar') : t('sshClientCollapseSidebar')}
            >
              {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
            {!sidebarCollapsed && (
              <>
                <span className="text-xs font-semibold text-[var(--text-primary)] flex-1 truncate">
                  {t('sshClientNodes')}
                </span>
                <button
                  type="button"
                  className={BTN_ICON}
                  title={t('sshAddNode')}
                  onClick={() => {
                    setEditing(null)
                    setEditorOpen(true)
                  }}
                >
                  <PlusOutlined />
                </button>
              </>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {nodes.length === 0 ? (
              !sidebarCollapsed && (
                <Empty
                  description={t('sshNoNodes')}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  className="py-8 px-2"
                >
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditing(null)
                      setEditorOpen(true)
                    }}
                  >
                    {t('sshAddNode')}
                  </Button>
                </Empty>
              )
            ) : (
              <SortableList
                items={nodes}
                onReorder={persistNodeOrder}
                className="py-2 px-1.5 flex flex-col gap-1.5"
              >
                {(node, api) => {
                  const selected = activeTab?.nodeId === node.id
                  const testing = testingId === node.id
                  if (sidebarCollapsed) {
                    return (
                      <div
                        ref={api.setNodeRef}
                        style={api.style}
                        className="mx-auto w-8 h-8"
                      >
                        <Tooltip title={node.name} placement="right">
                          <button
                            type="button"
                            ref={api.setActivatorNodeRef}
                            {...api.attributes}
                            {...api.listeners}
                            onClick={() => openOrFocusTab(node)}
                            className={`w-8 h-8 flex items-center justify-center rounded-md cursor-grab active:cursor-grabbing border border-dashed ${
                              selected
                                ? 'border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent)]'
                                : 'border-[var(--border-subtle)] bg-[var(--bg-warm)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]/40'
                            }`}
                          >
                            <CloudServerOutlined />
                          </button>
                        </Tooltip>
                      </div>
                    )
                  }
                  return (
                    <div
                      ref={api.setNodeRef}
                      style={api.style}
                      className={`group rounded-lg px-2.5 py-2 cursor-pointer border border-dashed transition-colors ${
                        selected
                          ? 'border-[var(--accent)]/45 bg-[var(--accent)]/10'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-warm)] hover:border-[var(--text-secondary)]/35 hover:bg-[var(--bg-warm)]'
                      }${api.isDragging ? ' shadow-sm !bg-transparent' : ''}`}
                      onClick={() => openOrFocusTab(node)}
                      onDoubleClick={() => openOrFocusTab(node, true)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          ref={api.setActivatorNodeRef}
                          {...api.attributes}
                          {...api.listeners}
                          title={t('sshReorderNode')}
                          className={
                            'shrink-0 inline-flex items-center justify-center border-none bg-transparent ' +
                            'text-[var(--text-secondary)] cursor-grab active:cursor-grabbing px-0.5 -ml-1 ' +
                            'hover:text-[var(--text-primary)]'
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <HolderOutlined />
                        </button>
                        <CloudServerOutlined
                          className={`shrink-0 ${selected ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--text-primary)] truncate leading-tight">
                            {node.name}
                          </div>
                          <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate leading-tight mt-0.5">
                            {node.username}@{node.host}:{node.port}
                          </div>
                          {node.jumpHostId && (
                            <div className="text-[10px] text-[var(--text-secondary)] truncate leading-tight mt-0.5">
                              via{' '}
                              {nodes.find((n) => n.id === node.jumpHostId)?.name ??
                                t('sshJumpHost')}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] transition-[grid-template-rows] duration-150 ease-out">
                        <div className="overflow-hidden min-h-0">
                          <div className="flex items-center justify-end gap-0.5 pt-1.5">
                            <button
                              type="button"
                              className={BTN_ICON}
                              title={t('sshTest')}
                              disabled={testing}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleTest(node)
                              }}
                            >
                              {testing ? <LoadingOutlined /> : <ApiOutlined />}
                            </button>
                            <button
                              type="button"
                              className={BTN_ICON}
                              title={t('sshClientNewSession')}
                              onClick={(e) => {
                                e.stopPropagation()
                                openOrFocusTab(node, true)
                              }}
                            >
                              <CodeOutlined />
                            </button>
                            <button
                              type="button"
                              className={BTN_ICON}
                              title={t('sshEdit')}
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditing(node)
                                setEditorOpen(true)
                              }}
                            >
                              <EditOutlined />
                            </button>
                            <button
                              type="button"
                              className={BTN_ICON}
                              title={t('sshDelete')}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteNode(node)
                              }}
                            >
                              <DeleteOutlined />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }}
              </SortableList>
            )}
          </div>
        </aside>
      )}

      <section className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-[var(--content-bg)]">
        {tabs.length > 0 && (
          <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-subtle)] overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTabId(tab.id)
                    setMaximized(null)
                  }}
                  className={`shrink-0 h-8 pl-3 pr-1.5 rounded-lg text-xs flex items-center gap-1.5 border cursor-pointer transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'bg-[var(--bg-warm)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'
                  }`}
                >
                  <span className="max-w-[140px] truncate">{tab.title}</span>
                  {tab.connecting && <LoadingOutlined className="text-[10px]" />}
                  <span
                    role="button"
                    tabIndex={0}
                    className={`h-5 w-5 rounded flex items-center justify-center ${
                      active ? 'hover:bg-white/20' : 'hover:bg-[var(--border-subtle)]'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      requestCloseTab(tab.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        requestCloseTab(tab.id)
                      }
                    }}
                  >
                    <CloseOutlined className="text-[10px]" />
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {!activeTab ? (
          <div className="flex-1 flex items-center justify-center">
            <Empty
              description={t('sshClientEmptyWorkspace')}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="shrink-0 flex min-w-0">
              {showConsole && (
                <div
                  className={`${TITLE_BAR_CLS} ${showFiles ? 'flex-1 min-w-0 border-r border-[var(--border-subtle)]' : 'flex-1 min-w-0'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {activeTab.title}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                      {activeTab.subtitle}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={filesOpen ? BTN_TEXT_ACTIVE : BTN_TEXT}
                    onClick={() => (filesOpen ? void closeFiles() : openFiles())}
                    title={t('sshClientFiles')}
                  >
                    <FolderOpenOutlined />
                    {t('sshClientFiles')}
                  </button>
                  <button
                    type="button"
                    className={BTN_ICON}
                    title={
                      maximized === 'console'
                        ? t('sshClientExitFullscreen')
                        : t('sshClientFullscreen')
                    }
                    onClick={() => setMaximized((m) => (m === 'console' ? null : 'console'))}
                  >
                    {maximized === 'console' ? <CompressOutlined /> : <ExpandOutlined />}
                  </button>
                  <button
                    type="button"
                    className={BTN_ICON}
                    title={t('sshClientClose')}
                    onClick={() => requestCloseTab(activeTab.id)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              )}
              {showFiles && (
                <div
                  className={`${TITLE_BAR_CLS} ${maximized === 'files' ? 'flex-1' : 'w-[380px] shrink-0'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {t('sshClientFiles')}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                      {activeTab.title}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={BTN_TEXT}
                    disabled={uploading}
                    onClick={() => void handleUpload()}
                    title={t('sshClientUpload')}
                  >
                    {uploading ? <LoadingOutlined /> : <UploadOutlined />}
                    {t('sshClientUpload')}
                  </button>
                  <Dropdown menu={{ items: createMenu }} trigger={['click']}>
                    <button type="button" className={BTN_TEXT} title={t('sshClientNew')}>
                      <PlusOutlined />
                      {t('sshClientNew')}
                    </button>
                  </Dropdown>
                  <button
                    type="button"
                    className={BTN_ICON}
                    title={
                      maximized === 'files'
                        ? t('sshClientExitFullscreen')
                        : t('sshClientFullscreen')
                    }
                    onClick={() => setMaximized((m) => (m === 'files' ? null : 'files'))}
                  >
                    {maximized === 'files' ? <CompressOutlined /> : <ExpandOutlined />}
                  </button>
                  <button
                    type="button"
                    className={BTN_ICON}
                    title={t('sshClientClose')}
                    onClick={() => void closeFiles()}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
              {showConsole && (
                <div
                  ref={consoleHostRef}
                  className={`min-w-0 min-h-0 flex flex-col bg-[var(--bg-warm)] ${
                    showFiles ? 'flex-1 border-r border-[var(--border-subtle)]' : 'flex-1'
                  }`}
                >
                  <div className="relative flex-1 min-h-0">
                    {tabs.map((tab) => (
                      <div
                        key={tab.id}
                        className="absolute inset-0 p-1"
                        style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
                      >
                        <div
                          ref={(el) => {
                            if (el) termHostsRef.current.set(tab.id, el)
                            else termHostsRef.current.delete(tab.id)
                          }}
                          className="h-full w-full min-h-0 overflow-hidden bg-[var(--bg-warm)]"
                        />
                      </div>
                    ))}
                  </div>
                  {activeEditor && (
                    <>
                      <div
                        className="shrink-0 h-2 flex items-center justify-center cursor-row-resize text-[var(--text-secondary)] hover:bg-[var(--accent)]/15 active:bg-[var(--accent)]/25"
                        title={t('sshClientEditResize')}
                        onPointerDown={handleEditorDividerPointerDown}
                      >
                        <HolderOutlined className="text-[10px]" />
                      </div>
                      <div
                        className="shrink-0 flex flex-col min-h-0 bg-[var(--surface)] border-t border-[var(--border-subtle)]"
                        style={{ height: editorHeight }}
                      >
                        <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--border-subtle)] bg-[var(--bg-warm)]">
                          <FileTextOutlined className="shrink-0 text-[var(--text-secondary)] mr-0.5" />
                          <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto">
                            {tabEditors.map((ed) => {
                              const isActive = activeEditor?.path === ed.path
                              const edDirty = ed.content !== ed.original
                              return (
                                <div
                                  key={ed.path}
                                  title={ed.path}
                                  className={`shrink-0 h-7 pl-2.5 pr-1.5 rounded-lg text-xs flex items-center gap-1.5 border cursor-pointer transition-colors ${
                                    isActive
                                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                                      : 'bg-[var(--surface)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'
                                  }`}
                                  onClick={() => focusEditor(activeTab.id, ed.path)}
                                >
                                  {ed.loading ? (
                                    <LoadingOutlined className="text-[10px]" />
                                  ) : (
                                    <FileTextOutlined className="text-[10px]" />
                                  )}
                                  <span className="max-w-[140px] truncate">{ed.name}</span>
                                  {edDirty && (
                                    <span
                                      className="w-1.5 h-1.5 rounded-full shrink-0"
                                      style={{
                                        background: isActive
                                          ? 'rgba(255,255,255,0.85)'
                                          : 'var(--accent)'
                                      }}
                                    />
                                  )}
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className={`h-4 w-4 rounded flex items-center justify-center ${
                                      isActive ? 'hover:bg-white/20' : 'hover:bg-[var(--border-subtle)]'
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void closeFileEditor(activeTab.id, ed.path)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.stopPropagation()
                                        void closeFileEditor(activeTab.id, ed.path)
                                      }
                                    }}
                                  >
                                    <CloseOutlined className="text-[9px]" />
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                          <button
                            type="button"
                            className={BTN_TEXT}
                            disabled={activeEditor.saving || !activeEditorDirty}
                            title={t('sshClientEditSaveHint')}
                            onClick={() => void saveFileEditor(activeEditor.tabId, activeEditor.path)}
                          >
                            {activeEditor.saving ? <LoadingOutlined /> : <SaveOutlined />}
                            {t('sshClientEditSave')}
                          </button>
                          <button
                            type="button"
                            className={BTN_ICON}
                            title={t('sshClientClose')}
                            onClick={() => void closeEditorPanel(activeEditor.tabId)}
                          >
                            <CloseOutlined />
                          </button>
                        </div>
                        <div className="flex-1 min-h-0">
                          {activeEditor.loading ? (
                            <div className="h-full flex items-center justify-center">
                              <Spin />
                            </div>
                          ) : activeEditor.binary ? (
                            <div className="h-full flex items-center justify-center px-6">
                              <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={t('sshClientEditBinary')}
                              />
                            </div>
                          ) : activeEditor.error ? (
                            <div className="h-full flex items-center justify-center px-6">
                              <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={activeEditor.error}
                              />
                            </div>
                          ) : (
                            <Editor
                              height="100%"
                              language={extToLang(activeEditor.name)}
                              value={activeEditor.content}
                              theme={themeResolved === 'dark' ? 'vs-dark' : 'light'}
                              loading={<Spin />}
                              options={{
                                fontSize: 13,
                                minimap: { enabled: false },
                                wordWrap: 'off',
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                tabSize: 2,
                                renderWhitespace: 'none'
                              }}
                              onChange={(value) => {
                                if (!activeEditor) return
                                updateEditorContent(activeEditor.tabId, activeEditor.path, value ?? '')
                              }}
                              onMount={(editor, monaco) => {
                                editor.addCommand(
                                  monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                                  () => {
                                    if (!activeEditor) return
                                    void saveFileEditor(activeEditor.tabId, activeEditor.path)
                                  }
                                )
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {showFiles && (
                <div
                  className={`min-h-0 flex flex-col bg-[var(--content-bg)] ${
                    maximized === 'files' ? 'flex-1' : 'w-[380px] shrink-0'
                  }`}
                >
                  <div className="shrink-0 px-3 py-2 border-b border-[var(--border-subtle)] flex items-center gap-2">
                    <HomeOutlined className="text-[var(--text-secondary)]" />
                    <Breadcrumb
                      className="flex-1 min-w-0"
                      items={crumbs.map((c) => ({
                        title: (
                          <button
                            type="button"
                            className="bg-transparent border-none p-0 cursor-pointer text-[var(--text-primary)] hover:text-[var(--accent)]"
                            onClick={() => void loadDir(activeTab.id, activeTab.nodeId, c.path)}
                          >
                            {c.name}
                          </button>
                        )
                      }))}
                    />
                    <button
                      type="button"
                      className={BTN_ICON}
                      title={t('sshClientRefresh')}
                      disabled={filesLoading}
                      onClick={() =>
                        void loadDir(activeTab.id, activeTab.nodeId, activeTab.remotePath || '/')
                      }
                    >
                      {filesLoading ? <LoadingOutlined /> : <ReloadOutlined />}
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <Spin spinning={filesLoading} className="min-h-full">
                      <Table
                        size="small"
                        pagination={false}
                        rowKey="path"
                        dataSource={entries}
                        locale={{ emptyText: t('sshClientDirEmpty') }}
                        onRow={(record) => ({
                          onDoubleClick: () => {
                            if (record.type === 'directory') {
                              void loadDir(activeTab.id, activeTab.nodeId, record.path)
                            } else {
                              void openFileEditor(record)
                            }
                          }
                        })}
                        columns={[
                          {
                            title: t('sshClientColName'),
                            dataIndex: 'name',
                            ellipsis: true,
                            render: (_: string, row: SshSftpEntry) => (
                              <button
                                type="button"
                                className="bg-transparent border-none p-0 cursor-pointer flex items-center gap-1.5 text-left text-[var(--text-primary)] hover:text-[var(--accent)] max-w-full"
                                onClick={() => {
                                  if (row.type === 'directory') {
                                    void loadDir(activeTab.id, activeTab.nodeId, row.path)
                                  } else {
                                    void openFileEditor(row)
                                  }
                                }}
                              >
                                {row.type === 'directory' ? (
                                  <FolderOutlined />
                                ) : row.type === 'symlink' ? (
                                  <LinkOutlined />
                                ) : (
                                  <FileOutlined />
                                )}
                                <span className="font-mono text-xs truncate">{row.name}</span>
                              </button>
                            )
                          },
                          {
                            title: t('sshClientColSize'),
                            dataIndex: 'size',
                            width: 72,
                            render: (size: number, row: SshSftpEntry) =>
                              row.type === 'directory' ? '-' : formatSize(size)
                          },
                          {
                            title: '',
                            width: 40,
                            render: (_: unknown, row: SshSftpEntry) => (
                              <button
                                type="button"
                                className={BTN_ICON}
                                disabled={row.type !== 'file'}
                                title={t('sshClientEdit')}
                                onClick={() => void openFileEditor(row)}
                              >
                                <FileTextOutlined />
                              </button>
                            )
                          },
                          {
                            title: '',
                            width: 40,
                            render: (_: unknown, row: SshSftpEntry) => (
                              <button
                                type="button"
                                className={BTN_ICON}
                                disabled={downloadingPath === row.path}
                                title={
                                  row.type === 'directory'
                                    ? t('sshClientDownloadDir')
                                    : t('sshClientDownloadFile')
                                }
                                onClick={() => void handleDownload(row)}
                              >
                                {downloadingPath === row.path ? (
                                  <LoadingOutlined />
                                ) : (
                                  <DownloadOutlined />
                                )}
                              </button>
                            )
                          }
                        ]}
                      />
                    </Spin>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <NodeEditor
        open={editorOpen}
        editing={editing}
        nodes={nodes}
        onCancel={() => setEditorOpen(false)}
        onSaved={(node) => {
          setNodes((prev) => {
            const idx = prev.findIndex((n) => n.id === node.id)
            if (idx === -1) return [...prev, node]
            const next = [...prev]
            next[idx] = node
            return next
          })
          setTabs((prev) =>
            prev.map((tab) =>
              tab.nodeId === node.id
                ? {
                    ...tab,
                    title: node.name,
                    subtitle: `${node.username}@${node.host}:${node.port}`
                  }
                : tab
            )
          )
          setEditorOpen(false)
        }}
      />

      <Modal
        open={!!createOpen}
        title={createOpen === 'dir' ? t('sshClientNewFolder') : t('sshClientNewFile')}
        onCancel={() => {
          setCreateOpen(null)
          setCreateName('')
        }}
        onOk={() => void submitCreate()}
        okText={t('sshSave')}
        cancelText={t('sshCancel')}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={createName}
          placeholder={createOpen === 'dir' ? 'new-folder' : 'new-file.txt'}
          onChange={(e) => setCreateName(e.target.value)}
          onPressEnter={() => void submitCreate()}
        />
      </Modal>
    </div>
  )
}

export default SshClient
