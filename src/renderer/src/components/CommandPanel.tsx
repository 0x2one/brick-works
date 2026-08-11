import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Empty, Form, Input, Modal, Segmented } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SendOutlined,
  SnippetsOutlined
} from '@ant-design/icons'

interface SshSnippet {
  id: string
  category: string
  name: string
  command: string
}

const STORAGE_KEY = 'ssh-snippets'

const DEFAULT_SNIPPETS: SshSnippet[] = [
  { id: 'd1', category: '系统', name: '磁盘占用', command: 'df -h' },
  { id: 'd2', category: '系统', name: '内存使用', command: 'free -m' },
  { id: 'd3', category: '系统', name: 'CPU 负载', command: 'uptime' },
  { id: 'd4', category: '系统', name: '实时进程', command: 'top' },
  { id: 'd5', category: '系统', name: '端口监听', command: 'ss -tulnp' },
  { id: 'd6', category: '系统', name: '系统信息', command: 'uname -a' },
  { id: 'd7', category: '服务', name: '服务状态', command: 'systemctl status' },
  {
    id: 'd8',
    category: '服务',
    name: '全部服务',
    command: 'systemctl list-units --type=service --all'
  },
  { id: 'd9', category: 'Docker', name: '容器列表', command: 'docker ps -a' },
  { id: 'd10', category: 'Docker', name: '镜像列表', command: 'docker images' }
]

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function newId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

interface CommandPanelProps {
  shellSessionId: string | null
}

function CommandPanel({ shellSessionId }: CommandPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [snippets, setSnippets] = useState<SshSnippet[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as SshSnippet[]
        if (Array.isArray(parsed)) return parsed
      }
    } catch {
      // ignore
    }
    return DEFAULT_SNIPPETS
  })
  const [category, setCategory] = useState('all')
  const [editing, setEditing] = useState<SshSnippet | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [form] = Form.useForm<{ category: string; name: string; command: string }>()

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets))
  }, [snippets])

  const categories = useMemo(() => {
    const set = new Set<string>(snippets.map((s) => s.category || t('sshCmdDefaultCat')))
    return ['all', ...Array.from(set)]
  }, [snippets, t])

  const filtered = useMemo(
    () =>
      category === 'all'
        ? snippets
        : snippets.filter((s) => (s.category || t('sshCmdDefaultCat')) === category),
    [category, snippets, t]
  )

  const send = useCallback(
    (command: string): void => {
      if (!shellSessionId) {
        message.warning(t('sshCmdNeedSession'))
        return
      }
      void window.api.ssh.writeShell(shellSessionId, toBase64(command + '\n'))
    },
    [shellSessionId, message, t]
  )

  const openEdit = useCallback(
    (snip: SshSnippet | null): void => {
      setEditing(snip)
      setEditorOpen(true)
      form.setFieldsValue(
        snip ?? { category: '', name: '', command: '' }
      )
    },
    [form]
  )

  const submit = useCallback(async (): Promise<void> => {
    const values = await form.validateFields()
    const categoryVal = values.category.trim() || t('sshCmdDefaultCat')
    const nameVal = values.name.trim()
    const commandVal = values.command.trim()
    if (!nameVal || !commandVal) {
      message.warning(t('sshCmdInvalid'))
      return
    }
    if (editing) {
      setSnippets((prev) =>
        prev.map((s) =>
          s.id === editing.id ? { ...s, category: categoryVal, name: nameVal, command: commandVal } : s
        )
      )
    } else {
      setSnippets((prev) => [...prev, { id: newId(), category: categoryVal, name: nameVal, command: commandVal }])
    }
    setEditorOpen(false)
  }, [editing, form, message, t])

  const remove = useCallback(
    (snip: SshSnippet): void => {
      setSnippets((prev) => prev.filter((s) => s.id !== snip.id))
    },
    []
  )

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openEdit(null)}
          >
            {t('sshCmdAdd')}
          </Button>
          <Segmented
            size="small"
            value={category}
            onChange={(v) => setCategory(String(v))}
            options={categories.map((c) => ({ label: c, value: c }))}
            className="min-w-0 flex-1 overflow-hidden"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2">
        {filtered.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('sshCmdEmpty')} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {filtered.map((snip) => (
              <div
                key={snip.id}
                className="group flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-1.5"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 bg-transparent border-none cursor-pointer text-left"
                  onClick={() => send(snip.command)}
                  title={`${snip.command}\n\n${t('sshCmdSendHint')}`}
                >
                  <div className="truncate text-xs font-medium text-[var(--text-primary)]">
                    <SnippetsOutlined className="mr-1 text-[var(--text-secondary)]" />
                    {snip.name}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-secondary)]">
                    {snip.command}
                  </div>
                </button>
                <button
                  type="button"
                  className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                  title={t('sshCmdSend')}
                  onClick={() => send(snip.command)}
                >
                  <SendOutlined className="text-xs" />
                </button>
                <button
                  type="button"
                  className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                  title={t('sshEdit')}
                  onClick={() => openEdit(snip)}
                >
                  <EditOutlined className="text-xs" />
                </button>
                <button
                  type="button"
                  className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-md border-none cursor-pointer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border-subtle)] hover:text-[var(--danger)]"
                  title={t('sshDelete')}
                  onClick={() => remove(snip)}
                >
                  <DeleteOutlined className="text-xs" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={editorOpen}
        title={editing ? t('sshCmdEdit') : t('sshCmdAdd')}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void submit()}
        okText={t('sshSave')}
        cancelText={t('sshCancel')}
        destroyOnHidden
        centered
        width={460}
      >
        <Form form={form} layout="vertical" className="mt-1" size="middle">
          <div className="grid grid-cols-2 gap-x-3">
            <Form.Item name="category" label={t('sshCmdCategory')}>
              <Input placeholder="系统 / 服务 / Docker" />
            </Form.Item>
            <Form.Item name="name" label={t('sshCmdName')} rules={[{ required: true }]}>
              <Input placeholder="磁盘占用" />
            </Form.Item>
          </div>
          <Form.Item name="command" label={t('sshCmdCommand')} rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder="df -h" autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default CommandPanel
