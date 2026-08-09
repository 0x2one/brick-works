import { app } from 'electron'
import { promises as fsp } from 'fs'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export type TodoPriority = 'none' | 'low' | 'medium' | 'high'

export interface TodoGroup {
  id: string
  name: string
  color: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
  priority: TodoPriority
  dueDate: number | null
  groupId: string | null
  createdAt: number
  updatedAt: number
}

export interface TodoData {
  groups: TodoGroup[]
  items: TodoItem[]
}

interface StoreFile {
  version: 2
  groups: TodoGroup[]
  items: TodoItem[]
}

function isGroup(v: unknown): v is TodoGroup {
  if (!v || typeof v !== 'object') return false
  const g = v as TodoGroup
  return typeof g.id === 'string' && typeof g.name === 'string' && typeof g.color === 'string'
}

function isTodoItem(v: unknown): v is TodoItem {
  if (!v || typeof v !== 'object') return false
  const t = v as TodoItem
  return (
    typeof t.id === 'string' &&
    typeof t.text === 'string' &&
    typeof t.done === 'boolean' &&
    (t.priority === 'none' ||
      t.priority === 'low' ||
      t.priority === 'medium' ||
      t.priority === 'high') &&
    (t.dueDate === null || typeof t.dueDate === 'number') &&
    (t.groupId === null || typeof t.groupId === 'string') &&
    typeof t.createdAt === 'number' &&
    typeof t.updatedAt === 'number'
  )
}

export interface TodoStore {
  init: () => Promise<void>
  load: () => TodoData
  save: (data: TodoData) => TodoData
}

export function createTodoStore(): TodoStore {
  const file = join(app.getPath('userData'), 'todo-list.json')
  let groups: TodoGroup[] = []
  let items: TodoItem[] = []

  async function readFile(): Promise<void> {
    try {
      const raw = await fsp.readFile(file, 'utf-8')
      const data = JSON.parse(raw) as StoreFile
      groups = Array.isArray(data?.groups) ? data.groups.filter(isGroup) : []
      items = Array.isArray(data?.items) ? data.items.filter(isTodoItem) : []
    } catch {
      groups = []
      items = []
    }
  }

  function persist(): void {
    const payload: StoreFile = { version: 2, groups, items }
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
    load(): TodoData {
      return { groups: groups.map((g) => ({ ...g })), items: items.map((t) => ({ ...t })) }
    },
    save(data: TodoData): TodoData {
      groups = Array.isArray(data?.groups) ? data.groups.filter(isGroup).map((g) => ({ ...g })) : []
      items = Array.isArray(data?.items) ? data.items.filter(isTodoItem).map((t) => ({ ...t })) : []
      persist()
      return this.load()
    }
  }
}
