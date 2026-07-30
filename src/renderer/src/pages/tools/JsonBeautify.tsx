import { useState, useCallback, useRef, useMemo, memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import {
  CodeOutlined,
  CompressOutlined,
  SnippetsOutlined,
  DownloadOutlined,
  ColumnWidthOutlined,
  ColumnHeightOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  EyeOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CaretRightOutlined,
  CaretDownOutlined
} from '@ant-design/icons'

function sortKeysAsc(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysAsc)
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        acc[key] = sortKeysAsc((obj as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return obj
}

function sortKeysDesc(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeysDesc)
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reverse()
      .reduce((acc: Record<string, unknown>, key) => {
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
  const [treeMode, setTreeMode] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const formatJSON = useCallback(
    (text: string, fmtMode: 'format' | 'minify', sortMode: string): void => {
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
        const msg = e instanceof Error ? e.message : t('jsonParseError')
        setError(msg.split('\n')[0].trim())
        setOutput('')
      }
    },
    [t]
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const pasted = e.clipboardData.getData('text')
      try {
        JSON.parse(pasted.trim())
        e.preventDefault()
        setInput(pasted)
        formatJSON(pasted, mode, sort)
      } catch {}
    },
    [mode, sort, formatJSON]
  )

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

  const handleModeChange = useCallback(
    (newMode: 'format' | 'minify') => {
      setMode(newMode)
      if (input.trim()) {
        formatJSON(input, newMode, sort)
      }
    },
    [input, sort, formatJSON]
  )

  const handleSortChange = useCallback(
    (newSort: string) => {
      setSort(newSort)
      if (input.trim()) {
        formatJSON(input, mode, newSort)
      }
    },
    [input, mode, formatJSON]
  )

  const toggleTree = useCallback(() => setTreeMode((v) => !v), [])

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const parsedForTree = useMemo(() => {
    if (!output) return null
    try {
      return JSON.parse(output)
    } catch {
      return null
    }
  }, [output])

  const JsonNode = memo(function JsonNode({
    value,
    path,
    expanded,
    onToggle,
    indent
  }: {
    value: unknown
    path: string
    expanded: Set<string>
    onToggle: (p: string) => void
    indent?: number
  }): ReactNode {
    const isExpanded = expanded.has(path)
    const gap = indent ?? 16
    const style = { paddingLeft: gap }

    if (value === null) return <span className="text-gray-400 font-medium">null</span>
    if (typeof value === 'boolean')
      return <span className="text-amber-600 font-medium">{String(value)}</span>
    if (typeof value === 'number') return <span className="text-blue-600 font-medium">{value}</span>
    if (typeof value === 'string') {
      const content = value.length > 500 ? value.slice(0, 500) + '...' : value
      return <span className="text-green-700">"{content}"</span>
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-[var(--text-secondary)]">[]</span>
      return (
        <div>
          <span
            onClick={() => onToggle(path)}
            className="cursor-pointer select-none hover:text-[var(--accent)] transition-colors duration-100"
          >
            <span className="inline-block w-4 text-xs text-[var(--text-secondary)]">
              {isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
            </span>
            <span className="text-[var(--text-secondary)]">[</span>
            {!isExpanded && (
              <span className="text-[var(--text-secondary)] text-xs ml-1">
                {value.length} items]
              </span>
            )}
          </span>
          {isExpanded && (
            <div style={style} className="border-l border-[var(--border-subtle)] ml-[7px]">
              {value.map((item, i) => (
                <div key={i} className="hover:bg-black/[0.02] rounded">
                  <span className="text-[var(--text-secondary)] text-xs select-none mr-1">
                    {i}:
                  </span>
                  <JsonNode
                    value={item}
                    path={`${path}[${i}]`}
                    expanded={expanded}
                    onToggle={onToggle}
                  />
                  {i < value.length - 1 && <span className="text-[var(--text-secondary)]">,</span>}
                </div>
              ))}
              <div className="text-[var(--text-secondary)]">]</div>
            </div>
          )}
        </div>
      )
    }

    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-[var(--text-secondary)]">{'{}'}</span>
    return (
      <div>
        <span
          onClick={() => onToggle(path)}
          className="cursor-pointer select-none hover:text-[var(--accent)] transition-colors duration-100"
        >
          <span className="inline-block w-4 text-xs text-[var(--text-secondary)]">
            {isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          </span>
          <span className="text-[var(--text-secondary)]">{'{'}</span>
          {!isExpanded && (
            <span className="text-[var(--text-secondary)] text-xs ml-1">
              {entries.length} keys{'}'}
            </span>
          )}
        </span>
        {isExpanded && (
          <div style={style} className="border-l border-[var(--border-subtle)] ml-[7px]">
            {entries.map(([key, val]) => (
              <div key={key} className="hover:bg-black/[0.02] rounded">
                <span className="text-[var(--accent)]">"{key}"</span>
                <span className="text-[var(--text-secondary)] mx-1">: </span>
                <JsonNode
                  value={val}
                  path={`${path}.${key}`}
                  expanded={expanded}
                  onToggle={onToggle}
                />
                <span className="text-[var(--text-secondary)]">,</span>
              </div>
            ))}
            <div className="text-[var(--text-secondary)]">{'}'}</div>
          </div>
        )}
      </div>
    )
  })

  const hasContent = !!input.trim()
  const inputStats = input ? `${input.length} chars · ${input.split('\n').length} lines` : ''

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 72px)' }}>
      <div className="sticky top-0 z-10 bg-[var(--content-bg)] pb-3">
        {breadcrumb ?? <div className="mb-3" />}

        {/* Header bar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Format / Minify */}
          <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg">
            <button
              onClick={() => handleModeChange('format')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer border-none flex items-center gap-1.5
                ${
                  mode === 'format'
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
                ${
                  mode === 'minify'
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
                ${
                  layout === 'horizontal'
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
                ${
                  layout === 'vertical'
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
            {SORT_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => handleSortChange(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer border-none flex items-center gap-1
                  ${
                    sort === s
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent'
                  }`}
              >
                {s === 'asc' && <ArrowUpOutlined />}
                {s === 'desc' && <ArrowDownOutlined />}
                {s === 'default'
                  ? t('jsonSortDefault')
                  : s === 'asc'
                    ? t('jsonSortAsc')
                    : t('jsonSortDesc')}
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
            onClick={() => {
              setInput('')
              setOutput('')
              setError(null)
            }}
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

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileOpen}
        className="hidden"
      />

      {/* Two-panel area */}
      <div className={`flex-1 min-h-0 flex gap-3 ${layout === 'vertical' ? 'flex-col' : ''}`}>
        {/* Input panel */}
        <div className={`flex flex-col ${layout === 'vertical' ? 'flex-1' : 'flex-1'} min-h-0`}>
          <div className="flex items-center justify-between mb-1.5 h-7">
            <span className={PANEL_HEADER_CLS}>{t('jsonInput')}</span>
            <span className="text-xs text-[var(--text-secondary)]">{inputStats}</span>
          </div>
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setOutput('')
              setError(null)
            }}
            onPaste={handlePaste}
            placeholder={t('jsonInputPlaceholder')}
            spellCheck={false}
            className="flex-1 w-full px-4 py-3 rounded-lg border border-[var(--border-subtle)]
              bg-white dark:bg-[var(--surface)] text-[var(--text-primary)]
              font-mono text-sm leading-relaxed outline-none resize-none
              focus:border-[var(--accent)] transition-colors duration-150"
          />
        </div>

        {/* Result panel */}
        <div className={`flex flex-col ${layout === 'vertical' ? 'flex-1' : 'flex-1'} min-h-0`}>
          <div className="flex items-center justify-between mb-1.5 h-7">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleTree}
                disabled={!output}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium
                  text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                  hover:bg-[var(--border-subtle)] transition-all duration-150 cursor-pointer border-none bg-transparent
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <EyeOutlined style={{ fontSize: 12 }} />
                {treeMode ? t('jsonTextMode') : t('jsonTreeMode')}
              </button>
              <span className="w-px h-3.5 bg-[var(--border-subtle)]" />
              <button
                onClick={handleCopy}
                disabled={!output}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium
                  text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                  hover:bg-[var(--border-subtle)] transition-all duration-150 cursor-pointer border-none bg-transparent
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <SnippetsOutlined style={{ fontSize: 12 }} />
                {t('copy')}
              </button>
              <span className="w-px h-3.5 bg-[var(--border-subtle)]" />
              <button
                onClick={handleDownload}
                disabled={!output}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium
                  text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                  hover:bg-[var(--border-subtle)] transition-all duration-150 cursor-pointer border-none bg-transparent
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <DownloadOutlined style={{ fontSize: 12 }} />
                {t('jsonDownload')}
              </button>
            </div>
            <span className={PANEL_HEADER_CLS}>{t('jsonResult')}</span>
          </div>
          {treeMode && parsedForTree && !error ? (
            <div
              className="flex-1 w-full px-4 py-3 rounded-lg border border-[var(--border-subtle)]
              bg-white dark:bg-[var(--surface)] font-mono text-sm leading-relaxed overflow-auto select-all"
            >
              <JsonNode
                value={parsedForTree}
                path="$"
                expanded={expanded}
                onToggle={toggleExpand}
              />
            </div>
          ) : (
            <textarea
              value={error || output}
              readOnly
              placeholder={t('jsonResultPlaceholder')}
              spellCheck={false}
              className={`flex-1 w-full px-4 py-3 rounded-lg border font-mono text-sm leading-relaxed outline-none resize-none select-all
                ${
                  error
                    ? 'border-red-300 bg-red-50 text-red-600'
                    : 'border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] text-[var(--text-primary)]'
                }
                focus:border-[var(--accent)] transition-colors duration-150`}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default JsonBeautify
