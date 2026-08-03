import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle
} from 'react'
import { useTranslation } from 'react-i18next'
import { App, Modal, Form, Input, InputNumber, Radio, Segmented, Empty, Button } from 'antd'
import {
  PlusOutlined,
  ApiOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  StopOutlined,
  CloudServerOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  CloseOutlined,
  ArrowRightOutlined,
  ArrowLeftOutlined,
  GlobalOutlined,
  RightOutlined,
  DownOutlined,
  WarningOutlined
} from '@ant-design/icons'

const LABEL_CLS =
  'block text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] mb-1.5'

const CARD_CLS =
  'rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden'

const BTN_CLS =
  'px-3 h-8 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none ' +
  'bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

const ACCENT_BTN_CLS =
  'px-4 h-8 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none ' +
  'bg-[var(--accent)] text-white hover:brightness-110 active:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed'

const STATE_DOT_CLS: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-amber-400 animate-pulse',
  error: 'bg-red-500',
  disconnected: 'bg-[var(--border-subtle)]'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

interface TunnelDraft {
  type: SshTunnelType
  name: string
  localPort: number
  listenAddr: string
  remoteHost: string
  remotePort: number
  bindAddr: string
  bindPort: number
  targetHost: string
  targetPort: number
  socksPort: number
  socksUser: string
  socksPass: string
  hasSocksPass: boolean
}

const DEFAULT_DRAFT: TunnelDraft = {
  type: 'local',
  name: '',
  localPort: 8080,
  listenAddr: '127.0.0.1',
  remoteHost: '127.0.0.1',
  remotePort: 80,
  bindAddr: '127.0.0.1',
  bindPort: 8080,
  targetHost: '127.0.0.1',
  targetPort: 3000,
  socksPort: 1080,
  socksUser: '',
  socksPass: '',
  hasSocksPass: false
}

function draftFromSpec(spec: SshTunnelSpec): TunnelDraft {
  return {
    type: spec.type,
    name: spec.name ?? '',
    localPort: spec.localPort ?? 8080,
    listenAddr: spec.listenAddr || '127.0.0.1',
    remoteHost: spec.remoteHost || '127.0.0.1',
    remotePort: spec.remotePort ?? 80,
    bindAddr: spec.bindAddr || '127.0.0.1',
    bindPort: spec.bindPort ?? 8080,
    targetHost: spec.targetHost || '127.0.0.1',
    targetPort: spec.targetPort ?? 3000,
    socksPort: spec.localPort ?? 1080,
    socksUser: spec.socksUser ?? '',
    socksPass: '',
    hasSocksPass: Boolean(spec.hasSocksPass)
  }
}

let cachedSshLogs: SshLogEntry[] = []

const SSH_ERROR_CODES = [
  'NO_TUNNELS',
  'PORT_CONFLICT',
  'PORT_INVALID',
  'HOST_KEY_MISMATCH',
  'AUTH_FAILED',
  'RECONNECT_EXHAUSTED',
  'NODE_NOT_FOUND',
  'TUNNEL_NOT_FOUND',
  'LISTEN_LOOPBACK_REQUIRED',
  'SOCKS_AUTH_REQUIRED'
] as const

function extractSshErrorCode(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : String(raw ?? '')
  if (!message) return ''
  for (const code of SSH_ERROR_CODES) {
    if (message === code || message.endsWith(`: ${code}`) || message.endsWith(`Error: ${code}`)) {
      return code
    }
  }
  const match = message.match(/\b([A-Z][A-Z0-9_]{2,})\b/g)
  if (match) {
    for (let i = match.length - 1; i >= 0; i--) {
      if ((SSH_ERROR_CODES as readonly string[]).includes(match[i])) return match[i]
    }
  }
  return message
}

function mapSshError(
  raw: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const code = extractSshErrorCode(raw)
  if (code === 'NO_TUNNELS') return t('sshNoTunnelsToConnect')
  if (code === 'PORT_CONFLICT') return t('sshPortConflict')
  if (code === 'PORT_INVALID') return t('sshPortInvalid')
  if (code === 'HOST_KEY_MISMATCH') return t('sshHostKeyMismatch')
  if (code === 'AUTH_FAILED') return t('sshAuthFailed')
  if (code === 'RECONNECT_EXHAUSTED') return t('sshReconnectExhausted')
  if (code === 'NODE_NOT_FOUND') return t('sshNodeNotFound')
  if (code === 'TUNNEL_NOT_FOUND') return t('sshTunnelNotFound')
  if (code === 'LISTEN_LOOPBACK_REQUIRED') return t('sshListenLoopbackRequired')
  if (code === 'SOCKS_AUTH_REQUIRED') return t('sshSocksAuthRequired')
  return t('sshConnectFail', { msg: code })
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
}

