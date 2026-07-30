import { useState, useCallback } from 'react'

export interface DevToolItem {
  id: string
  nameKey: string
  descKey: string
  tags: string[]
  route: string
}

export const devTools: DevToolItem[] = [
  {
    id: 'random-password',
    nameKey: 'devToolRandomPassword',
    descKey: 'devToolRandomPasswordDesc',
    tags: ['工具', '安全'],
    route: '/dev-tools/random-password',
  },
  {
    id: 'image-to-base64',
    nameKey: 'devToolImageToBase64',
    descKey: 'devToolImageToBase64Desc',
    tags: ['工具', '图片'],
    route: '/dev-tools/image-to-base64',
  },
  {
    id: 'json-beautify',
    nameKey: 'devToolJsonBeautify',
    descKey: 'devToolJsonBeautifyDesc',
    tags: ['工具', 'JSON'],
    route: '/dev-tools/json-beautify',
  },
]

export interface DevToolStats {
  favorited: boolean
  lastUsedAt: number | null
  useCount: number
}

const STORAGE_KEY = 'dev-tools-stats'

function loadStats(): Record<string, DevToolStats> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStats(stats: Record<string, DevToolStats>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
}

export function useDevToolStats() {
  const [stats, setStats] = useState<Record<string, DevToolStats>>(loadStats)

  const toggleFavorite = useCallback((id: string) => {
    setStats(prev => {
      const next = {
        ...prev,
        [id]: {
          ...prev[id] ?? { favorited: false, lastUsedAt: null, useCount: 0 },
          favorited: !(prev[id]?.favorited ?? false),
        },
      }
      saveStats(next)
      return next
    })
  }, [])

  const recordUse = useCallback((id: string) => {
    setStats(prev => {
      const next = {
        ...prev,
        [id]: {
          ...prev[id] ?? { favorited: false, lastUsedAt: null, useCount: 0 },
          lastUsedAt: Date.now(),
          useCount: (prev[id]?.useCount ?? 0) + 1,
        },
      }
      saveStats(next)
      return next
    })
  }, [])

  return { stats, toggleFavorite, recordUse }
}
