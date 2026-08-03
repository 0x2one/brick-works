import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { App, ColorPicker, Image, Spin } from 'antd'
import {
  SnippetsOutlined,
  ReloadOutlined,
  CheckOutlined,
  PaperClipOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  DownloadOutlined,
  PictureOutlined,
  CloseOutlined,
  PlusOutlined
} from '@ant-design/icons'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

const PANEL_HEADER_CLS = 'text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]'
const INPUT_LABEL_CLS = 'block text-xs font-medium text-[var(--text-secondary)] mb-1.5'

type ToolMode = 'generate' | 'decode'
type DecodeMode = 'clipboard' | 'file' | 'url' | 'drop'

const TOOL_MODES: Array<{ key: ToolMode; labelKey: string }> = [
  { key: 'generate', labelKey: 'qrModeGenerate' },
  { key: 'decode', labelKey: 'qrModeDecode' }
]

const DECODE_MODES: Array<{ key: DecodeMode; labelKey: string }> = [
  { key: 'clipboard', labelKey: 'qrDecModeClipboard' },
  { key: 'file', labelKey: 'qrDecModeFile' },
  { key: 'url', labelKey: 'qrDecModeUrl' },
  { key: 'drop', labelKey: 'qrDecModeDrop' }
]

type EcLevel = 'L' | 'M' | 'Q' | 'H'
const EC_LEVELS: EcLevel[] = ['L', 'M', 'Q', 'H']
const QR_SIZES = [256, 512, 1024]
const LOGO_RATIOS = [0.15, 0.2, 0.25]
const LOGO_EMOJIS = ['🚀', '⭐', '❤️', '🔥', '🎯', '💡', '📦', '🐱', '🍀', '🌈']

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function emojiToDataUrl(emoji: string, size = 128): string {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${size * 0.72}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.02)
  return c.toDataURL('image/png')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

async function decodeImageDataUrl(
  dataUrl: string
): Promise<{ text: string; version: number } | null> {
  const img = await loadImage(dataUrl)
  const maxDim = 2000
  let w = img.naturalWidth
  let h = img.naturalHeight
  if (!w || !h) return null
  const scale = Math.min(1, maxDim / Math.max(w, h))
  w = Math.max(1, Math.round(w * scale))
  h = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)
  const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' })
  if (!code) return null
  return { text: code.data, version: code.version }
}

function drawLogo(canvas: HTMLCanvasElement, logoDataUrl: string, ratio: number): Promise<void> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const side = Math.round(canvas.width * ratio)
        const x = (canvas.width - side) / 2
        const y = (canvas.height - side) / 2
        const pad = Math.max(4, Math.round(side * 0.12))
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.roundRect(x - pad, y - pad, side + pad * 2, side + pad * 2, pad)
        ctx.fill()
        ctx.drawImage(img, x, y, side, side)
      }
      resolve()
    }
    img.onerror = () => resolve()
    img.src = logoDataUrl
  })
}

const dashedBtnCls = `
  w-full py-8 px-4 rounded-lg border-2 border-dashed border-[var(--border-subtle)]
  bg-[var(--surface)] text-sm text-[var(--text-secondary)]
  flex flex-col items-center gap-2
  hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]
  transition-all duration-150 cursor-pointer
`

