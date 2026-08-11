import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App,
  ColorPicker,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Slider
} from 'antd'
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
  PlusOutlined,
  CloseOutlined
} from '@ant-design/icons'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { LABEL_CLS } from '../../components/ui'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type ShapeType = 'rect' | 'ellipse' | 'polygon' | 'line' | 'point'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Pt {
  x: number
  y: number
}

interface Annotation {
  id: string
  page: number
  color: string
  info: string
  shape: ShapeType
  /* rect / ellipse — normalized bounding box */
  x?: number
  y?: number
  w?: number
  h?: number
  /* polygon — normalized vertices */
  points?: Pt[]
  /* line — normalized endpoints */
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  /* point — normalized center + radius (fraction of min dimension) */
  cx?: number
  cy?: number
  r?: number
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

interface Draft {
  shape: ShapeType
  color: string
  info: string
  /* rect / ellipse px */
  x: number
  y: number
  w: number
  h: number
  /* line px */
  x1: number
  y1: number
  x2: number
  y2: number
  /* point px */
  cx: number
  cy: number
  r: number
  /* polygon px */
  points: Pt[]
}

type Drawing =
  | { shape: 'rect'; rect: Rect; cursor: Pt }
  | { shape: 'ellipse'; rect: Rect; cursor: Pt }
  | { shape: 'polygon'; points: Pt[]; cursor: Pt }
  | { shape: 'line'; points: [Pt, Pt] }
  | { shape: 'point'; point: Pt; cursor: Pt }

const STORAGE_KEY = 'brickworks:pdfImageAnnotations'
const MAX_STORED_FILES = 20
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4
const MIN_DRAG = 0.01
const SCROLLBAR_MARGIN = 12
const DEFAULT_POINT_R = 8
const DOUBLE_CLICK_MS = 350
const DOUBLE_CLICK_PX = 8

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

const SHAPE_ORDER: ShapeType[] = ['rect', 'ellipse', 'polygon', 'line', 'point']

const ICON_BTN_CLS =
  'w-8 h-8 rounded-lg text-sm flex items-center justify-center transition-all duration-150 cursor-pointer border-none ' +
  'bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

function normalizeAnno(a: Annotation): Annotation {
  return {
    ...a,
    shape: a.shape ?? 'rect',
    x: a.x ?? 0,
    y: a.y ?? 0,
    w: a.w ?? 0,
    h: a.h ?? 0,
    points: a.points ?? [],
    x1: a.x1 ?? 0,
    y1: a.y1 ?? 0,
    x2: a.x2 ?? 0,
    y2: a.y2 ?? 0,
    cx: a.cx ?? 0,
    cy: a.cy ?? 0,
    r: a.r ?? 0
  }
}

function loadStored(): StoredMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredMap) : {}
  } catch {
    return {}
  }
}

