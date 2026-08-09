import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PlusOutlined,
  DeleteOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  HolderOutlined,
  EditOutlined,
  FolderOutlined,
  InboxOutlined
} from '@ant-design/icons'
import { DatePicker, Tooltip, Empty, Modal, Input, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { SortableList } from '../components/SortableList'

type Filter = 'all' | 'active' | 'done'

type GroupFilter = 'all' | 'none' | string

const PRIORITY_META: Record<string, { labelKey: string; cls: string }> = {
  none: { labelKey: 'todoPriorityNone', cls: 'text-[var(--text-secondary)]' },
  low: { labelKey: 'todoPriorityLow', cls: 'text-[#3b82f6]' },
  medium: { labelKey: 'todoPriorityMedium', cls: 'text-[#d97706]' },
  high: { labelKey: 'todoPriorityHigh', cls: 'text-[#dc2626]' }
}

const GROUP_COLORS = [
  '#f7d794',
  '#82ccdd',
  '#b8e994',
  '#f8a5c2',
  '#d1b3e0',
  '#f3b37a',
  '#a8c8c8',
  '#e8c4a8'
]

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// Cached "now" refreshed by a timer, so overdue computation stays pure during render.
let nowCache = Date.now()

const ACTION_BTN_CLS =
  'flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-secondary)] ' +
  'hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition-all duration-100 cursor-pointer border-none bg-transparent'

function formatDue(dueDate: number): string {
  const d = dayjs(dueDate)
  return d.format('YYYY-MM-DD')
}

function TodoList(): React.JSX.Element {
  const { t } = useTranslation()
  const [items, setItems] = useState<TodoItem[]>([])
  const [groups, setGroups] = useState<TodoGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [newText, setNewText] = useState('')
  const [newPriority, setNewPriority] = useState<TodoPriority>('none')
  const [newDue, setNewDue] = useState<Dayjs | null>(null)
  const [newGroupId, setNewGroupId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [now, setNow] = useState(nowCache)

  // ── Group modal ──
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<TodoGroup | null>(null)
  const [groupNameInput, setGroupNameInput] = useState('')
  const [groupColorInput, setGroupColorInput] = useState(GROUP_COLORS[0])

  useEffect(() => {
    const id = window.setInterval(() => {
      nowCache = Date.now()
      setNow(nowCache)
    }, 60000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let alive = true
    void window.api.todo.load().then((data) => {
      if (alive) {
        setItems(data.items)
        setGroups(data.groups)
        setLoaded(true)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const persist = useCallback(
    (nextItems: TodoItem[], nextGroups?: TodoGroup[]): void => {
      setItems(nextItems)
      if (nextGroups) setGroups(nextGroups)
      void window.api.todo.save({ groups: nextGroups ?? groups, items: nextItems })
    },
    [groups]
  )

  const addItem = useCallback(() => {
    const text = newText.trim()
    if (!text) return
    const now = Date.now()
    const item: TodoItem = {
      id: genId(),
      text,
      done: false,
      priority: newPriority,
      dueDate: newDue ? newDue.valueOf() : null,
      groupId: groupFilter === 'none' ? null : groupFilter === 'all' ? newGroupId : groupFilter,
      createdAt: now,
      updatedAt: now
    }
    persist([item, ...items])
    setNewText('')
    setNewPriority('none')
    setNewDue(null)
    setNewGroupId(null)
  }, [newText, newPriority, newDue, newGroupId, groupFilter, items, persist])

  const updateItem = useCallback(
    (id: string, patch: Partial<TodoItem>): void => {
      persist(items.map((it) => (it.id === id ? { ...it, ...patch, updatedAt: Date.now() } : it)))
    },
    [items, persist]
  )

  const deleteItem = useCallback(
    (id: string): void => {
      persist(items.filter((it) => it.id !== id))
    },
    [items, persist]
  )

  const clearDone = useCallback((): void => {
    persist(items.filter((it) => !it.done))
  }, [items, persist])

  const handleReorder = useCallback(
    (next: TodoItem[]): void => {
      persist(next)
    },
    [persist]
  )

  const startEdit = useCallback(
    (id: string): void => {
      const item = items.find((it) => it.id === id)
      if (!item) return
      setEditingId(id)
      setEditText(item.text)
    },
    [items]
  )

  const commitEdit = useCallback((): void => {
    const text = editText.trim()
    if (editingId) {
      if (text) updateItem(editingId, { text })
      else deleteItem(editingId)
    }
    setEditingId(null)
    setEditText('')
  }, [editingId, editText, updateItem, deleteItem])

  // ── Group CRUD ──

  const openGroupModal = useCallback((group?: TodoGroup): void => {
    setEditingGroup(group ?? null)
    setGroupNameInput(group?.name ?? '')
    setGroupColorInput(group?.color ?? GROUP_COLORS[0])
    setGroupModalOpen(true)
  }, [])

  const closeGroupModal = useCallback((): void => {
    setGroupModalOpen(false)
    setEditingGroup(null)
    setGroupNameInput('')
    setGroupColorInput(GROUP_COLORS[0])
  }, [])

  const saveGroup = useCallback((): void => {
    const name = groupNameInput.trim()
    if (!name) {
      closeGroupModal()
      return
    }
    if (editingGroup) {
      const nextGroups = groups.map((g) =>
        g.id === editingGroup.id ? { ...g, name, color: groupColorInput } : g
      )
      persist(items, nextGroups)
    } else {
      const newGroup: TodoGroup = { id: genId(), name, color: groupColorInput }
      persist(items, [...groups, newGroup])
    }
    closeGroupModal()
  }, [groupNameInput, groupColorInput, editingGroup, groups, items, persist, closeGroupModal])

  const deleteGroup = useCallback(
    (group: TodoGroup): void => {
      const nextGroups = groups.filter((g) => g.id !== group.id)
      const nextItems = items.map((it) => (it.groupId === group.id ? { ...it, groupId: null } : it))
      persist(nextItems, nextGroups)
      if (groupFilter === group.id) setGroupFilter('all')
    },
    [groups, items, groupFilter, persist]
  )

  // ── Derived ──

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])

  const filtered = useMemo(() => {
    let list = [...items]
    if (groupFilter === 'none') list = list.filter((it) => it.groupId == null)
    else if (groupFilter !== 'all') list = list.filter((it) => it.groupId === groupFilter)
    if (filter === 'active') list = list.filter((it) => !it.done)
    else if (filter === 'done') list = list.filter((it) => it.done)
    return list
  }, [items, filter, groupFilter])

  const remaining = items.filter((it) => !it.done).length
  const total = items.length

  const groupSelectOptions = [
    { value: 'none', label: t('todoGroupNone') },
    ...groups.map((g) => ({ value: g.id, label: g.name }))
  ]

  const priorityBtnCls = (active: boolean): string => `
    px-2 py-1 rounded-md text-xs font-medium cursor-pointer transition-all duration-100 border
    ${
      active
        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
        : 'bg-transparent text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]'
    }`

  const filterTabCls = (active: boolean): string => `
    px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer
    ${
      active
        ? 'bg-[var(--accent)] text-white'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
    }`

  const groupItemCls = (active: boolean): string => `
    group relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] cursor-pointer
    transition-colors duration-150
    ${
      active
        ? 'bg-[var(--accent)] text-white'
        : 'text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
    }`

  return (
    <div className="flex flex-col p-6 flex-1 min-h-0">
      <div className="flex-1 min-h-0 flex gap-4">
        {/* ── Group sidebar ── */}
        <div className="w-[172px] shrink-0 flex flex-col border-r border-[var(--border-subtle)] pr-3">
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable space-y-0.5 pb-2">
            <div
              className={groupItemCls(groupFilter === 'all')}
              onClick={() => setGroupFilter('all')}
            >
              <InboxOutlined style={{ fontSize: 13 }} />
              <span className="flex-1 truncate">{t('todoGroupAll')}</span>
            </div>
            <div
              className={groupItemCls(groupFilter === 'none')}
              onClick={() => setGroupFilter('none')}
            >
              <FolderOutlined style={{ fontSize: 13 }} />
              <span className="flex-1 truncate">{t('todoGroupNone')}</span>
            </div>
            <div className="mx-2 my-2 border-t border-[var(--border-subtle)]" />
            {groups.map((group) => {
              const count = items.filter((it) => it.groupId === group.id && !it.done).length
              const active = groupFilter === group.id
              return (
                <div
                  key={group.id}
                  className={groupItemCls(active)}
                  onClick={() => setGroupFilter(group.id)}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: group.color }}
                  />
                  <span className="flex-1 truncate">{group.name}</span>
                  {count > 0 && (
                    <span className="text-[10px] tabular-nums opacity-60">{count}</span>
                  )}
                  {!active && (
                    <span className="shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openGroupModal(group)
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded text-[11px] opacity-60 hover:opacity-100 hover:bg-white/20"
                      >
                        <EditOutlined />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          Modal.confirm({
                            title: t('todoGroupDelete'),
                            content: t('todoGroupDeleteConfirm'),
                            okButtonProps: { danger: true },
                            onOk: () => deleteGroup(group)
                          })
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded text-[11px] opacity-60 hover:opacity-100 hover:bg-white/20"
                      >
                        <DeleteOutlined />
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="shrink-0 border-t border-[var(--border-subtle)] pt-2">
            <button
              onClick={() => openGroupModal()}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                cursor-pointer border-none bg-[var(--bg-warm)] text-[var(--text-primary)]
                border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)] transition-all duration-150"
            >
              <PlusOutlined />
              {t('todoGroupNew')}
            </button>
          </div>
        </div>

        {/* ── Main ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="sticky top-0 z-10 bg-[var(--content-bg)] pb-3 space-y-3">
            {/* Add form */}
            <div className="flex items-center gap-2">
              <input
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                placeholder={t('todoPlaceholder')}
                spellCheck={false}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-[var(--border-subtle)]
                  bg-white dark:bg-[var(--surface)] text-[var(--text-primary)]
                  text-sm outline-none focus:border-[var(--accent)] transition-colors duration-150"
              />
              <DatePicker
                value={newDue}
                onChange={setNewDue}
                placeholder={t('todoDueDate')}
                className="w-36"
                size="middle"
              />
              <Select
                value={
                  groupFilter === 'none'
                    ? 'none'
                    : groupFilter === 'all'
                      ? (newGroupId ?? 'none')
                      : groupFilter
                }
                onChange={(v) => setNewGroupId(v === 'none' ? null : v)}
                options={groupSelectOptions}
                style={{ width: 130 }}
                size="middle"
                className="text-xs"
                placeholder={t('todoGroupNone')}
              />
              <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg">
                {(['none', 'low', 'medium', 'high'] as TodoPriority[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setNewPriority(p)}
                    className={priorityBtnCls(newPriority === p)}
                    title={t(PRIORITY_META[p].labelKey)}
                  >
                    {t(PRIORITY_META[p].labelKey)}
                  </button>
                ))}
              </div>
              <button
                onClick={addItem}
                className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5
                  transition-all duration-150 cursor-pointer border-none bg-[var(--accent)] text-white
                  hover:brightness-110 active:brightness-90"
              >
                <PlusOutlined />
                {t('todoAdd')}
              </button>
            </div>

            {/* Filter tabs */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg">
                {(['all', 'active', 'done'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={filterTabCls(filter === f)}
                  >
                    {t(`todoFilter${f[0].toUpperCase()}${f.slice(1)}`)}
                  </button>
                ))}
              </div>
              <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                {t('todoRemaining', { remaining, total })}
              </span>
              <button
                onClick={clearDone}
                disabled={remaining === total}
                className="ml-auto text-xs font-semibold flex items-center gap-1 cursor-pointer border-none bg-transparent
                  text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors duration-100
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <DeleteOutlined style={{ fontSize: 11 }} />
                {t('todoClearDone')}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable">
            {loaded && filtered.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('todoEmpty')}
                  className="opacity-70"
                />
              </div>
            ) : (
              <SortableList items={filtered} onReorder={handleReorder} className="space-y-1.5">
                {(item, api) => {
                  const isEditing = editingId === item.id
                  const isOverdue = item.dueDate != null && !item.done && item.dueDate < now
                  const pMeta = PRIORITY_META[item.priority]
                  const group = item.groupId ? groupById.get(item.groupId) : null
                  return (
                    <div
                      ref={api.setNodeRef}
                      style={api.style}
                      className="group flex items-center gap-2 rounded-lg border border-[var(--border-subtle)]
                        bg-white dark:bg-[var(--surface)] px-3 py-2.5"
                    >
                      {/* Drag handle */}
                      <button
                        ref={api.setActivatorNodeRef}
                        {...api.attributes}
                        {...api.listeners}
                        className="shrink-0 cursor-grab text-[var(--text-secondary)] opacity-40 hover:opacity-80 transition-opacity duration-100 bg-transparent border-none p-1 active:cursor-grabbing"
                        title={t('todoDrag')}
                      >
                        <HolderOutlined style={{ fontSize: 13 }} />
                      </button>

                      {/* Checkbox */}
                      <button
                        onClick={() => updateItem(item.id, { done: !item.done })}
                        className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-all duration-100 cursor-pointer
                          ${
                            item.done
                              ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                              : 'border-[var(--border-subtle)] text-transparent hover:border-[var(--text-secondary)]'
                          }`}
                        title={item.done ? t('todoMarkActive') : t('todoMarkDone')}
                      >
                        <CheckOutlined style={{ fontSize: 10 }} />
                      </button>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              else if (e.key === 'Escape') {
                                setEditText(item.text)
                                setEditingId(null)
                              }
                            }}
                            spellCheck={false}
                            className="w-full px-1.5 py-0.5 rounded-md border border-[var(--accent)] bg-transparent
                              text-sm text-[var(--text-primary)] outline-none"
                          />
                        ) : (
                          <span
                            onClick={() => startEdit(item.id)}
                            className={`text-sm block break-words select-none cursor-text transition-colors duration-100 ${
                              item.done
                                ? 'text-[var(--text-secondary)] line-through'
                                : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {item.text}
                          </span>
                        )}
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className={`text-[10px] font-medium ${pMeta.cls}`}>
                            {t(pMeta.labelKey)}
                          </span>
                          {group && (
                            <span className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ background: group.color }}
                              />
                              {group.name}
                            </span>
                          )}
                          {item.dueDate != null && (
                            <span
                              className={`flex items-center gap-0.5 text-[10px] tabular-nums ${
                                isOverdue
                                  ? 'text-[#dc2626] dark:text-[#f87171]'
                                  : 'text-[var(--text-secondary)]'
                              }`}
                            >
                              <ClockCircleOutlined style={{ fontSize: 9 }} />
                              {formatDue(item.dueDate)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Move to group */}
                      <Tooltip title={t('todoGroupMove')}>
                        <Select
                          size="small"
                          value={item.groupId ?? 'none'}
                          onChange={(v) =>
                            updateItem(item.id, { groupId: v === 'none' ? null : v })
                          }
                          options={groupSelectOptions}
                          className="w-[110px] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-100"
                          variant="borderless"
                          popupMatchSelectWidth={false}
                        />
                      </Tooltip>

                      {/* Delete */}
                      <Tooltip title={t('todoDelete')}>
                        <button
                          onClick={() => deleteItem(item.id)}
                          className={`${ACTION_BTN_CLS} opacity-0 group-hover:opacity-100 transition-opacity duration-100`}
                        >
                          <DeleteOutlined style={{ fontSize: 13 }} />
                        </button>
                      </Tooltip>
                    </div>
                  )
                }}
              </SortableList>
            )}
          </div>
        </div>
      </div>

      {/* Group modal */}
      <Modal
        title={editingGroup ? t('todoGroupEdit') : t('todoGroupNew')}
        open={groupModalOpen}
        onOk={saveGroup}
        onCancel={closeGroupModal}
        okText={t('todoSave')}
        cancelText={t('todoCancel')}
        width={420}
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('todoGroupName')}
            </label>
            <Input
              value={groupNameInput}
              onChange={(e) => setGroupNameInput(e.target.value)}
              placeholder={t('todoGroupNamePlaceholder')}
              onPressEnter={saveGroup}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('todoGroupColor')}
            </label>
            <div className="flex flex-wrap gap-2">
              {GROUP_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setGroupColorInput(color)}
                  className={`w-7 h-7 rounded-lg cursor-pointer transition-all duration-100 border-2 ${
                    groupColorInput === color
                      ? 'border-[var(--accent)] scale-110'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ background: color }}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default TodoList
