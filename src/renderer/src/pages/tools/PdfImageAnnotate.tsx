import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import { App, ColorPicker, Input, InputNumber, Modal, Popconfirm, Slider } from 'antd'
import {
  FolderOpenOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ColumnWidthOutlined,
  ColumnHeightOutlined,
  LeftOutlined,
  RightOutlined,
  HighlightOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined
} from '@ant-design/icons'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Annotation extends Rect {
  id: string
  page: number
  color: string
  info: string
}

interface StoredFile {
  name: string
  type: 'pdf' | 'image'
  naturalWidth: number
  naturalHeight: number
  annotations: Annotation[]
  updatedAt?: number
}

type StoredMap = Record<string, StoredFile>

const STORAGE_KEY = 'brickworks:pdfImageAnnotations'
const MAX_STORED_FILES = 20
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4
const MIN_DRAG = 0.01
const SCROLLBAR_MARGIN = 12

const COLOR_PRESET_COLORS = [
  '#f5222d',
  '#fa541c',
  '#fa8c16',
  '#fadb14',
  '#52c41a',
  '#13c2c2',
  '#1677ff',
  '#2f54eb',
  '#722ed1',
  '#eb2f96',
  '#8c8c8c',
  '#262626'
]

const LABEL_CLS =
  'block text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] mb-1.5'

const BTN_CLS =
  'h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none ' +
  'bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

const ICON_BTN_CLS =
  'w-8 h-8 rounded-lg text-sm flex items-center justify-center transition-all duration-150 cursor-pointer border-none ' +
  'bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

function loadStored(): StoredMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredMap) : {}
  } catch {
    return {}
  }
}