function PdfImageAnnotate(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const urlRef = useRef<string | null>(null)
  const annoRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dragRef = useRef<{ start: Pt; cur: Pt } | null>(null)
  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const polygonLastClickRef = useRef<{ time: number; clientX: number; clientY: number } | null>(
    null
  )

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
  const [shape, setShape] = useState<ShapeType>('rect')
  const [color, setColor] = useState('#fa8c16')
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const [modalState, setModalState] = useState<
    { mode: 'new' } | { mode: 'edit'; anno: Annotation } | null
  >(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [boxInput, setBoxInput] = useState('')
  const [boxFormat, setBoxFormat] = useState<'xywh' | 'corners'>('xywh')
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
      polygonLastClickRef.current = null
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
      if (stored) setAnnotations(stored.annotations.map(normalizeAnno))

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
  const toNorm = useCallback((clientX: number, clientY: number): Pt => {
    const el = stageRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    }
  }, [])

  const rectFrom = useCallback((a: Pt, b: Pt): Rect => {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y)
    }
  }, [])

  const resetDraft = useCallback(
    (s: ShapeType): Draft => {
      const nw = natural?.width ?? 100
      const nh = natural?.height ?? 100
      const base = {
        shape: s,
        color,
        info: '',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
        cx: 0,
        cy: 0,
        r: DEFAULT_POINT_R,
        points: [] as Pt[]
      }
      switch (s) {
        case 'rect':
        case 'ellipse':
          return {
            ...base,
            x: Math.round(nw * 0.1),
            y: Math.round(nh * 0.1),
            w: Math.round(nw * 0.2),
            h: Math.round(nh * 0.1)
          }
        case 'line':
          return {
            ...base,
            x1: Math.round(nw * 0.1),
            y1: Math.round(nh * 0.1),
            x2: Math.round(nw * 0.3),
            y2: Math.round(nh * 0.3)
          }
        case 'point':
          return { ...base, cx: Math.round(nw * 0.5), cy: Math.round(nh * 0.5) }
        case 'polygon':
          return {
            ...base,
            points: [
              { x: Math.round(nw * 0.1), y: Math.round(nh * 0.1) },
              { x: Math.round(nw * 0.3), y: Math.round(nh * 0.1) },
              { x: Math.round(nw * 0.2), y: Math.round(nh * 0.3) }
            ]
          }
      }
    },
    [color, natural]
  )

  const openNewModal = useCallback(
    (s: ShapeType, overrides?: Partial<Draft>) => {
      setDraft({ ...resetDraft(s), ...overrides })
      setBoxInput('')
      setModalState({ mode: 'new' })
    },
    [resetDraft]
  )

  const annoToDraft = useCallback(
    (a: Annotation): Draft => {
      const nw = natural?.width ?? 1
      const nh = natural?.height ?? 1
      const base = {
        shape: a.shape,
        color: a.color,
        info: a.info,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
        cx: 0,
        cy: 0,
        r: DEFAULT_POINT_R,
        points: [] as Pt[]
      }
      switch (a.shape) {
        case 'rect':
        case 'ellipse':
          return {
            ...base,
            x: Math.round((a.x ?? 0) * nw),
            y: Math.round((a.y ?? 0) * nh),
            w: Math.round((a.w ?? 0) * nw),
            h: Math.round((a.h ?? 0) * nh)
          }
        case 'line':
          return {
            ...base,
            x1: Math.round((a.x1 ?? 0) * nw),
            y1: Math.round((a.y1 ?? 0) * nh),
            x2: Math.round((a.x2 ?? 0) * nw),
            y2: Math.round((a.y2 ?? 0) * nh)
          }
        case 'point':
          return {
            ...base,
            cx: Math.round((a.cx ?? 0) * nw),
            cy: Math.round((a.cy ?? 0) * nh),
            r: Math.round((a.r ?? 0) * Math.min(nw, nh))
          }
        case 'polygon':
          return {
            ...base,
            points: (a.points ?? []).map((p) => ({
              x: Math.round(p.x * nw),
              y: Math.round(p.y * nh)
            }))
          }
      }
    },
    [natural]
  )

  const openEdit = useCallback(
    (a: Annotation) => {
      setSelectedId(a.id)
      setDraft(annoToDraft(a))
      setBoxInput('')
      setModalState({ mode: 'edit', anno: a })
    },
    [annoToDraft]
  )

  const finishPolygon = useCallback(() => {
    polygonLastClickRef.current = null
    const cur = drawing
    if (!cur || cur.shape !== 'polygon' || !natural) return
    if (cur.points.length >= 3) {
      setDrawing(null)
      openNewModal('polygon', {
        points: cur.points.map((p) => ({
          x: Math.round(p.x * natural.width),
          y: Math.round(p.y * natural.height)
        }))
      })
    } else {
      message.info(t('annoPolygonTooFew'))
    }
  }, [drawing, natural, openNewModal, t, message])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!annotateMode || !natural || e.altKey) return
      e.preventDefault()
      const p = toNorm(e.clientX, e.clientY)

      if (shape === 'polygon') {
        if (e.button === 2) {
          if (drawing?.shape === 'polygon') {
            polygonLastClickRef.current = null
            const pts = drawing.points.slice(0, -1)
            setDrawing(
              pts.length ? { shape: 'polygon', points: pts, cursor: drawing.cursor } : null
            )
          }
          return
        }
        if (e.button !== 0) return
        const now = performance.now()
        const last = polygonLastClickRef.current
        const isFinish =
          drawing?.shape === 'polygon' &&
          last !== null &&
          now - last.time < DOUBLE_CLICK_MS &&
          Math.hypot(e.clientX - last.clientX, e.clientY - last.clientY) < DOUBLE_CLICK_PX
        polygonLastClickRef.current = { time: now, clientX: e.clientX, clientY: e.clientY }
        if (isFinish) {
          finishPolygon()
          return
        }
        const cur = drawing
        const pts = cur?.shape === 'polygon' ? [...cur.points, p] : [p]
        setDrawing({ shape: 'polygon', points: pts, cursor: p })
        return
      }

      if (e.button !== 0) return
      dragRef.current = { start: p, cur: p }
      stageRef.current?.setPointerCapture(e.pointerId)
      if (shape === 'rect' || shape === 'ellipse') {
        setDrawing({ shape, rect: { x: p.x, y: p.y, w: 0, h: 0 }, cursor: p })
      } else if (shape === 'line') {
        setDrawing({ shape: 'line', points: [p, p] })
      } else {
        setDrawing({ shape: 'point', point: p, cursor: p })
      }
    },
    [annotateMode, natural, toNorm, shape, drawing, finishPolygon]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!annotateMode || !natural) return
      const p = toNorm(e.clientX, e.clientY)

      if (shape === 'polygon') {
        if (drawing?.shape === 'polygon') setDrawing({ ...drawing, cursor: p })
        return
      }

      if (!dragRef.current) return
      dragRef.current.cur = p
      if (shape === 'rect' || shape === 'ellipse') {
        setDrawing({ shape, rect: rectFrom(dragRef.current.start, p), cursor: p })
      } else if (shape === 'line') {
        setDrawing({ shape: 'line', points: [dragRef.current.start, p] })
      } else {
        setDrawing({ shape: 'point', point: dragRef.current.start, cursor: p })
      }
    },
    [annotateMode, natural, toNorm, rectFrom, shape, drawing]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag || !annotateMode || !natural) return
      const p = toNorm(e.clientX, e.clientY)
      setDrawing(null)
      const nw = natural.width
      const nh = natural.height

      if (shape === 'point') {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > MIN_DRAG) {
          message.info(t('annoDrawTooSmall'))
          return
        }
        openNewModal('point', {
          cx: Math.round(drag.start.x * nw),
          cy: Math.round(drag.start.y * nh),
          r: DEFAULT_POINT_R
        })
        return
      }

      if (shape === 'line') {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < MIN_DRAG) {
          message.info(t('annoLineTooShort'))
          return
        }
        openNewModal('line', {
          x1: Math.round(drag.start.x * nw),
          y1: Math.round(drag.start.y * nh),
          x2: Math.round(p.x * nw),
          y2: Math.round(p.y * nh)
        })
        return
      }

      const rect = rectFrom(drag.start, p)
      if (rect.w < MIN_DRAG || rect.h < MIN_DRAG) {
        message.info(t('annoDrawTooSmall'))
        return
      }
      openNewModal(shape, {
        x: Math.round(rect.x * nw),
        y: Math.round(rect.y * nh),
        w: Math.round(rect.w * nw),
        h: Math.round(rect.h * nh)
      })
    },
    [annotateMode, natural, toNorm, rectFrom, openNewModal, shape, t, message]
  )

  const toggleAnnotateMode = useCallback(() => {
    setAnnotateMode((v) => {
      if (v) {
        polygonLastClickRef.current = null
        dragRef.current = null
        setDrawing(null)
      }
      return !v
    })
  }, [])

  /* ── annotations ── */
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
    if (!modalState || !natural || !draft) return
    const d = draft
    const nw = natural.width
    const nh = natural.height
    const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x <= nw && y <= nh

    let geom: Partial<Annotation> | null = null
    if (d.shape === 'rect' || d.shape === 'ellipse') {
      const { x, y, w, h } = d
      if (
        ![x, y, w, h].every(Number.isFinite) ||
        w <= 0 ||
        h <= 0 ||
        !inBounds(x, y) ||
        !inBounds(x + w, y + h)
      ) {
        message.error(t('annoInvalidCoords'))
        return
      }
      geom = { x: x / nw, y: y / nh, w: w / nw, h: h / nh }
    } else if (d.shape === 'line') {
      const { x1, y1, x2, y2 } = d
      if (![x1, y1, x2, y2].every(Number.isFinite) || !inBounds(x1, y1) || !inBounds(x2, y2)) {
        message.error(t('annoInvalidCoords'))
        return
      }
      geom = { x1: x1 / nw, y1: y1 / nh, x2: x2 / nw, y2: y2 / nh }
    } else if (d.shape === 'point') {
      const { cx, cy, r } = d
      if (![cx, cy, r].every(Number.isFinite) || r <= 0 || !inBounds(cx, cy)) {
        message.error(t('annoInvalidCoords'))
        return
      }
      geom = { cx: cx / nw, cy: cy / nh, r: r / Math.min(nw, nh) }
    } else {
      if (d.points.length < 3) {
        message.error(t('annoPolygonTooFew'))
        return
      }
      for (const p of d.points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !inBounds(p.x, p.y)) {
          message.error(t('annoInvalidCoords'))
          return
        }
      }
      geom = { points: d.points.map((p) => ({ x: p.x / nw, y: p.y / nh })) }
    }

    if (modalState.mode === 'new') {
      const anno: Annotation = {
        id: crypto.randomUUID(),
        page: currentPage,
        color: d.color,
        info: d.info.trim(),
        shape: d.shape,
        ...geom
      }
      setAnnotations((prev) => [...prev, anno])
      setSelectedId(anno.id)
    } else {
      const target = modalState.anno
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === target.id
            ? { ...a, ...geom, shape: d.shape, color: d.color, info: d.info.trim() }
            : a
        )
      )
      setSelectedId(null)
    }
    setModalState(null)
  }, [modalState, draft, currentPage, natural, t, message])

  const openManualAdd = useCallback(() => {
    if (!natural) return
    openNewModal(shape)
  }, [natural, openNewModal, shape])

  const applyBoxInput = useCallback(() => {
    if (!draft || !natural) return
    const m = boxInput
      .trim()
      .match(/^\s*\[?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]?\s*$/)
    if (!m) {
      message.error(t('annoInvalidCoords'))
      return
    }
    const nums = m.slice(1).map(Number)
    if (!nums.every(Number.isFinite)) {
      message.error(t('annoInvalidCoords'))
      return
    }
    let x: number
    let y: number
    let w: number
    let h: number
    if (boxFormat === 'corners') {
      const [x1, y1, x2, y2] = nums
      x = Math.min(x1, x2)
      y = Math.min(y1, y2)
      w = Math.abs(x2 - x1)
      h = Math.abs(y2 - y1)
    } else {
      const [cx, cy, cw, ch] = nums
      x = cx
      y = cy
      w = cw
      h = ch
    }
    if (w <= 0 || h <= 0) {
      message.error(t('annoInvalidCoords'))
      return
    }
    setDraft((d) =>
      d
        ? {
            ...d,
            x: Math.round(Math.min(natural.width, Math.max(0, x))),
            y: Math.round(Math.min(natural.height, Math.max(0, y))),
            w: Math.round(Math.min(natural.width, Math.max(1, w))),
            h: Math.round(Math.min(natural.height, Math.max(1, h)))
          }
        : d
    )
  }, [draft, boxInput, boxFormat, natural, t, message])

  /* keyboard: polygon editing (undo / cancel / finish) */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAltHeld(true)
      if (e.key === 'Escape') {
        polygonLastClickRef.current = null
        dragRef.current = null
        setDrawing(null)
        return
      }
      if (drawing?.shape === 'polygon') {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          polygonLastClickRef.current = null
          const pts = drawing.points.slice(0, -1)
          setDrawing(pts.length ? { shape: 'polygon', points: pts, cursor: drawing.cursor } : null)
          e.preventDefault()
        } else if (e.key === 'Enter') {
          finishPolygon()
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAltHeld(false)
    }
    const onBlur = (): void => {
      setAltHeld(false)
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [drawing, finishPolygon])

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

  const shapeOptions = useMemo(
    () =>
      SHAPE_ORDER.map((s) => ({
        value: s,
        label: t(`annoShape${s.charAt(0).toUpperCase()}${s.slice(1)}`)
      })),
    [t]
  )

  const boxFormatOptions = useMemo(
    () => [
      { value: 'xywh', label: t('annoBoxFormatSize') },
      { value: 'corners', label: t('annoBoxFormatCorners') }
    ],
    [t]
  )

  const shapeHintKey = useMemo(() => {
    const map: Record<ShapeType, string> = {
      rect: 'annoRectHint',
      ellipse: 'annoEllipseHint',
      polygon: 'annoPolygonHint',
      line: 'annoLineHint',
      point: 'annoPointHint'
    }
    return map[shape]
  }, [shape])

  const shapeLabel = useCallback(
    (s: ShapeType) => t(`annoShape${s.charAt(0).toUpperCase()}${s.slice(1)}`),
    [t]
  )

  const annoBBox = useCallback(
    (a: Annotation): { x: number; y: number; w: number; h: number } => {
      const W = display.width
      const H = display.height
      const minD = Math.min(W, H)
      switch (a.shape) {
        case 'ellipse':
        case 'rect':
          return { x: a.x! * W, y: a.y! * H, w: a.w! * W, h: a.h! * H }
        case 'polygon': {
          const pts = a.points ?? []
          const xs = pts.map((p) => p.x * W)
          const ys = pts.map((p) => p.y * H)
          const x = Math.min(...xs)
          const y = Math.min(...ys)
          return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
        }
        case 'line': {
          const x = Math.min(a.x1!, a.x2!) * W
          const y = Math.min(a.y1!, a.y2!) * H
          return { x, y, w: Math.abs(a.x2! - a.x1!) * W, h: Math.abs(a.y2! - a.y1!) * H }
        }
        case 'point': {
          const r = a.r! * minD
          const x = a.cx! * W - r
          const y = a.cy! * H - r
          return { x, y, w: r * 2, h: r * 2 }
        }
      }
    },
    [display]
  )

  const annoSummary = useCallback(
    (a: Annotation): string => {
      const nw = natural?.width ?? 1
      const nh = natural?.height ?? 1
      const minD = Math.min(nw, nh)
      switch (a.shape) {
        case 'rect':
        case 'ellipse':
          return `(${Math.round(a.x! * nw)}, ${Math.round(a.y! * nh)}) · ${Math.round(
            a.w! * nw
          )} × ${Math.round(a.h! * nh)}px`
        case 'line':
          return `(${Math.round(a.x1! * nw)}, ${Math.round(a.y1! * nh)}) → (${Math.round(
            a.x2! * nw
          )}, ${Math.round(a.y2! * nh)})`
        case 'point':
          return `(${Math.round(a.cx! * nw)}, ${Math.round(a.cy! * nh)}) · r=${Math.round(
            a.r! * minD
          )}px`
        case 'polygon':
          return `${a.points?.length ?? 0} ${t('annoVertices')}`
      }
    },
    [natural, t]
  )

  /* in-progress drawing geometry (px) */
  const drawingGeom = useMemo(() => {
    if (!drawing || !natural) return null
    const d: Drawing = drawing
    const nw = natural.width
    const nh = natural.height
    if (d.shape === 'rect' || d.shape === 'ellipse') {
      const g = d.rect
      return {
        text: `(${Math.round(g.x * nw)}, ${Math.round(g.y * nh)}) · ${Math.round(
          g.w * nw
        )} × ${Math.round(g.h * nh)}px`,
        x: g.x * display.width,
        y: g.y * display.height
      }
    }
    if (d.shape === 'line') {
      const [a, b] = d.points
      return {
        text: `(${Math.round(a.x * nw)}, ${Math.round(a.y * nh)}) → (${Math.round(
          b.x * nw
        )}, ${Math.round(b.y * nh)})`,
        x: ((a.x + b.x) / 2) * display.width,
        y: ((a.y + b.y) / 2) * display.height
      }
    }
    if (d.shape === 'point') {
      const p = d.point
      return {
        text: `(${Math.round(p.x * nw)}, ${Math.round(p.y * nh)})`,
        x: p.x * display.width,
        y: p.y * display.height
      }
    }
    const pts = [...d.points, d.cursor]
    const minX = Math.min(...pts.map((p) => p.x * display.width))
    const minY = Math.min(...pts.map((p) => p.y * display.height))
    return {
      text: t('annoPolygonProgress', { count: d.points.length }),
      x: minX,
      y: minY
    }
  }, [drawing, natural, display, t])

  const setDraftPoint = useCallback((i: number, key: 'x' | 'y', v: number | null) => {
    setDraft((d) => {
      if (!d) return d
      const points = d.points.map((p, idx) => (idx === i ? { ...p, [key]: Number(v) || 0 } : p))
      return { ...d, points }
    })
  }, [])

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

              <Select
                value={shape}
                onChange={(v) => {
                  setShape(v as ShapeType)
                  polygonLastClickRef.current = null
                  dragRef.current = null
                  setDrawing(null)
                }}
                options={shapeOptions}
                disabled={!annotateMode}
                style={{ width: 88 }}
              />

              <button
                onClick={toggleAnnotateMode}
                title={t('annoAnnotateHint')}
                className={
                  annotateMode
                    ? 'w-8 h-8 rounded-lg text-sm flex items-center justify-center transition-all duration-150 cursor-pointer border-none bg-[var(--accent)] text-white'
                    : ICON_BTN_CLS
                }
              >
                <HighlightOutlined />
              </button>

              <button onClick={openManualAdd} title={t('annoAddCoords')} className={ICON_BTN_CLS}>
                <PlusOutlined />
              </button>

              <ColorPicker
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
                <button title={t('annoClear')} className={ICON_BTN_CLS}>
                  <DeleteOutlined />
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
            {annotateMode && (
              <span className="hidden md:inline font-medium text-[var(--accent)]">
                {t(shapeHintKey)}
              </span>
            )}
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
                onClick={() => setSelectedId(null)}
                onContextMenu={(e) => {
                  if (annotateMode) e.preventDefault()
                }}
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
                  const box = annoBBox(a)
                  const selected = a.id === selectedId
                  const isBox = a.shape === 'rect' || a.shape === 'ellipse'
                  return (
                    <div
                      key={a.id}
                      ref={(el) => {
                        annoRefs.current[a.id] = el
                      }}
                      className="absolute group"
                      style={{
                        left: box.x,
                        top: box.y,
                        width: box.w,
                        height: box.h,
                        pointerEvents: annotateMode ? 'none' : 'auto'
                      }}
                    >
                      <div
                        onClick={(e) => {
                          e.stopPropagation()
                          openEdit(a)
                        }}
                        className="absolute inset-0 cursor-pointer"
                        style={
                          isBox
                            ? {
                                border: `2px solid ${a.color}`,
                                background: `${a.color}2e`,
                                boxShadow: selected ? '0 0 0 2px var(--accent)' : 'none',
                                borderRadius: a.shape === 'ellipse' ? '50%' : 4
                              }
                            : { boxShadow: selected ? '0 0 0 2px var(--accent)' : 'none' }
                        }
                      />
                      {a.shape === 'polygon' && a.points && a.points.length > 0 && (
                        <svg
                          className="absolute inset-0 pointer-events-none"
                          width={box.w}
                          height={box.h}
                          overflow="visible"
                        >
                          <polygon
                            points={(a.points ?? [])
                              .map(
                                (p) =>
                                  `${(p.x * display.width - box.x).toFixed(1)},${(
                                    p.y * display.height -
                                    box.y
                                  ).toFixed(1)}`
                              )
                              .join(' ')}
                            fill={`${a.color}2e`}
                            stroke={a.color}
                            strokeWidth={1.5}
                          />
                          {a.points.map((p, i) => (
                            <circle
                              key={i}
                              cx={p.x * display.width - box.x}
                              cy={p.y * display.height - box.y}
                              r={3}
                              fill={a.color}
                            />
                          ))}
                        </svg>
                      )}
                      {a.shape === 'line' && (
                        <svg
                          className="absolute inset-0 pointer-events-none"
                          width={box.w}
                          height={box.h}
                          overflow="visible"
                        >
                          <line
                            x1={a.x1! * display.width - box.x}
                            y1={a.y1! * display.height - box.y}
                            x2={a.x2! * display.width - box.x}
                            y2={a.y2! * display.height - box.y}
                            stroke={a.color}
                            strokeWidth={2}
                          />
                        </svg>
                      )}
                      {a.shape === 'point' && (
                        <svg
                          className="absolute inset-0 pointer-events-none"
                          width={box.w}
                          height={box.h}
                          overflow="visible"
                        >
                          <circle
                            cx={box.w / 2}
                            cy={box.h / 2}
                            r={box.w / 2}
                            fill={`${a.color}2e`}
                            stroke={a.color}
                            strokeWidth={2}
                          />
                        </svg>
                      )}
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
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => openEdit(a)}
                            className="flex h-5 w-5 items-center justify-center rounded text-[10px] bg-[var(--surface)] border border-[var(--border-subtle)] shadow-sm text-[var(--text-primary)] hover:text-[var(--accent)] cursor-pointer"
                          >
                            <EditOutlined />
                          </button>
                          <button
                            onClick={() => removeAnnotation(a.id)}
                            className="flex h-5 w-5 items-center justify-center rounded text-[10px] bg-[var(--surface)] border border-[var(--border-subtle)] shadow-sm text-[var(--text-primary)] hover:text-[var(--danger)] cursor-pointer"
                          >
                            <DeleteOutlined />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* In-progress drawing preview */}
                {drawing && natural && display.width > 0 && (
                  <>
                    {drawing.shape === 'rect' || drawing.shape === 'ellipse' ? (
                      <div
                        className="absolute pointer-events-none rounded-sm"
                        style={{
                          left: drawing.rect.x * display.width,
                          top: drawing.rect.y * display.height,
                          width: drawing.rect.w * display.width,
                          height: drawing.rect.h * display.height,
                          border: `1.5px dashed ${color}`,
                          background: `${color}26`,
                          borderRadius: drawing.shape === 'ellipse' ? '50%' : undefined
                        }}
                      />
                    ) : (
                      <svg
                        className="absolute inset-0 pointer-events-none"
                        style={{ width: display.width, height: display.height }}
                        overflow="visible"
                      >
                        {drawing.shape === 'line' && (
                          <line
                            x1={drawing.points[0].x * display.width}
                            y1={drawing.points[0].y * display.height}
                            x2={drawing.points[1].x * display.width}
                            y2={drawing.points[1].y * display.height}
                            stroke={color}
                            strokeWidth={1.5}
                            strokeDasharray="4 2"
                          />
                        )}
                        {drawing.shape === 'point' && (
                          <circle
                            cx={drawing.point.x * display.width}
                            cy={drawing.point.y * display.height}
                            r={DEFAULT_POINT_R * zoom}
                            fill={`${color}26`}
                            stroke={color}
                            strokeWidth={1.5}
                            strokeDasharray="4 2"
                          />
                        )}
                        {drawing.shape === 'polygon' && (
                          <>
                            <polygon
                              points={[...drawing.points, drawing.cursor]
                                .map(
                                  (p) =>
                                    `${(p.x * display.width).toFixed(1)},${(
                                      p.y * display.height
                                    ).toFixed(1)}`
                                )
                                .join(' ')}
                              fill={`${color}26`}
                              stroke={color}
                              strokeWidth={1.5}
                              strokeDasharray="4 2"
                            />
                            {drawing.points.map((p, i) => (
                              <circle
                                key={i}
                                cx={p.x * display.width}
                                cy={p.y * display.height}
                                r={4}
                                fill={color}
                              />
                            ))}
                          </>
                        )}
                      </svg>
                    )}
                    {drawingGeom && (
                      <div
                        className="absolute z-10 pointer-events-none rounded bg-[#262626] text-white px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap shadow-sm"
                        style={{
                          left: Math.min(drawingGeom.x + 4, Math.max(display.width - 220, 4)),
                          top: Math.max(drawingGeom.y - 22, 2)
                        }}
                      >
                        {drawingGeom.text}
                      </div>
                    )}
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
                      <span className="shrink-0 text-[10px] text-[var(--text-secondary)]">
                        {shapeLabel(a.shape)}
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
                          className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-[10px] text-[var(--text-secondary)] hover:text-[var(--danger)] hover:bg-[var(--border-subtle)] cursor-pointer"
                          title={t('annoDelete')}
                        >
                          <DeleteOutlined />
                        </button>
                      </Popconfirm>
                    </div>
                    <div className="mt-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
                      {annoSummary(a)}
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
        width={460}
      >
        {draft && (
          <div className="flex flex-col gap-4 pt-3">
            {modalState?.mode === 'new' && (
              <div>
                <label className={LABEL_CLS}>{t('annoShape')}</label>
                <Segmented
                  block
                  value={draft.shape}
                  onChange={(v) => setDraft((d) => (d ? { ...d, shape: v as ShapeType } : d))}
                  options={shapeOptions}
                />
              </div>
            )}
            <div>
              <label className={LABEL_CLS}>{t('annoColor')}</label>
              <ColorPicker
                value={draft.color}
                presets={colorPresets}
                showText
                onChange={(c) => setDraft((d) => (d ? { ...d, color: c.toHexString() } : d))}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>{t('annoInfo')}</label>
              <Input.TextArea
                value={draft.info}
                onChange={(e) => setDraft((d) => (d ? { ...d, info: e.target.value } : d))}
                placeholder={t('annoInfoPlaceholder')}
                rows={3}
              />
            </div>
            {modalState?.mode === 'new' && natural && (
              <>
                {(draft.shape === 'rect' || draft.shape === 'ellipse') && (
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="shrink-0 text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] whitespace-nowrap">
                        {t('annoBoxLabel')}
                      </span>
                      <Segmented
                        value={boxFormat}
                        onChange={(v) => setBoxFormat(v as 'xywh' | 'corners')}
                        options={boxFormatOptions}
                      />
                      <Input
                        value={boxInput}
                        onChange={(e) => setBoxInput(e.target.value)}
                        onPressEnter={applyBoxInput}
                        placeholder={t('annoBoxPlaceholder')}
                        className="flex-1"
                      />
                      <button
                        onClick={applyBoxInput}
                        title={t('annoBoxApply')}
                        className={ICON_BTN_CLS}
                      >
                        <EditOutlined />
                      </button>
                    </div>
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
                          value={draft.x}
                          onChange={(v) => setDraft((d) => (d ? { ...d, x: Number(v) || 0 } : d))}
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
                          value={draft.y}
                          onChange={(v) => setDraft((d) => (d ? { ...d, y: Number(v) || 0 } : d))}
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
                          value={draft.w}
                          onChange={(v) => setDraft((d) => (d ? { ...d, w: Number(v) || 0 } : d))}
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
                          value={draft.h}
                          onChange={(v) => setDraft((d) => (d ? { ...d, h: Number(v) || 0 } : d))}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {draft.shape === 'line' && (
                  <div>
                    <label className={LABEL_CLS}>{t('annoCoordinate')}</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ['x1', 'X1'],
                          ['y1', 'Y1'],
                          ['x2', 'X2'],
                          ['y2', 'Y2']
                        ] as const
                      ).map(([key, label]) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="w-5 shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                            {label}
                          </span>
                          <InputNumber
                            min={0}
                            max={key.startsWith('y') ? natural.height : natural.width}
                            precision={0}
                            value={draft[key]}
                            onChange={(v) =>
                              setDraft((d) => (d ? { ...d, [key]: Number(v) || 0 } : d))
                            }
                            style={{ width: '100%' }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {draft.shape === 'point' && (
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
                          value={draft.cx}
                          onChange={(v) => setDraft((d) => (d ? { ...d, cx: Number(v) || 0 } : d))}
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
                          value={draft.cy}
                          onChange={(v) => setDraft((d) => (d ? { ...d, cy: Number(v) || 0 } : d))}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-xs font-semibold text-[var(--text-secondary)]">
                          R
                        </span>
                        <InputNumber
                          min={1}
                          max={Math.round(Math.min(natural.width, natural.height) / 2)}
                          precision={0}
                          value={draft.r}
                          onChange={(v) => setDraft((d) => (d ? { ...d, r: Number(v) || 0 } : d))}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <span className="text-[11px] text-[var(--text-secondary)] leading-8">
                        {t('annoRadius')}
                      </span>
                    </div>
                  </div>
                )}

                {draft.shape === 'polygon' && (
                  <div>
                    <label className={LABEL_CLS}>
                      {t('annoVertices')} ({draft.points.length})
                    </label>
                    <div className="flex flex-col gap-1.5 max-h-40 overflow-auto">
                      {draft.points.map((p, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="w-4 shrink-0 text-[10px] text-[var(--text-secondary)]">
                            {i + 1}
                          </span>
                          <InputNumber
                            min={0}
                            max={natural.width}
                            precision={0}
                            size="small"
                            value={p.x}
                            onChange={(v) => setDraftPoint(i, 'x', v)}
                            style={{ width: '100%' }}
                          />
                          <InputNumber
                            min={0}
                            max={natural.height}
                            precision={0}
                            size="small"
                            value={p.y}
                            onChange={(v) => setDraftPoint(i, 'y', v)}
                            style={{ width: '100%' }}
                          />
                          <button
                            onClick={() =>
                              setDraft((d) =>
                                d ? { ...d, points: d.points.filter((_, idx) => idx !== i) } : d
                              )
                            }
                            title={t('annoRemoveVertex')}
                            className="shrink-0 flex h-6 w-6 items-center justify-center rounded text-[10px] text-[var(--text-secondary)] hover:text-[var(--danger)] hover:bg-[var(--border-subtle)] cursor-pointer"
                          >
                            <CloseOutlined />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() =>
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                points: [
                                  ...d.points,
                                  {
                                    x: Math.round(natural.width * 0.5),
                                    y: Math.round(natural.height * 0.5)
                                  }
                                ]
                              }
                            : d
                        )
                      }
                      className="mt-1.5 text-xs font-semibold text-[var(--accent)] hover:opacity-80 cursor-pointer"
                    >
                      + {t('annoAddVertex')}
                    </button>
                  </div>
                )}

                <p className="text-[11px] text-[var(--text-secondary)]">{t('annoCoordsPx')}</p>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default PdfImageAnnotate
