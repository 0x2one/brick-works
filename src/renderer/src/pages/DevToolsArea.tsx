import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppstoreOutlined, CloseOutlined } from '@ant-design/icons'
import { devTools } from '../data/devTools'
import DevTools from './DevTools'
import DevToolDetail from './DevToolDetail'

const TABS_STORAGE_KEY = 'dev-tools-tabs'
const TAB_POSITION_STORAGE_KEY = 'dev-tools-tab-position'

export type DevToolTabPosition = 'top' | 'bottom' | 'hidden'

const toolById = new Map(devTools.map((tool) => [tool.id, tool]))

function loadTabPosition(): DevToolTabPosition {
  const value = localStorage.getItem(TAB_POSITION_STORAGE_KEY)
  return value === 'bottom' || value === 'hidden' ? value : 'top'
}

function loadOpenTabs(): string[] {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY)
    if (!raw) return []
    const ids: unknown = JSON.parse(raw)
    if (!Array.isArray(ids)) return []
    return ids.filter((id): id is string => typeof id === 'string' && toolById.has(id))
  } catch {
    return []
  }
}

function DevToolsArea({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [openToolIds, setOpenToolIds] = useState<string[]>(loadOpenTabs)
  const [tabPosition, setTabPosition] = useState<DevToolTabPosition>(loadTabPosition)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const showGrid = location.pathname === '/dev-tools'
  const activeToolId = location.pathname.startsWith('/dev-tools/')
    ? location.pathname.slice('/dev-tools/'.length)
    : null

  useEffect(() => {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(openToolIds))
  }, [openToolIds])

  useEffect(() => {
    if (!ctxMenu) return
    const onMouseDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    const onBlur = (): void => setCtxMenu(null)
    const onResize = (): void => setCtxMenu(null)
    const onScroll = (): void => setCtxMenu(null)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    const onContextMenu = (): void => setCtxMenu(null)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('contextmenu', onContextMenu)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [ctxMenu])

  const closeAllTabs = (): void => {
    setOpenToolIds([])
    if (activeToolId) navigate('/dev-tools')
    setCtxMenu(null)
  }

  useEffect(() => {
    const onChange = (e: Event): void => {
      setTabPosition((e as CustomEvent<DevToolTabPosition>).detail)
    }
    window.addEventListener('dev-tools-tab-position-change', onChange)
    return () => window.removeEventListener('dev-tools-tab-position-change', onChange)
  }, [])

  useEffect(() => {
    if (activeToolId && toolById.has(activeToolId)) {
      setOpenToolIds((prev) => (prev.includes(activeToolId) ? prev : [...prev, activeToolId]))
    }
  }, [activeToolId])

  const closeTab = (id: string): void => {
    const idx = openToolIds.indexOf(id)
    setOpenToolIds((prev) => prev.filter((x) => x !== id))
    if (activeToolId === id) {
      const neighbor = idx > 0 ? toolById.get(openToolIds[idx - 1]) : undefined
      navigate(neighbor ? neighbor.route : '/dev-tools')
    }
  }

  const tabBase =
    'shrink-0 h-8 pl-3 pr-1.5 rounded-lg text-xs flex items-center gap-1.5 border cursor-pointer transition-colors'

  const tabBar =
    tabPosition === 'hidden' ? null : (
      <div
        className={`shrink-0 flex flex-wrap items-center gap-1 px-2 py-1.5 border-${
          tabPosition === 'top' ? 'b' : 't'
        } border-[var(--border-subtle)]`}
      >
        <button
          type="button"
          onClick={() => navigate('/dev-tools')}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setCtxMenu({ x: e.clientX, y: e.clientY })
          }}
          title={t('allTools')}
          className={`${tabBase} ${
            showGrid
              ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
              : 'bg-[var(--bg-warm)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'
          }`}
        >
          <AppstoreOutlined />
          <span className="max-w-[160px] truncate">{t('allTools')}</span>
        </button>
        {openToolIds.map((id) => {
          const tool = toolById.get(id)
          if (!tool) return null
          const active = activeToolId === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(tool.route)}
              className={`${tabBase} ${
                active
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'bg-[var(--bg-warm)] text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'
              }`}
            >
              <span className="max-w-[160px] truncate">{t(tool.nameKey)}</span>
              <span
                role="button"
                tabIndex={0}
                title={t('closeTab')}
                className={`h-5 w-5 rounded flex items-center justify-center ${
                  active ? 'hover:bg-white/20' : 'hover:bg-[var(--border-subtle)]'
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    closeTab(id)
                  }
                }}
              >
                <CloseOutlined style={{ fontSize: 10 }} />
              </span>
            </button>
          )
        })}
      </div>
    )

  return (
    <div
      className={`flex flex-col flex-1 min-h-0 overflow-hidden bg-[var(--content-bg)]${
        active ? '' : ' hidden'
      }`}
      aria-hidden={!active}
    >
      {tabPosition === 'top' && tabBar}

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <div className={showGrid ? 'shrink-0' : 'hidden'}>
          <DevTools />
        </div>
        {openToolIds.map((id) => {
          const tool = toolById.get(id)
          if (!tool) return null
          const panelCls = tool.fill ? 'flex flex-col flex-1 min-h-0' : 'shrink-0'
          return (
            <div key={id} className={`${panelCls} ${activeToolId === id ? '' : 'hidden'}`}>
              <DevToolDetail toolId={id} />
            </div>
          )
        })}
      </div>

      {tabPosition === 'bottom' && tabBar}

      {ctxMenu &&
        (() => {
          const MENU_W = 160
          const MENU_H = 36
          const OFFSET = 4
          const x = Math.min(ctxMenu.x, window.innerWidth - MENU_W - OFFSET)
          const y =
            tabPosition === 'bottom'
              ? Math.max(OFFSET, ctxMenu.y - MENU_H - OFFSET)
              : Math.min(ctxMenu.y + OFFSET, window.innerHeight - MENU_H - OFFSET)
          return (
            <div
              ref={menuRef}
              className="fixed z-50 py-1 rounded-lg border border-[var(--border-subtle)]
                bg-[var(--surface)] shadow-lg"
              style={{ left: x, top: y, minWidth: MENU_W }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <button
                type="button"
                onClick={closeAllTabs}
                className="w-full px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer border-none
                  bg-transparent text-[var(--text-primary)] hover:bg-[var(--border-subtle)]
                  transition-colors duration-100"
              >
                <CloseOutlined style={{ fontSize: 10 }} />
                <span>{t('closeAllTabs')}</span>
              </button>
            </div>
          )
        })()}
    </div>
  )
}

export default DevToolsArea
