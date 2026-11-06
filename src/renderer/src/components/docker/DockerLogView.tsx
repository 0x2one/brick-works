import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Empty, InputNumber, Space, Tag } from 'antd'
import { ClearOutlined, PauseOutlined, CaretRightOutlined, StopOutlined } from '@ant-design/icons'

const MAX_BUFFER = 400 * 1024

function fromBase64(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

interface DockerLogViewProps {
  containerId: string
  containerName: string
}

export default function DockerLogView({
  containerId,
  containerName
}: DockerLogViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [buffer, setBuffer] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [tail, setTail] = useState(200)
  const bufferRef = useRef('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const running = Boolean(sessionId)

  const appendData = useCallback((text: string): void => {
    bufferRef.current += text
    if (bufferRef.current.length > MAX_BUFFER) {
      bufferRef.current = bufferRef.current.slice(-Math.floor(MAX_BUFFER * 0.75))
    }
    setBuffer(bufferRef.current)
  }, [])

  const stop = useCallback((): void => {
    const id = sessionIdRef.current
    sessionIdRef.current = null
    setSessionId(null)
    if (id) void window.api.docker.stopLogs(id)
  }, [])

  const start = useCallback(async (): Promise<void> => {
    const res = await window.api.docker.startLogs({ containerId, tail, follow: true })
    bufferRef.current = ''
    setBuffer('')
    setPaused(false)
    sessionIdRef.current = res.sessionId
    setSessionId(res.sessionId)
  }, [containerId, tail])

  useEffect(() => {
    let alive = true
    const begin = async (): Promise<void> => {
      const res = await window.api.docker.startLogs({ containerId, tail, follow: true })
      if (!alive) {
        void window.api.docker.stopLogs(res.sessionId)
        return
      }
      bufferRef.current = ''
      setBuffer('')
      sessionIdRef.current = res.sessionId
      setSessionId(res.sessionId)
    }
    void begin()
    return () => {
      alive = false
      const id = sessionIdRef.current
      sessionIdRef.current = null
      if (id) void window.api.docker.stopLogs(id)
    }
  }, [containerId, tail])

  useEffect(() => {
    const off = window.api.docker.onLogChunk((chunk) => {
      if (chunk.sessionId !== sessionIdRef.current) return
      appendData(fromBase64(chunk.data))
    })
    return off
  }, [appendData])

  useEffect(() => {
    const el = scrollRef.current
    if (el && !paused) el.scrollTop = el.scrollHeight
  }, [buffer, paused])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-subtle)]">
        <Space size={8}>
          <span className="text-xs text-[var(--text-primary)] truncate max-w-[220px]">
            {containerName}
          </span>
          {running ? (
            <Tag color="processing">{t('dockerLogRunning')}</Tag>
          ) : (
            <Tag>{t('dockerLogStopped')}</Tag>
          )}
        </Space>
        <Space size={8}>
          <InputNumber
            size="small"
            min={10}
            max={10000}
            value={tail}
            onChange={(v) => setTail(Number(v) || 200)}
            style={{ width: 90 }}
          />
          <Button
            size="small"
            icon={running ? <StopOutlined /> : <CaretRightOutlined />}
            onClick={() => (running ? stop() : void start())}
          >
            {running ? t('dockerLogStop') : t('dockerLogStart')}
          </Button>
          <Button
            size="small"
            icon={paused ? <CaretRightOutlined /> : <PauseOutlined />}
            disabled={!running}
            onClick={() => setPaused((v) => !v)}
          />
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={() => {
              bufferRef.current = ''
              setBuffer('')
            }}
          />
        </Space>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto bg-[var(--bg-warm)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-all"
      >
        {!buffer && (
          <div className="h-full flex items-center justify-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('dockerLogEmpty')}
              className="scale-90"
            />
          </div>
        )}
        {buffer}
      </div>
    </div>
  )
}
