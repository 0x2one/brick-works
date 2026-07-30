import { useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import {
  CodeOutlined, CompressOutlined, SnippetsOutlined, DownloadOutlined,
  ColumnWidthOutlined, ColumnHeightOutlined, DeleteOutlined,
  FolderOpenOutlined, EyeOutlined, EyeInvisibleOutlined,
  ArrowUpOutlined, ArrowDownOutlined
} from '@ant-design/icons'

function sortKeysAsc(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysAsc)
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((acc: Record<string, unknown>, key) => {
      acc[key] = sortKeysAsc((obj as Record<string, unknown>)[key])
      return acc
    }, {})
  }
  return obj
}

function sortKeysDesc(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysDesc)
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).sort().reverse().reduce((acc: Record<string, unknown>, key) => {
      acc[key] = sortKeysDesc((obj as Record<string, unknown>)[key])
      return acc
    }, {})
  }
  return obj
}

function decodeUnicode(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

const SORT_OPTIONS = ['default', 'asc', 'desc'] as const
const PANEL_HEADER_CLS = 'text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]'

function JsonBeautify({ breadcrumb }: { breadcrumb?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [mode, setMode] = useState<'format' | 'minify'>('format')
  const [layout, setLayout] = useState<'horizontal' | 'vertical'>('horizontal')
  const [sort, setSort] = useState<string>('default')
  const [folded, setFolded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const formatJSON = useCallback((text: string, fmtMode: 'format' | 'minify', sortMode: string): void => {
    if (!text.trim()) return
    try {
      const parsed = JSON.parse(text.trim())
      let sorted = parsed
      if (sortMode === 'asc') sorted = sortKeysAsc(parsed)
      else if (sortMode === 'desc') sorted = sortKeysDesc(parsed)
      const formatted = JSON.stringify(sorted, null, fmtMode === 'format' ? 2 : undefined)
      setOutput(formatted)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('jsonParseError'))
      setOutput('')
    }
  }, [t])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text')
    try {
      JSON.parse(pasted.trim())
      setInput(pasted)
      formatJSON(pasted, mode, sort)
    } catch { }
  }, [mode, sort, formatJSON])

  const handleCopy = useCallback(async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      message.success(t('copied'))
    } catch {
      message.error(t('copyFailed'))
    }
  }, [output, t, message])

  const handleDownload = useCallback(() => {
    if (!output) return
    const blob = new Blob([output], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'data.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [output])

  const handleFileOpen = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setInput(reader.result as string)
      setOutput('')
      setError(null)
    }
    reader.readAsText(file)
  }, [])

  const handleModeChange = useCallback((newMode: 'format' | 'minify') => {
    setMode(newMode)
    if (input.trim()) {
      formatJSON(input, newMode, sort)
    }
  }, [input, sort, formatJSON])

  const handleSortChange = useCallback((newSort: string) => {
    setSort(newSort)
    if (input.trim()) {
      formatJSON(input, mode, newSort)
    }
  }, [input, mode, formatJSON])

  const toggleFold = useCallback(() => setFolded(v => !v), [])

  const displayOutput = useMemo(() => {
    if (!output && !error) return ''
    if (error) return error
    if (folded) {
      const oneLine = output.replace(/\s+/g, ' ')
      return oneLine.length > 120 ? oneLine.slice(0, 120) + '...' : oneLine
    }
    return output
  }, [output, error, folded])

  const hasContent = !!input.trim()
  const inputStats = input ? `${input.length} chars · ${input.split('\n').length} lines` : ''

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-[var(--content-bg)] pb-3">
        {breadcrumb ?? <div className="mb-3" />}

        {/* Header bar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Format / Minify */}
          <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg">
            <button
              onClick={() => handleModeChange('format')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer border-none flex items-center gap-1.5
                ${mode === 'format'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent'
                }`}
            >
              <CodeOutlined />
              {t('jsonFormat')}
            </button>
            <button
              onClick={() => handleModeChange('minify')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer border-none flex items-center gap-1.5
                ${mode === 'minify'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent'
                }`}
            >
              <CompressOutlined />
              {t('jsonMinify')}
            </button>
          </div>

          <div className="w-px h-5 bg-[var(--border-subtle)]" />

          {/* Layout toggle */}
          <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg">
            <button
              onClick={() => setLayout('horizontal')}
              className={`p-1.5 rounded-md text-xs transition-all duration-150 cursor-pointer border-none leading-none
                ${layout === 'horizontal'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent'
                }`}
              title="Left-Right"
            >
              <ColumnWidthOutlined />
            </button>
            <button
              onClick={() => setLayout('vertical')}
              className={`p-1.5 rounded-md text-xs transition-all duration-150 cursor-pointer border-none leading-none
                ${layout === 'vertical'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent'
                }`}
              title="Top-Bottom"
            >
              <ColumnHeightOutlined />
            </button>
          </div>

          <div className="w-px h-5 bg-[var(--border-subtle)]" />

          {/* Sort */}
          <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg">
            {SORT_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => handleSortChange(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer border-none flex items-center gap-1
                  ${sort === s
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent'
                  }`}
              >
                {s === 'asc' && <ArrowUpOutlined />}
                {s === 'desc' && <ArrowDownOutlined />}
                {s === 'default' ? t('jsonSortDefault') : s === 'asc' ? t('jsonSortAsc') : t('jsonSortDesc')}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-[var(--border-subtle)]" />

          {/* Decode + Open File */}
          <button
            onClick={() => {
              if (input) {
                setInput(decodeUnicode(input))
                message.success(t('jsonDecoded'))
              }
            }}
            disabled={!input}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold
              flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
              bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
              hover:bg-[var(--border-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('jsonDecode')}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold
              flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
              bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
              hover:bg-[var(--border-subtle)]"
          >
            <FolderOpenOutlined />
            {t('jsonOpenFile')}
          </button>
          <button
            onClick={() => { setInput(''); setOutput(''); setError(null) }}
            disabled={!hasContent}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold
              flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
              bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
              hover:bg-[var(--border-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <DeleteOutlined />
            {t('jsonClear')}
          </button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFileOpen} className="hidden" />

      {/* Two-panel area */}
      <div className={`flex-1 min-h-0 flex gap-3 ${layout === 'vertical' ? 'flex-col' : ''}`}>
        {/* Input panel */}
        <div className={`flex flex-col ${layout === 'vertical' ? 'flex-1' : 'flex-1'} min-h-0`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className={PANEL_HEADER_CLS}>{t('jsonInput')}</span>
            <span className="text-[10px] text-[var(--text-secondary)]">{inputStats}</span>
          </div>
          <textarea
            value={input}
            onChange={e => { setInput(e.target.value); setOutput(''); setError(null) }}
            onPaste={handlePaste}
            placeholder={t('jsonInputPlaceholder')}
            spellCheck={false}
            className="flex-1 w-full px-4 py-3 rounded-lg border border-[var(--border-subtle)]
              bg-white text-[var(--text-primary)]
              font-mono text-[13px] leading-relaxed outline-none resize-none
              focus:border-[var(--accent)] transition-colors duration-150"
          />
        </div>

        {/* Result panel */}
        <div className={`flex flex-col ${layout === 'vertical' ? 'flex-1' : 'flex-1'} min-h-0`}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleFold}
                disabled={!output}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                  text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                  hover:bg-[var(--border-subtle)] transition-all duration-150 cursor-pointer border-none bg-transparent
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                {folded ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                {folded ? t('jsonUnfold') : t('jsonFold')}
              </button>
              <div className="w-px h-3 bg-[var(--border-subtle)]" />
              <button
                onClick={handleCopy}
                disabled={!output}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                  text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                  hover:bg-[var(--border-subtle)] transition-all duration-150 cursor-pointer border-none bg-transparent
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <SnippetsOutlined />
                {t('copy')}
              </button>
              <div className="w-px h-3 bg-[var(--border-subtle)]" />
              <button
                onClick={handleDownload}
                disabled={!output}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                  text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                  hover:bg-[var(--border-subtle)] transition-all duration-150 cursor-pointer border-none bg-transparent
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <DownloadOutlined />
                {t('jsonDownload')}
              </button>
            </div>
            <span className={PANEL_HEADER_CLS}>{t('jsonResult')}</span>
          </div>
          <textarea
            value={displayOutput}
            readOnly
            placeholder={t('jsonResultPlaceholder')}
            spellCheck={false}
            className={`flex-1 w-full px-4 py-3 rounded-lg border font-mono text-[13px] leading-relaxed outline-none resize-none select-all
              ${error
                ? 'border-red-300 bg-red-50 text-red-600'
                : 'border-[var(--border-subtle)] bg-white text-[var(--text-primary)]'
              }
              focus:border-[var(--accent)] transition-colors duration-150`}
          />
        </div>
      </div>
    </div>
  )
}

export default JsonBeautify
