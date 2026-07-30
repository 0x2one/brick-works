import { useState, useCallback, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Image } from 'antd'
import {
  LinkOutlined,
  PaperClipOutlined,
  FolderOpenOutlined,
  SwapOutlined,
  CopyOutlined,
  DownloadOutlined,
  CheckOutlined
} from '@ant-design/icons'

const MODES = ['url', 'clipboard', 'file', 'reverse'] as const

const MODE_ICONS: Record<string, ReactNode> = {
  url: <LinkOutlined />,
  clipboard: <PaperClipOutlined />,
  file: <FolderOpenOutlined />,
  reverse: <SwapOutlined />
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function isValidDataUrl(s: string): boolean {
  return /^data:image\/[\w+-]+;base64,/.test(s.trim())
}

const LABEL_CLS =
  'block text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] mb-1.5'

function ImageToBase64({ breadcrumb }: { breadcrumb?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<string>('url')
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [result, setResult] = useState<{ dataUrl: string; base64: string } | null>(null)
  const [reverseInput, setReverseInput] = useState('')
  const [reversePreview, setReversePreview] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleFetchUrl = useCallback(async () => {
    if (!url.trim()) return
    setFetching(true)
    setResult(null)
    try {
      const dataUrl = await window.api.fetchImage(url.trim())
      if (!dataUrl) {
        message.error(t('imgToBase64FetchError'))
        setFetching(false)
        return
      }
      const base64 = dataUrl.split(',')[1]
      setResult({ dataUrl, base64 })
      message.success(t('imgToBase64Success'))
    } catch {
      message.error(t('imgToBase64FetchError'))
    }
    setFetching(false)
  }, [url, t, message])

  const handlePaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          const dataUrl = await blobToBase64(blob)
          const base64 = dataUrl.split(',')[1]
          setResult({ dataUrl, base64 })
          message.success(t('imgToBase64Success'))
          return
        }
      }
      message.info(t('imgToBase64NoImageClipboard'))
    } catch {
      message.error(t('imgToBase64PasteError'))
    }
  }, [t, message])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const dataUrl = await blobToBase64(file)
      const base64 = dataUrl.split(',')[1]
      setResult({ dataUrl, base64 })
      message.success(t('imgToBase64Success'))
    },
    [t, message]
  )

  const handleReverse = useCallback(() => {
    const input = reverseInput.trim()
    if (!input) return
    const fullDataUrl = input.startsWith('data:') ? input : `data:image/png;base64,${input}`
    if (!isValidDataUrl(fullDataUrl)) {
      message.error(t('imgToBase64InvalidBase64'))
      return
    }
    setReversePreview(fullDataUrl)
  }, [reverseInput, t, message])

  const handleCopyBase64 = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        message.success(t('copied'))
        setTimeout(() => setCopied(false), 2000)
      } catch {
        message.error(t('copyFailed'))
      }
    },
    [t, message]
  )

  const handleDownload = useCallback((dataUrl: string) => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `image.${dataUrl.split(';')[0].split('/')[1] || 'png'}`
    a.click()
  }, [])

  return (
    <div>
      <div className="sticky top-0 z-10 bg-[var(--content-bg)]">
        {breadcrumb ?? <div className="mb-4" />}

        {/* Mode pills */}
        <div className="mb-4">
          <label className={LABEL_CLS}>{t('imgToBase64InputMode')}</label>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m)
                  setResult(null)
                  setReversePreview(null)
                }}
                className={`toggle-pill ${mode === m ? 'active' : ''}`}
              >
                <span className="flex items-center gap-1.5 pill-label">
                  {MODE_ICONS[m]}
                  {t(`imgToBase64Mode${m.charAt(0).toUpperCase() + m.slice(1)}`)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* URL mode */}
        {mode === 'url' && (
          <div className="mb-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchUrl()}
                placeholder={t('imgToBase64UrlPlaceholder')}
                className="flex-1 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]
                  text-sm text-[var(--text-primary)] outline-none
                  focus:border-[var(--accent)] transition-colors duration-150"
              />
              <button
                onClick={handleFetchUrl}
                disabled={fetching || !url.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold
                  flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
                  bg-[var(--accent)] text-white
                  hover:brightness-110 active:brightness-90
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('imgToBase64Fetch')}
              </button>
            </div>
          </div>
        )}

        {/* Clipboard mode */}
        {mode === 'clipboard' && (
          <div className="mb-4">
            <button
              onClick={handlePaste}
              className="w-full py-8 px-4 rounded-lg border-2 border-dashed border-[var(--border-subtle)]
                bg-[var(--surface)] text-sm text-[var(--text-secondary)]
                flex flex-col items-center gap-2
                hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]
                transition-all duration-150 cursor-pointer"
            >
              <PaperClipOutlined style={{ fontSize: 24 }} />
              <span>{t('imgToBase64PasteHint')}</span>
            </button>
          </div>
        )}

        {/* File mode */}
        {mode === 'file' && (
          <div className="mb-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-8 px-4 rounded-lg border-2 border-dashed border-[var(--border-subtle)]
                bg-[var(--surface)] text-sm text-[var(--text-secondary)]
                flex flex-col items-center gap-2
                hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]
                transition-all duration-150 cursor-pointer"
            >
              <FolderOpenOutlined style={{ fontSize: 24 }} />
              <span>{t('imgToBase64SelectFile')}</span>
            </button>
          </div>
        )}

        {/* Reverse mode */}
        {mode === 'reverse' && (
          <div className="mb-4">
            <textarea
              value={reverseInput}
              onChange={(e) => setReverseInput(e.target.value)}
              placeholder={t('imgToBase64ReversePlaceholder')}
              rows={10}
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]
                text-xs font-mono text-[var(--text-primary)] outline-none resize-vertical
                focus:border-[var(--accent)] transition-colors duration-150"
            />
            <button
              onClick={handleReverse}
              disabled={!reverseInput.trim()}
              className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold
                flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
                bg-[var(--accent)] text-white
                hover:brightness-110 active:brightness-90
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('imgToBase64Render')}
            </button>
          </div>
        )}
      </div>

      {/* Preview + result */}
      {mode !== 'reverse' && result && (
        <div className="mt-8 border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--surface)]">
          {/* Image preview */}
          <div className="p-5 flex justify-center bg-[var(--bg-warm)] border-b border-[var(--border-subtle)]">
            <div
              className="w-32 h-32 rounded-lg overflow-hidden bg-white
              flex items-center justify-center shadow-sm"
            >
              <Image
                src={result.dataUrl}
                alt="preview"
                className="w-full h-full object-contain"
                preview={{ mask: null }}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 pt-5 pb-3 flex gap-3 flex-wrap">
            <button
              onClick={() => handleCopyBase64(result.base64)}
              className="px-5 py-2 rounded-lg text-sm font-semibold
                flex items-center gap-2 transition-all duration-150 cursor-pointer border-none
                bg-[var(--accent)] text-white hover:brightness-110 active:brightness-90"
            >
              {copied ? <CheckOutlined /> : <CopyOutlined />}
              {copied ? t('copied') : t('imgToBase64CopyBase64')}
            </button>
            <button
              onClick={() => handleDownload(result.dataUrl)}
              className="px-5 py-2 rounded-lg text-sm font-semibold
                flex items-center gap-2 transition-all duration-150 cursor-pointer border-none
                bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
                hover:bg-[var(--border-subtle)]"
            >
              <DownloadOutlined />
              {t('imgToBase64Download')}
            </button>
          </div>

          {/* Base64 output */}
          <div className="px-6 pb-6">
            <textarea
              value={result.dataUrl}
              readOnly
              rows={6}
              spellCheck={false}
              className="w-full px-4 py-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-warm)]
                text-[12px] font-mono text-[var(--text-primary)] outline-none resize-vertical select-all leading-relaxed"
            />
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              {t('imgToBase64Size')}: {result.base64.length} chars
            </p>
          </div>
        </div>
      )}

      {/* Reverse result */}
      {mode === 'reverse' && reversePreview && (
        <div className="mt-8 border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--surface)]">
          <div className="p-5 flex justify-center bg-[var(--bg-warm)] border-b border-[var(--border-subtle)]">
            <div
              className="w-32 h-32 rounded-lg overflow-hidden bg-white
              flex items-center justify-center shadow-sm"
            >
              <Image
                src={reversePreview}
                alt="preview"
                className="w-full h-full object-contain"
                preview={{ mask: null }}
              />
            </div>
          </div>
          <div className="px-6 py-5">
            <button
              onClick={() => handleDownload(reversePreview!)}
              className="px-5 py-2 rounded-lg text-sm font-semibold
                flex items-center gap-2 transition-all duration-150 cursor-pointer border-none
                bg-[var(--accent)] text-white hover:brightness-110 active:brightness-90"
            >
              <DownloadOutlined />
              {t('imgToBase64Download')}
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !reversePreview && !(mode === 'reverse' && reverseInput) && (
        <div className="mt-8 border-2 border-dashed border-[var(--border-subtle)] rounded-lg py-12 text-center">
          <p className="text-sm text-[var(--text-secondary)] opacity-50 italic">
            {mode === 'reverse' ? t('imgToBase64ReverseHint') : t('imgToBase64NoImage')}
          </p>
        </div>
      )}
    </div>
  )
}

export default ImageToBase64
