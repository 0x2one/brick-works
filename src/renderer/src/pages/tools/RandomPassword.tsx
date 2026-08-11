import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { InputNumber, App } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { Btn, EmptyState, ResultList, ResultsHeader } from '../../components/ui'
import { INPUT_LABEL_CLS, LABEL_CLS } from '../../components/ui'

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

function RandomPassword(): React.JSX.Element {
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
    [t, message]
  )

  const handleCopyAll = useCallback(async () => {
    if (!passwords.length) return
    try {
      await navigator.clipboard.writeText(passwords.join('\n'))
      message.success(t('copiedAll'))
    } catch {
      message.error(t('copyFailed'))
    }
  }, [passwords, t, message])

  const allDisabled = !sets.some((s) => s.active)

  return (
    <div className="flex flex-col min-h-0 p-6">
      {/* Sticky zone: controls + results header */}
      <div className="sticky top-0 z-10 bg-[var(--content-bg)]">
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
        <Btn
          variant="primary"
          size="md"
          block
          icon={<ReloadOutlined />}
          onClick={handleGenerate}
          disabled={allDisabled}
        >
          {t('generate')}
        </Btn>

        {/* Results header (pinned below generate, above rows) */}
        {passwords.length > 0 && (
          <ResultsHeader count={passwords.length} onCopyAll={handleCopyAll} />
        )}
      </div>

      {/* Results rows (scroll under sticky zone) */}
      {passwords.length > 0 && (
        <ResultList
          items={passwords}
          copiedIdx={copiedIdx}
          onCopy={handleCopy}
          className="-mt-[1px]"
        />
      )}

      {/* Empty state */}
      {passwords.length === 0 && <EmptyState className="mt-8" hint={t('clickGenerate')} />}
    </div>
  )
}

export default RandomPassword
