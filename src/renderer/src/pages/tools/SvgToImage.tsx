import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Image, InputNumber, Spin } from 'antd'
import {
  SnippetsOutlined,
  CheckOutlined,
  PaperClipOutlined,
  LinkOutlined,
  DownloadOutlined,
  CloseOutlined,
  PictureOutlined
} from '@ant-design/icons'

const PANEL_HEADER_CLS = 'text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]'
const INPUT_LABEL_CLS = 'block text-xs font-medium text-[var(--text-secondary)] mb-1.5'

type InputMode = 'file' | 'url'
type OutputFormat = 'png' | 'jpg' | 'webp'

const INPUT_MODES: Array<{ key: InputMode; labelKey: string }> = [
  { key: 'file', labelKey: 'svgToImgModeFile' },
  { key: 'url', labelKey: 'svgToImgModeUrl' }
]

const FORMATS: Array<{ key: OutputFormat; label: string }> = [
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
  { key: 'webp', label: 'WEBP' }
]

interface SvgSizes {
  width?: number
  height?: number
  viewBox?: { w: number; h: number }
}

function parseSvgSize(svgText: string): SvgSizes {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const root = doc.documentElement
    const parseLen = (v: string | null): number | undefined => {
      if (!v) return undefined
      const n = parseFloat(v)
      return Number.isFinite(n) && n > 0 ? n : undefined
    }
    const width = parseLen(root.getAttribute('width'))
    const height = parseLen(root.getAttribute('height'))
    let viewBox: SvgSizes['viewBox']
    const vb = root.getAttribute('viewBox')
    if (vb) {
      const parts = vb
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
        viewBox = { w: parts[2], h: parts[3] }
      }
    }
    return { width, height, viewBox }
  } catch {
    return {}
  }
}

function resolveIntrinsic(svgText: string): { w: number; h: number } {
  const s = parseSvgSize(svgText)
  let w = s.width
  let h = s.height
  if (w && h) {
    return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
  }
  if (w && s.viewBox) {
    h = (w * s.viewBox.h) / s.viewBox.w
  } else if (h && s.viewBox) {
    w = (h * s.viewBox.w) / s.viewBox.h
  } else if (s.viewBox) {
    w = 512
    h = (512 * s.viewBox.h) / s.viewBox.w
  } else {
    w = w ?? 512
    h = h ?? 512
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

async function renderSvg(
  svgText: string,
  outWidth: number,
  outHeight: number,
  bg: 'transparent' | 'white',
  format: OutputFormat
): Promise<{ dataUrl: string; sizeBytes: number }> {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = outWidth
  canvas.height = outHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  if (bg === 'white' || format === 'jpg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outWidth, outHeight)
  }
  ctx.drawImage(img, 0, 0, outWidth, outHeight)
  const type = format === 'png' ? 'image/png' : format === 'jpg' ? 'image/jpeg' : 'image/webp'
  const quality = format === 'png' ? undefined : 0.92
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('toBlob failed'))
          return
        }
        const reader = new FileReader()
        reader.onload = () => resolve({ dataUrl: reader.result as string, sizeBytes: blob.size })
        reader.onerror = reject
        reader.readAsDataURL(blob)
      },
      type,
      quality
    )
  })
}

const dashedBtnCls = `
  w-full py-8 px-4 rounded-lg border-2 border-dashed border-[var(--border-subtle)]
  bg-[var(--surface)] text-sm text-[var(--text-secondary)]
  flex flex-col items-center gap-2
  hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]
  transition-all duration-150 cursor-pointer
`