function PdfImageAnnotate({ breadcrumb }: { breadcrumb?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const urlRef = useRef<string | null>(null)
  const annoRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragRef = useRef<{ start: { x: number; y: number }; cur: { x: number; y: number } } | null>(
    null
  )
  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)

  const [fileKey, setFileKey] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [docType, setDocType] = useState<'pdf' | 'image' | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const pendingFitRef = useRef(false)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [annotateMode, setAnnotateMode] = useState(false)
  const [color, setColor] = useState('#fa8c16')
  const [drawing, setDrawing] = useState<{ rect: Rect; cursor: { x: number; y: number } } | null>(
    null
  )
  const [modalState, setModalState] = useState<
    { mode: 'new' } | { mode: 'edit'; anno: Annotation } | null
  >(null)
  const [draftColor, setDraftColor] = useState('#fa8c16')
  const [draftInfo, setDraftInfo] = useState('')
  const [draftX, setDraftX] = useState(0)
  const [draftY, setDraftY] = useState(0)
  const [draftW, setDraftW] = useState(0)
  const [draftH, setDraftH] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const [altHeld, setAltHeld] = useState(false)

  const display = useMemo(() => {
    if (!natural) return { width: 0, height: 0 }
    return { width: natural.width * zoom, height: natural.height * zoom }
  }, [natural, zoom])

  const pageAnnotations = useMemo(
    () => annotations.filter((a) => a.page === currentPage),
    [annotations, currentPage]
  )

  /* ── PDF page render ── */
  useEffect(() => {
    if (docType !== 'pdf' || !pdfDoc) return
    let cancelled = false
    pdfDoc
      .getPage(currentPage)
      .then((page) => {
        if (cancelled) return
        const vp = page.getViewport({ scale: 1 })
        setNatural((prev) =>
          prev && Math.abs(prev.width - vp.width) < 0.01 && Math.abs(prev.height - vp.height) < 0.01
            ? prev
            : { width: vp.width, height: vp.height }
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [docType, pdfDoc, currentPage])

  useEffect(() => {
    if (docType !== 'pdf' || !pdfDoc || !canvasRef.current) return
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
  }, [docType, pdfDoc, currentPage, zoom])

  /* ── persistence ── */
  useEffect(() => {
    if (!fileKey || !docType || !natural) return
    const map = loadStored()
    map[fileKey] = {
      name: fileName,
      type: docType,
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      annotations,
      updatedAt: Date.now()
    }
    const keys = Object.keys(map)
    if (keys.length > MAX_STORED_FILES) {
      keys
        .sort((a, b) => (map[a].updatedAt ?? 0) - (map[b].updatedAt ?? 0))
        .slice(0, keys.length - MAX_STORED_FILES)
        .forEach((k) => delete map[k])
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    } catch {
      // QuotaExceeded — drop oldest until it fits
      const remaining = Object.keys(map).sort(
        (a, b) => (map[a].updatedAt ?? 0) - (map[b].updatedAt ?? 0)
      )
      while (remaining.length > 1) {
        delete map[remaining.shift()!]
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
          break
        } catch {
          // continue pruning
        }
      }
    }
  }, [fileKey, fileName, docType, natural, annotations])

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
    if (pendingFitRef.current && natural && docType) {
      pendingFitRef.current = false
      fitWidth()
    }
  }, [natural, docType, fitWidth])

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
      const isImage = file.type.startsWith('image/')
      if (!isPdf && !isImage) {
        message.error(t('annoInvalidFile'))
        return
      }

      setPdfDoc(null)
      setDocType(null)
      setImageUrl(null)
      setNatural(null)
      setNumPages(0)
      setCurrentPage(1)
      setPageInput('1')
      setAnnotations([])
      setAnnotateMode(false)
      setDrawing(null)
      setSelectedId(null)
      setZoom(1)
      pendingFitRef.current = true

      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }

      const key = `${file.name}:${file.size}`
      setFileKey(key)
      setFileName(file.name)

      const stored = loadStored()[key]
      if (stored) setAnnotations(stored.annotations)

      if (isPdf) {
        try {
          const buf = await file.arrayBuffer()
          const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
          setDocType('pdf')
          setPdfDoc(doc)
          setNumPages(doc.numPages)
        } catch {
          setFileKey(null)
          pendingFitRef.current = false
          message.error(t('annoInvalidFile'))
        }
      } else {
        const url = URL.createObjectURL(file)
        urlRef.current = url
        setImageUrl(url)
        setDocType('image')
        const img = new Image()
        img.onload = () => setNatural({ width: img.naturalWidth, height: img.naturalHeight })
        img.src = url
      }
    },
    [t, message]
  )

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

  /* ── drawing ── */
  const toNorm = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const el = stageRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    }
  }, [])

  const rectFrom = useCallback((a: { x: number; y: number }, b: { x: number; y: number }): Rect => {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y)
    }
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!annotateMode || !natural || e.altKey) return
      e.preventDefault()
      const p = toNorm(e.clientX, e.clientY)
      dragRef.current = { start: p, cur: p }
      stageRef.current?.setPointerCapture(e.pointerId)
      setDrawing({ rect: { x: p.x, y: p.y, w: 0, h: 0 }, cursor: p })
    },
    [annotateMode, natural, toNorm]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return
      const p = toNorm(e.clientX, e.clientY)
      dragRef.current.cur = p
      setDrawing({ rect: rectFrom(dragRef.current.start, p), cursor: p })
    },
    [toNorm, rectFrom]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag || !annotateMode || !natural) {
        setDrawing(null)
        return
      }
      const p = toNorm(e.clientX, e.clientY)
      setDrawing(null)
      const rect = rectFrom(drag.start, p)
      if (rect.w < MIN_DRAG || rect.h < MIN_DRAG) {
        message.info(t('annoDrawTooSmall'))
        return
      }
      setDraftColor(color)
      setDraftInfo('')
      setDraftX(Math.round(rect.x * natural.width))
      setDraftY(Math.round(rect.y * natural.height))
      setDraftW(Math.round(rect.w * natural.width))
      setDraftH(Math.round(rect.h * natural.height))
      setModalState({ mode: 'new' })
    },
    [annotateMode, natural, toNorm, rectFrom, color, t, message]
  )

  /* ── annotations ── */
  const openEdit = useCallback((anno: Annotation) => {
    setSelectedId(anno.id)
    setDraftColor(anno.color)
    setDraftInfo(anno.info)
    setModalState({ mode: 'edit', anno })
  }, [])

  const removeAnnotation = useCallback(
    (id: string) => {
      setAnnotations((prev) => prev.filter((a) => a.id !== id))
      if (selectedId === id) setSelectedId(null)
    },
    [selectedId]
  )

  const scrollToAnno = useCallback((id: string) => {
    annoRefs.current[id]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  const handleModalOk = useCallback(() => {
    if (!modalState || !natural) return
    if (modalState.mode === 'new') {
      const x = draftX
      const y = draftY
      const w = draftW
      const h = draftH
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w <= 0 ||
        h <= 0 ||
        x < 0 ||
        y < 0 ||
        x + w > natural.width ||
        y + h > natural.height
      ) {
        message.error(t('annoInvalidCoords'))
        return
      }
      const anno: Annotation = {
        id: crypto.randomUUID(),
        page: currentPage,
        color: draftColor,
        info: draftInfo.trim(),
        x: x / natural.width,
        y: y / natural.height,
        w: w / natural.width,
        h: h / natural.height
      }
      setAnnotations((prev) => [...prev, anno])
      setSelectedId(anno.id)
    } else {
      const target = modalState.anno
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === target.id ? { ...a, color: draftColor, info: draftInfo.trim() } : a
        )
      )
      setSelectedId(null)
    }
    setModalState(null)
  }, [
    modalState,
    draftColor,
    draftInfo,
    draftX,
    draftY,
    draftW,
    draftH,
    currentPage,
    natural,
    t,
    message
  ])

  const openManualAdd = useCallback(() => {
    if (!natural) return
    setDraftColor(color)
    setDraftInfo('')
    setDraftX(Math.round(natural.width * 0.1))
    setDraftY(Math.round(natural.height * 0.1))
    setDraftW(Math.round(natural.width * 0.2))
    setDraftH(Math.round(natural.height * 0.1))
    setModalState({ mode: 'new' })
  }, [natural, color])

  /* ── zoom / page ── */
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
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
      setSelectedId(null)
    },
    [numPages]
  )

  const currentPageRef = useRef(currentPage)
  const numPagesRef = useRef(numPages)
  const wheelFlipLockRef = useRef(false)
  currentPageRef.current = currentPage
  numPagesRef.current = numPages

  /* Ctrl / Cmd + wheel zooms the preview toward cursor */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !docType) return

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.deltaY === 0) return
      e.preventDefault()
      const direction = e.deltaY > 0 ? -1 : 1
      applyZoom(zoomRef.current + direction * 0.1, { x: e.clientX, y: e.clientY })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [docType, fileKey, applyZoom])

  /* Wheel flips PDF pages at scroll edges (or always when content fits) */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || docType !== 'pdf' || numPages <= 1) return

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
  }, [docType, numPages, gotoPage])

  const commitPage = useCallback(() => {
    const v = parseInt(pageInput, 10)
    if (!Number.isNaN(v)) gotoPage(v)
    else setPageInput(String(currentPage))
  }, [pageInput, currentPage, gotoPage])

  const zoomPercent = Math.round(zoom * 100)

  const colorPresets = useMemo(
    () => [{ label: t('annoColorPresets'), colors: COLOR_PRESET_COLORS }],
    [t]
  )

  return (
    <div className="flex flex-col p-6" style={{ height: 'calc(100vh - 56px)' }}>
      <div className="shrink-0 pb-3">
        {breadcrumb ?? <div className="mb-3" />}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => fileRef.current?.click()} className={BTN_CLS}>
            <FolderOpenOutlined />
            {t('annoOpenFile')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,image/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {fileKey && docType && (
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

              {docType === 'pdf' && (
                <>
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
                </>
              )}

              <div className="w-px h-5 bg-[var(--border-subtle)]" />

              <button
                onClick={() => setAnnotateMode((v) => !v)}
                title={t('annoAnnotateHint')}
                className={
                  annotateMode
                    ? 'h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none bg-[var(--accent)] text-white'
                    : BTN_CLS
                }
              >
                <HighlightOutlined />
                {t('annoAnnotateMode')}
              </button>

              <button onClick={openManualAdd} title={t('annoAddCoords')} className={BTN_CLS}>
                <PlusOutlined />
                {t('annoAddCoords')}
              </button>

              <ColorPicker
                size="small"
                value={color}
                presets={colorPresets}
                onChange={(c) => setColor(c.toHexString())}
                disabled={!annotateMode}
              />

              <Popconfirm
                title={t('annoClear')}
                description={t('annoClearConfirm')}
                okText={t('annoClear')}
                cancelText={t('annoCancel')}
                onConfirm={() => setAnnotations([])}
                okButtonProps={{ danger: true }}
              >
                <button className={BTN_CLS}>
                  <DeleteOutlined />
                  {t('annoClear')}
                </button>
              </Popconfirm>
            </>
          )}
        </div>

        {fileKey && docType && (
          <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--text-secondary)]">
            <span className="truncate max-w-[240px]">{fileName}</span>
            {docType === 'pdf' && (
              <span>{t('annoPage', { current: currentPage, total: numPages })}</span>
            )}
            <span className="hidden md:inline">{t('annoCoordsOrigin')}</span>
          </div>
        )}
      </div>

      {fileKey && docType ? (
        <div className="flex-1 min-h-0 flex gap-3">
          {/* Preview stage */}
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
                  cursor: panning
                    ? 'grabbing'
                    : altHeld
                      ? 'grab'
                      : annotateMode
                        ? 'crosshair'
                        : 'default',
                  touchAction: 'none'
                }}
                onPointerDown={annotateMode ? handlePointerDown : undefined}
                onPointerMove={annotateMode ? handlePointerMove : undefined}
                onPointerUp={annotateMode ? handlePointerUp : undefined}
              >
                {docType === 'pdf' ? (
                  <canvas ref={canvasRef} className="block" />
                ) : (
                  <img
                    src={imageUrl ?? ''}
                    alt=""
                    draggable={false}
                    className="block select-none"
                    style={{
                      width: display.width || undefined,
                      height: display.height || undefined
                    }}
                  />
                )}

                {/* Annotations overlay */}
                {pageAnnotations.map((a) => {
                  const x = a.x * display.width
                  const y = a.y * display.height
                  const w = a.w * display.width
                  const h = a.h * display.height
                  const selected = a.id === selectedId
                  return (
                    <div
                      key={a.id}
                      ref={(el) => {
                        annoRefs.current[a.id] = el
                      }}
                      className="absolute group"
                      style={{
                        left: x,
                        top: y,
                        width: w,
                        height: h,
                        pointerEvents: annotateMode ? 'none' : 'auto'
                      }}
                    >
                      <div
                        onClick={() => openEdit(a)}
                        className="absolute inset-0 rounded cursor-pointer"
                        style={{
                          border: `2px solid ${a.color}`,
                          background: `${a.color}2e`,
                          boxShadow: selected ? '0 0 0 2px var(--accent)' : 'none'
                        }}
                      />
                      {a.info && (
                        <div
                          className="absolute -top-5 left-0 max-w-full truncate rounded px-1.5 py-0.5 text-[10px] leading-none text-white pointer-events-none"
                          style={{ background: a.color }}
                        >
                          {a.info}
                        </div>
                      )}
                      {selected && (
                        <div
                          className="absolute top-1 right-1 flex items-center gap-1"
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => openEdit(a)}
                            className="flex h-5 w-5 items-center justify-center rounded text-[10px] bg-white dark:bg-[var(--surface)] border border-[var(--border-subtle)] shadow-sm text-[var(--text-primary)] hover:text-[var(--accent)] cursor-pointer"
                          >
                            <EditOutlined />
                          </button>
                          <button
                            onClick={() => removeAnnotation(a.id)}
                            className="flex h-5 w-5 items-center justify-center rounded text-[10px] bg-white dark:bg-[var(--surface)] border border-[var(--border-subtle)] shadow-sm text-[var(--text-primary)] hover:text-red-500 cursor-pointer"
                          >
                            <DeleteOutlined />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Rubber band + coordinate hint */}
                {drawing && natural && (
                  <>
                    <div
                      className="absolute pointer-events-none rounded-sm"
                      style={{
                        left: drawing.rect.x * display.width,
                        top: drawing.rect.y * display.height,
                        width: drawing.rect.w * display.width,
                        height: drawing.rect.h * display.height,
                        border: `1.5px dashed ${color}`,
                        background: `${color}26`
                      }}
                    />
                    <div
                      className="absolute z-10 pointer-events-none rounded bg-[#262626] text-white px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap shadow-sm"
                      style={{
                        left: Math.min(
                          drawing.rect.x * display.width + 4,
                          Math.max(display.width - 220, 4)
                        ),
                        top: Math.max(drawing.rect.y * display.height - 22, 2)
                      }}
                    >
                      ({Math.round(drawing.rect.x * natural.width)},{' '}
                      {Math.round(drawing.rect.y * natural.height)}) ·{' '}
                      {Math.round(drawing.rect.w * natural.width)} ×{' '}
                      {Math.round(drawing.rect.h * natural.height)}px
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Annotation list */}
          <div className="w-[300px] shrink-0 flex flex-col border border-[var(--border-subtle)] rounded-lg bg-[var(--surface)]">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]">
                {t('annoAnnotations')}
              </span>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {t('annoTotal', { count: pageAnnotations.length })}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-2.5 flex flex-col gap-2">
              {!natural ? (
                <p className="text-xs text-[var(--text-secondary)] italic px-1" />
              ) : pageAnnotations.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)] italic px-1">{t('annoEmpty')}</p>
              ) : (
                pageAnnotations.map((a, i) => (
                  <div
                    key={a.id}
                    onClick={() => {
                      setSelectedId(a.id)
                      scrollToAnno(a.id)
                    }}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-colors duration-150
                      ${
                        a.id === selectedId
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-warm)] hover:bg-[var(--border-subtle)]'
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="shrink-0 w-3 h-3 rounded-sm"
                        style={{ background: a.color }}
                      />
                      <span className="flex-1 min-w-0 truncate text-xs font-medium text-[var(--text-primary)]">
                        {i + 1}. {a.info || t('annoNoInfo')}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(a)
                        }}
                        className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--border-subtle)] cursor-pointer"
                        title={t('annoEdit')}
                      >
                        <EditOutlined />
                      </button>
                      <Popconfirm
                        title={t('annoDelete')}
                        okText={t('annoDelete')}
                        cancelText={t('annoCancel')}
                        onConfirm={(e) => {
                          e?.stopPropagation()
                          removeAnnotation(a.id)
                        }}
                        okButtonProps={{ danger: true }}
                      >
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-[10px] text-[var(--text-secondary)] hover:text-red-500 hover:bg-[var(--border-subtle)] cursor-pointer"
                          title={t('annoDelete')}
                        >
                          <DeleteOutlined />
                        </button>
                      </Popconfirm>
                    </div>
                    <div className="mt-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
                      ({Math.round(a.x * natural.width)}, {Math.round(a.y * natural.height)}) ·{' '}
                      {Math.round(a.w * natural.width)} × {Math.round(a.h * natural.height)}px
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
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
            <span>{t('annoOpenHint')}</span>
          </button>
        </div>
      )}

      {/* Annotation editor */}
      <Modal
        open={modalState !== null}
        title={modalState?.mode === 'new' ? t('annoAdd') : t('annoEdit')}
        okText={t('annoSave')}
        cancelText={t('annoCancel')}
        onOk={handleModalOk}
        onCancel={() => setModalState(null)}
        destroyOnHidden
        width={420}
      >
        <div className="flex flex-col gap-4 pt-3">
          <div>
            <label className={LABEL_CLS}>{t('annoColor')}</label>
            <ColorPicker
              value={draftColor}
              presets={colorPresets}
              showText
              onChange={(c) => setDraftColor(c.toHexString())}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>{t('annoInfo')}</label>
            <Input.TextArea
              value={draftInfo}
              onChange={(e) => setDraftInfo(e.target.value)}
              placeholder={t('annoInfoPlaceholder')}
              rows={3}
            />
          </div>
          {modalState?.mode === 'new' && natural && (
            <div>
              <label className={LABEL_CLS}>{t('annoCoordinate')}</label>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                    X
                  </span>
                  <InputNumber
                    min={0}
                    max={natural.width}
                    precision={0}
                    value={draftX}
                    onChange={(v) => setDraftX(Number(v) || 0)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                    Y
                  </span>
                  <InputNumber
                    min={0}
                    max={natural.height}
                    precision={0}
                    value={draftY}
                    onChange={(v) => setDraftY(Number(v) || 0)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                    W
                  </span>
                  <InputNumber
                    min={1}
                    max={natural.width}
                    precision={0}
                    value={draftW}
                    onChange={(v) => setDraftW(Number(v) || 0)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                    H
                  </span>
                  <InputNumber
                    min={1}
                    max={natural.height}
                    precision={0}
                    value={draftH}
                    onChange={(v) => setDraftH(Number(v) || 0)}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{t('annoCoordsPx')}</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

export default PdfImageAnnotate