function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={className}>
      <span className={LABEL_CLS}>{label}</span>
      {children}
      {hint && <p className="text-[10px] text-[var(--text-secondary)] mt-1">{hint}</p>}
    </div>
  )
}

interface TunnelFormHandle {
  submit: () => Promise<boolean>
}

interface TunnelFormProps {
  nodeId: string
  onAdded: () => void
  onError: (msg: string) => void
  fixedType?: SshTunnelType
  editing?: SshTunnelSpec | null
  onSubmittingChange?: (submitting: boolean) => void
}

const TunnelForm = forwardRef<TunnelFormHandle, TunnelFormProps>(function TunnelForm(
  { nodeId, onAdded, onError, fixedType, editing, onSubmittingChange },
  ref
) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<TunnelDraft>(() =>
    editing ? draftFromSpec(editing) : { ...DEFAULT_DRAFT, type: fixedType ?? 'local' }
  )

  const set = <K extends keyof TunnelDraft>(key: K, value: TunnelDraft[K]): void =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const handleAdd = useCallback(async (): Promise<boolean> => {
    onSubmittingChange?.(true)
    try {
      const base =
        draft.type === 'local'
          ? {
              type: 'local' as const,
              name: draft.name.trim() || undefined,
              localPort: draft.localPort,
              listenAddr: draft.listenAddr.trim() || '127.0.0.1',
              remoteHost: draft.remoteHost.trim() || '127.0.0.1',
              remotePort: draft.remotePort
            }
          : draft.type === 'remote'
            ? {
                type: 'remote' as const,
                name: draft.name.trim() || undefined,
                bindAddr: draft.bindAddr.trim() || '127.0.0.1',
                bindPort: draft.bindPort,
                targetHost: draft.targetHost.trim() || '127.0.0.1',
                targetPort: draft.targetPort
              }
            : {
                type: 'socks5' as const,
                name: draft.name.trim() || undefined,
                localPort: draft.socksPort,
                listenAddr: draft.listenAddr.trim() || '127.0.0.1',
                socksUser: draft.socksUser.trim() || undefined,
                socksPass: draft.socksPass.trim() || undefined,
                hasSocksPass: draft.hasSocksPass || Boolean(draft.socksPass.trim())
              }
      if (editing?.id) {
        await window.api.ssh.updateTunnel(nodeId, { ...base, id: editing.id })
      } else {
        await window.api.ssh.addTunnel(nodeId, base)
        setDraft({ ...DEFAULT_DRAFT, type: fixedType ?? draft.type })
      }
      onAdded()
      return true
    } catch (err) {
      const code = extractSshErrorCode(err)
      if (
        code === 'PORT_CONFLICT' ||
        code === 'PORT_INVALID' ||
        code === 'LISTEN_LOOPBACK_REQUIRED' ||
        code === 'SOCKS_AUTH_REQUIRED'
      ) {
        onError(mapSshError(code, t))
      } else onError(editing ? t('sshTunnelUpdateFail') : t('sshTunnelAddFail'))
      return false
    } finally {
      onSubmittingChange?.(false)
    }
  }, [draft, nodeId, onAdded, onError, t, fixedType, editing, onSubmittingChange])

  useImperativeHandle(ref, () => ({ submit: () => handleAdd() }), [handleAdd])

  return (
    <div className="flex flex-col gap-4">
      {!fixedType && (
        <div>
          <span className={LABEL_CLS}>{t('sshTunnelType')}</span>
          <Segmented
            size="small"
            value={draft.type}
            onChange={(v) => set('type', v as SshTunnelType)}
            options={[
              { label: t('sshTypeLocal'), value: 'local' },
              { label: t('sshTypeRemote'), value: 'remote' },
              { label: t('sshTypeSocks5'), value: 'socks5' }
            ]}
          />
        </div>
      )}

      <Field label={t('sshName')}>
        <Input
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={t('sshTunnelNamePlaceholder')}
          allowClear
        />
      </Field>

      {draft.type === 'local' && (
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('sshLocalPort')}>
            <InputNumber
              min={1}
              max={65535}
              value={draft.localPort}
              onChange={(v) => set('localPort', v ?? 8080)}
              className="w-full"
            />
          </Field>
          <Field label={t('sshRemotePort')}>
            <InputNumber
              min={1}
              max={65535}
              value={draft.remotePort}
              onChange={(v) => set('remotePort', v ?? 80)}
              className="w-full"
            />
          </Field>
          <Field label={t('sshListenAddr')} hint={t('sshListenAddrLocalHint')}>
            <Input
              value={draft.listenAddr}
              onChange={(e) => set('listenAddr', e.target.value)}
              placeholder="127.0.0.1"
            />
          </Field>
          <Field label={t('sshRemoteHost')}>
            <Input
              value={draft.remoteHost}
              onChange={(e) => set('remoteHost', e.target.value)}
              placeholder="127.0.0.1"
            />
          </Field>
        </div>
      )}

      {draft.type === 'remote' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('sshBindPort')} hint={t('sshBindPortHint')}>
              <InputNumber
                min={0}
                max={65535}
                value={draft.bindPort}
                onChange={(v) => set('bindPort', v ?? 8080)}
                className="w-full"
              />
            </Field>
            <Field label={t('sshTargetPort')}>
              <InputNumber
                min={1}
                max={65535}
                value={draft.targetPort}
                onChange={(v) => set('targetPort', v ?? 3000)}
                className="w-full"
              />
            </Field>
            <Field label={t('sshBindAddr')} hint={t('sshBindAddrHint')}>
              <Input
                value={draft.bindAddr}
                onChange={(e) => set('bindAddr', e.target.value)}
                placeholder="127.0.0.1"
              />
            </Field>
            <Field label={t('sshTargetHost')}>
              <Input
                value={draft.targetHost}
                onChange={(e) => set('targetHost', e.target.value)}
                placeholder="127.0.0.1"
              />
            </Field>
          </div>
          <p className="text-[11px] flex items-center gap-1.5 text-[var(--text-secondary)]">
            <WarningOutlined style={{ color: 'var(--accent)' }} />
            {t('sshGatewayPorts')}
          </p>
        </>
      )}

      {draft.type === 'socks5' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('sshSocksPort')}>
              <InputNumber
                min={1}
                max={65535}
                value={draft.socksPort}
                onChange={(v) => set('socksPort', v ?? 1080)}
                className="w-full"
              />
            </Field>
            <Field label={t('sshListenAddr')} hint={t('sshListenAddrSocksHint')}>
              <Input
                value={draft.listenAddr}
                onChange={(e) => set('listenAddr', e.target.value)}
                placeholder="127.0.0.1"
              />
            </Field>
            <Field label={t('sshSocksUser')} hint={t('sshSocksAuthHint')}>
              <Input
                value={draft.socksUser}
                onChange={(e) => set('socksUser', e.target.value)}
                allowClear
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('sshSocksPass')}
              hint={draft.hasSocksPass && !draft.socksPass ? t('sshSocksPassKeep') : undefined}
            >
              <Input.Password
                value={draft.socksPass}
                onChange={(e) => set('socksPass', e.target.value)}
                allowClear
                autoComplete="new-password"
              />
            </Field>
          </div>
        </>
      )}
    </div>
  )
})

