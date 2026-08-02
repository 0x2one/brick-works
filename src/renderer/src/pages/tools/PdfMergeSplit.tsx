import { useState, useCallback, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import {
  MergeCellsOutlined,
  ScissorOutlined,
  PartitionOutlined,
  FolderOpenOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  FilePdfOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { PDFDocument } from 'pdf-lib'

type Mode = 'merge' | 'split' | 'extract'

interface PdfItem {
  id: string
  name: string
  pageCount: number
  bytes: ArrayBuffer
}

interface OutputFile {
  name: string
  bytes: Uint8Array
}

const LABEL_CLS =
  'block text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] mb-1.5'

const BTN_PRIMARY =
  'px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none bg-[var(--accent)] text-white hover:brightness-110 active:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed'

const BTN_GHOST =
  'px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all duration-150 cursor-pointer border border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--text-primary)] hover:border-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed'

const MODE_ICONS: Record<Mode, ReactNode> = {
  merge: <MergeCellsOutlined />,
  split: <ScissorOutlined />,
  extract: <PartitionOutlined />
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  // Copy into a fresh Uint8Array so BlobPart typing accepts ArrayBuffer-backed views
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Parse "1-3,5,7-10" into 1-indexed inclusive ranges. */
function parsePageRanges(
  input: string,
  maxPage: number
): { ranges: Array<[number, number]>; error?: string } {
  const trimmed = input.trim()
  if (!trimmed) return { ranges: [], error: 'empty' }

  const parts = trimmed.split(/[,，\s]+/).filter(Boolean)
  const ranges: Array<[number, number]> = []

  for (const part of parts) {
    const m = part.match(/^(\d+)(?:\s*[-–~到至]\s*(\d+))?$/)
    if (!m) return { ranges: [], error: 'invalid' }
    const start = parseInt(m[1], 10)
    const end = m[2] ? parseInt(m[2], 10) : start
    if (start < 1 || end < 1 || start > maxPage || end > maxPage || start > end) {
      return { ranges: [], error: 'outOfRange' }
    }
    ranges.push([start, end])
  }

  return { ranges }
}

async function loadPdfItem(file: File): Promise<PdfItem> {
  const bytes = await file.arrayBuffer()
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    pageCount: doc.getPageCount(),
    bytes
  }
}

function PdfMergeSplit({ breadcrumb }: { breadcrumb?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const fileRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>('merge')
  const [files, setFiles] = useState<PdfItem[]>([])
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [rangeInput, setRangeInput] = useState('')
  const [extractAsMultiple, setExtractAsMultiple] = useState(false)
  const [outputs, setOutputs] = useState<OutputFile[]>([])

  const resetOutputs = useCallback(() => setOutputs([]), [])

  const handleModeChange = useCallback(
    (next: Mode) => {
      setMode(next)
      setFiles([])
      setRangeInput('')
      setOutputs([])
    },
    []
  )

  const handleFilesSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files
      if (!selected?.length) return
      setLoading(true)
      resetOutputs()
      try {
        const loaded: PdfItem[] = []
        for (const file of Array.from(selected)) {
          if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            message.error(t('pdfMsInvalidFile', { name: file.name }))
            continue
          }
          try {
            loaded.push(await loadPdfItem(file))
          } catch {
            message.error(t('pdfMsLoadError', { name: file.name }))
          }
        }
        if (mode === 'merge') {
          setFiles((prev) => [...prev, ...loaded])
        } else {
          setFiles(loaded.slice(0, 1))
        }
        if (loaded.length) message.success(t('pdfMsLoaded', { count: loaded.length }))
      } finally {
        setLoading(false)
        e.target.value = ''
      }
    },
    [mode, message, t, resetOutputs]
  )

  const moveFile = useCallback((index: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    resetOutputs()
  }, [resetOutputs])

  const removeFile = useCallback(
    (id: string) => {
      setFiles((prev) => prev.filter((f) => f.id !== id))
      resetOutputs()
    },
    [resetOutputs]
  )

  const handleMerge = useCallback(async () => {
    if (files.length < 2) {
      message.warning(t('pdfMsMergeNeedTwo'))
      return
    }
    setProcessing(true)
    try {
      const merged = await PDFDocument.create()
      for (const item of files) {
        const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true })
        const pages = await merged.copyPages(src, src.getPageIndices())
        pages.forEach((p) => merged.addPage(p))
      }
      const bytes = await merged.save()
      const out = { name: 'merged.pdf', bytes }
      setOutputs([out])
      downloadBytes(bytes, out.name)
      message.success(t('pdfMsMergeSuccess', { count: files.length }))
    } catch {
      message.error(t('pdfMsProcessError'))
    } finally {
      setProcessing(false)
    }
  }, [files, message, t])

  const handleSplit = useCallback(async () => {
    const item = files[0]
    if (!item) {
      message.warning(t('pdfMsNeedOne'))
      return
    }
    setProcessing(true)
    try {
      const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true })
      const base = item.name.replace(/\.pdf$/i, '')
      const results: OutputFile[] = []
      for (let i = 0; i < src.getPageCount(); i++) {
        const doc = await PDFDocument.create()
        const [page] = await doc.copyPages(src, [i])
        doc.addPage(page)
        const bytes = await doc.save()
        results.push({ name: `${base}-p${i + 1}.pdf`, bytes })
      }
      setOutputs(results)
      message.success(t('pdfMsSplitSuccess', { count: results.length }))
    } catch {
      message.error(t('pdfMsProcessError'))
    } finally {
      setProcessing(false)
    }
  }, [files, message, t])

  const handleExtract = useCallback(async () => {
    const item = files[0]
    if (!item) {
      message.warning(t('pdfMsNeedOne'))
      return
    }
    const { ranges, error } = parsePageRanges(rangeInput, item.pageCount)
    if (error === 'empty') {
      message.warning(t('pdfMsRangeEmpty'))
      return
    }
    if (error === 'invalid') {
      message.error(t('pdfMsRangeInvalid'))
      return
    }
    if (error === 'outOfRange') {
      message.error(t('pdfMsRangeOutOfBounds', { max: item.pageCount }))
      return
    }

    setProcessing(true)
    try {
      const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true })
      const base = item.name.replace(/\.pdf$/i, '')

      if (extractAsMultiple) {
        const results: OutputFile[] = []
        for (let r = 0; r < ranges.length; r++) {
          const [start, end] = ranges[r]
          const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i)
          const doc = await PDFDocument.create()
          const pages = await doc.copyPages(src, indices)
          pages.forEach((p) => doc.addPage(p))
          const bytes = await doc.save()
          const suffix = start === end ? `p${start}` : `p${start}-${end}`
          results.push({ name: `${base}-${suffix}.pdf`, bytes })
        }
        setOutputs(results)
        message.success(t('pdfMsExtractSuccess', { count: results.length }))
      } else {
        const indices = ranges.flatMap(([start, end]) =>
          Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i)
        )
        const doc = await PDFDocument.create()
        const pages = await doc.copyPages(src, indices)
        pages.forEach((p) => doc.addPage(p))
        const bytes = await doc.save()
        const out = { name: `${base}-extract.pdf`, bytes }
        setOutputs([out])
        downloadBytes(bytes, out.name)
        message.success(t('pdfMsExtractSuccess', { count: 1 }))
      }
    } catch {
      message.error(t('pdfMsProcessError'))
    } finally {
      setProcessing(false)
    }
  }, [files, rangeInput, extractAsMultiple, message, t])

  const handleDownloadAll = useCallback(async () => {
    for (let i = 0; i < outputs.length; i++) {
      downloadBytes(outputs[i].bytes, outputs[i].name)
      if (i < outputs.length - 1) {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
  }, [outputs])

  const totalPages = files.reduce((sum, f) => sum + f.pageCount, 0)
  const acceptMultiple = mode === 'merge'

  return (
    <div className="p-6">
      <div className="sticky top-0 z-10 bg-[var(--content-bg)] pb-1">
        {breadcrumb ?? <div className="mb-4" />}

        <div className="mb-4">
          <label className={LABEL_CLS}>{t('pdfMsMode')}</label>
          <div className="flex flex-wrap gap-2">
            {(['merge', 'split', 'extract'] as const).map((m) => (
              <button key={m} onClick={() => handleModeChange(m)} className={`toggle-pill ${mode === m ? 'active' : ''}`}>
                <span className="flex items-center gap-1.5 pill-label">
                  {MODE_ICONS[m]}
                  {t(`pdfMsMode${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">
        {mode === 'merge' && t('pdfMsMergeHint')}
        {mode === 'split' && t('pdfMsSplitHint')}
        {mode === 'extract' && t('pdfMsExtractHint')}
      </p>

      {/* Upload zone */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        className="w-full py-8 px-4 mb-4 rounded-lg border-2 border-dashed border-[var(--border-subtle)]
          bg-[var(--surface)] text-sm text-[var(--text-secondary)]
          flex flex-col items-center gap-2
          hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]
          transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FolderOpenOutlined className="text-2xl" />
        <span>{loading ? t('pdfMsLoading') : acceptMultiple ? t('pdfMsSelectMultiple') : t('pdfMsSelectOne')}</span>
        <span className="text-xs opacity-70">{t('pdfMsAcceptHint')}</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple={acceptMultiple}
        onChange={handleFilesSelected}
        className="hidden"
      />

      {/* File list */}
      {files.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className={LABEL_CLS + ' mb-0'}>
              {t('pdfMsFileList')} · {t('pdfMsPageSummary', { files: files.length, pages: totalPages })}
            </label>
            {mode === 'merge' && (
              <button type="button" onClick={() => fileRef.current?.click()} className={BTN_GHOST}>
                <PlusOutlined />
                {t('pdfMsAddMore')}
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {files.map((file, index) => (
              <li
                key={file.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]"
              >
                <FilePdfOutlined className="text-[var(--accent)] text-lg shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text-primary)] truncate font-medium">{file.name}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    {t('pdfMsPages', { count: file.pageCount })} · {formatSize(file.bytes.byteLength)}
                  </div>
                </div>
                {mode === 'merge' && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveFile(index, -1)}
                      disabled={index === 0}
                      className={BTN_GHOST}
                      title={t('pdfMsMoveUp')}
                    >
                      <ArrowUpOutlined />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveFile(index, 1)}
                      disabled={index === files.length - 1}
                      className={BTN_GHOST}
                      title={t('pdfMsMoveDown')}
                    >
                      <ArrowDownOutlined />
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(file.id)}
                  className={BTN_GHOST}
                  title={t('pdfMsRemove')}
                >
                  <DeleteOutlined />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Extract options */}
      {mode === 'extract' && files.length > 0 && (
        <div className="mb-4 space-y-3">
          <div>
            <label className={LABEL_CLS}>{t('pdfMsRangeLabel')}</label>
            <input
              type="text"
              value={rangeInput}
              onChange={(e) => {
                setRangeInput(e.target.value)
                resetOutputs()
              }}
              placeholder={t('pdfMsRangePlaceholder')}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]
                text-sm text-[var(--text-primary)] outline-none
                focus:border-[var(--accent)] transition-colors duration-150"
            />
            <p className="mt-1.5 text-xs text-[var(--text-secondary)]">{t('pdfMsRangeExample')}</p>
          </div>
          <div>
            <label className={LABEL_CLS}>{t('pdfMsExtractOutput')}</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setExtractAsMultiple(false)
                  resetOutputs()
                }}
                className={`toggle-pill ${!extractAsMultiple ? 'active' : ''}`}
              >
                <span className="pill-label">{t('pdfMsExtractSingle')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExtractAsMultiple(true)
                  resetOutputs()
                }}
                className={`toggle-pill ${extractAsMultiple ? 'active' : ''}`}
              >
                <span className="pill-label">{t('pdfMsExtractMulti')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action */}
      {files.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {mode === 'merge' && (
            <button type="button" onClick={handleMerge} disabled={processing || files.length < 2} className={BTN_PRIMARY}>
              <MergeCellsOutlined />
              {processing ? t('pdfMsProcessing') : t('pdfMsDoMerge')}
            </button>
          )}
          {mode === 'split' && (
            <button type="button" onClick={handleSplit} disabled={processing} className={BTN_PRIMARY}>
              <ScissorOutlined />
              {processing ? t('pdfMsProcessing') : t('pdfMsDoSplit')}
            </button>
          )}
          {mode === 'extract' && (
            <button type="button" onClick={handleExtract} disabled={processing || !rangeInput.trim()} className={BTN_PRIMARY}>
              <PartitionOutlined />
              {processing ? t('pdfMsProcessing') : t('pdfMsDoExtract')}
            </button>
          )}
        </div>
      )}

      {/* Outputs */}
      {outputs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={LABEL_CLS + ' mb-0'}>
              {t('pdfMsOutputList')} · {outputs.length}
            </label>
            {outputs.length > 1 && (
              <button type="button" onClick={handleDownloadAll} className={BTN_GHOST}>
                <DownloadOutlined />
                {t('pdfMsDownloadAll')}
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {outputs.map((out) => (
              <li
                key={out.name}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]"
              >
                <FilePdfOutlined className="text-[var(--accent)] text-lg shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text-primary)] truncate font-medium">{out.name}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    {formatSize(out.bytes.byteLength)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => downloadBytes(out.bytes, out.name)}
                  className={BTN_PRIMARY}
                >
                  <DownloadOutlined />
                  {t('pdfMsDownload')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default PdfMergeSplit
