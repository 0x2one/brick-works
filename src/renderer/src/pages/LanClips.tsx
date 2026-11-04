import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Input, Popconfirm } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  ImportOutlined,
  PlusOutlined,
  RightOutlined
} from '@ant-design/icons'
import { Btn } from '../components/ui'
import { LABEL_CLS, CARD_CLS } from '../components/ui'

type ClipDraft = { label: string; text: string }
type ClipPatch = { label?: string; text?: string; baseRevision?: number }

function clipFallbackName(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > 30 ? compact.slice(0, 30) + '…' : compact
}

function clipErrorKey(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('CLIP_LIMIT')) return 'lanClipsLimit'
  if (msg.includes('TOO_LARGE')) return 'lanClipsTooLarge'
  if (msg.includes('EMPTY_CLIPBOARD')) return 'lanClipsEmptyClipboard'
  if (msg.includes('CONFLICT')) return 'lanClipsConflict'
  return 'lanClipsFail'
}

function isConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('CONFLICT')
}

function LanClips(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [state, setState] = useState<LanClipsState>({ revision: 0, slots: [] })
  const [drafts, setDrafts] = useState<Record<string, ClipDraft>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [stale, setStale] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const dirtyRef = useRef<Record<string, boolean>>({})
  const staleRef = useRef<Record<string, boolean>>({})
  const draftsRef = useRef<Record<string, ClipDraft>>({})
  const baseRevRef = useRef<Record<string, number>>({})
  const inFlightRef = useRef<Record<string, ClipPatch>>({})
  const saveSlotRef = useRef<(id: string, patch: ClipPatch) => Promise<void>>(async () => {})

  const syncDrafts = useCallback((next: Record<string, ClipDraft>) => {
    draftsRef.current = next
    setDrafts(next)
  }, [])
  const syncDirty = useCallback((next: Record<string, boolean>) => {
    dirtyRef.current = next
    setDirty(next)
  }, [])
  const syncStale = useCallback((next: Record<string, boolean>) => {
    staleRef.current = next
    setStale(next)
  }, [])

  const applyRemote = useCallback(
    (s: LanClipsState) => {
      const nextDrafts = { ...draftsRef.current }
      const nextDirty = { ...dirtyRef.current }
      const nextStale = { ...staleRef.current }
      const nextBase = { ...baseRevRef.current }
      const live = new Set(s.slots.map((slot) => slot.id))

      for (const slot of s.slots) {
        const draft = nextDrafts[slot.id]
        const isDirty = !!nextDirty[slot.id]
        const base = nextBase[slot.id] ?? slot.rev
        const inflight = inFlightRef.current[slot.id]
        const matchesDraft = !!draft && draft.label === slot.label && draft.text === slot.text
        const matchesInflight =
          !!inflight &&
          (inflight.text === undefined || inflight.text === slot.text) &&
          (inflight.label === undefined || inflight.label === slot.label)

        if (isDirty && draft) {
          if (matchesDraft || matchesInflight) {
            nextBase[slot.id] = slot.rev
            if (matchesDraft) {
              delete nextDirty[slot.id]
              delete nextDrafts[slot.id]
            }
            delete nextStale[slot.id]
            if (matchesInflight) delete inFlightRef.current[slot.id]
          } else if (slot.rev !== base) {
            nextStale[slot.id] = true
            clearTimeout(saveTimers.current[slot.id])
          }
        } else {
          nextBase[slot.id] = slot.rev
          delete nextDrafts[slot.id]
          delete nextDirty[slot.id]
          delete nextStale[slot.id]
        }
      }

      for (const id of Object.keys(nextDrafts)) {
        if (!live.has(id)) {
          delete nextDrafts[id]
          delete nextDirty[id]
          delete nextStale[id]
          delete nextBase[id]
          delete inFlightRef.current[id]
          clearTimeout(saveTimers.current[id])
        }
      }

      baseRevRef.current = nextBase
      syncDrafts(nextDrafts)
      syncDirty(nextDirty)
      syncStale(nextStale)
      setState(s)
    },
    [syncDirty, syncDrafts, syncStale]
  )

  useEffect(() => {
    let mounted = true
    const timers = saveTimers.current
    window.api.lan
      .listClips()
      .then((s) => {
        if (!mounted) return
        applyRemote(s)
      })
      .catch(() => {})
    const off = window.api.lan.onClipsChange((s) => {
      if (mounted) applyRemote(s)
    })
    return () => {
      mounted = false
      off()
      for (const timer of Object.values(timers)) clearTimeout(timer)
    }
  }, [applyRemote])

  const slots = state.slots
  const shown = useMemo(
    () =>
      slots.map((slot) => {
        const draft = drafts[slot.id]
        const useDraft = !!dirty[slot.id] && !!draft
        return {
          slot,
          label: useDraft ? draft.label : slot.label,
          text: useDraft ? draft.text : slot.text
        }
      }),
    [slots, drafts, dirty]
  )

  const report = useCallback(
    (err: unknown) => {
      message.error(t(clipErrorKey(err)))
    },
    [message, t]
  )

  const markStale = useCallback(
    (id: string) => {
      clearTimeout(saveTimers.current[id])
      delete inFlightRef.current[id]
      syncStale({ ...staleRef.current, [id]: true })
    },
    [syncStale]
  )

  const saveSlot = useCallback(
    async (id: string, patch: ClipPatch) => {
      if (staleRef.current[id]) return
      const baseRevision = patch.baseRevision ?? baseRevRef.current[id]
      const payload: ClipPatch = { ...patch, baseRevision }
      inFlightRef.current[id] = payload
      try {
        const result = await window.api.lan.updateClip(id, payload)
        baseRevRef.current[id] = result.rev
        delete inFlightRef.current[id]
        const draft = draftsRef.current[id]
        const matchesResult = !!draft && draft.label === result.label && draft.text === result.text
        const matchesSent =
          !!draft &&
          (payload.label === undefined || draft.label === payload.label) &&
          (payload.text === undefined || draft.text === payload.text)
        if (matchesResult || matchesSent) {
          const nextDrafts = { ...draftsRef.current }
          const nextDirty = { ...dirtyRef.current }
          const nextStale = { ...staleRef.current }
          delete nextDrafts[id]
          delete nextDirty[id]
          delete nextStale[id]
          syncDrafts(nextDrafts)
          syncDirty(nextDirty)
          syncStale(nextStale)
        } else if (draft && dirtyRef.current[id] && !staleRef.current[id]) {
          const follow: ClipPatch = { baseRevision: result.rev }
          if (draft.label !== result.label) follow.label = draft.label
          if (draft.text !== result.text) follow.text = draft.text
          if (follow.label !== undefined || follow.text !== undefined) {
            void saveSlotRef.current(id, follow)
          }
        }
      } catch (err) {
        delete inFlightRef.current[id]
        if (isConflict(err)) {
          markStale(id)
          return
        }
        report(err)
      }
    },
    [markStale, report, syncDirty, syncDrafts, syncStale]
  )

  useEffect(() => {
    saveSlotRef.current = saveSlot
  }, [saveSlot])

  const scheduleTextSave = useCallback(
    (id: string, text: string) => {
      clearTimeout(saveTimers.current[id])
      saveTimers.current[id] = setTimeout(() => {
        if (staleRef.current[id]) return
        void saveSlot(id, { text, baseRevision: baseRevRef.current[id] })
      }, 500)
    },
    [saveSlot]
  )

  const handleCreate = useCallback(async () => {
    try {
      const slot = await window.api.lan.createClip()
      setExpanded((e) => ({ ...e, [slot.id]: true }))
    } catch (err) {
      report(err)
    }
  }, [report])

  const handleFromSystemNew = useCallback(async () => {
    try {
      const slot = await window.api.lan.clipFromSystem()
      setExpanded((e) => ({ ...e, [slot.id]: true }))
      message.success(t('lanClipsFilled'))
    } catch (err) {
      report(err)
    }
  }, [message, report, t])

  const handleFromSystem = useCallback(
    async (slot: LanClipSlot) => {
      clearTimeout(saveTimers.current[slot.id])
      try {
        await window.api.lan.clipFromSystem(slot.id, slot.rev)
        const nextDrafts = { ...draftsRef.current }
        const nextDirty = { ...dirtyRef.current }
        const nextStale = { ...staleRef.current }
        delete nextDrafts[slot.id]
        delete nextDirty[slot.id]
        delete nextStale[slot.id]
        syncDrafts(nextDrafts)
        syncDirty(nextDirty)
        syncStale(nextStale)
        setExpanded((e) => ({ ...e, [slot.id]: true }))
        message.success(t('lanClipsFilled'))
      } catch (err) {
        if (isConflict(err)) {
          markStale(slot.id)
          message.warning(t('lanClipsConflict'))
          return
        }
        report(err)
      }
    },
    [markStale, message, report, syncDirty, syncDrafts, syncStale, t]
  )

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((e) => ({ ...e, [id]: !e[id] }))
  }, [])

  const beginEdit = useCallback((slot: LanClipSlot) => {
    if (baseRevRef.current[slot.id] === undefined) {
      baseRevRef.current[slot.id] = slot.rev
    }
  }, [])

  const patchDraft = useCallback(
    (slot: LanClipSlot, patch: Partial<ClipDraft>) => {
      const prev = draftsRef.current[slot.id] ?? { label: slot.label, text: slot.text }
      const next = { ...prev, ...patch }
      syncDrafts({ ...draftsRef.current, [slot.id]: next })
      syncDirty({ ...dirtyRef.current, [slot.id]: true })
    },
    [syncDirty, syncDrafts]
  )

  const flushBlur = useCallback(
    (id: string) => {
      clearTimeout(saveTimers.current[id])
      if (staleRef.current[id]) return
      const draft = draftsRef.current[id]
      if (!dirtyRef.current[id] || !draft) return
      if (inFlightRef.current[id]) return
      const slot = state.slots.find((s) => s.id === id)
      if (!slot) return
      const patch: ClipPatch = { baseRevision: baseRevRef.current[id] }
      if (draft.label !== slot.label) patch.label = draft.label
      if (draft.text !== slot.text) patch.text = draft.text
      if (patch.label === undefined && patch.text === undefined) return
      void saveSlot(id, patch)
    },
    [saveSlot, state.slots]
  )

  const takeRemote = useCallback(
    (id: string) => {
      clearTimeout(saveTimers.current[id])
      delete inFlightRef.current[id]
      const slot = state.slots.find((s) => s.id === id)
      if (slot) baseRevRef.current[id] = slot.rev
      const nextDrafts = { ...draftsRef.current }
      const nextDirty = { ...dirtyRef.current }
      const nextStale = { ...staleRef.current }
      delete nextDrafts[id]
      delete nextDirty[id]
      delete nextStale[id]
      syncDrafts(nextDrafts)
      syncDirty(nextDirty)
      syncStale(nextStale)
    },
    [state.slots, syncDirty, syncDrafts, syncStale]
  )

  const keepLocal = useCallback(
    (id: string) => {
      const slot = state.slots.find((s) => s.id === id)
      if (slot) baseRevRef.current[id] = slot.rev
      const nextStale = { ...staleRef.current }
      delete nextStale[id]
      syncStale(nextStale)
      const draft = draftsRef.current[id]
      if (!draft) return
      const patch: ClipPatch = { baseRevision: baseRevRef.current[id] }
      if (!slot || draft.label !== slot.label) patch.label = draft.label
      if (!slot || draft.text !== slot.text) patch.text = draft.text
      if (patch.label !== undefined || patch.text !== undefined) {
        void saveSlot(id, patch)
      }
    },
    [saveSlot, state.slots, syncStale]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={LABEL_CLS}>{t('lanClips')}</span>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1">{t('lanClipsHint')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Btn icon={<ImportOutlined />} onClick={() => void handleFromSystemNew()}>
            {t('lanClipsFromSystemNew')}
          </Btn>
          <Btn variant="primary" icon={<PlusOutlined />} onClick={() => void handleCreate()}>
            {t('lanClipsNew')}
          </Btn>
        </div>
      </div>

      {shown.length === 0 ? (
        <section className={CARD_CLS}>
          <p className="text-xs text-[var(--text-secondary)] py-10 text-center">
            {t('lanClipsEmpty')}
          </p>
        </section>
      ) : (
        shown.map(({ slot, label, text }, index) => {
          const open = !!expanded[slot.id]
          const preview =
            text
              .trim()
              .split(/\r?\n/)
              .find((line) => line.trim()) || ''
          return (
            <article key={slot.id} className={CARD_CLS}>
              <div
                className={`px-4 py-3 flex items-center gap-2 ${open || stale[slot.id] ? 'border-b border-[var(--border-subtle)]' : ''}`}
              >
                <button
                  type="button"
                  className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] cursor-pointer border-none bg-transparent"
                  title={open ? t('lanClipsCollapse') : t('lanClipsExpand')}
                  onClick={() => toggleExpanded(slot.id)}
                >
                  {open ? (
                    <DownOutlined style={{ fontSize: 10 }} />
                  ) : (
                    <RightOutlined style={{ fontSize: 10 }} />
                  )}
                </button>
                <span className="shrink-0 w-6 h-6 rounded-md bg-[var(--accent)] text-white text-[11px] font-semibold flex items-center justify-center">
                  {index + 1}
                </span>
                <Input
                  value={label}
                  placeholder={clipFallbackName(text) || t('lanClipsLabelPlaceholder')}
                  variant="borderless"
                  className="flex-1 min-w-0 font-medium"
                  onFocus={() => beginEdit(slot)}
                  onChange={(e) => {
                    patchDraft(slot, { label: e.target.value })
                  }}
                  onBlur={() => flushBlur(slot.id)}
                  onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                />
                <Btn
                  variant="ghost"
                  icon={<ImportOutlined />}
                  title={t('lanClipsFromSystem')}
                  onClick={() => void handleFromSystem(slot)}
                />
                <Btn
                  variant="ghost"
                  icon={<CopyOutlined />}
                  title={t('lanClipsToSystem')}
                  onClick={() => {
                    window.api.lan
                      .clipToSystem(slot.id)
                      .then(() => message.success(t('lanClipsCopied')))
                      .catch(report)
                  }}
                />
                <Popconfirm
                  title={t('lanClipsDeleteConfirm')}
                  onConfirm={() => {
                    window.api.lan.deleteClip(slot.id).catch(report)
                  }}
                  okText={t('lanClipsDelete')}
                >
                  <span>
                    <Btn variant="ghost" icon={<DeleteOutlined />} title={t('lanClipsDelete')} />
                  </span>
                </Popconfirm>
              </div>
              {stale[slot.id] ? (
                <div className="px-4 py-2 flex items-center gap-2 flex-wrap bg-[var(--bg-warm)]">
                  <span className="text-[11px] text-[var(--text-secondary)] flex-1 min-w-0">
                    {t('lanClipsRemoteUpdated')}
                  </span>
                  <Btn onClick={() => takeRemote(slot.id)}>{t('lanClipsTakeRemote')}</Btn>
                  <Btn variant="primary" onClick={() => keepLocal(slot.id)}>
                    {t('lanClipsKeepLocal')}
                  </Btn>
                </div>
              ) : null}
              {open ? (
                <div className="px-3 py-3">
                  <Input.TextArea
                    value={text}
                    spellCheck={false}
                    placeholder={t('lanClipsTextPlaceholder')}
                    className="lan-clip-editor"
                    style={{
                      minHeight: 280,
                      height: 360,
                      resize: 'vertical',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: 13,
                      lineHeight: 1.55
                    }}
                    onFocus={() => beginEdit(slot)}
                    onChange={(e) => {
                      const value = e.target.value
                      patchDraft(slot, { text: value })
                      scheduleTextSave(slot.id, value)
                    }}
                    onBlur={() => flushBlur(slot.id)}
                  />
                  <div className="mt-2 text-[11px] text-[var(--text-secondary)] tabular-nums">
                    {t('lanClipsChars', { n: text.length })}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full text-left px-4 py-2.5 border-none bg-transparent cursor-pointer hover:bg-[var(--bg-warm)]"
                  onClick={() => toggleExpanded(slot.id)}
                >
                  <span className="block text-xs font-mono text-[var(--text-secondary)] truncate">
                    {preview || t('lanClipsPreviewEmpty')}
                  </span>
                </button>
              )}
            </article>
          )
        })
      )}
    </div>
  )
}

export default LanClips
