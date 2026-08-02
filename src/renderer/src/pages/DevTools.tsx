import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input } from 'antd'
import { HeartOutlined, HeartFilled } from '@ant-design/icons'
import { devTools, useDevToolStats } from '../data/devTools'

const TABS = ['all', 'favorites', 'recent', 'most-used'] as const
const TAB_LABELS: Record<string, string> = {
  all: 'devToolTabAll',
  favorites: 'devToolTabFavorites',
  recent: 'devToolTabRecent',
  'most-used': 'devToolTabMostUsed'
}

function DevTools(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { stats, toggleFavorite, recordUse } = useDevToolStats()
  const [activeTab, setActiveTab] = useState('all')
  const [searchText, setSearchText] = useState('')

  const filteredTools = useMemo(() => {
    let list = [...devTools]

    if (searchText) {
      const lower = searchText.toLowerCase()
      list = list.filter(
        (tool) =>
          t(tool.nameKey).toLowerCase().includes(lower) ||
          t(tool.descKey).toLowerCase().includes(lower)
      )
    }

    switch (activeTab) {
      case 'favorites':
        list = list.filter((tool) => stats[tool.id]?.favorited)
        break
      case 'recent':
        list.sort((a, b) => {
          const aTime = stats[a.id]?.lastUsedAt ?? 0
          const bTime = stats[b.id]?.lastUsedAt ?? 0
          return bTime - aTime
        })
        break
      case 'most-used':
        list.sort((a, b) => {
          const aCount = stats[a.id]?.useCount ?? 0
          const bCount = stats[b.id]?.useCount ?? 0
          return bCount - aCount
        })
        break
    }

    return list
  }, [activeTab, searchText, stats, t])

  const handleCardClick = (id: string, route: string) => {
    recordUse(id)
    navigate(route, { viewTransition: true })
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg w-fit">
          {TABS.map((key) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`
                px-4 py-1 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer
                ${
                  activeTab === key
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
                }
              `}
            >
              {t(TAB_LABELS[key])}
            </button>
          ))}
        </div>
        <Input.Search
          placeholder={t('searchTools')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onSearch={setSearchText}
          style={{ width: 320 }}
          allowClear
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredTools.map((tool) => {
          const s = stats[tool.id]
          return (
            <div
              key={tool.id}
              className="tool-card"
              onClick={() => handleCardClick(tool.id, tool.route)}
            >
              <div className="flex items-start justify-between mb-2 gap-2">
                <span className="font-semibold text-[15px] leading-snug text-[var(--text-primary)]">
                  {t(tool.nameKey)}
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(tool.id)
                  }}
                  className="cursor-pointer shrink-0 mt-0.5 leading-none"
                  style={{
                    color: s?.favorited ? 'var(--accent)' : 'var(--text-secondary)',
                    fontSize: 15
                  }}
                >
                  {s?.favorited ? <HeartFilled /> : <HeartOutlined />}
                </span>
              </div>

              <p className="text-sm leading-relaxed text-[var(--text-secondary)] mb-3 line-clamp-2">
                {t(tool.descKey)}
              </p>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {tool.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs rounded-md bg-[var(--border-subtle)] text-[var(--text-secondary)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-auto pt-3 border-t border-[var(--border-subtle)] flex gap-3 text-xs text-[var(--text-secondary)]">
                {s?.lastUsedAt && (
                  <span>
                    {t('lastUsed')}: {new Date(s.lastUsedAt).toLocaleDateString()}
                  </span>
                )}
                <span>
                  {t('useCount')}: {s?.useCount ?? 0}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default DevTools
