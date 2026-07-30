import { useState, useCallback, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { InputNumber, App } from 'antd'
import { SnippetsOutlined, ReloadOutlined, CheckOutlined } from '@ant-design/icons'

const DIGITS = '0123456789'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SPECIALS = '~!@#$%^&*()[{]}-_=+|;:\'",<.>/?`'

interface CharSet {
  key: string
  labelKey: string
  chars: string
  active: boolean
}

function generateBatch(length: number, count: number, sets: CharSet[]): string[] {
  const pool = sets
    .filter((s) => s.active)
    .map((s) => s.chars)
    .join('')
  if (!pool) return []

  const results: string[] = []
  for (let n = 0; n < count; n++) {
    const buf = new Uint32Array(length)
    crypto.getRandomValues(buf)
    let pw = ''
    for (let i = 0; i < length; i++) {
      pw += pool[buf[i] % pool.length]
    }
    results.push(pw)
  }
  return results
}

const LABEL_CLS =
  'block text-[11px] font-semibold tracking-widest text-[var(--text-secondary)] mb-1.5'
const INPUT_LABEL_CLS = 'block text-xs font-medium text-[var(--text-secondary)] mb-1.5'

function RandomPassword({ breadcrumb }: { breadcrumb?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [length, setLength] = useState(16)
  const [count, setCount] = useState(5)
  const [sets, setSets] = useState<CharSet[]>([
    { key: 'digits', labelKey: 'digitsLabel', chars: DIGITS, active: true },
    { key: 'lower', labelKey: 'lowerLabel', chars: LOWER, active: true },
    { key: 'upper', labelKey: 'upperLabel', chars: UPPER, active: true },
    { key: 'specials', labelKey: 'specialsLabel', chars: SPECIALS, active: true }
  ])
  const [passwords, setPasswords] = useState<string[]>([])
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const toggleSet = useCallback((key: string) => {
    setSets((prev) => prev.map((s) => (s.key === key ? { ...s, active: !s.active } : s)))
  }, [])

  const handleGenerate = useCallback(() => {
    setPasswords(generateBatch(length, count, sets))
    setCopiedIdx(null)
  }, [length, count, sets])

  const handleCopy = useCallback(
    async (pw: string, idx: number) => {
      try {
        await navigator.clipboard.writeText(pw)
        setCopiedIdx(idx)
        message.success(t('copied'))
        setTimeout(() => setCopiedIdx(null), 2000)
      } catch {
        message.error(t('copyFailed'))
      }
    },
    [t]
  )

  const handleCopyAll = useCallback(async () => {
    if (!passwords.length) return
    try {
      await navigator.clipboard.writeText(passwords.join('\n'))
      message.success(t('copiedAll'))
    } catch {
      message.error(t('copyFailed'))
    }
  }, [passwords, t])

  const allDisabled = !sets.some((s) => s.active)

  return (
    <div className="flex flex-col min-h-0">
      {/* Sticky zone: breadcrumb + controls + results header */}
      <div className="sticky top-0 z-10 bg-[var(--content-bg)]">
        {breadcrumb ?? <div className="mb-4" />}

        {/* Config bar — pills left, inputs right */}
        <div className="flex flex-wrap items-start gap-4 mb-4">
          {/* Character sets */}
          <div className="flex-1 min-w-[280px]">
            <label className={LABEL_CLS}>{t('characterTypes')}</label>
            <div className="flex flex-wrap gap-2">
              {sets.map((s) => (
                <button
                  key={s.key}
                  onClick={() => toggleSet(s.key)}
                  className={`toggle-pill ${s.active ? 'active' : ''}`}
                >
                  <span className="pill-label">{t(s.labelKey)}</span>
                  <span className="pill-chars">{s.chars}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Length + Count */}
          <div className="flex gap-3 items-start shrink-0">
            <div className="w-24">
              <label className={INPUT_LABEL_CLS}>{t('passwordLength')}</label>
              <InputNumber<number>
                size="large"
                min={4}
                max={128}
                value={length}
                onChange={(v) => v != null && setLength(v)}
                className="!w-full"
              />
            </div>
            <div className="w-20">
              <label className={INPUT_LABEL_CLS}>{t('count')}</label>
              <InputNumber<number>
                size="large"
                min={1}
                max={100}
                value={count}
                onChange={(v) => v != null && setCount(v)}
                className="!w-full"
              />
            </div>
          </div>
        </div>

        {/* Generate */}
        <button
          onClick={handleGenerate}
          disabled={allDisabled}
          className="
            w-full py-2.5 px-6 rounded-lg text-sm font-semibold
            flex items-center justify-center gap-2
            transition-all duration-150 cursor-pointer border-none
            bg-[var(--accent)] text-white
            hover:brightness-110 active:brightness-90
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100
          "
        >
          <ReloadOutlined />
          {t('generate')}
        </button>

        {/* Results header (pinned below generate, above rows) */}
        {passwords.length > 0 && (
          <div className="mt-6 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
              {t('count')} · {passwords.length}
            </span>
            <button
              onClick={handleCopyAll}
              className="text-[11px] font-semibold uppercase tracking-widest
                text-[var(--accent)] hover:brightness-110
                transition-all duration-150 cursor-pointer border-none bg-transparent"
            >
              {t('copyAll')}
            </button>
          </div>
        )}
      </div>

      {/* Results rows (scroll under sticky zone) */}
      {passwords.length > 0 && (
        <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden bg-[var(--surface)] -mt-[1px]">
          {passwords.map((pw, idx) => (
            <div
              key={idx}
              onClick={() => handleCopy(pw, idx)}
              className={`
                flex items-center gap-3 px-4 py-2.5 group cursor-pointer
                transition-colors duration-100
                ${idx % 2 === 1 ? 'bg-black/[0.02]' : ''}
                hover:bg-black/[0.04]
              `}
            >
              <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums w-5 shrink-0 text-right leading-none opacity-50">
                {idx + 1}
              </span>
              <span className="flex-1 font-mono text-[15px] leading-snug text-[var(--text-primary)] break-all min-w-0 select-all pointer-events-none">
                {pw}
              </span>
              <span
                className="shrink-0 flex items-center justify-center w-7 h-7 rounded
                text-[var(--text-secondary)] opacity-30 group-hover:opacity-100
                transition-all duration-150"
              >
                {copiedIdx === idx ? (
                  <CheckOutlined style={{ color: 'var(--accent)', fontSize: 13 }} />
                ) : (
                  <SnippetsOutlined style={{ fontSize: 13 }} />
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {passwords.length === 0 && (
        <div className="mt-8 border-2 border-dashed border-[var(--border-subtle)] rounded-lg py-12 text-center">
          <p className="text-sm text-[var(--text-secondary)] opacity-50 italic">
            {t('clickGenerate')}
          </p>
        </div>
      )}
    </div>
  )
}

export default RandomPassword
