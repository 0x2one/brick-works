import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  FormOutlined,
  CheckOutlined
} from '@ant-design/icons'
import { Modal, Input, Tooltip, message } from 'antd'

interface Tag {
  id: string
  name: string
  color: string
}

interface Note {
  id: string
  tagId: string | null
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

const TAG_COLORS = [
  '#f7d794',
  '#82ccdd',
  '#b8e994',
  '#f8a5c2',
  '#d1b3e0',
  '#f3b37a',
  '#a8c8c8',
  '#e8c4a8'
]

const LS_TAGS = 'brickworks:stickyTags'
const LS_NOTES = 'brickworks:stickyNotes'

function loadFromLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveToLS<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data))
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function TagSidebar({
  tags,
  selectedTagId,
  onSelectTag,
  onAddTag,
  onEditTag,
  onDeleteTag
}: {
  tags: Tag[]
  selectedTagId: string | null
  onSelectTag: (id: string | null) => void
  onAddTag: () => void
  onEditTag: (tag: Tag) => void
  onDeleteTag: (tag: Tag) => void
}) {
  const { t } = useTranslation()
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  return (
    <div
      className="flex h-full flex-col border-r border-[var(--border-subtle)]"
      style={{ width: 164 }}
    >
      <div className="flex-1 overflow-y-auto px-2 pt-3">
        <div
          className={`sticky-tag-item ${selectedTagId === null ? 'active' : ''}`}
          onClick={() => onSelectTag(null)}
        >
          <span className="text-xs font-medium">{t('memoStickyAll')}</span>
        </div>
        <div className="mx-2 my-2 border-t border-[var(--border-subtle)]" />
        {tags.map((tag) => (
          <div
            key={tag.id}
            className={`group relative ${selectedTagId === tag.id ? 'active' : ''} sticky-tag-item`}
            onClick={() => onSelectTag(tag.id)}
            onMouseEnter={() => setHoveredId(tag.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <span className="sticky-tag-dot" style={{ background: tag.color }} />
            <span className="flex-1 truncate">{tag.name}</span>
            {hoveredId === tag.id && (
              <span className="flex shrink-0 gap-0.5">
                <button
                  className="flex h-5 w-5 items-center justify-center rounded text-[11px] opacity-60 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditTag(tag)
                  }}
                >
                  <EditOutlined />
                </button>
                <button
                  className="flex h-5 w-5 items-center justify-center rounded text-[11px] opacity-60 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteTag(tag)
                  }}
                >
                  <DeleteOutlined />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-center border-t border-[var(--border-subtle)] px-2 py-2">
        <Tooltip title={t('memoStickyNewTag')}>
          <button className="sticky-toolbar-btn" onClick={onAddTag}>
            <PlusOutlined />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

function NoteCard({
  note,
  tag,
  selected,
  batchMode,
  batchSelected,
  onClick,
  onToggleBatch
}: {
  note: Note
  tag?: Tag
  selected: boolean
  batchMode: boolean
  batchSelected: boolean
  onClick: () => void
  onToggleBatch: () => void
}) {
  return (
    <div className={`sticky-card cursor-pointer ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="flex h-full flex-col p-3">
        {batchMode && (
          <div className="mb-2 flex items-center">
            <button
              className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] ${
                batchSelected
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border-subtle)]'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                onToggleBatch()
              }}
            >
              {batchSelected && <CheckOutlined />}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          {tag && <span className="sticky-tag-dot shrink-0" style={{ background: tag.color }} />}
          {note.title && (
            <span
              className="truncate text-[13px] font-semibold"
              style={{ color: 'var(--sticky-text)' }}
            >
              {note.title}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {new Date(note.updatedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric'
            })}
          </span>
        </div>
        <div
          className="mt-2 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-[12px] leading-[1.6]"
          style={{ color: 'var(--sticky-text)', maxHeight: 140 }}
        >
          {note.content || <span style={{ color: 'var(--text-secondary)' }}>...</span>}
        </div>
      </div>
    </div>
  )
}

function MemoSticky(): React.JSX.Element {
  const { t } = useTranslation()

  const [tags, setTags] = useState<Tag[]>(() => loadFromLS<Tag[]>(LS_TAGS, []))
  const [notes, setNotes] = useState<Note[]>(() => loadFromLS<Note[]>(LS_NOTES, []))
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set())

  const [tagModalOpen, setTagModalOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [tagNameInput, setTagNameInput] = useState('')
  const [tagColorInput, setTagColorInput] = useState(TAG_COLORS[0])

  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [noteTitleInput, setNoteTitleInput] = useState('')
  const [noteContentInput, setNoteContentInput] = useState('')

  useEffect(() => {
    saveToLS(LS_TAGS, tags)
  }, [tags])
  useEffect(() => {
    saveToLS(LS_NOTES, notes)
  }, [notes])

  const tagMap = new Map(tags.map((t) => [t.id, t]))

  const filteredNotes =
    selectedTagId === null ? notes : notes.filter((n) => n.tagId === selectedTagId)

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null

  const openTagModal = useCallback((tag?: Tag) => {
    setEditingTag(tag ?? null)
    setTagNameInput(tag?.name ?? '')
    setTagColorInput(tag?.color ?? TAG_COLORS[0])
    setTagModalOpen(true)
  }, [])

  const closeTagModal = useCallback(() => {
    setTagModalOpen(false)
    setEditingTag(null)
    setTagNameInput('')
    setTagColorInput(TAG_COLORS[0])
  }, [])

  const saveTag = useCallback(() => {
    const name = tagNameInput.trim()
    if (!name) return
    if (editingTag) {
      setTags((prev) =>
        prev.map((t) => (t.id === editingTag.id ? { ...t, name, color: tagColorInput } : t))
      )
    } else {
      const newTag: Tag = { id: genId(), name, color: tagColorInput }
      setTags((prev) => [...prev, newTag])
    }
    closeTagModal()
  }, [tagNameInput, tagColorInput, editingTag, closeTagModal])

  const deleteTag = useCallback(
    (tag: Tag) => {
      setTags((prev) => prev.filter((t) => t.id !== tag.id))
      setNotes((prev) => prev.map((n) => (n.tagId === tag.id ? { ...n, tagId: null } : n)))
      if (selectedTagId === tag.id) setSelectedTagId(null)
    },
    [selectedTagId]
  )

  const openNoteModal = useCallback((note?: Note) => {
    setEditingNote(note ?? null)
    setNoteTitleInput(note?.title ?? '')
    setNoteContentInput(note?.content ?? '')
    setNoteModalOpen(true)
  }, [])

  const closeNoteModal = useCallback(() => {
    setNoteModalOpen(false)
    setEditingNote(null)
    setNoteTitleInput('')
    setNoteContentInput('')
  }, [])

  const saveNote = useCallback(() => {
    const title = noteTitleInput.trim()
    const content = noteContentInput.trim()
    if (!title && !content) {
      closeNoteModal()
      return
    }
    if (editingNote) {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === editingNote.id ? { ...n, title, content, updatedAt: Date.now() } : n
        )
      )
    } else {
      const newNote: Note = {
        id: genId(),
        tagId: selectedTagId,
        title,
        content,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      setNotes((prev) => [newNote, ...prev])
    }
    closeNoteModal()
  }, [noteTitleInput, noteContentInput, editingNote, selectedTagId, closeNoteModal])

  const deleteNote = useCallback(
    (note: Note) => {
      setNotes((prev) => prev.filter((n) => n.id !== note.id))
      if (selectedNoteId === note.id) setSelectedNoteId(null)
    },
    [selectedNoteId]
  )

  const copyNote = useCallback(
    async (note: Note) => {
      try {
        await navigator.clipboard.writeText(note.content)
        message.success(t('memoStickyCopySuccess'))
      } catch {
        // fallback
      }
    },
    [t]
  )

  const toggleBatchSelect = useCallback((id: string) => {
    setBatchSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const deleteBatch = useCallback(() => {
    setNotes((prev) => prev.filter((n) => !batchSelected.has(n.id)))
    setBatchSelected(new Set())
    setBatchMode(false)
  }, [batchSelected])

  return (
    <div className="flex h-full overflow-hidden rounded-xl" style={{ background: 'var(--bg-warm)' }}>
      <TagSidebar
        tags={tags}
        selectedTagId={selectedTagId}
        onSelectTag={setSelectedTagId}
        onAddTag={() => openTagModal()}
        onEditTag={(tag) => openTagModal(tag)}
        onDeleteTag={(tag) => {
          Modal.confirm({
            title: t('memoStickyDeleteTag'),
            content: t('memoStickyDeleteTagConfirm'),
            okButtonProps: { danger: true },
            onOk: () => deleteTag(tag)
          })
        }}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filteredNotes.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('memoStickyNoNotes')}
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-3">
              {filteredNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  tag={tagMap.get(note.tagId ?? '')}
                  selected={selectedNoteId === note.id}
                  batchMode={batchMode}
                  batchSelected={batchSelected.has(note.id)}
                  onClick={() => setSelectedNoteId(note.id === selectedNoteId ? null : note.id)}
                  onToggleBatch={() => toggleBatchSelect(note.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 border-l border-[var(--border-subtle)] px-2 py-3">
        <Tooltip title={t('memoStickyCopySuccess')} placement="left">
          <button
            className="sticky-toolbar-btn"
            disabled={!selectedNote}
            onClick={() => selectedNote && copyNote(selectedNote)}
          >
            <CopyOutlined />
          </button>
        </Tooltip>
        <Tooltip title={t('memoStickyNewNote')} placement="left">
          <button className="sticky-toolbar-btn" onClick={() => openNoteModal()}>
            <PlusOutlined />
          </button>
        </Tooltip>
        <Tooltip title={t('memoStickyEditNote')} placement="left">
          <button
            className="sticky-toolbar-btn"
            disabled={!selectedNote}
            onClick={() => selectedNote && openNoteModal(selectedNote)}
          >
            <EditOutlined />
          </button>
        </Tooltip>
        <Tooltip title={t('memoStickyDeleteNote')} placement="left">
          <button
            className="sticky-toolbar-btn"
            disabled={!selectedNote}
            onClick={() => {
              if (!selectedNote) return
              Modal.confirm({
                title: t('memoStickyDeleteNote'),
                content: t('memoStickyDeleteNoteConfirm'),
                okButtonProps: { danger: true },
                onOk: () => deleteNote(selectedNote)
              })
            }}
          >
            <DeleteOutlined />
          </button>
        </Tooltip>
        <div className="my-1 w-5 border-t border-[var(--border-subtle)]" />
        <Tooltip
          title={batchMode ? t('memoStickyBatchDone') : t('memoStickyBatchMode')}
          placement="left"
        >
          <button
            className={`sticky-toolbar-btn ${batchMode ? 'active' : ''}`}
            onClick={() => {
              if (batchMode) {
                setBatchMode(false)
                setBatchSelected(new Set())
              } else {
                setBatchMode(true)
                setBatchSelected(new Set())
              }
            }}
          >
            {batchMode ? <CheckOutlined /> : <FormOutlined />}
          </button>
        </Tooltip>
        {batchMode && batchSelected.size > 0 && (
          <Tooltip title={t('memoStickyDeleteNote')} placement="left">
            <button className="sticky-toolbar-btn" onClick={deleteBatch}>
              <DeleteOutlined />
            </button>
          </Tooltip>
        )}
      </div>

      <Modal
        title={editingTag ? t('memoStickyEditTag') : t('memoStickyNewTag')}
        open={tagModalOpen}
        onOk={saveTag}
        onCancel={closeTagModal}
        okText={t('memoStickySave')}
        cancelText={t('memoStickyCancel')}
        width={360}
      >
        <div className="flex flex-col gap-4 py-2">
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('memoStickyTagName')}
            </label>
            <Input
              value={tagNameInput}
              onChange={(e) => setTagNameInput(e.target.value)}
              placeholder={t('memoStickyTagName')}
              onPressEnter={saveTag}
              autoFocus
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('memoStickyChooseColor')}
            </label>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  className={`sticky-color-swatch ${tagColorInput === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setTagColorInput(c)}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        title={editingNote ? t('memoStickyEditNote') : t('memoStickyNewNote')}
        open={noteModalOpen}
        onOk={saveNote}
        onCancel={closeNoteModal}
        okText={t('memoStickySave')}
        cancelText={t('memoStickyCancel')}
        width={480}
      >
        <div className="flex flex-col gap-3 py-2">
          <Input
            value={noteTitleInput}
            onChange={(e) => setNoteTitleInput(e.target.value)}
            placeholder={t('memoStickyTitlePlaceholder')}
            onPressEnter={saveNote}
            autoFocus
          />
          <Input.TextArea
            value={noteContentInput}
            onChange={(e) => setNoteContentInput(e.target.value)}
            placeholder={t('memoStickyContentPlaceholder')}
            rows={6}
          />
        </div>
      </Modal>
    </div>
  )
}

export default MemoSticky
