import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Slider } from 'antd'
import {
  FolderOpenOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ColumnWidthOutlined,
  ColumnHeightOutlined,
  LeftOutlined,
  RightOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  MessageOutlined
} from '@ant-design/icons'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, RenderTask, PageViewport } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MIN_ZOOM = 0.2
const MAX_ZOOM = 4
const SCROLLBAR_MARGIN = 12
const NOTE_ICON_SIZE = 22

const TEXT_MARKUP_TYPES = ['Highlight', 'Underline', 'Squiggly', 'StrikeOut']

interface NativeAnno {
  id: string
  subtype: string
  rect?: number[] | null
  color?: unknown
  quadPoints?: unknown
  inkLists?: unknown
  vertices?: unknown
  lineCoordinates?: unknown
  borderWidth?: number
  borderStyle?: { width?: number; rawWidth?: number }
  contents?: string
  contentsObj?: { str?: string }
  title?: string
  titleObj?: { str?: string }
}

type OverlayItem =
  | {
      kind: 'note'
      key: string
      x: number
      y: number
      color: string
      contents: string
      title: string
    }
  | {
      kind: 'hit'
      key: string
      x: number
      y: number
      w: number
      h: number
      contents: string
      title: string
    }
  | { kind: 'text'; key: string; x: number; y: number; w: number; h: number; text: string }
  | { kind: 'ink'; key: string; paths: string[]; color: string; width: number }
  | {
      kind: 'outline'
      key: string
      shape: 'rect' | 'ellipse'
      x: number
      y: number
      w: number
      h: number
      color: string
      width: number
      dashed?: boolean
    }
  | {
      kind: 'seg'
      key: string
      x1: number
      y1: number
      x2: number
      y2: number
      color: string
      width: number
    }
  | { kind: 'poly'; key: string; points: string; color: string; width: number; closed: boolean }

const ICON_BTN_CLS =
  'w-8 h-8 rounded-lg text-sm flex items-center justify-center transition-all duration-150 cursor-pointer border-none ' +
  'bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

function toNumbers(v: unknown): number[] {
  const out: number[] = []
  const walk = (x: unknown): void => {
    if (Array.isArray(x) || (x !== null && typeof x === 'object')) {
      for (const k of Object.keys(x as Record<string, unknown>)) {
        walk((x as Record<string, unknown>)[k])
      }
    } else if (typeof x === 'number') {
      out.push(x)
    }
  }
  walk(v)
  return out
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function rgb(color?: unknown): string {
  const vals = toNumbers(color)
  if (vals.length < 3) return ''
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v > 1 ? v : v * 255)))
  return `rgb(${clamp(vals[0])}, ${clamp(vals[1])}, ${clamp(vals[2])})`
}

