import { app } from 'electron'
import { promises as fsp } from 'fs'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface StickyTag {
  id: string
  name: string
  color: string
}

export interface StickyNote {
  id: string
  tagId: string | null
  content: string
  createdAt: number
  updatedAt: number
}

export interface StickyData {
  tags: StickyTag[]
  notes: StickyNote[]
}

interface StoreFile {
  version: 1
  tags: StickyTag[]
  notes: StickyNote[]
}

function isTag(v: unknown): v is StickyTag {
  if (!v || typeof v !== 'object') return false
  const t = v as StickyTag
  return typeof t.id === 'string' && typeof t.name === 'string' && typeof t.color === 'string'
}

function isNote(v: unknown): v is StickyNote {
  if (!v || typeof v !== 'object') return false
  const n = v as StickyNote
  return (
    typeof n.id === 'string' &&
    (n.tagId === null || typeof n.tagId === 'string') &&
    typeof n.content === 'string' &&
    typeof n.createdAt === 'number' &&
    typeof n.updatedAt === 'number'
  )
}

export interface StickyStore {
  init: () => Promise<void>
  load: () => StickyData
  save: (data: StickyData) => StickyData
}

export function createStickyStore(): StickyStore {
  const file = join(app.getPath('userData'), 'sticky-notes.json')
  let tags: StickyTag[] = []
  let notes: StickyNote[] = []

  async function readFile(): Promise<void> {
    try {
      const raw = await fsp.readFile(file, 'utf-8')
      const data = JSON.parse(raw) as StoreFile
      tags = Array.isArray(data?.tags) ? data.tags.filter(isTag) : []
      notes = Array.isArray(data?.notes) ? data.notes.filter(isNote) : []
    } catch {
      tags = []
      notes = []
    }
  }

  function persist(): void {
    const payload: StoreFile = { version: 1, tags, notes }
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8')
    } catch {
      // best-effort
    }
  }

  return {
    async init(): Promise<void> {
      await readFile()
    },
    load(): StickyData {
      return { tags: [...tags], notes: [...notes] }
    },
    save(data: StickyData): StickyData {
      tags = Array.isArray(data?.tags) ? data.tags.filter(isTag) : []
      notes = Array.isArray(data?.notes) ? data.notes.filter(isNote) : []
      persist()
      return { tags: [...tags], notes: [...notes] }
    }
  }
}
