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
import type { MenuProps, InputRef } from 'antd'
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
  FileTextOutlined,
  DashboardOutlined,
  SearchOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CopyOutlined,
  ClearOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  SnippetsOutlined,
  ToolOutlined,
  NodeIndexOutlined,
  StarOutlined,
  StarFilled,
  BookOutlined,
  ImportOutlined
} from '@ant-design/icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import SshFileEditor from '../components/SshFileEditor'
import SshSysInfoPanel from '../components/SshSysInfoPanel'
import CommandPanel from '../components/CommandPanel'
import ProcessPanel from '../components/ProcessPanel'
import ServicesPanel from '../components/ServicesPanel'
import LogTailPanel from '../components/LogTailPanel'
import PortsPanel from '../components/PortsPanel'
import { useTheme } from '../theme/ThemeProvider'
import { SortableList } from '../components/SortableList'

const BTN_ICON =
  'h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer ' +
  'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

const BTN_ICON_ACTIVE =
  'h-7 w-7 inline-flex items-center justify-center rounded-md border-none cursor-pointer ' +
  'bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25'

const BTN_TEXT =
  'h-7 px-2 inline-flex items-center gap-1 rounded-md text-xs border-none cursor-pointer ' +
  'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

const TITLE_BAR_CLS =
  'h-10 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--border-subtle)] bg-[var(--surface)]'

const FONT_MIN = 10
const FONT_MAX = 26
const DEFAULT_FONT = 13

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

type MaximizeMode = null | 'console' | 'files' | 'editor' | 'info' | 'tool'

type ToolPanelKey = 'commands' | 'process' | 'services' | 'logs' | 'ports'

interface SessionTab {
  id: string
  nodeId: string
  title: string
  subtitle: string
  shellSessionId: string | null
  filesOpen: boolean
  infoOpen: boolean
  toolOpen: ToolPanelKey | null
  remotePath: string
  connecting: boolean
  /** restored session — do not auto-connect the terminal until the user presses Enter */
  noAutoConnect?: boolean
}

