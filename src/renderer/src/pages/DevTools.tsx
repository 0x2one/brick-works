import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input } from 'antd'
import { HeartOutlined, HeartFilled, SearchOutlined } from '@ant-design/icons'
import { devTools, useDevToolStats } from '../data/devTools'
import { EmptyState } from '../components/ui'

const TABS = ['all', 'favorites', 'recent', 'most-used'] as const
const TAB_LABELS: Record<string, string> = {
  all: 'devToolTabAll',
  favorites: 'devToolTabFavorites',
  recent: 'devToolTabRecent',
  'most-used': 'devToolTabMostUsed'
}

const TAG_CLS: Record<string, string> = {
  devTagTool: 'tag-chip',
  devTagSecurity: 'tag-chip tag-chip--danger',
  devTagImage: 'tag-chip tag-chip--accent',
  devTagJson: 'tag-chip tag-chip--info',
  devTagCodec: 'tag-chip tag-chip--warning',
  devTagTime: 'tag-chip',
  devTagGenerate: 'tag-chip tag-chip--success',
  devTagDoc: 'tag-chip tag-chip--warning',
  devTagText: 'tag-chip',
  devTagColor: 'tag-chip tag-chip--accent',
  devTagBinary: 'tag-chip tag-chip--info'
}

function DevTools(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { stats, toggleFavorite, recordUse } = useDevToolStats()
  const [activeTab, setActiveTab] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const tagOptions = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const tool of devTools) {
      for (const tag of tool.tags) {
        if (tag === 'devTagTool' || seen.has(tag)) continue
        seen.add(tag)
        list.push(tag)
      }
    }
    return list
  }, [])

  const filteredTools = useMemo(() => {
    let list = [...devTools]

    if (activeTag) {
      list = list.filter((tool) => tool.tags.includes(activeTag))
    }

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
  }, [activeTag, activeTab, searchText, stats, t])

  const handleCardClick = (id: string, route: string): void => {
    recordUse(id)
    navigate(route)
  }

  const showEmpty = filteredTools.length === 0

  const emptyTitle = searchText
    ? t('noSearchResults')
    : activeTab === 'favorites'
      ? t('noFavorites')
      : t('noSearchResults')
  const emptyHint = searchText
    ? t('noSearchResultsHint')
    : activeTab === 'favorites'
      ? t('noFavoritesHint')
      : undefined
  const emptyIcon = searchText ? (
    <SearchOutlined />
  ) : activeTab === 'favorites' ? (
    <HeartOutlined />
  ) : (
    <SearchOutlined />
  )

  return (
    <div className="p-6">
      <div className="sticky top-0 z-10 bg-[var(--content-bg)] pb-4 -mt-6 pt-6 -mx-6 px-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
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

        {/* Tag filter */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {tagOptions.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              aria-pressed={activeTag === tag}
              className={activeTag === tag ? 'tag-chip is-active' : (TAG_CLS[tag] ?? 'tag-chip')}
            >
              {t(tag)}
            </button>
          ))}
        </div>
      </div>

      {showEmpty ? (
        <EmptyState className="!py-16" icon={emptyIcon} title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredTools.map((tool, index) => {
            const s = stats[tool.id]
            return (
              <div
                key={tool.id}
                className="tool-card tool-card-enter group relative"
                style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={t(tool.nameKey)}
                  onClick={() => handleCardClick(tool.id, tool.route)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleCardClick(tool.id, tool.route)
                    }
                  }}
                  className="flex flex-col h-full"
                >
                  <div className="flex items-center gap-2.5 mb-3 pr-8">
                    <span className="flex items-center justify-center w-8 h-8 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] text-base shrink-0">
                      {tool.icon}
                    </span>
                    <span className="flex-1 min-w-0 font-semibold text-[15px] leading-snug text-[var(--text-primary)] truncate">
                      {t(tool.nameKey)}
                    </span>
                  </div>

                  <p className="text-sm leading-relaxed text-[var(--text-secondary)] mb-3 line-clamp-2">
                    {t(tool.descKey)}
                  </p>

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {tool.tags.map((tag) => (
                      <span key={tag} className={TAG_CLS[tag] ?? 'tag-chip'}>
                        {t(tag)}
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

                <button
                  type="button"
                  onClick={() => toggleFavorite(tool.id)}
                  aria-label={s?.favorited ? t('unfavoriteTool') : t('favoriteTool')}
                  title={s?.favorited ? t('unfavoriteTool') : t('favoriteTool')}
                  aria-pressed={s?.favorited ?? false}
                  className="absolute top-3 right-3 flex items-center justify-center w-6 h-6 rounded-md cursor-pointer border-none
                    transition-colors duration-150 ${
                      s?.favorited
                        ? 'text-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--hover-bg)]'
                    }"
                >
                  {s?.favorited ? <HeartFilled /> : <HeartOutlined />}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default DevTools
