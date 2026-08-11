import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Select } from 'antd'
import { ClearOutlined, CopyOutlined } from '@ant-design/icons'
import { Btn, PANEL_HEADER_CLS } from '../../components/ui'

const FLAGS = [
  { key: 'g', labelKey: 'regexFlagGlobal', desc: 'global' },
  { key: 'i', labelKey: 'regexFlagIgnoreCase', desc: 'ignore case' },
  { key: 'm', labelKey: 'regexFlagMultiline', desc: 'multiline' },
  { key: 's', labelKey: 'regexFlagDotAll', desc: 'dot all' },
  { key: 'u', labelKey: 'regexFlagUnicode', desc: 'unicode' },
  { key: 'y', labelKey: 'regexFlagSticky', desc: 'sticky' }
]

const PRESETS: Array<{ key: string; labelKey: string; pattern: string; flags: string }> = [
  {
    key: 'email',
    labelKey: 'regexPresetEmail',
    pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]+',
    flags: 'gi'
  },
  {
    key: 'url',
    labelKey: 'regexPresetUrl',
    pattern: "https?://[\\w\\-._~:/?#[\\]@!$&'()*+,;=%]+",
    flags: 'gi'
  },
  {
    key: 'ipv4',
    labelKey: 'regexPresetIpv4',
    pattern: '\\b(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}\\b',
    flags: 'g'
  },
  { key: 'phone', labelKey: 'regexPresetPhone', pattern: '\\b1[3-9]\\d{9}\\b', flags: 'g' },
  {
    key: 'uuid',
    labelKey: 'regexPresetUuid',
    pattern: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
    flags: 'gi'
  },
  { key: 'date', labelKey: 'regexPresetDate', pattern: '\\b\\d{4}-\\d{2}-\\d{2}\\b', flags: 'g' },
  {
    key: 'time',
    labelKey: 'regexPresetTime',
    pattern: '\\b(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?\\b',
    flags: 'g'
  },
  {
    key: 'html-tag',
    labelKey: 'regexPresetHtmlTag',
    pattern: '<\\/?[a-zA-Z][\\w-]*(?:\\s+[\\w-]+=(?:"[^"]*"|\'[^\']*\'|[^\\s>]+))*\\s*\\/?>',
    flags: 'gi'
  },
  {
    key: 'hex-color',
    labelKey: 'regexPresetHexColor',
    pattern: '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b',
    flags: 'gi'
  },
  { key: 'chinese', labelKey: 'regexPresetChinese', pattern: '[\\u4e00-\\u9fa5]+', flags: 'g' }
]

interface MatchInfo {
  index: number
  text: string
  groups: Array<{ index: number; name: string | undefined; text: string | undefined }>
}

function collectMatches(pattern: string, flags: string, text: string): MatchInfo[] {
  const re = new RegExp(pattern, flags)
  const out: MatchInfo[] = []
  if (!flags.includes('g') && !flags.includes('y')) {
    const m = re.exec(text)
    if (m) {
      out.push({
        index: m.index,
        text: m[0],
        groups: m.slice(1).map((g, i) => ({ index: i + 1, name: undefined, text: g }))
      })
    }
    return out
  }
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') {
      re.lastIndex++
      continue
    }
    out.push({
      index: m.index,
      text: m[0],
      groups: m.slice(1).map((g, i) => ({ index: i + 1, name: undefined, text: g }))
    })
    if (m.index === re.lastIndex) re.lastIndex++
  }
  return out
}

