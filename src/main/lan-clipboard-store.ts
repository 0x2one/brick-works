import { app } from 'electron'
import { randomBytes } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { promises as fsp } from 'fs'
import { join } from 'path'

export const MAX_CLIP_SLOTS = 20
export const MAX_CLIP_TEXT_BYTES = 256 * 1024
export const CLIP_ID_RE = /^[a-f0-9]{16}$/
export const MAX_CLIP_LABEL_CHARS = 64

export interface LanClipSlot {
  id: string
  label: string
  text: string
  updatedAt: number
}

export interface LanClipsState {
  revision: number
  slots: LanClipSlot[]
}

interface StoreFile {
  version: 1
  revision: number
  slots: LanClipSlot[]
}

export class LanClipError extends Error {
  code: string
  status: number

  constructor(code: string, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

function coerceSlot(v: unknown): LanClipSlot | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  if (typeof s.id !== 'string' || !CLIP_ID_RE.test(s.id)) return null
  if (typeof s.label !== 'string') return null
  const updatedAt = typeof s.updatedAt === 'number' ? s.updatedAt : Date.now()
  const text = s.kind === 'image' ? '' : typeof s.text === 'string' ? s.text : ''
  return { id: s.id, label: s.label, text, updatedAt }
}

function publicSlot(s: LanClipSlot): LanClipSlot {
  return { id: s.id, label: s.label, text: s.text ?? '', updatedAt: s.updatedAt }
}

export interface LanClipboardStore {
  init: () => Promise<void>
  list: () => LanClipsState
  create: (label?: string) => LanClipSlot
  update: (id: string, patch: { label?: string; text?: string }) => LanClipSlot
  delete: (id: string) => boolean
  onChange: (cb: (state: LanClipsState) => void) => () => void
}

export function createLanClipboardStore(): LanClipboardStore {
  const metaFile = join(app.getPath('userData'), 'lan-clipboards.json')
  const imgDir = join(app.getPath('userData'), 'lan-clipboards')
  let revision = 0
  let slots: LanClipSlot[] = []
  const listeners = new Set<(state: LanClipsState) => void>()

  function snapshot(): LanClipsState {
    return { revision, slots: slots.map(publicSlot) }
  }

  function persist(): void {
    const payload: StoreFile = { version: 1, revision, slots }
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(metaFile, JSON.stringify(payload), 'utf-8')
    } catch {
      // best-effort
    }
  }

  function notify(): void {
    const state = snapshot()
    for (const cb of listeners) {
      try {
        cb(state)
      } catch {
        // listener errors must not break the store
      }
    }
  }

  function bump(): void {
    revision += 1
    persist()
    notify()
  }

  function findIndex(id: string): number {
    if (!CLIP_ID_RE.test(id)) throw new LanClipError('NOT_FOUND', 404)
    const i = slots.findIndex((s) => s.id === id)
    if (i < 0) throw new LanClipError('NOT_FOUND', 404)
    return i
  }

  function sanitizeLabel(label: string | undefined): string {
    return (label ?? '').trim().slice(0, MAX_CLIP_LABEL_CHARS)
  }

  async function readFile(): Promise<void> {
    try {
      const raw = await fsp.readFile(metaFile, 'utf-8')
      const data = JSON.parse(raw) as StoreFile
      revision = typeof data?.revision === 'number' && data.revision >= 0 ? data.revision : 0
      slots = Array.isArray(data?.slots)
        ? data.slots
            .map(coerceSlot)
            .filter((s): s is LanClipSlot => s !== null)
            .slice(0, MAX_CLIP_SLOTS)
        : []
    } catch {
      revision = 0
      slots = []
    }
  }

  return {
    async init(): Promise<void> {
      await readFile()
      persist()
      await fsp.rm(imgDir, { recursive: true, force: true }).catch(() => {})
    },

    list(): LanClipsState {
      return snapshot()
    },

    create(label?: string): LanClipSlot {
      if (slots.length >= MAX_CLIP_SLOTS) throw new LanClipError('CLIP_LIMIT')
      const slot: LanClipSlot = {
        id: randomBytes(8).toString('hex'),
        label: sanitizeLabel(label),
        text: '',
        updatedAt: Date.now()
      }
      slots = [...slots, slot]
      bump()
      return publicSlot(slot)
    },

    update(id: string, patch: { label?: string; text?: string }): LanClipSlot {
      const i = findIndex(id)
      const prev = slots[i]
      const next: LanClipSlot = { ...prev }
      let changed = false
      if (patch.label !== undefined) {
        const label = sanitizeLabel(patch.label)
        if (label !== next.label) {
          next.label = label
          changed = true
        }
      }
      if (patch.text !== undefined) {
        if (typeof patch.text !== 'string') throw new LanClipError('INVALID_NAME')
        const bytes = Buffer.byteLength(patch.text, 'utf8')
        if (bytes > MAX_CLIP_TEXT_BYTES) throw new LanClipError('TOO_LARGE', 413)
        if (patch.text !== next.text) {
          next.text = patch.text
          changed = true
        }
      }
      if (!changed) return publicSlot(prev)
      next.updatedAt = Date.now()
      slots = slots.map((s, idx) => (idx === i ? next : s))
      bump()
      return publicSlot(next)
    },

    delete(id: string): boolean {
      findIndex(id)
      slots = slots.filter((s) => s.id !== id)
      bump()
      return true
    },

    onChange(cb: (state: LanClipsState) => void): () => void {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    }
  }
}
