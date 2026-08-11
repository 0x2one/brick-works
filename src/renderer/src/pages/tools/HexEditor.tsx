import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import {
  FolderOpenOutlined,
  DownloadOutlined,
  SearchOutlined,
  AimOutlined
} from '@ant-design/icons'
import { Btn, Segmented } from '../../components/ui'

const BYTES_PER_ROW = 16
const ROW_HEIGHT = 22
const OVERSCAN = 8
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100 MB

function formatOffset(offset: number): string {
  return offset.toString(16).toUpperCase().padStart(8, '0')
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function asciiChar(b: number): string {
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'
}

function toHexByteString(b: number): string {
  return b.toString(16).padStart(2, '0').toUpperCase()
}

function parseHexQuery(query: string): Uint8Array | null {
  const s = query.trim().replace(/\s+/g, '')
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) return null
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

function findAll(hay: Uint8Array, needle: Uint8Array): number[] {
  if (needle.length === 0 || needle.length > hay.length) return []
  const out: number[] = []
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer
    }
    out.push(i)
  }
  return out
}

function HexEditor(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [data, setData] = useState<Uint8Array>(() => new Uint8Array(0))
  const [fileName, setFileName] = useState('')
  const [modifiedOffsets, setModifiedOffsets] = useState<Set<number>>(new Set())
  const [version, setVersion] = useState(0)
  const [query, setQuery] = useState('')
  const [hexMode, setHexMode] = useState(true)
  const [gotoText, setGotoText] = useState('')
  const [activeCell, setActiveCell] = useState<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(300)

  const scrollRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef(data)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const fileRef = useRef<HTMLInputElement>(null)
  const hexInputRef = useRef<HTMLInputElement>(null)

  const totalRows = useMemo(
    () => (data.length === 0 ? 0 : Math.ceil(data.length / BYTES_PER_ROW)),
    [data]
  )

  // ── Windowed visible rows ──

  const visibleRows = useMemo(() => {
    if (totalRows === 0) return []
    const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const endRow = Math.min(
      totalRows,
      startRow + Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2 + 2
    )
    const rows: Array<{ offset: number; start: number; end: number }> = []
    for (let r = startRow; r < endRow; r++) {
      const start = r * BYTES_PER_ROW
      rows.push({ offset: start, start, end: Math.min(data.length, start + BYTES_PER_ROW) })
    }
    return rows
  }, [totalRows, scrollTop, viewportH, data])

  // Measure viewport height
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => {
      setViewportH(el.clientHeight || 300)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [version, data.length])

  // ── File open ──

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const buf = reader.result
        if (!(buf instanceof ArrayBuffer)) {
          message.error(t('hexReadError'))
          return
        }
        if (buf.byteLength > MAX_FILE_SIZE) {
          message.warning(t('hexTooLarge'))
        }
        const arr = new Uint8Array(buf)
        dataRef.current = arr
        setData(arr)
        setFileName(file.name)
        setModifiedOffsets(new Set())
        setActiveCell(null)
        setScrollTop(0)
        setQuery('')
        if (scrollRef.current) scrollRef.current.scrollTop = 0
      }
      reader.readAsArrayBuffer(file)
      e.target.value = ''
    },
    [t, message]
  )

  // ── Editing ──

  const handleCellChange = useCallback((offset: number, byte: number) => {
    if (offset >= dataRef.current.length) return
    const next = dataRef.current.slice()
    if (next[offset] === byte) return
    next[offset] = byte
    dataRef.current = next
    setData(next)
    setModifiedOffsets((prev) => {
      const s = new Set(prev)
      s.add(offset)
      return s
    })
    setVersion((v) => v + 1)
  }, [])

  const commitHex = useCallback(
    (offset: number, raw: string): void => {
      const s = raw.trim()
      if (/^[0-9a-fA-F]{2}$/.test(s)) handleCellChange(offset, parseInt(s, 16))
      else if (activeCell === offset) setActiveCell(null)
    },
    [handleCellChange, activeCell]
  )

  const handleAsciiChange = useCallback(
    (offset: number, raw: string): void => {
      const ch = raw.slice(-1)
      if (ch) handleCellChange(offset, ch.charCodeAt(0))
    },
    [handleCellChange]
  )

  const advance = useCallback((offset: number): void => {
    if (offset + 1 < dataRef.current.length) setActiveCell(offset + 1)
    else setActiveCell(null)
  }, [])

  // ── Search ──

  const [searchResults, setSearchResults] = useState<number[]>([])
  const [searchIdx, setSearchIdx] = useState(-1)

  const runSearch = useCallback(
    (dir: 1 | -1) => {
      const q = query.trim()
      const hay = dataRef.current
      if (!q || hay.length === 0) {
        message.info(t('hexSearchHint'))
        return
      }
      const needle = hexMode ? parseHexQuery(q) : new TextEncoder().encode(q)
      if (!needle || needle.length === 0) {
        message.error(t('hexSearchHexInvalid'))
        return
      }
      const hits = findAll(hay, needle)
      setSearchResults(hits)
      if (hits.length === 0) {
        setSearchIdx(-1)
        message.info(t('hexSearchNoMatch'))
        return
      }
      const cur = searchIdx
      let next: number
      if (dir === 1) next = cur < 0 || cur >= hits.length - 1 ? 0 : cur + 1
      else next = cur <= 0 ? hits.length - 1 : cur - 1
      setSearchIdx(next)
      const off = hits[next]
      const row = Math.floor(off / BYTES_PER_ROW)
      const sc = scrollRef.current
      const target = Math.max(0, row * ROW_HEIGHT - 40)
      if (sc) sc.scrollTop = target
      setScrollTop(target)
      setActiveCell(off)
      hexInputRef.current?.focus()
    },
    [query, hexMode, searchIdx, t, message]
  )

  // ── Goto ──

  const handleGoto = useCallback(() => {
    const s = gotoText.trim()
    if (!s) return
    const parsed = /^0x/i.test(s) ? parseInt(s.slice(2), 16) : parseInt(s, 10)
    if (!Number.isFinite(parsed)) {
      message.error(t('hexGotoInvalid'))
      return
    }
    const max = Math.max(0, dataRef.current.length - 1)
    const off = Math.max(0, Math.min(parsed, max))
    const row = Math.floor(off / BYTES_PER_ROW)
    const target = Math.max(0, row * ROW_HEIGHT - 40)
    const sc = scrollRef.current
    if (sc) sc.scrollTop = target
    setScrollTop(target)
    setActiveCell(off)
    hexInputRef.current?.focus()
  }, [gotoText, t, message])

  // ── Download ──

  const handleDownload = useCallback(() => {
    if (dataRef.current.length === 0) return
    const bytes = new Uint8Array(dataRef.current)
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'hex-editor.bin'
    a.click()
    URL.revokeObjectURL(url)
    message.success(t('hexDownloaded'))
  }, [fileName, t, message])

  const handleScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop)
  }, [])

  const modifiedCount = modifiedOffsets.size
  const hasData = data.length > 0

  const byteCellCls =
    'w-9 h-5 flex items-center justify-center rounded-[3px] font-mono text-xs cursor-pointer select-none hover:bg-[var(--border-subtle)]'

  return (
    <div className="flex flex-col p-6 flex-1 min-h-0">
      {/* ── Pinned toolbar ── */}
      <div className="sticky top-0 z-10 bg-[var(--content-bg)] pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" onChange={handleFileChange} className="hidden" />
          <Btn icon={<FolderOpenOutlined />} onClick={() => fileRef.current?.click()}>
            {t('hexOpen')}
          </Btn>

          <span className="text-xs text-[var(--text-secondary)] tabular-nums max-w-[220px] truncate">
            {fileName || t('hexNoFile')}
          </span>
          {hasData && (
            <span className="text-xs text-[var(--text-secondary)] tabular-nums">
              · {formatSize(data.length)}
            </span>
          )}
          {modifiedCount > 0 && (
            <span className="text-xs text-[var(--accent)] font-semibold tabular-nums">
              · {t('hexModified', { count: modifiedCount })}
            </span>
          )}

          <div className="w-px h-5 bg-[var(--border-subtle)]" />

          {/* Search */}
          <div className="flex items-center gap-1">
            <Segmented
              options={[
                { value: 'hex', label: 'HEX' },
                { value: 'ascii', label: 'ASCII' }
              ]}
              value={hexMode ? 'hex' : 'ascii'}
              onChange={(v) => setHexMode(v === 'hex')}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={hexMode ? t('hexSearchHex') : t('hexSearchAscii')}
              spellCheck={false}
              onKeyDown={(e) => e.key === 'Enter' && runSearch(1)}
              className="w-44 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]
                text-[var(--text-primary)] font-mono text-xs outline-none focus:border-[var(--accent)] transition-colors"
            />
            <Btn
              icon={<SearchOutlined style={{ fontSize: 11 }} />}
              onClick={() => runSearch(1)}
              title={t('hexFindNext')}
            />
            {searchResults.length > 0 && (
              <span className="text-xs text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
                {searchIdx + 1}/{searchResults.length}
              </span>
            )}
          </div>

          <div className="w-px h-5 bg-[var(--border-subtle)]" />

          {/* Goto */}
          <div className="flex items-center gap-1">
            <input
              value={gotoText}
              onChange={(e) => setGotoText(e.target.value)}
              placeholder={t('hexGotoPlaceholder')}
              spellCheck={false}
              onKeyDown={(e) => e.key === 'Enter' && handleGoto()}
              className="w-28 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]
                text-[var(--text-primary)] font-mono text-xs outline-none focus:border-[var(--accent)] transition-colors"
            />
            <Btn
              icon={<AimOutlined style={{ fontSize: 11 }} />}
              onClick={handleGoto}
              title={t('hexGoto')}
            />
          </div>

          <div className="w-px h-5 bg-[var(--border-subtle)]" />

          <Btn
            variant="primary"
            icon={<DownloadOutlined style={{ fontSize: 11 }} />}
            onClick={handleDownload}
            disabled={!hasData}
          >
            {t('hexDownload')}
          </Btn>
        </div>
      </div>

      {/* ── Body ── */}
      {!hasData ? (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-3 px-10 py-12 rounded-xl border-2 border-dashed border-[var(--border-subtle)]
              bg-[var(--surface)] text-[var(--text-secondary)] text-sm
              hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
          >
            <FolderOpenOutlined style={{ fontSize: 32 }} />
            <span>{t('hexDropHint')}</span>
          </button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
          {/* Column header */}
          <div className="shrink-0 flex items-center px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-warm)] font-mono text-[10px] text-[var(--text-secondary)] select-none">
            <span className="w-20 shrink-0">Offset</span>
            <span className="flex-1 min-w-0">
              {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
                <span key={i} className="inline-block w-9 text-center">
                  {i.toString(16).toUpperCase()}
                </span>
              ))}
            </span>
            <span className="w-[120px] shrink-0 text-center">ASCII</span>
          </div>

          {/* Scrollable grid */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 min-h-0 overflow-auto font-mono text-xs scrollbar-gutter-stable"
          >
            <div style={{ height: totalRows * ROW_HEIGHT }} className="relative">
              {visibleRows.map((row) => (
                <div
                  key={row.offset}
                  className="absolute left-0 right-0 flex items-center px-3 hover:bg-[var(--bg-warm)]"
                  style={{ top: (row.offset / BYTES_PER_ROW) * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  <span className="w-20 shrink-0 text-[var(--text-secondary)] tabular-nums select-all">
                    {formatOffset(row.offset)}
                  </span>
                  <span className="flex-1 min-w-0">
                    {Array.from({ length: BYTES_PER_ROW }, (_, i) => {
                      const off = row.start + i
                      if (off >= row.end) return <span key={i} className="inline-block w-9" />
                      const active = activeCell === off
                      const modified = modifiedOffsets.has(off)
                      return (
                        <span key={i} className="inline-block w-9">
                          {active ? (
                            <input
                              ref={off === activeCell ? hexInputRef : undefined}
                              autoFocus
                              defaultValue={toHexByteString(data[off])}
                              onBlur={(e) => commitHex(off, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                  e.preventDefault()
                                  commitHex(off, (e.target as HTMLInputElement).value)
                                  advance(off)
                                } else if (e.key === 'Backspace' || e.key === 'Delete') {
                                  e.preventDefault()
                                  handleCellChange(off, 0)
                                } else if (e.key === 'Escape') {
                                  setActiveCell(null)
                                }
                              }}
                              spellCheck={false}
                              className="w-8 h-5 rounded-[3px] border border-[var(--accent)] bg-[var(--surface)]
                                text-[var(--accent)] text-xs font-mono text-center outline-none"
                            />
                          ) : (
                            <span
                              onClick={() => setActiveCell(off)}
                              className={byteCellCls}
                              style={
                                modified ? { color: 'var(--accent)', fontWeight: 600 } : undefined
                              }
                            >
                              {toHexByteString(data[off])}
                            </span>
                          )}
                        </span>
                      )
                    })}
                  </span>
                  <span className="w-[120px] shrink-0">
                    {Array.from({ length: BYTES_PER_ROW }, (_, i) => {
                      const off = row.start + i
                      if (off >= row.end) return null
                      const active = activeCell === off
                      return (
                        <span key={i} className="inline-block w-3.5 text-center">
                          {active ? (
                            <input
                              autoFocus
                              defaultValue={asciiChar(data[off])}
                              onChange={(e) => {
                                const v = e.target.value
                                if (v.length > 1) {
                                  handleAsciiChange(off, v)
                                  e.target.value = asciiChar(data[off])
                                }
                              }}
                              onBlur={(e) => handleAsciiChange(off, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                  e.preventDefault()
                                  advance(off)
                                } else if (e.key === 'Backspace' || e.key === 'Delete') {
                                  e.preventDefault()
                                  handleCellChange(off, 0)
                                } else if (e.key === 'Escape') {
                                  setActiveCell(null)
                                }
                              }}
                              spellCheck={false}
                              className="w-3.5 h-5 rounded-[2px] border border-[var(--accent)] bg-[var(--surface)]
                                text-[var(--accent)] text-xs font-mono text-center outline-none p-0"
                            />
                          ) : (
                            <span
                              onClick={() => setActiveCell(off)}
                              className="inline-block cursor-pointer hover:bg-[var(--border-subtle)] rounded-[2px] select-none"
                              style={
                                modifiedOffsets.has(off)
                                  ? { color: 'var(--accent)', fontWeight: 600 }
                                  : undefined
                              }
                            >
                              {asciiChar(data[off])}
                            </span>
                          )}
                        </span>
                      )
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default HexEditor
