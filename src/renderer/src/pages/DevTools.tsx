import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Typography, Input, Row, Col, Card, Tag, Space } from 'antd'
import { HeartOutlined, HeartFilled } from '@ant-design/icons'
import { devTools, useDevToolStats } from '../data/devTools'

const TABS = ['all', 'favorites', 'recent', 'most-used'] as const
const TAB_LABELS: Record<string, string> = {
  all: 'devToolTabAll',
  favorites: 'devToolTabFavorites',
  recent: 'devToolTabRecent',
  'most-used': 'devToolTabMostUsed',
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
      list = list.filter(tool =>
        t(tool.nameKey).toLowerCase().includes(lower) ||
        t(tool.descKey).toLowerCase().includes(lower),
      )
    }

    switch (activeTab) {
      case 'favorites':
        list = list.filter(tool => stats[tool.id]?.favorited)
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
    navigate(route)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg w-fit">
          {TABS.map(key => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`
                px-4 py-1 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer
                ${activeTab === key
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
          onChange={e => setSearchText(e.target.value)}
          onSearch={setSearchText}
          style={{ width: 320 }}
          allowClear
        />
      </div>

      <Row gutter={[16, 16]}>
        {filteredTools.map(tool => {
          const s = stats[tool.id]
          return (
            <Col key={tool.id} xs={24} sm={12} lg={8} xl={6}>
              <Card
                hoverable
                className="h-full"
                onClick={() => handleCardClick(tool.id, tool.route)}
              >
                <div className="flex flex-col h-full">
                  <div className="flex items-start justify-between mb-2">
                    <Typography.Title level={4} className="!mb-0">
                      {t(tool.nameKey)}
                    </Typography.Title>
                    <span
                      onClick={e => { e.stopPropagation(); toggleFavorite(tool.id) }}
                      className="cursor-pointer text-lg shrink-0 ml-2"
                    >
                      {s?.favorited
                        ? <HeartFilled className="text-red-500" />
                        : <HeartOutlined />}
                    </span>
                  </div>

                  <Typography.Paragraph
                    className="!mb-3"
                    ellipsis={{ rows: 2 }}
                    style={{ minHeight: 44 }}
                  >
                    {t(tool.descKey)}
                  </Typography.Paragraph>

                  <div className="mb-3">
                    <Space size={4} wrap>
                      {tool.tags.map(tag => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </Space>
                  </div>

                  <div className="mt-auto text-xs text-gray-400 flex gap-3">
                    {s?.lastUsedAt && (
                      <span>{t('lastUsed')}: {new Date(s.lastUsedAt).toLocaleDateString()}</span>
                    )}
                    <span>{t('useCount')}: {s?.useCount ?? 0}</span>
                  </div>
                </div>
              </Card>
            </Col>
          )
        })}
      </Row>
    </div>
  )
}

export default DevTools
