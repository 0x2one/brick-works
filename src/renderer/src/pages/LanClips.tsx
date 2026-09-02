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
  return 'lanClipsFail'
}

function LanClips(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [state, setState] = useState<LanClipsState>({ revision: 0, slots: [] })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { label: string; text: string }>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    let mounted = true
    const timers = saveTimers.current
    window.api.lan
      .listClips()
      .then((s) => {
        if (mounted) setState(s)
      })
      .catch(() => {})
    const off = window.api.lan.onClipsChange((s) => {
      if (mounted) setState(s)
    })
    return () => {
      mounted = false
      off()
      for (const timer of Object.values(timers)) clearTimeout(timer)
    }
  }, [])

  const slots = state.slots
  const shown = useMemo(
    () =>
      slots.map((slot) => {
        const draft = drafts[slot.id]
        const editing = focusId === slot.id
        return {
          slot,
          label: editing && draft ? draft.label : slot.label,
          text: editing && draft ? draft.text : slot.text
        }
      }),
    [slots, drafts, focusId]
  )

  const report = useCallback(
    (err: unknown) => {
      message.error(t(clipErrorKey(err)))
    },
    [message, t]
  )

  const saveSlot = useCallback(
    async (id: string, patch: { label?: string; text?: string }) => {
      try {
        await window.api.lan.updateClip(id, patch)
      } catch (err) {
        report(err)
      }
    },
    [report]
  )

  const scheduleTextSave = useCallback(
    (id: string, text: string) => {
      clearTimeout(saveTimers.current[id])
      saveTimers.current[id] = setTimeout(() => {
        void saveSlot(id, { text })
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

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((e) => ({ ...e, [id]: !e[id] }))
  }, [])

  const beginEdit = useCallback((slot: LanClipSlot) => {
    setFocusId(slot.id)
    setDrafts((d) => ({
      ...d,
      [slot.id]: d[slot.id] ?? { label: slot.label, text: slot.text }
    }))
  }, [])

  const flushBlur = useCallback(
    (id: string, slot: LanClipSlot) => {
      clearTimeout(saveTimers.current[id])
      const draft = drafts[id]
      setFocusId((cur) => (cur === id ? null : cur))
      if (!draft) return
      const patch: { label?: string; text?: string } = {}
      if (draft.label !== slot.label) patch.label = draft.label
      if (draft.text !== slot.text) patch.text = draft.text
      if (Object.keys(patch).length) void saveSlot(id, patch)
    },
    [drafts, saveSlot]
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
                className={`px-4 py-3 flex items-center gap-2 ${open ? 'border-b border-[var(--border-subtle)]' : ''}`}
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
                    const value = e.target.value
                    setDrafts((d) => ({
                      ...d,
                      [slot.id]: { label: value, text: d[slot.id]?.text ?? slot.text }
                    }))
                  }}
                  onBlur={() => flushBlur(slot.id, slot)}
                  onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                />
                <Btn
                  variant="ghost"
                  icon={<ImportOutlined />}
                  title={t('lanClipsFromSystem')}
                  onClick={() => {
                    window.api.lan
                      .clipFromSystem(slot.id)
                      .then(() => {
                        setExpanded((e) => ({ ...e, [slot.id]: true }))
                        message.success(t('lanClipsFilled'))
                      })
                      .catch(report)
                  }}
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
                      setDrafts((d) => ({
                        ...d,
                        [slot.id]: { label: d[slot.id]?.label ?? slot.label, text: value }
                      }))
                      scheduleTextSave(slot.id, value)
                    }}
                    onBlur={() => flushBlur(slot.id, slot)}
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