function SvgToImage({ breadcrumb }: { breadcrumb?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [inputMode, setInputMode] = useState<InputMode>('file')
  const [url, setUrl] = useState('')
  const [svgText, setSvgText] = useState<string | null>(null)
  const [svgName, setSvgName] = useState('')
  const [intrinsic, setIntrinsic] = useState<{ w: number; h: number } | null>(null)

  const [format, setFormat] = useState<OutputFormat>('png')
  const [width, setWidth] = useState(512)
  const [height, setHeight] = useState(512)
  const [lockRatio, setLockRatio] = useState(true)
  const [bg, setBg] = useState<'transparent' | 'white'>('transparent')

  const [result, setResult] = useState<{ dataUrl: string; sizeBytes: number } | null>(null)
  const [converting, setConverting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const applySvg = useCallback((text: string, name: string) => {
    setSvgText(text)
    setSvgName(name)
    const { w, h } = resolveIntrinsic(text)
    setIntrinsic({ w, h })
    setWidth(w)
    setHeight(h)
    setResult(null)
  }, [])

  const handleFileChange = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith('.svg') && !file.type.includes('svg')) {
        message.error(t('svgToImgInvalidFile'))
        return
      }
      file.text().then((text) => applySvg(text, file.name))
    },
    [applySvg, t, message]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      handleFileChange(file)
    },
    [handleFileChange]
  )

  const handleUrlFetch = useCallback(async () => {
    if (!url.trim()) return
    try {
      const text = await window.api.fetchSvg(url.trim())
      if (!text) {
        message.error(t('svgToImgFetchError'))
        return
      }
      const name = url.trim().split('/').pop()?.split('?')[0] || 'image.svg'
      applySvg(text, name)
    } catch {
      message.error(t('svgToImgFetchError'))
    }
  }, [url, applySvg, message, t])

  // Auto convert whenever source or options change
  useEffect(() => {
    if (!svgText) return
    let cancelled = false
    const outW = Math.max(1, Math.round(width))
    const outH = Math.max(1, Math.round(height))
    const timer = window.setTimeout(() => {
      setConverting(true)
      renderSvg(svgText, outW, outH, bg, format)
        .then((r) => {
          if (cancelled) return
          setResult(r)
        })
        .catch(() => {
          if (!cancelled) message.error(t('svgToImgConvertError'))
        })
        .finally(() => {
          if (!cancelled) setConverting(false)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [svgText, width, height, bg, format, t, message])

  const setWidthKeepRatio = useCallback(
    (v: number | null) => {
      if (v == null) return
      const w = Math.max(1, Math.round(v))
      setWidth(w)
      if (lockRatio && intrinsic && intrinsic.h) {
        setHeight(Math.max(1, Math.round((w * intrinsic.h) / intrinsic.w)))
      }
    },
    [lockRatio, intrinsic]
  )

  const setHeightKeepRatio = useCallback(
    (v: number | null) => {
      if (v == null) return
      const h = Math.max(1, Math.round(v))
      setHeight(h)
      if (lockRatio && intrinsic && intrinsic.w) {
        setWidth(Math.max(1, Math.round((h * intrinsic.w) / intrinsic.h)))
      }
    },
    [lockRatio, intrinsic]
  )

  const handleResetSize = useCallback(() => {
    if (!intrinsic) return
    setWidth(intrinsic.w)
    setHeight(intrinsic.h)
  }, [intrinsic])

  const handleDownload = useCallback(() => {
    if (!result) return
    const a = document.createElement('a')
    const base = (svgName || 'image').replace(/\.[^.]+$/, '')
    a.href = result.dataUrl
    a.download = `${base}.${format}`
    a.click()
  }, [result, svgName, format])

  const handleCopyImage = useCallback(async () => {
    if (!result) return
    try {
      const blob = await (await fetch(result.dataUrl)).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      message.success(t('copied'))
    } catch {
      message.error(t('copyFailed'))
    }
  }, [result, message, t])

  const [copied, setCopied] = useState(false)

  const handleCopyDataUrl = useCallback(async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.dataUrl)
      setCopied(true)
      message.success(t('copied'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      message.error(t('copyFailed'))
    }
  }, [result, t, message])

  return (
    <div className="flex flex-col p-6" style={{ height: 'calc(100vh - 56px)' }}>
      {breadcrumb ? <div className="mb-3 shrink-0">{breadcrumb}</div> : <div className="mb-3" />}

      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
        {/* ── Input ── */}
        <section>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] p-4">
            {/* Mode pills */}
            <div className="flex gap-1 flex-wrap mb-4">
              {INPUT_MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => {
                    setInputMode(m.key)
                    setUrl('')
                  }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border-none transition-all duration-100
                    ${
                      inputMode === m.key
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-secondary)] bg-[var(--bg-warm)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)]'
                    }`}
                >
                  {t(m.labelKey)}
                </button>
              ))}
            </div>

            {inputMode === 'file' ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".svg,image/svg+xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileChange(file)
                    e.target.value = ''
                  }}
                  className="hidden"
                />
                <div
                  className={dashedBtnCls + ' min-h-[120px]'}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                >
                  <PictureOutlined style={{ fontSize: 24 }} />
                  <span>{t('svgToImgDropHint')}</span>
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUrlFetch()}
                  placeholder={t('svgToImgUrlPlaceholder')}
                  spellCheck={false}
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)]
                    text-sm text-[var(--text-primary)] outline-none
                    focus:border-[var(--accent)] transition-colors duration-150"
                />
                <button
                  onClick={handleUrlFetch}
                  disabled={!url.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-semibold
                    flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
                    bg-[var(--accent)] text-white
                    hover:brightness-110 active:brightness-90
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <LinkOutlined />
                  {t('svgToImgFetch')}
                </button>
              </div>
            )}

            {svgText && (
              <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span className="truncate font-mono">{svgName || 'SVG'}</span>
                {intrinsic && (
                  <span className="shrink-0">
                    · {intrinsic.w} × {intrinsic.h}
                  </span>
                )}
                <button
                  onClick={() => fileRef.current?.click()}
                  className="shrink-0 text-[var(--accent)] hover:brightness-110 transition-all duration-150 cursor-pointer border-none bg-transparent"
                >
                  {t('svgToImgReplace')}
                </button>
                <button
                  onClick={() => {
                    setSvgText(null)
                    setSvgName('')
                    setIntrinsic(null)
                    setResult(null)
                  }}
                  className="shrink-0 flex items-center gap-0.5 text-[var(--text-secondary)]
                    hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer border-none bg-transparent"
                >
                  <CloseOutlined style={{ fontSize: 10 }} />
                  {t('svgToImgClear')}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Options ── */}
        <section>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] p-4 space-y-4">
            <div>
              <label className={INPUT_LABEL_CLS}>{t('svgToImgFormat')}</label>
              <div className="flex rounded-lg border border-[var(--border-subtle)] overflow-hidden max-w-[320px]">
                {FORMATS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFormat(f.key)}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium cursor-pointer border-none transition-all duration-100
                      ${
                        format === f.key
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={INPUT_LABEL_CLS}>{t('svgToImgSize')}</label>
              <div className="flex items-center gap-2">
                <InputNumber<number>
                  size="large"
                  min={1}
                  max={8192}
                  value={width}
                  onChange={setWidthKeepRatio}
                  className="!w-28"
                />
                <span className="text-[var(--text-secondary)]">×</span>
                <InputNumber<number>
                  size="large"
                  min={1}
                  max={8192}
                  value={height}
                  onChange={setHeightKeepRatio}
                  className="!w-28"
                />
                <button
                  onClick={() => setLockRatio(!lockRatio)}
                  title={t('svgToImgLockRatio')}
                  className={`h-10 px-3 rounded-lg text-xs font-semibold cursor-pointer border transition-all duration-100 flex items-center gap-1
                    ${
                      lockRatio
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'bg-transparent text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                    }`}
                >
                  <PaperClipOutlined style={{ fontSize: 12 }} />
                  {t('svgToImgLockRatio')}
                </button>
                <button
                  onClick={handleResetSize}
                  disabled={!intrinsic}
                  className="h-10 px-3 rounded-lg text-xs font-semibold cursor-pointer border transition-all duration-100
                    bg-transparent text-[var(--text-secondary)] border-[var(--border-subtle)]
                    hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('svgToImgReset')}
                </button>
              </div>
            </div>

            <div>
              <label className={INPUT_LABEL_CLS}>{t('svgToImgBackground')}</label>
              <div className="flex rounded-lg border border-[var(--border-subtle)] overflow-hidden max-w-[240px]">
                {(
                  [
                    { key: 'transparent', labelKey: 'svgToImgBgTransparent' },
                    { key: 'white', labelKey: 'svgToImgBgWhite' }
                  ] as const
                ).map((b) => (
                  <button
                    key={b.key}
                    onClick={() => setBg(b.key)}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium cursor-pointer border-none transition-all duration-100
                      ${
                        bg === b.key
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                  >
                    {t(b.labelKey)}
                  </button>
                ))}
              </div>
              {format === 'jpg' && bg === 'transparent' && (
                <div className="text-[10px] text-[var(--text-secondary)] mt-1">
                  {t('svgToImgJpgNoAlpha')}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Result ── */}
        <section>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] p-4">
            <div className={PANEL_HEADER_CLS + ' mb-2'}>{t('svgToImgResult')}</div>
            {converting && !result && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] py-4">
                <Spin size="small" />
                {t('svgToImgConverting')}
              </div>
            )}
            {result ? (
              <div className="flex flex-col items-center gap-3">
                <div
                  className="rounded-lg border border-[var(--border-subtle)] p-3 flex items-center justify-center"
                  style={{
                    backgroundImage:
                      'conic-gradient(#e5e5e5 0 25%, #fff 0 50%, #e5e5e5 0 75%, #fff 0)',
                    backgroundSize: '16px 16px'
                  }}
                >
                  <Image
                    src={result.dataUrl}
                    alt="result"
                    width={224}
                    preview={{ mask: t('svgToImgPreview') }}
                  />
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {Math.round(width)} × {Math.round(height)} ·{' '}
                  {(result.sizeBytes / 1024).toFixed(1)} KB
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                  <button
                    onClick={handleDownload}
                    className="px-5 py-2 rounded-lg text-sm font-semibold
                      flex items-center gap-2 transition-all duration-150 cursor-pointer border-none
                      bg-[var(--accent)] text-white hover:brightness-110 active:brightness-90"
                  >
                    <DownloadOutlined />
                    {t('svgToImgDownload')}
                  </button>
                  <button
                    onClick={handleCopyImage}
                    className="px-5 py-2 rounded-lg text-sm font-semibold
                      flex items-center gap-2 transition-all duration-150 cursor-pointer border-none
                      bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
                      hover:bg-[var(--border-subtle)]"
                  >
                    <SnippetsOutlined />
                    {t('svgToImgCopyImage')}
                  </button>
                  <button
                    onClick={handleCopyDataUrl}
                    className="px-5 py-2 rounded-lg text-sm font-semibold
                      flex items-center gap-2 transition-all duration-150 cursor-pointer border-none
                      bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
                      hover:bg-[var(--border-subtle)]"
                  >
                    {copied ? (
                      <CheckOutlined style={{ color: 'var(--accent)' }} />
                    ) : (
                      <SnippetsOutlined />
                    )}
                    {copied ? t('copied') : t('svgToImgCopyDataUrl')}
                  </button>
                </div>
              </div>
            ) : (
              !converting && (
                <div className="border-2 border-dashed border-[var(--border-subtle)] rounded-lg py-10 text-center">
                  <p className="text-sm text-[var(--text-secondary)] opacity-50 italic">
                    {t('svgToImgNoResult')}
                  </p>
                </div>
              )
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default SvgToImage