function RegexTester(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState<string>('gi')
  const [text, setText] = useState('')

  const regexError = useMemo(() => {
    if (!pattern) return null
    try {
      new RegExp(pattern, flags)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }, [pattern, flags])

  const matches = useMemo(() => {
    if (!pattern || regexError) return []
    try {
      return collectMatches(pattern, flags, text)
    } catch {
      return []
    }
  }, [pattern, flags, text, regexError])

  // Rendered text with highlight segments
  const segments = useMemo(() => {
    if (!matches.length) return [{ text, hit: false }]
    const out: Array<{ text: string; hit: boolean }> = []
    let cursor = 0
    for (const m of matches) {
      if (m.index > cursor) out.push({ text: text.slice(cursor, m.index), hit: false })
      out.push({ text: m.text, hit: true })
      cursor = m.index + m.text.length
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false })
    return out
  }, [matches, text])

  const toggleFlag = (key: string): void => {
    setFlags((prev) => (prev.includes(key) ? prev.replace(key, '') : prev + key))
  }

  const handlePreset = (key: string): void => {
    const preset = PRESETS.find((p) => p.key === key)
    if (!preset) return
    setPattern(preset.pattern)
    setFlags(preset.flags)
  }

  const handleCopyText = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      message.success(t('copied'))
    } catch {
      message.error(t('copyFailed'))
    }
  }

  const flagBtnCls = (active: boolean): string => `
    px-2.5 py-1 rounded-md text-xs font-mono font-semibold cursor-pointer transition-all duration-100 border
    ${
      active
        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
        : 'bg-transparent text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]'
    }`

  const matchCountText = pattern
    ? t('regexMatchCount', { count: matches.length })
    : t('regexEnterPattern')

  return (
    <div className="flex flex-col p-6 flex-1 min-h-0">
      {/* ── Pinned control bar ── */}
      <div className="sticky top-0 z-10 bg-[var(--content-bg)] pb-3 space-y-3">
        {/* Pattern input row */}
        <div className="flex items-stretch rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden focus-within:border-[var(--accent)] transition-colors duration-150">
          <span className="flex items-center pl-3 pr-1 font-mono text-sm text-[var(--text-secondary)] select-none">
            /
          </span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={t('regexPatternPlaceholder')}
            spellCheck={false}
            className="flex-1 min-w-0 py-2.5 font-mono text-sm text-[var(--text-primary)] bg-transparent outline-none border-none"
          />
          <span className="flex items-center px-3 font-mono text-sm text-[var(--text-secondary)] select-none whitespace-nowrap">
            /{flags}/
          </span>
        </div>

        {/* Flags + actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {FLAGS.map((f) => (
            <button
              key={f.key}
              onClick={() => toggleFlag(f.key)}
              title={`${f.desc}`}
              className={flagBtnCls(flags.includes(f.key))}
            >
              {f.key}
              <span className="ml-0.5 opacity-60 text-[10px]">{t(f.labelKey)}</span>
            </button>
          ))}
          <div className="w-px h-5 bg-[var(--border-subtle)] mx-1" />
          <Select
            value={undefined}
            onChange={handlePreset}
            placeholder={t('regexPreset')}
            options={PRESETS.map((p) => ({ value: p.key, label: t(p.labelKey) }))}
            style={{ width: 170 }}
            size="small"
            allowClear
            className="text-xs"
          />
          <Btn
            variant="ghost"
            icon={<ClearOutlined style={{ fontSize: 11 }} />}
            onClick={() => {
              setPattern('')
              setFlags('gi')
            }}
          >
            {t('regexClear')}
          </Btn>
        </div>

        {regexError && (
          <div className="px-3 py-2 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger-border)] text-xs text-[var(--danger)] font-mono break-all">
            {regexError}
          </div>
        )}
      </div>

      {/* ── Body: two columns ── */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* Left: test text */}
        <section className="flex-1 min-w-0 flex flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className={PANEL_HEADER_CLS}>{t('regexTestText')}</span>
            <span className="text-xs text-[var(--text-secondary)] tabular-nums">
              {matchCountText}
            </span>
          </div>
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            {/* Highlight preview */}
            <div className="flex-1 min-h-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-warm)] overflow-auto">
              <pre className="p-3 text-sm leading-relaxed font-mono text-[var(--text-primary)] whitespace-pre-wrap break-words select-all">
                {!pattern ? (
                  <span className="text-[var(--text-secondary)] italic text-xs">
                    {t('regexEnterPattern')}
                  </span>
                ) : text === '' ? (
                  <span className="text-[var(--text-secondary)] italic text-xs">
                    {t('regexTextEmpty')}
                  </span>
                ) : (
                  segments.map((seg, i) =>
                    seg.hit ? (
                      <mark
                        key={i}
                        className="bg-[var(--accent)] text-white dark:text-black/80 rounded-[2px] px-px"
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    )
                  )
                )}
              </pre>
            </div>
            {/* Editor */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('regexTextPlaceholder')}
              spellCheck={false}
              className="h-24 shrink-0 w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)]
                bg-[var(--surface)] text-[var(--text-primary)]
                font-mono text-sm leading-relaxed outline-none resize-none
                focus:border-[var(--accent)] transition-colors duration-150"
            />
          </div>
        </section>

        {/* Right: match list */}
        <section className="w-[340px] shrink-0 flex flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <span className={PANEL_HEADER_CLS}>{t('regexMatches')}</span>
            {matches.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-semibold tabular-nums">
                {matches.length}
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-gutter-stable">
            {matches.length === 0 ? (
              <div className="border-2 border-dashed border-[var(--border-subtle)] rounded-lg py-8 text-center">
                <p className="text-xs text-[var(--text-secondary)] opacity-60 italic">
                  {pattern && !regexError ? t('regexNoMatch') : t('regexEnterPattern')}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {matches.map((m, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-warm)] px-3 py-2"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-semibold text-[var(--text-secondary)] tabular-nums shrink-0">
                        #{i + 1}
                      </span>
                      <span className="text-[10px] text-[var(--text-secondary)] tabular-nums shrink-0">
                        {m.index}–{m.index + m.text.length}
                      </span>
                      <button
                        onClick={() => handleCopyText(m.text)}
                        className="ml-auto flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]
                          hover:brightness-110 transition-all duration-150 cursor-pointer border-none bg-transparent"
                      >
                        <CopyOutlined style={{ fontSize: 10 }} />
                        {t('copy')}
                      </button>
                    </div>
                    <code className="block text-sm font-mono text-[var(--text-primary)] break-all select-all">
                      {m.text}
                    </code>
                    {m.groups.length > 0 && (
                      <div className="mt-1.5 pt-1.5 border-t border-[var(--border-subtle)] flex flex-wrap gap-x-4 gap-y-1">
                        {m.groups.map((g, gi) => (
                          <span key={gi} className="text-xs font-mono text-[var(--text-secondary)]">
                            <span className="opacity-60">${g.index}</span>{' '}
                            <span className="text-[var(--text-primary)] break-all">
                              {g.text ?? '(undefined)'}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default RegexTester