function QrCodeTool({ breadcrumb }: { breadcrumb?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [toolMode, setToolMode] = useState<ToolMode>('generate')

  // ── Generate ──
  const [content, setContent] = useState('')
  const [ecLevel, setEcLevel] = useState<EcLevel>('M')
  const [fgColor, setFgColor] = useState('#000000')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [qrSize, setQrSize] = useState(512)
  const [logoEnabled, setLogoEnabled] = useState(false)
  const [logoEmoji, setLogoEmoji] = useState('🚀')
  const [logoImageDataUrl, setLogoImageDataUrl] = useState<string | null>(null)
  const [logoRatio, setLogoRatio] = useState(0.2)
  const [generated, setGenerated] = useState<string | null>(null)
  const logoFileRef = useRef<HTMLInputElement>(null)

  // ── Decode ──
  const [subMode, setSubMode] = useState<DecodeMode>('clipboard')
  const [url, setUrl] = useState('')
  const [decodeImage, setDecodeImage] = useState<string | null>(null)
  const [decodeResult, setDecodeResult] = useState<{ text: string; version: number } | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Generate ──
  const handleGenerate = useCallback(async () => {
    if (!content.trim()) return
    const canvas = document.createElement('canvas')
    try {
      await QRCode.toCanvas(canvas, content, {
        errorCorrectionLevel: ecLevel,
        margin: 2,
        width: qrSize,
        color: { dark: `${fgColor}ff`, light: `${bgColor}ff` }
      })
      if (logoEnabled) {
        const logoDataUrl = logoImageDataUrl ?? emojiToDataUrl(logoEmoji)
        if (logoDataUrl) await drawLogo(canvas, logoDataUrl, logoRatio)
      }
      setGenerated(canvas.toDataURL('image/png'))
    } catch {
      message.error(t('qrGenError'))
    }
  }, [
    content,
    ecLevel,
    fgColor,
    bgColor,
    qrSize,
    logoEnabled,
    logoImageDataUrl,
    logoEmoji,
    logoRatio,
    t,
    message
  ])

  const handleLogoFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    blobToBase64(file).then((dataUrl) => {
      setLogoImageDataUrl(dataUrl)
      setLogoEnabled(true)
    })
  }, [])

  const handleDownload = useCallback((dataUrl: string) => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = 'qrcode.png'
    a.click()
  }, [])

  // ── Decode ──
  const runDecode = useCallback(
    async (dataUrl: string) => {
      setDecoding(true)
      setDecodeResult(null)
      setDecodeImage(dataUrl)
      setCopied(false)
      try {
        const result = await decodeImageDataUrl(dataUrl)
        if (result) {
          setDecodeResult(result)
          message.success(t('qrDecSuccess'))
        } else {
          message.info(t('qrDecNotFound'))
        }
      } catch {
        message.error(t('qrDecError'))
      }
      setDecoding(false)
    },
    [message, t]
  )

  const handleClipboardRead = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((x) => x.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          const dataUrl = await blobToBase64(blob)
          runDecode(dataUrl)
          return
        }
      }
      message.info(t('imgToBase64NoImageClipboard'))
    } catch {
      message.error(t('imgToBase64PasteError'))
    }
  }, [runDecode, message, t])

  // Global paste: screenshot → Ctrl+V directly decodes
  useEffect(() => {
    if (toolMode !== 'decode' || subMode !== 'clipboard') return
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) {
            blobToBase64(blob).then((dataUrl) => runDecode(dataUrl))
          }
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [toolMode, subMode, runDecode])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      blobToBase64(file).then((dataUrl) => runDecode(dataUrl))
    },
    [runDecode]
  )

  const handleUrlDecode = useCallback(async () => {
    if (!url.trim()) return
    try {
      const dataUrl = await window.api.fetchImage(url.trim())
      if (!dataUrl) {
        message.error(t('imgToBase64FetchError'))
        return
      }
      runDecode(dataUrl)
    } catch {
      message.error(t('imgToBase64FetchError'))
    }
  }, [url, runDecode, message, t])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      if (!file.type.startsWith('image/')) return
      blobToBase64(file).then((dataUrl) => runDecode(dataUrl))
    },
    [runDecode]
  )

  const handleCopyText = useCallback(
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

  const handleSwitchDecodeMode = useCallback((m: DecodeMode) => {
    setSubMode(m)
    setDecodeImage(null)
    setDecodeResult(null)
    setCopied(false)
  }, [])

  const generateBtnCls = `
    w-full py-2.5 px-6 rounded-lg text-sm font-semibold
    flex items-center justify-center gap-2
    transition-all duration-150 cursor-pointer border-none
    bg-[var(--accent)] text-white
    hover:brightness-110 active:brightness-90
    disabled:opacity-40 disabled:cursor-not-allowed
  `

  return (
    <div className="flex flex-col p-6" style={{ height: 'calc(100vh - 56px)' }}>
      {breadcrumb ? <div className="mb-3 shrink-0">{breadcrumb}</div> : <div className="mb-3" />}

      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
        {/* ── Mode switch ── */}
        <section>
          <div className="flex gap-1 flex-wrap">
            {TOOL_MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setToolMode(m.key)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border-none transition-all duration-100
                  ${
                    toolMode === m.key
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-secondary)] bg-[var(--bg-warm)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)]'
                  }`}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        </section>

        {/* ── Generate panel ── */}
        {toolMode === 'generate' && (
          <section>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_240px] gap-4 items-start">
                {/* Left: content + preview */}
                <div className="min-w-0">
                  <label className={INPUT_LABEL_CLS}>{t('qrGenContent')}</label>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={4}
                    placeholder={t('qrGenContentPlaceholder')}
                    spellCheck={false}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)]
                      bg-white dark:bg-[var(--surface)] text-[var(--text-primary)]
                      text-sm outline-none resize-vertical focus:border-[var(--accent)] transition-colors duration-150 font-mono"
                  />
                  <button
                    onClick={handleGenerate}
                    disabled={!content.trim()}
                    className={generateBtnCls + ' mt-3'}
                  >
                    <ReloadOutlined />
                    {t('qrGenGenerate')}
                  </button>

                  <div className="mt-5">
                    <div className={PANEL_HEADER_CLS + ' mb-2'}>{t('qrGenPreview')}</div>
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-warm)] p-4 flex items-center justify-center min-h-[220px]">
                      {generated ? (
                        <Image
                          src={generated}
                          alt="qr"
                          width={224}
                          preview={{ mask: t('qrGenPreview') }}
                        />
                      ) : (
                        <span className="text-sm text-[var(--text-secondary)] opacity-50 italic">
                          {t('clickGenerate')}
                        </span>
                      )}
                    </div>
                    {generated && (
                      <button
                        onClick={() => handleDownload(generated)}
                        className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold
                          flex items-center gap-2 transition-all duration-150 cursor-pointer border-none
                          bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
                          hover:bg-[var(--border-subtle)]"
                      >
                        <DownloadOutlined />
                        {t('qrGenDownload')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Right: options */}
                <div className="space-y-4">
                  <div>
                    <label className={INPUT_LABEL_CLS}>{t('qrGenEcLevel')}</label>
                    <div className="flex rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                      {EC_LEVELS.map((lv) => (
                        <button
                          key={lv}
                          onClick={() => setEcLevel(lv)}
                          className={`flex-1 px-2 py-1.5 text-xs font-medium cursor-pointer border-none transition-all duration-100
                            ${
                              ecLevel === lv
                                ? 'bg-[var(--accent)] text-white'
                                : 'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                        >
                          {lv}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)] mt-1">
                      {t('qrGenEcHint')}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={INPUT_LABEL_CLS}>{t('qrGenFgColor')}</label>
                      <ColorPicker
                        value={fgColor}
                        onChange={(c) => setFgColor(c.toHexString())}
                        disabledAlpha
                        showText
                        className="!w-full"
                      />
                    </div>
                    <div>
                      <label className={INPUT_LABEL_CLS}>{t('qrGenBgColor')}</label>
                      <ColorPicker
                        value={bgColor}
                        onChange={(c) => setBgColor(c.toHexString())}
                        disabledAlpha
                        showText
                        className="!w-full"
                      />
                    </div>
                  </div>

                  <div>
                    <label className={INPUT_LABEL_CLS}>{t('qrGenSize')}</label>
                    <div className="flex rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                      {QR_SIZES.map((s) => (
                        <button
                          key={s}
                          onClick={() => setQrSize(s)}
                          className={`flex-1 px-2 py-1.5 text-xs font-medium cursor-pointer border-none transition-all duration-100
                            ${
                              qrSize === s
                                ? 'bg-[var(--accent)] text-white'
                                : 'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Logo */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className={INPUT_LABEL_CLS + ' !mb-0'}>{t('qrGenLogo')}</span>
                      <button
                        onClick={() => setLogoEnabled(!logoEnabled)}
                        className={`px-3 h-7 rounded-md text-xs font-semibold cursor-pointer border transition-all duration-100
                          ${
                            logoEnabled
                              ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                              : 'bg-transparent text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                          }`}
                      >
                        {logoEnabled ? t('qrGenLogoOn') : t('qrGenLogoOff')}
                      </button>
                    </div>

                    {logoEnabled && (
                      <div className="mt-2 space-y-3">
                        <div className="flex gap-1.5 flex-wrap">
                          {LOGO_EMOJIS.map((e) => (
                            <button
                              key={e}
                              onClick={() => setLogoEmoji(e)}
                              className={`w-8 h-8 rounded-lg text-lg cursor-pointer border transition-all duration-100
                                ${
                                  !logoImageDataUrl && logoEmoji === e
                                    ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                                    : 'border-[var(--border-subtle)] bg-transparent hover:border-[var(--text-secondary)]'
                                }`}
                            >
                              {e}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            ref={logoFileRef}
                            type="file"
                            accept="image/*"
                            onChange={handleLogoFileChange}
                            className="hidden"
                          />
                          <button
                            onClick={() => logoFileRef.current?.click()}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                              text-[var(--text-secondary)] border border-[var(--border-subtle)]
                              hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]
                              transition-all duration-150 cursor-pointer bg-transparent"
                          >
                            <PlusOutlined />
                            {t('qrGenLogoImage')}
                          </button>
                          {logoImageDataUrl && (
                            <>
                              <img
                                src={logoImageDataUrl}
                                alt="logo"
                                className="w-8 h-8 rounded object-contain border border-[var(--border-subtle)] bg-white"
                              />
                              <button
                                onClick={() => setLogoImageDataUrl(null)}
                                className="flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)]
                                  hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]
                                  transition-all duration-150 cursor-pointer border-none bg-transparent"
                              >
                                <CloseOutlined style={{ fontSize: 11 }} />
                              </button>
                            </>
                          )}
                        </div>

                        <div>
                          <label className={INPUT_LABEL_CLS}>{t('qrGenLogoSize')}</label>
                          <div className="flex rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                            {LOGO_RATIOS.map((r) => (
                              <button
                                key={r}
                                onClick={() => setLogoRatio(r)}
                                className={`flex-1 px-2 py-1.5 text-xs font-medium cursor-pointer border-none transition-all duration-100
                                  ${
                                    logoRatio === r
                                      ? 'bg-[var(--accent)] text-white'
                                      : 'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                                  }`}
                              >
                                {Math.round(r * 100)}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Decode panel ── */}
        {toolMode === 'decode' && (
          <section>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] p-4">
              {/* Sub mode pills */}
              <div className="flex gap-1 flex-wrap mb-4">
                {DECODE_MODES.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => handleSwitchDecodeMode(m.key)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border-none transition-all duration-100
                      ${
                        subMode === m.key
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text-secondary)] bg-[var(--bg-warm)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)]'
                      }`}
                  >
                    {t(m.labelKey)}
                  </button>
                ))}
              </div>

              {subMode === 'clipboard' && (
                <div className="mb-4">
                  <button onClick={handleClipboardRead} className={dashedBtnCls}>
                    <PaperClipOutlined style={{ fontSize: 24 }} />
                    <span>{t('qrDecPasteHint')}</span>
                  </button>
                </div>
              )}

              {subMode === 'file' && (
                <div className="mb-4">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button onClick={() => fileRef.current?.click()} className={dashedBtnCls}>
                    <FolderOpenOutlined style={{ fontSize: 24 }} />
                    <span>{t('qrDecSelectFile')}</span>
                  </button>
                </div>
              )}

              {subMode === 'url' && (
                <div className="mb-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUrlDecode()}
                      placeholder={t('qrDecUrlPlaceholder')}
                      spellCheck={false}
                      className="flex-1 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)]
                        text-sm text-[var(--text-primary)] outline-none
                        focus:border-[var(--accent)] transition-colors duration-150"
                    />
                    <button
                      onClick={handleUrlDecode}
                      disabled={!url.trim() || decoding}
                      className="px-4 py-2 rounded-lg text-sm font-semibold
                        flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
                        bg-[var(--accent)] text-white
                        hover:brightness-110 active:brightness-90
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <LinkOutlined />
                      {t('qrDecDecode')}
                    </button>
                  </div>
                </div>
              )}

              {subMode === 'drop' && (
                <div
                  className={dashedBtnCls + ' mb-4 min-h-[140px]'}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                >
                  <PictureOutlined style={{ fontSize: 24 }} />
                  <span>{t('qrDecDropHint')}</span>
                </div>
              )}

              {/* Result */}
              {decodeImage && (
                <div>
                  <div className={PANEL_HEADER_CLS + ' mb-2'}>{t('qrDecResult')}</div>
                  <div className="flex gap-4">
                    <div className="w-32 h-32 shrink-0 rounded-lg overflow-hidden bg-[var(--bg-warm)] border border-[var(--border-subtle)] flex items-center justify-center">
                      <Image
                        src={decodeImage}
                        alt="source"
                        className="w-full h-full object-contain"
                        preview={{ mask: null }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      {decoding ? (
                        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] py-4">
                          <Spin size="small" />
                          {t('qrDecDecoding')}
                        </div>
                      ) : decodeResult ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <code className="flex-1 px-3 py-2 rounded-md bg-[var(--bg-warm)] text-sm font-mono text-[var(--text-primary)] break-all select-all">
                              {decodeResult.text}
                            </code>
                            <button
                              onClick={() => handleCopyText(decodeResult.text)}
                              className="shrink-0 flex items-center justify-center w-8 h-8 rounded text-[var(--text-secondary)]
                                hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]
                                transition-all duration-150 cursor-pointer border-none bg-transparent"
                            >
                              {copied ? (
                                <CheckOutlined style={{ color: 'var(--accent)', fontSize: 14 }} />
                              ) : (
                                <SnippetsOutlined style={{ fontSize: 14 }} />
                              )}
                            </button>
                          </div>
                          <div className="text-[11px] text-[var(--text-secondary)]">
                            {t('qrDecVersion')}: {decodeResult.version}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-[var(--text-secondary)] italic py-4">
                          {t('qrDecNotFound')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default QrCodeTool