function PdfPreview(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const urlRef = useRef<string | null>(null)
  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)

  const [fileKey, setFileKey] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [zoom, setZoom] = useState(1)
  const pendingFitRef = useRef(false)
  const [annotations, setAnnotations] = useState<NativeAnno[]>([])
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [openPopup, setOpenPopup] = useState<{
    key: string
    x: number
    y: number
    contents: string
    title: string
  } | null>(null)
  const [panning, setPanning] = useState(false)
  const [altHeld, setAltHeld] = useState(false)

  const display = useMemo(() => {
    if (!viewport) return { width: 0, height: 0 }
    return { width: viewport.width, height: viewport.height }
  }, [viewport])

  /* ── load page: natural size + native annotations ── */
  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    void pdfDoc
      .getPage(currentPage)
      .then(async (page) => {
        if (cancelled) return
        const vp1 = page.getViewport({ scale: 1 })
        setNatural((prev) =>
          prev &&
          Math.abs(prev.width - vp1.width) < 0.01 &&
          Math.abs(prev.height - vp1.height) < 0.01
            ? prev
            : { width: vp1.width, height: vp1.height }
        )
        const annos = await page.getAnnotations({ intent: 'display' })
        if (cancelled) return
        setAnnotations(annos as NativeAnno[])
        setOpenPopup(null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pdfDoc, currentPage])

  /* ── render page canvas at zoom ── */
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let cancelled = false
    let renderTask: RenderTask | null = null
    void (async () => {
      try {
        const page = await pdfDoc.getPage(currentPage)
        if (cancelled) return
        const vp = page.getViewport({ scale: zoom })
        const canvas = canvasRef.current
        if (!canvas) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(vp.width * dpr)
        canvas.height = Math.floor(vp.height * dpr)
        canvas.style.width = `${vp.width}px`
        canvas.style.height = `${vp.height}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        setViewport(vp)
        renderTask = page.render({
          canvas,
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
        })
        await renderTask.promise
      } catch {
        // render cancelled or page unavailable
      }
    })()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdfDoc, currentPage, zoom])

  /* ── cleanup ── */
  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      pdfDoc?.loadingTask.destroy().catch(() => {})
    }
  }, [pdfDoc])

  /* ── file open ── */
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = ''
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      if (!isPdf) {
        message.error(t('annoInvalidFile'))
        return
      }

      setPdfDoc(null)
      setNumPages(0)
      setCurrentPage(1)
      setPageInput('1')
      setNatural(null)
      setViewport(null)
      setAnnotations([])
      setOpenPopup(null)
      setZoom(1)
      pendingFitRef.current = true

      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }

      const key = `${file.name}:${file.size}`
      setFileKey(key)
      setFileName(file.name)

      try {
        const buf = await file.arrayBuffer()
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
        setPdfDoc(doc)
        setNumPages(doc.numPages)
      } catch {
        setFileKey(null)
        pendingFitRef.current = false
        message.error(t('annoInvalidFile'))
      }
    },
    [t, message]
  )

  /* ── auto fit on file open ── */
  const fitWidth = useCallback(() => {
    const el = scrollRef.current
    if (!el || !natural) return
    const avail = el.clientWidth - 48 - SCROLLBAR_MARGIN
    if (avail <= 0) return
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, avail / natural.width))
    setZoom(Math.floor(z * 1000) / 1000)
  }, [natural])

  const fitHeight = useCallback(() => {
    const el = scrollRef.current
    if (!el || !natural) return
    const avail = el.clientHeight - 48 - SCROLLBAR_MARGIN
    if (avail <= 0) return
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, avail / natural.height))
    setZoom(Math.floor(z * 1000) / 1000)
  }, [natural])

  useEffect(() => {
    if (pendingFitRef.current && natural) {
      pendingFitRef.current = false
      fitWidth()
    }
  }, [natural, fitWidth])

  /* ── pan (Alt + left drag) ── */
  const handlePanPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.altKey) return
    const el = scrollRef.current
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop
    }
    el.setPointerCapture(e.pointerId)
    setPanning(true)
  }, [])

  const handlePanPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    const el = scrollRef.current
    if (!pan || !el || e.pointerId !== pan.pointerId) return
    e.preventDefault()
    el.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX)
    el.scrollTop = pan.scrollTop - (e.clientY - pan.startY)
  }, [])

  const handlePanPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (!pan || e.pointerId !== pan.pointerId) return
    panRef.current = null
    setPanning(false)
    try {
      scrollRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }, [])

  /* ── keyboard: Alt for panning ── */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAltHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAltHeld(false)
    }
    const onBlur = (): void => setAltHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  /* ── overlay geometry (native annotations → display coords) ── */
  const overlayItems = useMemo(() => {
    if (!viewport || !showAnnotations || annotations.length === 0) return []
    const items: OverlayItem[] = []
    const toPt = (x: number, y: number): [number, number] => {
      const p = viewport.convertToViewportPoint(x, y)
      return [p[0], p[1]]
    }
    const fmt = (pts: number[][]): string =>
      pts.map((pt) => `${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')
    const pairs = (v: unknown): number[][] => chunk(toNumbers(v), 2).filter((p) => p.length === 2)

    for (const a of annotations) {
      const rect = Array.isArray(a.rect) && a.rect.length >= 4 ? a.rect : null
      const rectOk =
        !!rect && rect.slice(0, 4).every((v) => typeof v === 'number' && Number.isFinite(v))
      const borderW = Math.max(1, (a.borderStyle?.rawWidth ?? a.borderWidth ?? 1) * zoom)

      if (TEXT_MARKUP_TYPES.includes(a.subtype)) {
        const quads = chunk(toNumbers(a.quadPoints), 8).filter((q) => q.length === 8)
        if (quads.length > 0) {
          let minX = Infinity
          let minY = Infinity
          let maxX = -Infinity
          let maxY = -Infinity
          for (const q of quads) {
            for (let i = 0; i < 8; i += 2) {
              const [x, y] = toPt(q[i], q[i + 1])
              if (x < minX) minX = x
              if (x > maxX) maxX = x
              if (y < minY) minY = y
              if (y > maxY) maxY = y
            }
          }
          const contents = a.contentsObj?.str ?? a.contents ?? ''
          const title = a.titleObj?.str ?? a.title ?? ''
          items.push({
            kind: 'outline',
            key: a.id,
            shape: 'rect',
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY,
            color: rgb(a.color) || 'rgb(230, 120, 0)',
            width: 2.5,
            dashed: true
          })
          if (contents || title) {
            items.push({
              kind: 'hit',
              key: a.id,
              x: minX,
              y: minY,
              w: maxX - minX,
              h: maxY - minY,
              contents,
              title
            })
          }
        }
      } else if (a.subtype === 'Text' && rectOk) {
        const [x1, , , y2] = rect!
        const [px, py] = toPt(x1, y2)
        items.push({
          kind: 'note',
          key: a.id,
          x: px,
          y: py,
          color: rgb(a.color) || 'rgb(140, 140, 140)',
          contents: a.contentsObj?.str ?? a.contents ?? '',
          title: a.titleObj?.str ?? a.title ?? ''
        })
      } else if (a.subtype === 'FreeText' && rectOk) {
        const [x1, y1, x2, y2] = rect!
        const tl = toPt(x1, y2)
        const br = toPt(x2, y1)
        items.push({
          kind: 'text',
          key: a.id,
          x: tl[0],
          y: tl[1],
          w: br[0] - tl[0],
          h: br[1] - tl[1],
          text: a.contentsObj?.str ?? a.contents ?? ''
        })
      } else if (a.subtype === 'Ink' && Array.isArray(a.inkLists)) {
        const color = rgb(a.color) || 'rgb(0, 0, 0)'
        const paths: string[] = []
        for (const stroke of a.inkLists) {
          const pts = pairs(stroke).map(([x, y]) => toPt(x, y))
          if (pts.length >= 2) paths.push(fmt(pts))
        }
        if (paths.length) items.push({ kind: 'ink', key: a.id, paths, color, width: borderW })
      } else if ((a.subtype === 'Square' || a.subtype === 'Circle') && rectOk) {
        const [x1, y1, x2, y2] = rect!
        const tl = toPt(x1, y2)
        const br = toPt(x2, y1)
        items.push({
          kind: 'outline',
          key: a.id,
          shape: a.subtype === 'Circle' ? 'ellipse' : 'rect',
          x: tl[0],
          y: tl[1],
          w: br[0] - tl[0],
          h: br[1] - tl[1],
          color: rgb(a.color) || 'rgb(0, 0, 0)',
          width: borderW
        })
      } else if (a.subtype === 'Line') {
        const coords = toNumbers(a.lineCoordinates)
        if (coords.length >= 4) {
          const p1 = toPt(coords[0], coords[1])
          const p2 = toPt(coords[2], coords[3])
          items.push({
            kind: 'seg',
            key: a.id,
            x1: p1[0],
            y1: p1[1],
            x2: p2[0],
            y2: p2[1],
            color: rgb(a.color) || 'rgb(0, 0, 0)',
            width: borderW
          })
        }
      } else if (a.subtype === 'Polygon' || a.subtype === 'PolyLine') {
        const pts = pairs(a.vertices).map(([x, y]) => toPt(x, y))
        if (pts.length >= 2) {
          items.push({
            kind: 'poly',
            key: a.id,
            points: fmt(pts),
            color: rgb(a.color) || 'rgb(0, 0, 0)',
            width: borderW,
            closed: a.subtype === 'Polygon'
          })
        }
      }
    }
    return items
  }, [viewport, annotations, showAnnotations, zoom])

  const visibleCount = useMemo(() => {
    if (!showAnnotations) return 0
    return annotations.length
  }, [annotations, showAnnotations])

  const TYPE_KEYS: Record<string, string> = {
    Highlight: 'pdfPreviewTypeHighlight',
    Underline: 'pdfPreviewTypeUnderline',
    Squiggly: 'pdfPreviewTypeSquiggly',
    StrikeOut: 'pdfPreviewTypeStrikeOut',
    Text: 'pdfPreviewTypeText',
    FreeText: 'pdfPreviewTypeFreeText',
    Ink: 'pdfPreviewTypeInk',
    Square: 'pdfPreviewTypeSquare',
    Circle: 'pdfPreviewTypeCircle',
    Line: 'pdfPreviewTypeLine',
    Polygon: 'pdfPreviewTypePolygon',
    PolyLine: 'pdfPreviewTypePolyLine',
    Link: 'pdfPreviewTypeLink'
  }

  const annoList = useMemo(() => {
    return annotations.map((a) => ({
      id: a.id,
      subtype: a.subtype,
      color:
        rgb(a.color) ||
        (TEXT_MARKUP_TYPES.includes(a.subtype) ? 'rgb(230, 120, 0)' : 'rgb(140, 140, 140)'),
      contents: a.contentsObj?.str ?? a.contents ?? '',
      title: a.titleObj?.str ?? a.title ?? ''
    }))
  }, [annotations])

  const typeLabel = useCallback(
    (subtype: string): string => {
      const key = TYPE_KEYS[subtype]
      return key ? t(key) : subtype
    },
    [t]
  )

  /* ── zoom / page ── */
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  const zoomAnchorRef = useRef<{
    naturalX: number
    naturalY: number
    clientX: number
    clientY: number
  } | null>(null)

  const captureZoomAnchor = (clientX: number, clientY: number): void => {
    const stage = stageRef.current
    const prev = zoomRef.current
    if (!stage || prev <= 0) return
    const rect = stage.getBoundingClientRect()
    zoomAnchorRef.current = {
      naturalX: (clientX - rect.left) / prev,
      naturalY: (clientY - rect.top) / prev,
      clientX,
      clientY
    }
  }

  const applyZoom = useCallback((nextZoom: number, anchor?: { x: number; y: number }) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(nextZoom * 100) / 100))
    if (clamped === zoomRef.current) return
    if (anchor) {
      captureZoomAnchor(anchor.x, anchor.y)
    } else {
      const scroller = scrollRef.current
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        captureZoomAnchor(rect.left + rect.width / 2, rect.top + rect.height / 2)
      }
    }
    setZoom(clamped)
  }, [])

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    if (!anchor) return
    zoomAnchorRef.current = null
    const scroller = scrollRef.current
    const stage = stageRef.current
    if (!scroller || !stage) return
    const rect = stage.getBoundingClientRect()
    scroller.scrollLeft += rect.left + anchor.naturalX * zoom - anchor.clientX
    scroller.scrollTop += rect.top + anchor.naturalY * zoom - anchor.clientY
  }, [zoom])

  const handleZoomIn = useCallback(() => {
    applyZoom(zoomRef.current + 0.1)
  }, [applyZoom])
  const handleZoomOut = useCallback(() => {
    applyZoom(zoomRef.current - 0.1)
  }, [applyZoom])

  const gotoPage = useCallback(
    (p: number) => {
      const next = Math.min(numPages, Math.max(1, Math.floor(p)))
      setCurrentPage(next)
      setPageInput(String(next))
    },
    [numPages]
  )

  const commitPage = useCallback(() => {
    const v = parseInt(pageInput, 10)
    if (!Number.isNaN(v)) gotoPage(v)
    else setPageInput(String(currentPage))
  }, [pageInput, currentPage, gotoPage])

  const currentPageRef = useRef(currentPage)
  const numPagesRef = useRef(numPages)
  const wheelFlipLockRef = useRef(false)
  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])
  useEffect(() => {
    numPagesRef.current = numPages
  }, [numPages])

  /* Ctrl / Cmd + wheel zooms toward cursor */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !pdfDoc) return

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.deltaY === 0) return
      e.preventDefault()
      const direction = e.deltaY > 0 ? -1 : 1
      applyZoom(zoomRef.current + direction * 0.1, { x: e.clientX, y: e.clientY })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pdfDoc, fileKey, applyZoom])

  /* Wheel flips pages at scroll edges */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !pdfDoc || numPages <= 1) return

    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) return
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return

      const goingDown = e.deltaY > 0
      const goingUp = e.deltaY < 0
      if (!goingDown && !goingUp) return

      const { scrollTop, scrollHeight, clientHeight } = el
      const canScroll = scrollHeight > clientHeight + 2
      const atTop = scrollTop <= 2
      const atBottom = scrollTop + clientHeight >= scrollHeight - 2
      const shouldFlip = !canScroll || (goingDown && atBottom) || (goingUp && atTop)
      if (!shouldFlip) return

      const page = currentPageRef.current
      const total = numPagesRef.current
      if (goingDown && page >= total) return
      if (goingUp && page <= 1) return

      e.preventDefault()
      if (wheelFlipLockRef.current) return
      wheelFlipLockRef.current = true
      gotoPage(page + (goingDown ? 1 : -1))
      if (goingDown) {
        el.scrollTop = 0
      } else {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight
        })
      }
      window.setTimeout(() => {
        wheelFlipLockRef.current = false
      }, 280)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pdfDoc, numPages, gotoPage])

  const zoomPercent = Math.round(zoom * 100)

  const togglePopup = useCallback(
    (p: { key: string; x: number; y: number; contents: string; title: string }) => {
      setOpenPopup((prev) =>
        prev && prev.key === p.key
          ? null
          : {
              key: p.key,
              x: p.x,
              y: p.y,
              contents: p.contents,
              title: p.title
            }
      )
    },
    []
  )

  return (
    <div className="flex flex-col p-6 flex-1 min-h-0">
      <div className="shrink-0 pb-3">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            title={t('annoOpenFile')}
            className={ICON_BTN_CLS}
          >
            <FolderOpenOutlined />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />

          {fileKey && pdfDoc && (
            <>
              <div className="w-px h-5 bg-[var(--border-subtle)]" />
              <button onClick={handleZoomOut} title={t('annoZoomOut')} className={ICON_BTN_CLS}>
                <ZoomOutOutlined />
              </button>
              <div className="flex items-center gap-2">
                <Slider
                  min={MIN_ZOOM * 100}
                  max={MAX_ZOOM * 100}
                  value={zoomPercent}
                  onChange={(v) => applyZoom(v / 100)}
                  tooltip={{ formatter: (v) => `${v}%` }}
                  style={{ width: 140 }}
                />
                <span className="w-10 text-right text-xs text-[var(--text-secondary)]">
                  {zoomPercent}%
                </span>
              </div>
              <button onClick={handleZoomIn} title={t('annoZoomIn')} className={ICON_BTN_CLS}>
                <ZoomInOutlined />
              </button>
              <button onClick={fitWidth} title={t('annoFitWidth')} className={ICON_BTN_CLS}>
                <ColumnWidthOutlined />
              </button>
              <button onClick={fitHeight} title={t('annoFitHeight')} className={ICON_BTN_CLS}>
                <ColumnHeightOutlined />
              </button>

              <div className="w-px h-5 bg-[var(--border-subtle)]" />
              <button
                onClick={() => gotoPage(currentPage - 1)}
                disabled={currentPage <= 1}
                title={t('annoPageJump')}
                className={ICON_BTN_CLS}
              >
                <LeftOutlined />
              </button>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={numPages}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
                  onBlur={commitPage}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitPage()
                  }}
                  className="w-12 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]
                    text-center text-xs text-[var(--text-primary)] outline-none
                    focus:border-[var(--accent)] transition-colors duration-150"
                />
                <span className="text-xs text-[var(--text-secondary)]">/ {numPages}</span>
              </div>
              <button
                onClick={() => gotoPage(currentPage + 1)}
                disabled={currentPage >= numPages}
                title={t('annoPageJump')}
                className={ICON_BTN_CLS}
              >
                <RightOutlined />
              </button>

              <div className="w-px h-5 bg-[var(--border-subtle)]" />

              <button
                onClick={() => setShowAnnotations((v) => !v)}
                className={
                  showAnnotations
                    ? 'h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none bg-[var(--accent)] text-white'
                    : 'h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)]'
                }
              >
                {showAnnotations ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                {t('pdfPreviewShowAnnotations')}
              </button>
            </>
          )}
        </div>

        {fileKey && pdfDoc && (
          <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--text-secondary)]">
            <span className="truncate max-w-[240px]">{fileName}</span>
            <span>{t('annoPage', { current: currentPage, total: numPages })}</span>
            {showAnnotations && (
              <span>
                {visibleCount > 0
                  ? t('pdfPreviewTotal', { count: visibleCount })
                  : t('pdfPreviewNoAnnotations')}
              </span>
            )}
          </div>
        )}
      </div>

      {fileKey && pdfDoc ? (
        <div className="flex-1 min-h-0 flex gap-3">
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-auto bg-[var(--bg-warm)] border border-[var(--border-subtle)] rounded-lg"
            style={{
              cursor: panning ? 'grabbing' : altHeld ? 'grab' : undefined,
              userSelect: panning ? 'none' : undefined
            }}
            onPointerDownCapture={handlePanPointerDown}
            onPointerMove={handlePanPointerMove}
            onPointerUp={handlePanPointerUp}
            onPointerCancel={handlePanPointerUp}
          >
            <div className="min-h-full w-max min-w-full flex py-6 px-6">
              <div
                ref={stageRef}
                className="relative bg-white shadow-md m-auto"
                style={{
                  width: display.width || undefined,
                  height: display.height || undefined,
                  cursor: panning ? 'grabbing' : altHeld ? 'grab' : 'default',
                  touchAction: 'none'
                }}
                onClick={() => setOpenPopup(null)}
              >
                <canvas ref={canvasRef} className="block" />

                {/* Native annotation overlay */}
                {viewport && showAnnotations && (
                  <>
                    <svg
                      className="absolute inset-0 pointer-events-none"
                      style={{ width: viewport.width, height: viewport.height }}
                    >
                      {overlayItems
                        .filter((i): i is OverlayItem & { kind: 'ink' } => i.kind === 'ink')
                        .map((i) => (
                          <g
                            key={i.key}
                            fill="none"
                            stroke={i.color}
                            strokeWidth={i.width}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            {i.paths.map((pts, idx) => (
                              <polyline key={idx} points={pts} />
                            ))}
                          </g>
                        ))}
                      {overlayItems
                        .filter((i): i is OverlayItem & { kind: 'outline' } => i.kind === 'outline')
                        .map((i) =>
                          i.shape === 'rect' ? (
                            <rect
                              key={i.key}
                              x={i.x}
                              y={i.y}
                              width={i.w}
                              height={i.h}
                              fill="none"
                              stroke={i.color}
                              strokeWidth={i.width}
                              strokeDasharray={i.dashed ? '5 4' : undefined}
                            />
                          ) : (
                            <ellipse
                              key={i.key}
                              cx={i.x + i.w / 2}
                              cy={i.y + i.h / 2}
                              rx={i.w / 2}
                              ry={i.h / 2}
                              fill="none"
                              stroke={i.color}
                              strokeWidth={i.width}
                              strokeDasharray={i.dashed ? '5 4' : undefined}
                            />
                          )
                        )}
                      {overlayItems
                        .filter((i): i is OverlayItem & { kind: 'seg' } => i.kind === 'seg')
                        .map((i) => (
                          <line
                            key={i.key}
                            x1={i.x1}
                            y1={i.y1}
                            x2={i.x2}
                            y2={i.y2}
                            stroke={i.color}
                            strokeWidth={i.width}
                          />
                        ))}
                      {overlayItems
                        .filter((i): i is OverlayItem & { kind: 'poly' } => i.kind === 'poly')
                        .map((i) =>
                          i.closed ? (
                            <polygon
                              key={i.key}
                              points={i.points}
                              fill="none"
                              stroke={i.color}
                              strokeWidth={i.width}
                            />
                          ) : (
                            <polyline
                              key={i.key}
                              points={i.points}
                              fill="none"
                              stroke={i.color}
                              strokeWidth={i.width}
                            />
                          )
                        )}
                    </svg>
                    {overlayItems
                      .filter((i): i is OverlayItem & { kind: 'note' } => i.kind === 'note')
                      .map((i) => (
                        <button
                          key={i.key}
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePopup(i)
                          }}
                          title={i.contents || i.title}
                          className="absolute flex items-center justify-center cursor-pointer border-none p-0 text-[var(--text-secondary)] hover:scale-110 transition-transform duration-150"
                          style={{
                            width: NOTE_ICON_SIZE,
                            height: NOTE_ICON_SIZE,
                            left: i.x - NOTE_ICON_SIZE / 2,
                            top: i.y - NOTE_ICON_SIZE / 2,
                            color: i.color,
                            background: 'transparent'
                          }}
                        >
                          <MessageOutlined style={{ fontSize: 16 }} />
                        </button>
                      ))}
                    {overlayItems
                      .filter((i): i is OverlayItem & { kind: 'hit' } => i.kind === 'hit')
                      .map((i) => (
                        <button
                          key={i.key}
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePopup(i)
                          }}
                          title={i.contents || i.title}
                          className="absolute cursor-pointer p-0"
                          style={{
                            left: i.x,
                            top: i.y,
                            width: i.w,
                            height: i.h,
                            border: 'none',
                            background: 'transparent'
                          }}
                        />
                      ))}
                    {overlayItems
                      .filter((i): i is OverlayItem & { kind: 'text' } => i.kind === 'text')
                      .map((i) => (
                        <div
                          key={i.key}
                          className="absolute pointer-events-none overflow-hidden text-black"
                          style={{
                            left: i.x,
                            top: i.y,
                            width: i.w,
                            minHeight: i.h,
                            fontSize: Math.max(10, Math.min(30, i.h * 0.55)),
                            lineHeight: 1.2
                          }}
                        >
                          {i.text}
                        </div>
                      ))}
                  </>
                )}

                {/* Comment popup */}
                {openPopup && (
                  <div
                    className="absolute z-20 max-w-[260px] rounded-lg shadow-md border border-[var(--border-subtle)] bg-[var(--surface)] p-2.5"
                    style={{
                      left: Math.min(openPopup.x + 14, Math.max(display.width - 260, 8)),
                      top: openPopup.y + 14
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {openPopup.title && (
                      <div className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                        {openPopup.title}
                      </div>
                    )}
                    <div className="text-xs text-[var(--text-primary)] whitespace-pre-wrap break-words">
                      {openPopup.contents || '—'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Annotation list */}
          {showAnnotations && (
            <div className="w-[300px] shrink-0 flex flex-col border border-[var(--border-subtle)] rounded-lg bg-[var(--surface)]">
              <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]">
                  {t('pdfPreviewListTitle')}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t('pdfPreviewTotal', { count: annotations.length })}
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-2.5 flex flex-col gap-2">
                {annotations.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)] italic px-1">
                    {t('pdfPreviewNoAnnotations')}
                  </p>
                ) : (
                  annoList.map((it, idx) => (
                    <div
                      key={it.id}
                      className="p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-warm)]"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="shrink-0 w-3 h-3 rounded-sm"
                          style={{ background: it.color }}
                        />
                        <span className="flex-1 min-w-0 truncate text-xs font-medium text-[var(--text-primary)]">
                          {idx + 1}. {typeLabel(it.subtype)}
                        </span>
                        {it.title && (
                          <span className="shrink-0 text-[10px] text-[var(--text-secondary)] truncate max-w-[90px]">
                            {it.title}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap break-words leading-relaxed">
                        {it.contents || t('pdfPreviewNoComment')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <button
            onClick={() => fileRef.current?.click()}
            className="py-12 px-16 rounded-2xl border-2 border-dashed border-[var(--border-subtle)]
              text-sm text-[var(--text-secondary)] flex flex-col items-center gap-3
              hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]
              transition-all duration-150 cursor-pointer"
          >
            <FolderOpenOutlined style={{ fontSize: 28 }} />
            <span>{t('pdfPreviewOpenHint')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default PdfPreview