interface TermRuntime {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
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
  const [infoByTab, setInfoByTab] = useState<Record<string, SshSysInfo | null>>({})
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [createOpen, setCreateOpen] = useState<'file' | 'dir' | null>(null)
  const [createName, setCreateName] = useState('')
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('ssh-bookmarks') || '[]') as string[]
      return Array.isArray(stored) ? stored : []
    } catch {
      return []
    }
  })
  const [dragOver, setDragOver] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importCandidates, setImportCandidates] = useState<SshConfigCandidate[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [importSelected, setImportSelected] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [copyTipVisible, setCopyTipVisible] = useState(false)

  const [editorsByTab, setEditorsByTab] = useState<Record<string, SshFileEditorState[]>>({})
  const [activeEditorPathByTab, setActiveEditorPathByTab] = useState<Record<string, string>>({})
  const [editorHeight, setEditorHeight] = useState(320)
  const [toolHeight, setToolHeight] = useState<number | null>(null)
  const toolHeightRef = useRef<number | null>(null)
  useEffect(() => {
    toolHeightRef.current = toolHeight
  }, [toolHeight])

  const [fontSize, setFontSize] = useState(() => {
    const stored = parseInt(localStorage.getItem('ssh-term-fontsize') || '', 10)
    return Number.isFinite(stored) ? Math.min(FONT_MAX, Math.max(FONT_MIN, stored)) : DEFAULT_FONT
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchMatch, setSearchMatch] = useState<{ index: number; count: number } | null>(null)
  const searchInputRef = useRef<InputRef>(null)
  const [copyEnabled, setCopyEnabled] = useState(false)

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
  const restoredRef = useRef(false)
  const skipAutoCopyRef = useRef(false)
  const activeRef = useRef(active)
  const termFocusedRef = useRef(false)
  const syncTermFocus = useCallback((): void => {
    window.api.app.setTermPasteFocus(Boolean(activeRef.current && termFocusedRef.current))
  }, [])

  useEffect(() => {
    activeRef.current = active
    syncTermFocus()
  }, [active, syncTermFocus])

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

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const savedRaw = localStorage.getItem('ssh-session-tabs')
    const id = window.setTimeout(() => {
      try {
        const saved = JSON.parse(savedRaw || '[]') as string[]
        const ids = Array.isArray(saved)
          ? saved.filter((x): x is string => typeof x === 'string')
          : []
        const valid = ids.filter((id) => nodes.some((n) => n.id === id))
        if (valid.length === 0) return
        const restored: SessionTab[] = valid.map((nodeId) => {
          const node = nodes.find((n) => n.id === nodeId)!
          return {
            id: newTabId(),
            nodeId,
            title: node.name,
            subtitle: `${node.username}@${node.host}:${node.port}`,
            shellSessionId: null,
            filesOpen: false,
            infoOpen: false,
            toolOpen: null,
            noAutoConnect: true,
            remotePath: '/',
            connecting: false
          }
        })
        setTabs(restored)
        setActiveTabId(restored[0]?.id ?? null)
      } catch {
        // ignore malformed storage
      }
    }, 0)
    return () => window.clearTimeout(id)
  }, [nodes])

  useEffect(() => {
    if (tabs.length === 0) {
      localStorage.removeItem('ssh-session-tabs')
      return
    }
    localStorage.setItem('ssh-session-tabs', JSON.stringify(tabs.map((t) => t.nodeId)))
  }, [tabs])

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
    termFocusedRef.current = false
    syncTermFocus()
  }, [syncTermFocus])

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
      if (tab.infoOpen) {
        const othersOpen = tabsRef.current.some(
          (item) => item.id !== tabId && item.nodeId === tab.nodeId && item.infoOpen
        )
        if (!othersOpen) await window.api.ssh.disconnectSysInfo(tab.nodeId)
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
      setInfoByTab((prev) => {
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
      termFocusedRef.current = false
      syncTermFocus()
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
      for (const nodeId of nodeIds) void window.api.ssh.disconnectSysInfo(nodeId)
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
        fontSize,
        fontFamily: 'Consolas, "Courier New", monospace',
        // Search decorations (used to report the match count) require the proposed API.
        allowProposedApi: true
      })
      applyTermTheme(term, themeResolved)
      const fit = new FitAddon()
      const search = new SearchAddon()
      term.loadAddon(fit)
      term.loadAddon(search)
      search.onDidChangeResults(({ resultIndex, resultCount }) => {
        setSearchMatch({ index: resultIndex, count: resultCount })
      })
      term.open(host)
      fit.fit()
      const rt: TermRuntime = { term, fit, search, shellSessionId: null }
      termsRef.current.set(tab.id, rt)

      const textarea = term.textarea
      if (textarea) {
        textarea.addEventListener('focus', () => {
          termFocusedRef.current = true
          syncTermFocus()
        })
        textarea.addEventListener('blur', () => {
          termFocusedRef.current = false
          syncTermFocus()
        })
      }

      term.onSelectionChange(() => {
        if (skipAutoCopyRef.current) return
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

      if (!tab.noAutoConnect) await connectShellRef.current(tab.id, false)
    },
    [fontSize, syncTermFocus, themeResolved]
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

  useEffect(() => {
    localStorage.setItem('ssh-term-fontsize', String(fontSize))
    for (const rt of termsRef.current.values()) {
      rt.term.options.fontSize = fontSize
      rt.fit.fit()
    }
  }, [fontSize])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])

  const pasteClipboard = useCallback(async (): Promise<void> => {
    if (!activeTabId) return
    const rt = termsRef.current.get(activeTabId)
    if (!rt?.shellSessionId) return
    const text = await window.api.clipboard.readText()
    // Route through the terminal so pasted text is normalized (CRLF -> CR) and
    // wrapped in bracketed-paste sequences when the remote enables that mode;
    // the existing onData handler then writes it to the shell.
    if (text) rt.term.paste(text)
    rt.term.focus()
  }, [activeTabId])

  useEffect(() => {
    const off = window.api.shortcuts.onShortcut((key) => {
      if (!active) return
      if (key === 'v') {
        void pasteClipboard()
        return
      }
      if (key === 'f') {
        setSearchOpen((v) => !v)
        return
      }
      const inFormField = Boolean(
        document.activeElement?.closest('.ant-input, .ant-select, .ant-input-number')
      )
      if (inFormField) return
      if (key === '=' || key === '+') {
        setFontSize((v) => Math.min(FONT_MAX, v + 1))
      } else if (key === '-' || key === '_') {
        setFontSize((v) => Math.max(FONT_MIN, v - 1))
      } else if (key === '0') {
        setFontSize(DEFAULT_FONT)
      }
    })
    return off
  }, [active, pasteClipboard])

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
      return
    }
    const rt = activeTabId ? termsRef.current.get(activeTabId) : undefined
    rt?.search.clearDecorations()
    const id = window.setTimeout(() => setSearchMatch(null), 0)
    return () => window.clearTimeout(id)
  }, [searchOpen, activeTabId])

  const runTermSearch = useCallback(
    (dir: 'next' | 'prev'): void => {
      if (!activeTabId || !searchText) return
      const rt = termsRef.current.get(activeTabId)
      if (!rt?.search) return
      const opts = {
        caseSensitive: false,
        wholeWord: false,
        // Decorations must be enabled for onDidChangeResults (match count) to fire.
        // Use transparent overview ruler colors so the visuals stay unchanged.
        decorations: {
          matchOverviewRuler: '#00000000',
          activeMatchColorOverviewRuler: '#00000000'
        } as const
      }
      skipAutoCopyRef.current = true
      try {
        if (dir === 'next') rt.search.findNext(searchText, opts)
        else rt.search.findPrevious(searchText, opts)
      } finally {
        skipAutoCopyRef.current = false
      }
    },
    [activeTabId, searchText]
  )

  const copySelection = useCallback(async (): Promise<void> => {
    if (!activeTabId) return
    const rt = termsRef.current.get(activeTabId)
    if (!rt) return
    const text = rt.term.getSelection()
    if (!text) return
    await window.api.clipboard.writeText(text)
    notifyCopiedRef.current()
  }, [activeTabId])

  const clearTerminal = useCallback((): void => {
    if (!activeTabId) return
    termsRef.current.get(activeTabId)?.term.clear()
  }, [activeTabId])

  const selectAllTerminal = useCallback((): void => {
    if (!activeTabId) return
    termsRef.current.get(activeTabId)?.term.selectAll()
  }, [activeTabId])

  const buildTermMenu = useCallback(
    (): MenuProps => ({
      items: [
        {
          key: 'copy',
          icon: <CopyOutlined />,
          label: t('sshTermCopy'),
          disabled: !copyEnabled
        },
        { key: 'paste', icon: <SnippetsOutlined />, label: t('sshTermPaste') },
        { key: 'clear', icon: <ClearOutlined />, label: t('sshTermClear') },
        { key: 'selectall', icon: <FileTextOutlined />, label: t('sshTermSelectAll') },
        { type: 'divider' },
        { key: 'font-inc', icon: <ZoomInOutlined />, label: t('sshTermFontInc') },
        { key: 'font-dec', icon: <ZoomOutOutlined />, label: t('sshTermFontDec') },
        { key: 'font-reset', icon: <ReloadOutlined />, label: t('sshTermFontReset') },
        { type: 'divider' },
        { key: 'search', icon: <SearchOutlined />, label: t('sshTermSearch') }
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
            clearTerminal()
            break
          case 'selectall':
            selectAllTerminal()
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
          case 'search':
            setSearchOpen(true)
            break
        }
      }
    }),
    [clearTerminal, copyEnabled, copySelection, pasteClipboard, selectAllTerminal, t]
  )

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
      infoOpen: false,
      toolOpen: null,
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
      prev.map((tab) =>
        tab.id === activeTab.id
          ? { ...tab, filesOpen: true, infoOpen: false, toolOpen: null }
          : tab
      )
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

  const refreshSysInfo = useCallback(async (): Promise<void> => {
    const tab = activeTab
    if (!tab || !tab.infoOpen) return
    setInfoLoading(true)
    setInfoError(null)
    try {
      const res = await window.api.ssh.sysInfo(tab.nodeId)
      if (res.ok) {
        setInfoByTab((prev) => ({ ...prev, [tab.id]: res.info }))
      } else {
        setInfoByTab((prev) => ({ ...prev, [tab.id]: null }))
        setInfoError(res.error || '')
      }
    } catch (err) {
      setInfoByTab((prev) => ({ ...prev, [tab.id]: null }))
      setInfoError(err instanceof Error ? err.message : String(err))
    } finally {
      setInfoLoading(false)
    }
  }, [activeTab])

  const openInfo = useCallback(async (): Promise<void> => {
    if (!activeTab) return
    const tabId = activeTab.id
    const nodeId = activeTab.nodeId
    if (activeTab.filesOpen) {
      const othersOpen = tabsRef.current.some(
        (item) => item.id !== tabId && item.nodeId === nodeId && item.filesOpen
      )
      if (!othersOpen) await window.api.ssh.sftpDisconnect(nodeId)
    }
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId ? { ...tab, infoOpen: true, filesOpen: false, toolOpen: null } : tab
      )
    )
    setMaximized((m) => (m === 'files' ? null : m))
    void refreshSysInfo()
  }, [activeTab, refreshSysInfo])

  const closeInfo = useCallback(async (): Promise<void> => {
    if (!activeTab) return
    const tabId = activeTab.id
    const nodeId = activeTab.nodeId
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, infoOpen: false } : tab)))
    if (maximized === 'info') setMaximized(null)
    const othersOpen = tabsRef.current.some(
      (tab) => tab.id !== tabId && tab.nodeId === nodeId && tab.infoOpen
    )
    if (!othersOpen) await window.api.ssh.disconnectSysInfo(nodeId)
  }, [activeTab, maximized])

  const openTool = useCallback(
    (key: ToolPanelKey): void => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab?.id
            ? { ...tab, filesOpen: false, infoOpen: false, toolOpen: key }
            : tab
        )
      )
      setMaximized((m) => (m === 'files' || m === 'info' ? null : m))
    },
    [activeTab?.id]
  )

  const closeTool = useCallback((): void => {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((tab) => (tab.id === activeTab.id ? { ...tab, toolOpen: null } : tab))
    )
    if (maximized === 'tool') setMaximized(null)
  }, [activeTab, maximized])

  useEffect(() => {
    if (!active || !activeTab?.infoOpen) return
    const first = window.setTimeout(() => void refreshSysInfo(), 0)
    const id = window.setInterval(() => void refreshSysInfo(), 4000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [active, activeTab?.id, activeTab?.infoOpen, refreshSysInfo])

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
      if (maximized === 'files' || maximized === 'info' || maximized === 'tool') setMaximized('console')
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
      if (list.length === 1 && maximized === 'editor') setMaximized(null)
    },
    [confirmCloseEditor, maximized]
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
      if (maximized === 'editor') setMaximized(null)
    },
    [confirmDiscardAllEditors, maximized]
  )

  const handleEditorDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const container = consoleHostRef.current
      if (!container) return
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
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
        target.releasePointerCapture(e.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        fitActiveTerm()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [fitActiveTerm]
  )

  const handleToolDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const wrapper = consoleHostRef.current?.parentElement
      const container = wrapper ?? consoleHostRef.current
      if (!container) return
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      const startY = e.clientY
      const startH = toolHeightRef.current ?? Math.round(container.clientHeight / 2)
      const totalH = container.clientHeight
      const onMove = (ev: PointerEvent): void => {
        const next = startH - (ev.clientY - startY)
        const min = 120
        const max = Math.max(min + 60, totalH - 120)
        setToolHeight(Math.min(max, Math.max(min, next)))
      }
      const onUp = (): void => {
        target.releasePointerCapture(e.pointerId)
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

  useEffect(() => {
    localStorage.setItem('ssh-bookmarks', JSON.stringify(bookmarks))
  }, [bookmarks])

  const currentPathBookmarked = !!activeTab && bookmarks.includes(activeTab.remotePath)

  const toggleBookmark = useCallback((): void => {
    if (!activeTab) return
    const p = activeTab.remotePath || '/'
    setBookmarks((prev) => {
      if (prev.includes(p)) return prev.filter((x) => x !== p)
      return [...prev, p]
    })
  }, [activeTab])

  const goBookmark = useCallback(
    (p: string): void => {
      if (!activeTab) return
      void loadDir(activeTab.id, activeTab.nodeId, p)
    },
    [activeTab, loadDir]
  )

  const openImport = useCallback(async (): Promise<void> => {
    setImportOpen(true)
    setImportLoading(true)
    setImportError(null)
    setImportCandidates([])
    setImportSelected([])
    try {
      const res = await window.api.ssh.importSshConfig()
      if (res.ok) {
        setImportCandidates(res.candidates)
        setImportSelected(res.candidates.map((c) => c.name))
      } else {
        setImportError(res.error)
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportLoading(false)
    }
  }, [])

  const confirmImport = useCallback(async (): Promise<void> => {
    const selected = importCandidates.filter((c) => importSelected.includes(c.name))
    if (selected.length === 0) return
    setImporting(true)
    try {
      let count = 0
      for (const c of selected) {
        await window.api.ssh.saveNode({
          name: c.name,
          host: c.host,
          port: c.port,
          username: c.username,
          authType: c.authType,
          privateKeyPath: c.privateKeyPath,
          jumpHostId: null
        })
        count += 1
      }
      message.success(t('sshImportConfigImported', { count }))
      setImportOpen(false)
      loadNodes()
    } catch (err) {
      message.error(mapSshError(err, t))
    } finally {
      setImporting(false)
    }
  }, [importCandidates, importSelected, loadNodes, message, t])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault()
      setDragOver(false)
      if (!activeTab) return
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      const paths = files
        .map((f) => window.api.files.getPathForFile(f))
        .filter((p): p is string => Boolean(p))
      if (paths.length === 0) {
        message.warning(t('sshClientDropNoPath'))
        return
      }
      void (async () => {
        setUploading(true)
        try {
          const res = await window.api.ssh.sftpUploadPaths(
            activeTab.nodeId,
            activeTab.remotePath || '/',
            paths
          )
          if (res.ok) {
            message.success(t('sshClientUploadOk', { count: res.count ?? 0 }))
            void loadDir(activeTab.id, activeTab.nodeId, activeTab.remotePath || '/')
          } else {
            message.error(mapSshError(res.error ?? '', t))
          }
        } catch (err) {
          message.error(mapSshError(err, t))
        } finally {
          setUploading(false)
        }
      })()
    },
    [activeTab, loadDir, message, t]
  )

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
  const infoOpen = !!activeTab?.infoOpen
  const activeTool = activeTab?.toolOpen ?? null
  const showSidebar = maximized === null || maximized === 'editor'
  const showConsole = maximized !== 'files' && maximized !== 'info' && maximized !== 'tool'
  const showConsoleTitle = showConsole && maximized !== 'editor'
  const showFiles = filesOpen && maximized !== 'console' && maximized !== 'info' && maximized !== 'tool'
  const showInfo = infoOpen && maximized !== 'console' && maximized !== 'files' && maximized !== 'tool'
  const isCommands = activeTool === 'commands'
  const showCommands =
    isCommands && maximized !== 'console' && maximized !== 'files' && maximized !== 'info'
  const showTools =
    activeTool !== null &&
    !isCommands &&
    maximized !== 'console' &&
    maximized !== 'files' &&
    maximized !== 'info'

  const toolTitle = useMemo(() => {
    switch (activeTool) {
      case 'commands':
        return t('sshToolCommands')
      case 'process':
        return t('sshToolProcess')
      case 'services':
        return t('sshToolServices')
      case 'logs':
        return t('sshToolLogs')
      case 'ports':
        return t('sshToolPorts')
      default:
        return ''
    }
  }, [activeTool, t])

  const renderToolPanel = useCallback(
    (tab: SessionTab): React.JSX.Element | null => {
      const toggleFullscreen = (): void =>
        setMaximized((m) => (m === 'tool' ? null : 'tool'))
      switch (activeTool) {
        case 'commands':
          return <CommandPanel shellSessionId={tab.shellSessionId} />
        case 'process':
          return (
            <ProcessPanel
              nodeId={tab.nodeId}
              onClose={closeTool}
              fullscreen={maximized === 'tool'}
              onToggleFullscreen={toggleFullscreen}
            />
          )
        case 'services':
          return (
            <ServicesPanel
              nodeId={tab.nodeId}
              onClose={closeTool}
              fullscreen={maximized === 'tool'}
              onToggleFullscreen={toggleFullscreen}
            />
          )
        case 'logs':
          return (
            <LogTailPanel
              nodeId={tab.nodeId}
              onClose={closeTool}
              fullscreen={maximized === 'tool'}
              onToggleFullscreen={toggleFullscreen}
            />
          )
        case 'ports':
          return (
            <PortsPanel
              nodeId={tab.nodeId}
              onClose={closeTool}
              fullscreen={maximized === 'tool'}
              onToggleFullscreen={toggleFullscreen}
            />
          )
        default:
          return null
      }
    },
    [activeTool, closeTool, maximized]
  )
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

  const editorHeader =
    activeTab && activeEditor ? (
      <div className="h-10 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--border-subtle)] bg-[var(--surface)]">
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
                    : 'bg-[var(--bg-warm)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'
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
                      background: isActive ? 'rgba(255,255,255,0.85)' : 'var(--accent)'
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
          title={
            maximized === 'editor' ? t('sshClientExitFullscreen') : t('sshClientFullscreen')
          }
          onClick={() => setMaximized((m) => (m === 'editor' ? null : 'editor'))}
        >
          {maximized === 'editor' ? <CompressOutlined /> : <ExpandOutlined />}
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
    ) : null

  const editorContent = activeEditor ? (
    <div className="flex-1 min-h-0">
      {activeEditor.loading ? (
        <div className="h-full flex items-center justify-center">
          <Spin />
        </div>
      ) : activeEditor.binary ? (
        <div className="h-full flex items-center justify-center px-6">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('sshClientEditBinary')} />
        </div>
      ) : activeEditor.error ? (
        <div className="h-full flex items-center justify-center px-6">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={activeEditor.error} />
        </div>
      ) : (
        <SshFileEditor
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
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              if (!activeEditor) return
              void saveFileEditor(activeEditor.tabId, activeEditor.path)
            })
          }}
        />
      )}
    </div>
  ) : null

  useEffect(() => {
    if (!active || !activeTabId) return
    const id = window.requestAnimationFrame(fitActiveTerm)
    return () => window.cancelAnimationFrame(id)
  }, [active, activeTabId, hasActiveEditor, fitActiveTerm])

  useEffect(() => {
    if (
      !active ||
      !activeTabId ||
      maximized === 'editor' ||
      maximized === 'files' ||
      maximized === 'info' ||
      maximized === 'tool'
    )
      return
    const id = window.requestAnimationFrame(fitActiveTerm)
    return () => window.cancelAnimationFrame(id)
  }, [active, activeTabId, maximized, activeTool, toolHeight, fitActiveTerm])

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
                <button
                  type="button"
                  className={BTN_ICON}
                  title={t('sshImportConfig')}
                  onClick={() => void openImport()}
                >
                  <ImportOutlined />
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

          {sidebarCollapsed && (
            <div className="shrink-0 flex items-center justify-center py-1.5 border-t border-[var(--border-subtle)]">
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
            </div>
          )}
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
              {maximized === 'editor' ? (
                editorHeader ? (
                  <div
                    className={`flex-1 min-w-0 ${showFiles ? 'border-r border-[var(--border-subtle)]' : ''}`}
                  >
                    {editorHeader}
                  </div>
                ) : null
              ) : (
                showConsoleTitle && (
                <div
                  className={`${TITLE_BAR_CLS} ${
                    showFiles || showInfo || showCommands
                      ? 'flex-1 min-w-0 border-r border-[var(--border-subtle)]'
                      : 'flex-1 min-w-0'
                  }`}
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
                    className={filesOpen ? BTN_ICON_ACTIVE : BTN_ICON}
                    onClick={() => (filesOpen ? void closeFiles() : openFiles())}
                    title={t('sshClientFiles')}
                  >
                    <FolderOpenOutlined />
                  </button>
                  <button
                    type="button"
                    className={infoOpen ? BTN_ICON_ACTIVE : BTN_ICON}
                    onClick={() => (infoOpen ? void closeInfo() : void openInfo())}
                    title={t('sshClientInfo')}
                  >
                    <DashboardOutlined />
                  </button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'commands', icon: <SnippetsOutlined />, label: t('sshToolCommands') },
                        { key: 'process', icon: <ApiOutlined />, label: t('sshToolProcess') },
                        { key: 'services', icon: <CloudServerOutlined />, label: t('sshToolServices') },
                        { key: 'logs', icon: <FileTextOutlined />, label: t('sshToolLogs') },
                        { key: 'ports', icon: <NodeIndexOutlined />, label: t('sshToolPorts') }
                      ],
                      onClick: ({ key }) => openTool(key as ToolPanelKey)
                    }}
                  >
                    <button
                      type="button"
                      className={activeTool ? BTN_ICON_ACTIVE : BTN_ICON}
                      title={t('sshTools')}
                    >
                      <ToolOutlined />
                    </button>
                  </Dropdown>
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
                )
              )}
              {showFiles && (
                <div
                  className={`${TITLE_BAR_CLS} ${
                    maximized === 'files'
                      ? 'flex-1'
                      : `w-[380px] shrink-0 ${showInfo || showCommands ? 'border-r border-[var(--border-subtle)]' : ''}`
                  }`}
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
              {showInfo && (
                <div
                  className={`${TITLE_BAR_CLS} ${
                    maximized === 'info'
                      ? 'flex-1'
                      : `w-[300px] shrink-0 ${showCommands ? 'border-r border-[var(--border-subtle)]' : ''}`
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {t('sshClientInfo')}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                      {activeTab.title}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={BTN_TEXT}
                    disabled={infoLoading}
                    onClick={() => void refreshSysInfo()}
                    title={t('sshClientInfoRefresh')}
                  >
                    {infoLoading ? <LoadingOutlined /> : <ReloadOutlined />}
                    {t('sshClientRefresh')}
                  </button>
                  <button
                    type="button"
                    className={BTN_ICON}
                    title={
                      maximized === 'info'
                        ? t('sshClientExitFullscreen')
                        : t('sshClientFullscreen')
                    }
                    onClick={() => setMaximized((m) => (m === 'info' ? null : 'info'))}
                  >
                    {maximized === 'info' ? <CompressOutlined /> : <ExpandOutlined />}
                  </button>
                  <button
                    type="button"
                    className={BTN_ICON}
                    title={t('sshClientClose')}
                    onClick={() => void closeInfo()}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              )}
              {showCommands && (
                <div
                  className={`${TITLE_BAR_CLS} ${maximized === 'tool' ? 'flex-1' : 'w-[300px] shrink-0'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {toolTitle}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                      {activeTab.title}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={BTN_ICON}
                    title={
                      maximized === 'tool'
                        ? t('sshClientExitFullscreen')
                        : t('sshClientFullscreen')
                    }
                    onClick={() => setMaximized((m) => (m === 'tool' ? null : 'tool'))}
                  >
                    {maximized === 'tool' ? <CompressOutlined /> : <ExpandOutlined />}
                  </button>
                  <button
                    type="button"
                    className={BTN_ICON}
                    title={t('sshClientClose')}
                    onClick={closeTool}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 flex overflow-hidden">
              <div
                className={`min-w-0 min-h-0 flex flex-col ${
                  showFiles ? 'flex-1 border-r border-[var(--border-subtle)]' : 'flex-1'
                }`}
                style={showConsole || showTools ? undefined : { display: 'none' }}
              >
                <div
                  ref={consoleHostRef}
                  className="min-w-0 min-h-0 flex flex-col bg-[var(--bg-warm)] flex-1"
                  style={showConsole ? undefined : { display: 'none' }}
                >
                  <div
                    className="relative flex-1 min-h-0"
                    style={maximized === 'editor' ? { display: 'none' } : undefined}
                  >
                    {tabs.map((tab) => (
                      <div
                        key={tab.id}
                        className="absolute inset-0 p-1"
                        style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
                      >
                        <Dropdown
                          trigger={['contextMenu']}
                          menu={buildTermMenu()}
                          onOpenChange={(open) => {
                            if (!open) return
                            const rt = termsRef.current.get(tab.id)
                            setCopyEnabled(Boolean(rt?.term.getSelection()))
                          }}
                        >
                          <div
                            ref={(el) => {
                              if (el) termHostsRef.current.set(tab.id, el)
                              else termHostsRef.current.delete(tab.id)
                            }}
                            className="h-full w-full min-h-0 overflow-hidden bg-[var(--bg-warm)]"
                          />
                        </Dropdown>
                      </div>
                    ))}
                    {searchOpen && activeTabId && showConsole && (
                      <div className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1 shadow-sm">
                        <Input
                          ref={searchInputRef}
                          size="small"
                          allowClear
                          placeholder={t('sshTermSearchPlaceholder')}
                          value={searchText}
                          onChange={(e) => {
                            setSearchText(e.target.value)
                            setSearchMatch(null)
                          }}
                          onPressEnter={() => runTermSearch('next')}
                          className="w-44"
                        />
                        {searchMatch && (
                          <span
                            className={`shrink-0 text-[10px] ${
                              searchMatch.count > 0
                                ? 'text-[var(--text-secondary)]'
                                : 'text-[var(--danger)]'
                            }`}
                          >
                            {searchMatch.count > 0
                              ? `${searchMatch.index + 1}/${searchMatch.count}`
                              : '0/0'}
                          </span>
                        )}
                        <button
                          type="button"
                          className={BTN_ICON}
                          title={t('sshTermSearchPrev')}
                          onClick={() => runTermSearch('prev')}
                        >
                          <ArrowUpOutlined />
                        </button>
                        <button
                          type="button"
                          className={BTN_ICON}
                          title={t('sshTermSearchNext')}
                          onClick={() => runTermSearch('next')}
                        >
                          <ArrowDownOutlined />
                        </button>
                        <button
                          type="button"
                          className={BTN_ICON}
                          title={t('sshTermSearchClose')}
                          onClick={() => setSearchOpen(false)}
                        >
                          <CloseOutlined />
                        </button>
                      </div>
                    )}
                  </div>
                  {activeEditor && (
                    <>
                      {maximized !== 'editor' && (
                        <div
                          className="group shrink-0 h-2.5 flex items-center justify-center cursor-row-resize touch-none select-none bg-[var(--surface)] hover:bg-[var(--surface)] active:bg-[var(--surface)]"
                          title={t('sshClientEditResize')}
                          onPointerDown={handleEditorDividerPointerDown}
                        >
                          <span className="h-1 w-9 rounded-full bg-[var(--border-subtle)] group-hover:bg-[var(--text-secondary)]" />
                        </div>
                      )}
                      <div
                        className={`flex flex-col min-h-0 bg-[var(--surface)] ${
                          maximized === 'editor'
                            ? 'flex-1'
                            : 'shrink-0 border-t border-[var(--border-subtle)]'
                        }`}
                        style={maximized === 'editor' ? undefined : { height: editorHeight }}
                      >
                        {maximized !== 'editor' && editorHeader}
                        {editorContent}
                      </div>
                    </>
                  )}
                </div>

                {showTools && activeTab && (
                  <>
                    {maximized !== 'tool' && (
                      <div
                        className="group shrink-0 h-2.5 flex items-center justify-center cursor-row-resize touch-none select-none bg-[var(--surface)] hover:bg-[var(--surface)] active:bg-[var(--surface)]"
                        title={t('sshClientToolResize')}
                        onPointerDown={handleToolDividerPointerDown}
                      >
                        <span className="h-1 w-9 rounded-full bg-[var(--border-subtle)] group-hover:bg-[var(--text-secondary)]" />
                      </div>
                    )}
                    <div
                      key={activeTab.id}
                      className={`min-h-0 flex flex-col bg-[var(--surface)] ${
                        maximized === 'tool'
                          ? 'flex-1'
                          : toolHeight === null
                            ? 'flex-1 border-t border-[var(--border-subtle)]'
                            : 'shrink-0 border-t border-[var(--border-subtle)]'
                      }`}
                      style={maximized === 'tool' || toolHeight === null ? undefined : { height: toolHeight }}
                    >
                      <div className="flex-1 min-h-0">{renderToolPanel(activeTab)}</div>
                    </div>
                  </>
                )}
              </div>

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
                    <button
                      type="button"
                      className={currentPathBookmarked ? BTN_ICON_ACTIVE : BTN_ICON}
                      title={t('sshClientBookmarkToggle')}
                      onClick={toggleBookmark}
                    >
                      {currentPathBookmarked ? <StarFilled /> : <StarOutlined />}
                    </button>
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: bookmarks.map((p) => ({
                          key: p,
                          label: <span className="font-mono">{p}</span>
                        })),
                        onClick: ({ key }) => goBookmark(key)
                      }}
                    >
                      <button type="button" className={BTN_ICON} title={t('sshClientBookmarks')}>
                        <BookOutlined />
                      </button>
                    </Dropdown>
                  </div>
                  <div
                    className="relative flex-1 min-h-0 overflow-auto"
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragOver(true)
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                  >
                    {dragOver && (
                      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-[var(--accent)] bg-[var(--accent)]/10">
                        <span className="rounded-lg bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--accent)]">
                          {t('sshClientDropUpload')}
                        </span>
                      </div>
                    )}
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
                                {row.isSymlink ? (
                                  <LinkOutlined />
                                ) : row.type === 'directory' ? (
                                  <FolderOutlined />
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
              {showInfo && (
                <div
                  className={`min-h-0 flex flex-col bg-[var(--content-bg)] ${
                    maximized === 'info' ? 'flex-1' : 'w-[300px] shrink-0'
                  }`}
                >
                  <div className="flex-1 min-h-0 overflow-auto">
                    <SshSysInfoPanel
                      info={activeTab ? (infoByTab[activeTab.id] ?? null) : null}
                      loading={infoLoading}
                      error={infoError}
                      onRefresh={() => void refreshSysInfo()}
                    />
                  </div>
                </div>
              )}
              {showCommands && activeTab && (
                <div
                  key={activeTab.id}
                  className={`min-h-0 flex flex-col bg-[var(--content-bg)] ${
                    maximized === 'tool' ? 'flex-1' : 'w-[300px] shrink-0'
                  }`}
                >
                  <div className="flex-1 min-h-0 overflow-auto">{renderToolPanel(activeTab)}</div>
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

      <Modal
        open={importOpen}
        title={t('sshImportConfigTitle')}
        onCancel={() => setImportOpen(false)}
        onOk={() => void confirmImport()}
        okText={t('sshImportConfigImport')}
        okButtonProps={{ disabled: importSelected.length === 0 }}
        confirmLoading={importing}
        cancelText={t('sshCancel')}
        destroyOnHidden
        centered
        width={640}
      >
        {importError ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('sshImportConfigFail', { msg: importError })} />
        ) : (
          <Table
            size="small"
            rowKey="name"
            loading={importLoading}
            pagination={false}
            dataSource={importCandidates}
            rowSelection={{
              selectedRowKeys: importSelected,
              onChange: (keys) => setImportSelected(keys.map(String))
            }}
            locale={{ emptyText: t('sshImportConfigEmpty') }}
            columns={[
              {
                title: t('sshImportConfigColHost'),
                dataIndex: 'name',
                render: (v: string, row: SshConfigCandidate) => (
                  <span className="font-mono text-xs">
                    {v}
                    <span className="text-[var(--text-secondary)]"> → {row.host}</span>
                  </span>
                )
              },
              { title: t('sshImportConfigColUser'), dataIndex: 'username', width: 120 },
              { title: t('sshImportConfigColPort'), dataIndex: 'port', width: 72 },
              {
                title: t('sshImportConfigColKey'),
                dataIndex: 'privateKeyPath',
                width: 200,
                ellipsis: true,
                render: (v?: string) =>
                  v ? <span className="font-mono text-xs">{v}</span> : t('sshAuthPassword')
              }
            ]}
          />
        )}
      </Modal>
    </div>
  )
}

export default SshClient
