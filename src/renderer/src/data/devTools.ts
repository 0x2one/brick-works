import { useState, useCallback } from 'react'

export interface DevToolItem {
  id: string
  nameKey: string
  descKey: string
  tags: string[]
  route: string
  fill?: boolean
}

export const devTools: DevToolItem[] = [
  {
    id: 'random-password',
    nameKey: 'devToolRandomPassword',
    descKey: 'devToolRandomPasswordDesc',
    tags: ['devTagTool', 'devTagSecurity'],
    route: '/dev-tools/random-password'
  },
  {
    id: 'image-to-base64',
    nameKey: 'devToolImageToBase64',
    descKey: 'devToolImageToBase64Desc',
    tags: ['devTagTool', 'devTagImage'],
    route: '/dev-tools/image-to-base64'
  },
  {
    id: 'json-beautify',
    nameKey: 'devToolJsonBeautify',
    descKey: 'devToolJsonBeautifyDesc',
    tags: ['devTagTool', 'devTagJson'],
    route: '/dev-tools/json-beautify',
    fill: true
  },
  {
    id: 'codec-converter',
    nameKey: 'devToolCodec',
    descKey: 'devToolCodecDesc',
    tags: ['devTagTool', 'devTagCodec'],
    route: '/dev-tools/codec-converter',
    fill: true
  },
  {
    id: 'timestamp-converter',
    nameKey: 'devToolTimestamp',
    descKey: 'devToolTimestampDesc',
    tags: ['devTagTool', 'devTagTime'],
    route: '/dev-tools/timestamp-converter',
    fill: true
  },
  {
    id: 'uuid-generator',
    nameKey: 'devToolUuidGen',
    descKey: 'devToolUuidGenDesc',
    tags: ['devTagTool', 'devTagGenerate'],
    route: '/dev-tools/uuid-generator',
    fill: true
  },
  {
    id: 'qr-code',
    nameKey: 'devToolQrCode',
    descKey: 'devToolQrCodeDesc',
    tags: ['devTagTool', 'devTagImage'],
    route: '/dev-tools/qr-code',
    fill: true
  },
  {
    id: 'svg-to-image',
    nameKey: 'devToolSvgToImg',
    descKey: 'devToolSvgToImgDesc',
    tags: ['devTagTool', 'devTagImage'],
    route: '/dev-tools/svg-to-image',
    fill: true
  },
  {
    id: 'pdf-image-annotate',
    nameKey: 'devToolPdfImageAnnotate',
    descKey: 'devToolPdfImageAnnotateDesc',
    tags: ['devTagTool', 'devTagDoc', 'devTagImage'],
    route: '/dev-tools/pdf-image-annotate',
    fill: true
  },
  {
    id: 'pdf-preview',
    nameKey: 'devToolPdfPreview',
    descKey: 'devToolPdfPreviewDesc',
    tags: ['devTagTool', 'devTagDoc'],
    route: '/dev-tools/pdf-preview',
    fill: true
  },
  {
    id: 'pdf-merge-split',
    nameKey: 'devToolPdfMergeSplit',
    descKey: 'devToolPdfMergeSplitDesc',
    tags: ['devTagTool', 'devTagDoc'],
    route: '/dev-tools/pdf-merge-split'
  },
  {
    id: 'text-diff',
    nameKey: 'devToolTextDiff',
    descKey: 'devToolTextDiffDesc',
    tags: ['devTagTool', 'devTagText'],
    route: '/dev-tools/text-diff',
    fill: true
  },
  {
    id: 'color-converter',
    nameKey: 'devToolColorConverter',
    descKey: 'devToolColorConverterDesc',
    tags: ['devTagTool', 'devTagColor'],
    route: '/dev-tools/color-converter',
    fill: true
  },
  {
    id: 'regex-tester',
    nameKey: 'devToolRegexTester',
    descKey: 'devToolRegexTesterDesc',
    tags: ['devTagTool', 'devTagText'],
    route: '/dev-tools/regex-tester',
    fill: true
  }
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

function saveStats(stats: Record<string, DevToolStats>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
}

export function useDevToolStats(): {
  stats: Record<string, DevToolStats>
  toggleFavorite: (id: string) => void
  recordUse: (id: string) => void
} {
  const [stats, setStats] = useState<Record<string, DevToolStats>>(loadStats)

  const toggleFavorite = useCallback((id: string) => {
    setStats((prev) => {
      const next = {
        ...prev,
        [id]: {
          ...(prev[id] ?? { favorited: false, lastUsedAt: null, useCount: 0 }),
          favorited: !(prev[id]?.favorited ?? false)
        }
      }
      saveStats(next)
      return next
    })
  }, [])

  const recordUse = useCallback((id: string) => {
    setStats((prev) => {
      const next = {
        ...prev,
        [id]: {
          ...(prev[id] ?? { favorited: false, lastUsedAt: null, useCount: 0 }),
          lastUsedAt: Date.now(),
          useCount: (prev[id]?.useCount ?? 0) + 1
        }
      }
      saveStats(next)
      return next
    })
  }, [])

  return { stats, toggleFavorite, recordUse }
}
