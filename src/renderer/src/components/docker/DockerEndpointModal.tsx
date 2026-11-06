import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Form, Input, InputNumber, Modal, Segmented, Select, Switch } from 'antd'

const DEFAULT_PIPE = '//./pipe/docker_engine'
const DEFAULT_SOCKET = '/var/run/docker.sock'

interface DockerEndpointModalProps {
  open: boolean
  endpoint: DockerEndpointView | null
  sshNodes: SshNodeView[]
  wslDistros: string[]
  onClose: () => void
  onSubmit: (input: DockerEndpointInput) => Promise<void>
}

interface EndpointFormValues {
  name: string
  pipePath: string
  host: string
  port: number
  distro: string
  wslMode: 'cli' | 'tcp'
  wslPort: number
  sshNodeId?: string
  remoteSocketPath: string
  remoteHost: string
  remotePort: number
  caPath: string
  certPath: string
  keyPath: string
  keyPassphrase: string
}

function DockerEndpointForm({
  endpoint,
  sshNodes,
  wslDistros,
  onClose,
  onSubmit
}: Omit<DockerEndpointModalProps, 'open'>): React.JSX.Element {
  const { t } = useTranslation()
  const [form] = Form.useForm<EndpointFormValues>()
  const [type, setType] = useState<DockerEndpointType>(endpoint?.type ?? 'pipe')
  const [tlsEnabled, setTlsEnabled] = useState(
    Boolean(endpoint?.tls?.caPath || endpoint?.tls?.certPath || endpoint?.tls?.keyPath)
  )
  const [saving, setSaving] = useState(false)

  const initialValues = useMemo<EndpointFormValues>(
    () => ({
      name: endpoint?.name ?? '',
      pipePath: endpoint?.pipePath ?? DEFAULT_PIPE,
      host: endpoint?.host ?? '127.0.0.1',
      port: endpoint?.port ?? 2375,
      distro: endpoint?.distro ?? wslDistros[0] ?? '',
      wslMode: endpoint?.wslMode ?? 'cli',
      wslPort: endpoint?.wslPort ?? 2375,
      sshNodeId: endpoint?.sshNodeId ?? undefined,
      remoteSocketPath: endpoint?.remoteSocketPath ?? DEFAULT_SOCKET,
      remoteHost: endpoint?.remoteHost ?? '',
      remotePort: endpoint?.remotePort ?? 2375,
      caPath: endpoint?.tls?.caPath ?? '',
      certPath: endpoint?.tls?.certPath ?? '',
      keyPath: endpoint?.tls?.keyPath ?? '',
      keyPassphrase: ''
    }),
    [endpoint, wslDistros]
  )

  const typeOptions = useMemo(
    () => [
      { value: 'pipe', label: t('dockerTypePipe') },
      { value: 'tcp', label: t('dockerTypeTcp') },
      { value: 'wsl', label: t('dockerTypeWsl') },
      { value: 'ssh', label: t('dockerTypeSsh') }
    ],
    [t]
  )

  const submit = async (): Promise<void> => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const input: DockerEndpointInput = {
        id: endpoint?.id,
        name: values.name,
        type,
        pipePath: type === 'pipe' ? values.pipePath : undefined,
        host: type === 'tcp' ? values.host : undefined,
        port: type === 'tcp' ? values.port : undefined,
        tls:
          type === 'tcp' && tlsEnabled
            ? {
                caPath: values.caPath,
                certPath: values.certPath,
                keyPath: values.keyPath,
                keyPassphrase: values.keyPassphrase
              }
            : undefined,
        distro: type === 'wsl' ? values.distro : undefined,
        wslMode: type === 'wsl' ? values.wslMode : undefined,
        wslPort: type === 'wsl' && values.wslMode === 'tcp' ? values.wslPort : undefined,
        sshNodeId: type === 'ssh' ? values.sshNodeId : undefined,
        remoteSocketPath: type === 'ssh' ? values.remoteSocketPath : undefined,
        remoteHost: type === 'ssh' ? values.remoteHost : undefined,
        remotePort: type === 'ssh' && values.remoteHost ? values.remotePort : undefined
      }
      await onSubmit(input)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={endpoint ? t('dockerEditEndpoint') : t('dockerAddEndpoint')}
      okText={t('dockerSave')}
      cancelText={t('dockerCancel')}
      confirmLoading={saving}
      /* Render inline (no portal) so the dialog stays inside the page area */
      getContainer={false}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
      width={560}
    >
      <div className="pt-2">
        <Segmented
          block
          value={type}
          onChange={(value) => setType(value as DockerEndpointType)}
          options={typeOptions}
        />
      </div>
      <Form
        form={form}
        layout="vertical"
        className="mt-4"
        requiredMark={false}
        initialValues={initialValues}
      >
        <Form.Item
          name="name"
          label={t('dockerName')}
          rules={[{ required: true, message: t('dockerNameRequired') }]}
        >
          <Input placeholder={t('dockerNamePlaceholder')} />
        </Form.Item>

        {type === 'pipe' && (
          <Form.Item name="pipePath" label={t('dockerPipePath')}>
            <Input placeholder={DEFAULT_PIPE} />
          </Form.Item>
        )}

        {type === 'tcp' && (
          <>
            <Form.Item
              name="host"
              label={t('dockerHost')}
              rules={[{ required: true, message: t('dockerHostRequired') }]}
            >
              <Input placeholder="127.0.0.1" />
            </Form.Item>
            <Form.Item name="port" label={t('dockerPort')}>
              <InputNumber min={1} max={65535} className="w-full" />
            </Form.Item>
            <Form.Item label={t('dockerTls')}>
              <Switch checked={tlsEnabled} onChange={setTlsEnabled} />
            </Form.Item>
            {tlsEnabled && (
              <>
                <Form.Item name="caPath" label={t('dockerCaPath')}>
                  <Input placeholder="ca.pem" />
                </Form.Item>
                <Form.Item name="certPath" label={t('dockerCertPath')}>
                  <Input placeholder="cert.pem" />
                </Form.Item>
                <Form.Item name="keyPath" label={t('dockerKeyPath')}>
                  <Input placeholder="key.pem" />
                </Form.Item>
                <Form.Item name="keyPassphrase" label={t('dockerKeyPassphrase')}>
                  <Input.Password placeholder={t('dockerKeyPassphrasePlaceholder')} />
                </Form.Item>
              </>
            )}
          </>
        )}

        {type === 'wsl' && (
          <>
            <Form.Item name="distro" label={t('dockerDistro')}>
              <Select
                allowClear
                showSearch
                placeholder={t('dockerDistroPlaceholder')}
                options={wslDistros.map((d) => ({ value: d, label: d }))}
              />
            </Form.Item>
            <Form.Item name="wslMode" label={t('dockerWslMode')}>
              <Segmented
                block
                options={[
                  { value: 'cli', label: t('dockerWslModeCli') },
                  { value: 'tcp', label: t('dockerWslModeTcp') }
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.wslMode !== next.wslMode}>
              {({ getFieldValue }) =>
                getFieldValue('wslMode') === 'tcp' ? (
                  <Form.Item name="wslPort" label={t('dockerWslPort')}>
                    <InputNumber min={1} max={65535} className="w-full" />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
            <p className="text-[11px] text-[var(--text-secondary)] m-0">{t('dockerWslHint')}</p>
          </>
        )}

        {type === 'ssh' && (
          <>
            <Form.Item
              name="sshNodeId"
              label={t('dockerSshNode')}
              rules={[{ required: true, message: t('dockerSshNodeRequired') }]}
            >
              <Select
                showSearch
                placeholder={t('dockerSshNodePlaceholder')}
                options={sshNodes.map((n) => ({ value: n.id, label: `${n.name} (${n.host})` }))}
              />
            </Form.Item>
            <Form.Item name="remoteSocketPath" label={t('dockerRemoteSocket')}>
              <Input placeholder={DEFAULT_SOCKET} />
            </Form.Item>
            <Form.Item name="remoteHost" label={t('dockerRemoteHost')}>
              <Input placeholder="127.0.0.1" />
            </Form.Item>
            <Form.Item name="remotePort" label={t('dockerRemotePort')}>
              <InputNumber min={1} max={65535} className="w-full" />
            </Form.Item>
            <p className="text-[11px] text-[var(--text-secondary)] m-0">{t('dockerSshHint')}</p>
          </>
        )}
      </Form>
    </Modal>
  )
}

export default function DockerEndpointModal({
  open,
  endpoint,
  sshNodes,
  wslDistros,
  onClose,
  onSubmit
}: DockerEndpointModalProps): React.JSX.Element | null {
  // Mounting the form only while open gives it a fresh state on every open.
  if (!open) return null
  return (
    <DockerEndpointForm
      endpoint={endpoint}
      sshNodes={sshNodes}
      wslDistros={wslDistros}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  )
}