function NodeEditor({
  open,
  editing,
  onCancel,
  onSaved
}: {
  open: boolean
  editing: SshNodeView | null
  onCancel: () => void
  onSaved: (node: SshNodeView) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<EditorValues>()

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
      passphrase: ''
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
        passphrase: values.authType === 'privateKey' ? values.passphrase : undefined
      })
      message.success(t('sshSaved'))
      onSaved(node)
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return
      const msg = (err as Error)?.message ?? ''
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
      width={460}
    >
      <Form form={form} layout="vertical" className="mt-2">
        <Form.Item name="name" label={t('sshName')} rules={[{ required: true }]}>
          <Input placeholder="cloud-server" />
        </Form.Item>
        <div className="grid grid-cols-3 gap-3">
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
        <Form.Item name="username" label={t('sshUsername')} rules={[{ required: true }]}>
          <Input placeholder="root" />
        </Form.Item>
        {editing && (
          <div className="mb-4">
            <Button size="small" onClick={handleClearHostKey}>
              {t('sshClearHostKey')}
            </Button>
            <p className="text-[10px] text-[var(--text-secondary)] mt-1">
              {t('sshClearHostKeyHint')}
            </p>
          </div>
        )}
        <Form.Item name="authType" label={t('sshAuthType')}>
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: t('sshAuthPassword'), value: 'password' },
              { label: t('sshAuthKey'), value: 'privateKey' }
            ]}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.authType !== cur.authType}>
          {() => {
            const authType = form.getFieldValue('authType') as EditorValues['authType']
            if (authType === 'password') {
              return (
                <Form.Item
                  name="password"
                  label={t('sshPassword')}
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
      </Form>
    </Modal>
  )
}

function SshTunnel(): React.JSX.Element {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const [nodes, setNodes] = useState<SshNodeView[]>([])
  const [statuses, setStatuses] = useState<SshSessionStatus[]>([])
  const [tunnels, setTunnels] = useState<SshTunnelSpec[]>([])
  const [logs, setLogs] = useState<SshLogEntry[]>(cachedSshLogs)
  const [activeTab, setActiveTab] = useState('nodes')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<SshNodeView | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({})
  const [addModal, setAddModal] = useState<{
    nodeId: string
    type: SshTunnelType
    tunnel?: SshTunnelSpec
  } | null>(null)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const tunnelFormRef = useRef<TunnelFormHandle>(null)
  const logBoxRef = useRef<HTMLDivElement | null>(null)

  const sessionByNode = useMemo(() => {
    const map = new Map<string, SshSessionStatus>()
    for (const s of statuses) map.set(s.nodeId, s)
    return map
  }, [statuses])

  const loadTunnels = useCallback(() => {
    window.api.ssh
      .listTunnels()
      .then(setTunnels)
      .catch(() => {})
  }, [])

  const appendLog = useCallback((entry: SshLogEntry) => {
    setLogs((prev) => {
      const next = [...prev.slice(-499), entry]
      cachedSshLogs = next
      return next
    })
  }, [])

  const clearLogs = useCallback(() => {
    cachedSshLogs = []
    setLogs([])
  }, [])

  useEffect(() => {
    let mounted = true
    Promise.all([window.api.ssh.listNodes(), window.api.ssh.status()])
      .then(([nodeList, sshStatuses]) => {
        if (!mounted) return
        setNodes(nodeList)
        setStatuses(sshStatuses)
      })
      .catch(() => {})
    loadTunnels()
    const offStatus = window.api.ssh.onStatusChange((s) => {
      if (mounted) setStatuses(s)
    })
    const offLog = window.api.ssh.onLog((entry) => {
      if (mounted) appendLog(entry)
    })
    return () => {
      mounted = false
      offStatus()
      offLog()
    }
  }, [loadTunnels, appendLog])

  useEffect(() => {
    const el = logBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  const handleConnect = useCallback(
    async (node: SshNodeView, type?: SshTunnelType) => {
      const session = sessionByNode.get(node.id)
      const isTypeActive = (s: SshSessionStatus | undefined, tunnelType: SshTunnelType): boolean =>
        !!s?.tunnels.some(
          (tun) =>
            tun.type === tunnelType && (tun.status === 'running' || tun.status === 'starting')
        )
      const showConnectError = (raw: unknown): void => {
        message.error(mapSshError(raw, t))
      }
      if (type) {
        if (isTypeActive(session, type)) {
          try {
            await window.api.ssh.disconnectType(node.id, type)
            message.success(t('sshDisconnected'))
          } catch (err) {
            showConnectError(err)
          }
          return
        }
        const typeCount = tunnels.filter(
          (tun) => tun.nodeId === node.id && tun.type === type
        ).length
        if (typeCount === 0) {
          message.warning(t('sshNoTunnelsToConnect'))
          return
        }
        try {
          const status = await window.api.ssh.connect(node.id, type)
          if (status.state === 'error') showConnectError(status.error ?? '')
        } catch (err) {
          showConnectError(err)
        }
        return
      }
      if (session?.state === 'connected') {
        try {
          await window.api.ssh.disconnect(node.id)
          message.success(t('sshDisconnected'))
        } catch (err) {
          showConnectError(err)
        }
        return
      }
      const nodeCount = tunnels.filter((tun) => tun.nodeId === node.id).length
      if (nodeCount === 0) {
        message.warning(t('sshNoTunnelsToConnect'))
        return
      }
      try {
        const status = await window.api.ssh.connect(node.id)
        if (status.state === 'error') showConnectError(status.error ?? '')
      } catch (err) {
        showConnectError(err)
      }
    },
    [sessionByNode, tunnels, message, t]
  )

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }))
  }, [])

  const handleToggleTunnel = useCallback(
    async (nodeId: string, tunnelId: string, running: boolean) => {
      try {
        if (running) {
          await window.api.ssh.stopTunnel(nodeId, tunnelId)
        } else {
          await window.api.ssh.startTunnel(nodeId, tunnelId)
        }
      } catch (err) {
        message.error(mapSshError(err, t))
      }
    },
    [message, t]
  )

  const handleTest = useCallback(
    async (node: SshNodeView) => {
      setTestingId(node.id)
      try {
        const res = await window.api.ssh.test(node.id)
        if (res.ok) {
          message.success(t('sshTestOk', { ms: res.latencyMs }))
        } else {
          message.error(mapSshError(res.error ?? '', t))
        }
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
          await window.api.ssh.deleteNode(node.id)
          setNodes((prev) => prev.filter((n) => n.id !== node.id))
          loadTunnels()
          message.success(t('sshDeleted'))
        }
      })
    },
    [modal, message, t, loadTunnels]
  )

  const handleDeleteTunnel = useCallback(
    (nodeId: string, tunnel: SshTunnelSpec) => {
      modal.confirm({
        title: t('sshDelete'),
        content: t('sshDeleteTunnelConfirm'),
        okText: t('sshDelete'),
        cancelText: t('sshCancel'),
        onOk: async () => {
          await window.api.ssh.removeTunnel(nodeId, tunnel.id!)
          loadTunnels()
          message.success(t('sshTunnelRemoved'))
        }
      })
    },
    [modal, message, t, loadTunnels]
  )

  const tunnelSummary = (spec: SshTunnelSpec, live?: SshTunnelState): string => {
    if (spec.type === 'local') {
      return t('sshFlowLocal', {
        listenAddr: live?.listenAddr || spec.listenAddr || '127.0.0.1',
        localPort: spec.localPort,
        remoteHost: spec.remoteHost,
        remotePort: spec.remotePort
      })
    }
    if (spec.type === 'remote') {
      return t('sshFlowRemote', {
        bindAddr: spec.bindAddr || '127.0.0.1',
        bindPort: live?.bindPort ?? spec.bindPort,
        targetHost: spec.targetHost,
        targetPort: spec.targetPort
      })
    }
    return t('sshFlowSocks', {
      listenAddr: live?.listenAddr || spec.listenAddr || '127.0.0.1',
      localPort: spec.localPort
    })
  }

  const nodesTab = (
    <section className={CARD_CLS}>
      <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
        <span className={LABEL_CLS}>{t('sshNodes')}</span>
        <button
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
          className={ACCENT_BTN_CLS}
        >
          <PlusOutlined />
          {t('sshAddNode')}
        </button>
      </div>

      {nodes.length === 0 ? (
        <Empty description={t('sshNoNodes')} image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-10">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null)
              setEditorOpen(true)
            }}
          >
            {t('sshAddNode')}
          </Button>
        </Empty>
      ) : (
        <div className="divide-y divide-[var(--border-subtle)]">
          {nodes.map((node) => {
            const session = sessionByNode.get(node.id)
            const state = session?.state ?? 'disconnected'
            const connecting = state === 'connecting'
            const connected = state === 'connected'
            const testing = testingId === node.id
            return (
              <div key={node.id} className="px-5 py-4 flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATE_DOT_CLS[state]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {node.name}
                    </span>
                    {state === 'connected' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600">
                        {t('sshConnected')}
                      </span>
                    )}
                    {state === 'connecting' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-600">
                        {t('sshConnecting')}
                      </span>
                    )}
                    {state === 'error' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
                        {t('sshError')}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--text-secondary)] mt-0.5 flex items-center gap-2">
                    <span>
                      {node.username}@{node.host}:{node.port}
                    </span>
                    <span className="px-1 py-px rounded bg-[var(--bg-warm)] border border-[var(--border-subtle)]">
                      {node.authType === 'password' ? t('sshAuthPassword') : t('sshAuthKey')}
                    </span>
                  </div>
                  {session?.error && (
                    <div className="text-[11px] text-red-500 mt-1 truncate">
                      {mapSshError(session.error, t)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleTest(node)}
                    disabled={testing || connected || connecting}
                    title={t('sshTest')}
                    className={BTN_CLS}
                  >
                    {testing ? <LoadingOutlined /> : <ApiOutlined />}
                    {t('sshTest')}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(node)
                      setEditorOpen(true)
                    }}
                    disabled={connected || connecting}
                    title={t('sshEdit')}
                    className={BTN_CLS}
                  >
                    <EditOutlined />
                  </button>
                  <button
                    onClick={() => handleDeleteNode(node)}
                    disabled={connected || connecting}
                    title={t('sshDelete')}
                    className={BTN_CLS}
                  >
                    <DeleteOutlined />
                  </button>
                  <button
                    onClick={() => handleConnect(node)}
                    disabled={connecting}
                    className={connected ? BTN_CLS : ACCENT_BTN_CLS}
                  >
                    {connecting ? (
                      <LoadingOutlined />
                    ) : connected ? (
                      <StopOutlined />
                    ) : (
                      <PlayCircleOutlined />
                    )}
                    {connecting
                      ? t('sshConnecting')
                      : connected
                        ? t('sshDisconnect')
                        : t('sshConnect')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )

  const renderNodeTunnelCards = (filterType?: SshTunnelType): React.JSX.Element => {
    if (nodes.length === 0) {
      return (
        <section className={CARD_CLS}>
          <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
            <span className={LABEL_CLS}>{t('sshTunnels')}</span>
          </div>
          <Empty
            description={t('sshNoNodes')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            className="py-10"
          >
            <Button
              type="primary"
              icon={<CloudServerOutlined />}
              onClick={() => setActiveTab('nodes')}
            >
              {t('sshGoNodes')}
            </Button>
          </Empty>
        </section>
      )
    }

    return (
      <div className="flex flex-col gap-4">
        {nodes.map((node) => {
          const session = sessionByNode.get(node.id)
          const state = session?.state ?? 'disconnected'
          const connected = state === 'connected'
          const connecting = state === 'connecting'
          const expanded = !!expandedNodes[node.id]
          const nodeTunnels = tunnels.filter(
            (t) => t.nodeId === node.id && (!filterType || t.type === filterType)
          )
          const liveMap = new Map(session?.tunnels.map((t) => [t.id, t]) ?? [])
          const typeRunning =
            !!filterType &&
            !!session?.tunnels.some(
              (tun) =>
                tun.type === filterType && (tun.status === 'running' || tun.status === 'starting')
            )
          const displayState = connecting
            ? 'connecting'
            : typeRunning
              ? 'connected'
              : state === 'error'
                ? 'error'
                : 'disconnected'
          const typeConnected = typeRunning
          return (
            <section key={node.id} className={CARD_CLS}>
              <div
                className="px-5 py-3 flex items-center gap-3 cursor-pointer select-none"
                onClick={() => toggleExpanded(node.id)}
              >
                <span className="w-4 flex items-center justify-center text-[var(--text-secondary)] text-xs shrink-0">
                  {expanded ? <DownOutlined /> : <RightOutlined />}
                </span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATE_DOT_CLS[displayState]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {node.name}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    {displayState === 'connected'
                      ? t('sshConnected')
                      : displayState === 'connecting'
                        ? t('sshConnecting')
                        : displayState === 'error'
                          ? t('sshError')
                          : t('sshDisconnected')}
                    {' · '}
                    {t('sshTunnelCount', { count: nodeTunnels.length })}
                  </div>
                  {displayState === 'error' && session?.error && (
                    <div className="text-[11px] text-red-500 mt-0.5 truncate">
                      {mapSshError(session.error, t)}
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setAddModal({ nodeId: node.id, type: filterType ?? 'local' })
                  }}
                  className={BTN_CLS}
                >
                  <PlusOutlined />
                  {t('sshAdd')}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleConnect(node, filterType)
                  }}
                  disabled={connecting}
                  className={typeConnected ? BTN_CLS : ACCENT_BTN_CLS}
                >
                  {connecting ? (
                    <LoadingOutlined />
                  ) : typeConnected ? (
                    <StopOutlined />
                  ) : (
                    <PlayCircleOutlined />
                  )}
                  {connecting
                    ? t('sshConnecting')
                    : typeConnected
                      ? t('sshDisconnect')
                      : t('sshConnect')}
                </button>
              </div>

              {expanded && (
                <>
                  {nodeTunnels.length === 0 ? (
                    <div className="px-5 py-6 text-center text-xs text-[var(--text-secondary)]">
                      {t('sshTunnelsEmpty')}
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
                      {nodeTunnels.map((spec) => {
                        const live = liveMap.get(spec.id!)
                        const running = connected && live?.status === 'running'
                        const starting = live?.status === 'starting' || connecting
                        let dotCls = 'bg-[var(--border-subtle)]'
                        if (connected && live) {
                          if (live.status === 'running') dotCls = 'bg-green-500'
                          else if (live.status === 'error') dotCls = 'bg-red-500'
                          else dotCls = 'bg-amber-400 animate-pulse'
                        }
                        return (
                          <div key={spec.id} className="px-5 py-3 flex items-center gap-3">
                            <button
                              onClick={() => handleToggleTunnel(node.id, spec.id!, running)}
                              disabled={starting}
                              title={running ? t('sshStop') : t('sshStart')}
                              className={
                                running
                                  ? 'w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none transition-all duration-150 bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)] disabled:opacity-40 disabled:cursor-not-allowed'
                                  : 'w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none transition-all duration-150 bg-[var(--accent)] text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed'
                              }
                            >
                              {starting ? (
                                <LoadingOutlined />
                              ) : running ? (
                                <StopOutlined />
                              ) : (
                                <PlayCircleOutlined />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              {spec.name ? (
                                <>
                                  <div className="text-xs font-medium text-[var(--text-primary)] truncate leading-tight">
                                    {spec.name}
                                  </div>
                                  <div className="text-[11px] font-mono text-[var(--text-secondary)] truncate mt-1">
                                    {tunnelSummary(spec, live)}
                                  </div>
                                </>
                              ) : (
                                <code className="text-xs font-mono text-[var(--text-primary)] truncate">
                                  {tunnelSummary(spec, live)}
                                </code>
                              )}
                            </div>
                            {connected && live?.status === 'error' && live.error && (
                              <span className="text-[11px] text-red-500 truncate">
                                {live.error}
                              </span>
                            )}
                            <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
                            <button
                              onClick={() =>
                                setAddModal({
                                  nodeId: node.id,
                                  type: spec.type,
                                  tunnel: spec
                                })
                              }
                              disabled={starting}
                              title={t('sshEdit')}
                              className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none transition-all duration-150 bg-[var(--bg-warm)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <EditOutlined />
                            </button>
                            <button
                              onClick={() => handleDeleteTunnel(node.id, spec)}
                              title={t('sshDelete')}
                              className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none transition-all duration-150 bg-[var(--bg-warm)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]"
                            >
                              <CloseOutlined />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </section>
          )
        })}
      </div>
    )
  }

  const localTab = renderNodeTunnelCards('local')
  const remoteTab = renderNodeTunnelCards('remote')
  const socksTab = renderNodeTunnelCards('socks5')

  const logsTab = (
    <section className={CARD_CLS}>
      <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
        <span className={LABEL_CLS}>{t('sshLogs')}</span>
        <button onClick={clearLogs} disabled={logs.length === 0} className={BTN_CLS}>
          <DeleteOutlined />
          {t('sshClearLogs')}
        </button>
      </div>
      <div
        ref={logBoxRef}
        className="px-5 py-4 max-h-[420px] overflow-auto font-mono text-xs leading-5"
      >
        {logs.length === 0 ? (
          <div className="text-[var(--text-secondary)] text-center py-8">{t('sshLogEmpty')}</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2 py-0.5">
              <span className="text-[var(--text-secondary)] shrink-0">{formatTime(log.time)}</span>
              <span
                className={`shrink-0 w-12 ${
                  log.level === 'error'
                    ? 'text-red-500'
                    : log.level === 'warn'
                      ? 'text-amber-500'
                      : 'text-[var(--text-secondary)]'
                }`}
              >
                {log.level}
              </span>
              <span className="text-[var(--accent)] shrink-0">[{log.nodeName}]</span>
              <span className="text-[var(--text-primary)] break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )

  const tunnelModalLabel = (type: SshTunnelType, editing?: boolean): string => {
    if (editing) {
      if (type === 'local') return t('sshEditLocal')
      if (type === 'remote') return t('sshEditRemote')
      return t('sshEditSocks')
    }
    if (type === 'local') return t('sshAddLocal')
    if (type === 'remote') return t('sshAddRemote')
    return t('sshAddSocks')
  }

  const tabDefs: Array<{ key: string; icon: React.ReactNode; label: string }> = [
    { key: 'nodes', icon: <CloudServerOutlined />, label: t('sshTabNodes') },
    { key: 'local', icon: <ArrowRightOutlined />, label: t('sshTypeLocal') },
    { key: 'remote', icon: <ArrowLeftOutlined />, label: t('sshTypeRemote') },
    { key: 'socks5', icon: <GlobalOutlined />, label: t('sshTypeSocks5') },
    { key: 'logs', icon: <FileTextOutlined />, label: t('sshTabLogs') }
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 bg-[var(--content-bg)]">
        <p className="text-xs text-[var(--text-secondary)] pt-6 px-6 pb-2">{t('sshDesc')}</p>
        <div className="flex items-center border-b border-[var(--border-subtle)] px-6">
          {tabDefs.map((tab) => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative px-3 py-2 text-sm flex items-center gap-1.5 transition-colors cursor-pointer border-none bg-transparent ${
                  active
                    ? 'text-[var(--text-primary)] font-medium'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.icon}
                {tab.label}
                {active && (
                  <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-[var(--accent)]" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="max-w-[760px] ml-6 pr-6 pb-6">
        {activeTab === 'nodes' && nodesTab}
        {activeTab === 'local' && localTab}
        {activeTab === 'remote' && remoteTab}
        {activeTab === 'socks5' && socksTab}
        {activeTab === 'logs' && logsTab}
      </div>

      <Modal
        open={!!addModal}
        title={addModal ? tunnelModalLabel(addModal.type, !!addModal.tunnel) : t('sshAddTunnel')}
        onCancel={() => setAddModal(null)}
        footer={
          <>
            <Button onClick={() => setAddModal(null)}>{t('sshCancel')}</Button>
            <Button
              type="primary"
              loading={addSubmitting}
              onClick={() => {
                tunnelFormRef.current?.submit()
              }}
            >
              {addModal ? tunnelModalLabel(addModal.type, !!addModal.tunnel) : t('sshAddTunnel')}
            </Button>
          </>
        }
        destroyOnHidden
        width={520}
      >
        {addModal && (
          <TunnelForm
            key={addModal.tunnel?.id ?? `new-${addModal.type}-${addModal.nodeId}`}
            ref={tunnelFormRef}
            nodeId={addModal.nodeId}
            fixedType={addModal.type}
            editing={addModal.tunnel}
            onSubmittingChange={setAddSubmitting}
            onAdded={() => {
              loadTunnels()
              const nodeConnected = sessionByNode.get(addModal.nodeId)?.state === 'connected'
              const isEdit = !!addModal.tunnel
              message.success(
                isEdit
                  ? t('sshTunnelUpdated')
                  : nodeConnected
                    ? t('sshTunnelAdded')
                    : t('sshTunnelSavedOffline')
              )
              setAddModal(null)
            }}
            onError={(m) => {
              message.error(m)
            }}
          />
        )}
      </Modal>

      <NodeEditor
        open={editorOpen}
        editing={editing}
        onCancel={() => setEditorOpen(false)}
        onSaved={(node) => {
          setNodes((prev) => {
            const idx = prev.findIndex((n) => n.id === node.id)
            if (idx === -1) return [...prev, node]
            const next = [...prev]
            next[idx] = node
            return next
          })
          setEditorOpen(false)
        }}
      />
    </div>
  )
}

export default SshTunnel
