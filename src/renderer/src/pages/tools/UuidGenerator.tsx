import { useState, useCallback, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { App, InputNumber, Select } from 'antd'
import { SnippetsOutlined, ReloadOutlined, CheckOutlined } from '@ant-design/icons'

const PANEL_HEADER_CLS = 'text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]'
const INPUT_LABEL_CLS = 'block text-xs font-medium text-[var(--text-secondary)] mb-1.5'

type Mode = 'uuid' | 'snowflake' | 'nanoid' | 'parse'

const MODES: Array<{ key: Mode; labelKey: string }> = [
  { key: 'uuid', labelKey: 'uuidGenModeUuid' },
  { key: 'snowflake', labelKey: 'uuidGenModeSnowflake' },
  { key: 'nanoid', labelKey: 'uuidGenModeNanoid' },
  { key: 'parse', labelKey: 'uuidGenModeParse' }
]

// ── Snowflake ──
const SNOWFLAKE_EPOCH = 1288834974657n // Twitter epoch (2010-11-04 01:42:54.657 UTC)
const MACHINE_BITS = 10
const SEQUENCE_BITS = 12

function generateSnowflakes(count: number, machineId: number, sequence: number): string[] {
  const now = BigInt(Date.now())
  const out: string[] = []
  let seq = sequence
  for (let n = 0; n < count; n++) {
    const id =
      ((now - SNOWFLAKE_EPOCH) << BigInt(MACHINE_BITS + SEQUENCE_BITS)) |
      (BigInt(machineId) << BigInt(SEQUENCE_BITS)) |
      BigInt(seq)
    out.push(id.toString())
    seq = (seq + 1) % (1 << SEQUENCE_BITS)
  }
  return out
}

interface ParsedSnowflake {
  decimal: bigint
  binary: string
  timestampRaw: bigint
  timestampMs: number
  utc: string
  local: string
  machineId: number
  datacenterId: number
  workerId: number
  sequence: number
}

function formatDateTime(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(ms))
  const m: Record<string, string> = {}
  for (const p of parts) m[p.type] = p.value
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`
}

function parseSnowflake(input: string): ParsedSnowflake | null {
  const s = input.trim()
  if (!/^\d+$/.test(s)) return null
  const id = BigInt(s)
  if (id >= 1n << 63n) return null
  const timestampRaw = id >> BigInt(MACHINE_BITS + SEQUENCE_BITS)
  const timestampMs = Number(timestampRaw + SNOWFLAKE_EPOCH)
  if (!Number.isFinite(timestampMs) || timestampMs < 0) return null
  const machineId = Number((id >> BigInt(SEQUENCE_BITS)) & 0x3ffn)
  return {
    decimal: id,
    binary: id.toString(2).padStart(64, '0'),
    timestampRaw,
    timestampMs,
    utc: formatDateTime(timestampMs, 'UTC'),
    local: formatDateTime(timestampMs, Intl.DateTimeFormat().resolvedOptions().timeZone),
    machineId,
    datacenterId: (machineId >> 5) & 0x1f,
    workerId: machineId & 0x1f,
    sequence: Number(id & 0xfffn)
  }
}

// ── UUID v4 ──
function generateUuid(count: number, uppercase: boolean, simple: boolean): string[] {
  const out: string[] = []
  for (let n = 0; n < count; n++) {
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40 // version 4
    b[8] = (b[8] & 0x3f) | 0x80 // variant RFC 4122
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    let u = simple
      ? hex
      : `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    if (uppercase) u = u.toUpperCase()
    out.push(u)
  }
  return out
}

// ── NanoID ──
const NANOID_PRESETS = [
  {
    key: 'url',
    labelKey: 'uuidGenAlphaUrl',
    alphabet: 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
  },
  {
    key: 'alnum',
    labelKey: 'uuidGenAlphaAlnum',
    alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  },
  { key: 'lower', labelKey: 'uuidGenAlphaLower', alphabet: 'abcdefghijklmnopqrstuvwxyz' },
  { key: 'upper', labelKey: 'uuidGenAlphaUpper', alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  { key: 'numeric', labelKey: 'uuidGenAlphaNumeric', alphabet: '0123456789' },
  { key: 'hex', labelKey: 'uuidGenAlphaHex', alphabet: '0123456789abcdef' }
] as const

type NanoidPresetKey = (typeof NANOID_PRESETS)[number]['key']

function generateNanoid(count: number, size: number, alphabet: string): string[] {
  const out: string[] = []
  for (let n = 0; n < count; n++) {
    const buf = new Uint32Array(size)
    crypto.getRandomValues(buf)
    let id = ''
    for (let i = 0; i < size; i++) id += alphabet[buf[i] % alphabet.length]
    out.push(id)
  }
  return out
}

// ── Shared UI ──
function ResultList({
  items,
  copiedIdx,
  onCopy
}: {
  items: string[]
  copiedIdx: number | null
  onCopy: (value: string, idx: number) => void
}): React.JSX.Element {
  return (
    <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden bg-[var(--surface)]">
      {items.map((value, idx) => (
        <div
          key={idx}
          onClick={() => onCopy(value, idx)}
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
            {value}
          </span>
          <span className="shrink-0 flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] opacity-30 group-hover:opacity-100 transition-all duration-150">
            {copiedIdx === idx ? (
              <CheckOutlined style={{ color: 'var(--accent)', fontSize: 13 }} />
            ) : (
              <SnippetsOutlined style={{ fontSize: 13 }} />
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function UuidGenerator({ breadcrumb }: { breadcrumb?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [mode, setMode] = useState<Mode>('uuid')

  // ── UUID ──
  const [uuidCount, setUuidCount] = useState(5)
  const [uuidUpper, setUuidUpper] = useState(false)
  const [uuidSimple, setUuidSimple] = useState(false)
  const [uuids, setUuids] = useState<string[]>([])

  // ── Snowflake ──
  const [sfMachine, setSfMachine] = useState(() => Math.floor(Math.random() * 1024))
  const [sfSequence, setSfSequence] = useState(() => Math.floor(Math.random() * 4096))
  const [sfCount, setSfCount] = useState(5)
  const [snowflakes, setSnowflakes] = useState<string[]>([])

  // ── NanoID ──
  const [nanoCount, setNanoCount] = useState(5)
  const [nanoLength, setNanoLength] = useState(21)
  const [nanoPreset, setNanoPreset] = useState<NanoidPresetKey>('url')
  const [nanoCustom, setNanoCustom] = useState('')
  const [nanoids, setNanoids] = useState<string[]>([])

  // ── Parse ──
  const [parseInput, setParseInput] = useState('')
  const [parsed, setParsed] = useState<ParsedSnowflake | null>(null)
  const [parseFailed, setParseFailed] = useState(false)

  // ── Copy ──
  const [copiedRow, setCopiedRow] = useState<number | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const handleCopyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        message.success(t('copied'))
      } catch {
        message.error(t('copyFailed'))
      }
    },
    [t, message]
  )

  const handleCopyRow = useCallback(
    (value: string, idx: number) => {
      handleCopyText(value)
      setCopiedRow(idx)
      setTimeout(() => setCopiedRow(null), 2000)
    },
    [handleCopyText]
  )

  const handleCopyField = useCallback(
    (value: string, key: string) => {
      handleCopyText(value)
      setCopiedField(key)
      setTimeout(() => setCopiedField(null), 2000)
    },
    [handleCopyText]
  )

  const handleCopyAll = useCallback(
    async (items: string[]) => {
      if (!items.length) return
      try {
        await navigator.clipboard.writeText(items.join('\n'))
        message.success(t('copiedAll'))
      } catch {
        message.error(t('copyFailed'))
      }
    },
    [t, message]
  )

  // ── Handlers ──
  const handleGenerateUuid = useCallback(() => {
    setUuids(generateUuid(uuidCount, uuidUpper, uuidSimple))
    setCopiedRow(null)
  }, [uuidCount, uuidUpper, uuidSimple])

  const handleGenerateSnowflake = useCallback(() => {
    setSnowflakes(generateSnowflakes(sfCount, sfMachine, sfSequence))
    setCopiedRow(null)
  }, [sfCount, sfMachine, sfSequence])

  const handleRandomizeSf = useCallback(() => {
    setSfMachine(Math.floor(Math.random() * 1024))
    setSfSequence(Math.floor(Math.random() * 4096))
  }, [])

  const effectiveNanoAlphabet = useMemo(
    () => nanoCustom.trim() || NANOID_PRESETS.find((p) => p.key === nanoPreset)?.alphabet || '',
    [nanoCustom, nanoPreset]
  )

  const handleGenerateNanoid = useCallback(() => {
    setNanoids(generateNanoid(nanoCount, nanoLength, effectiveNanoAlphabet))
    setCopiedRow(null)
  }, [nanoCount, nanoLength, effectiveNanoAlphabet])

  const handleParse = useCallback(() => {
    if (!parseInput.trim()) {
      setParsed(null)
      setParseFailed(false)
      return
    }
    const result = parseSnowflake(parseInput)
    setParsed(result)
    setParseFailed(!result)
  }, [parseInput])

  const segInfo = parsed
    ? [
        {
          key: 'sign',
          labelKey: 'uuidGenParseSign',
          bits: parsed.binary.slice(0, 1),
          cls: 'text-[var(--text-secondary)]',
          dot: 'bg-[var(--text-secondary)]'
        },
        {
          key: 'ts',
          labelKey: 'uuidGenParseTimestamp',
          bits: parsed.binary.slice(1, 42),
          cls: 'text-[var(--accent)]',
          dot: 'bg-[var(--accent)]'
        },
        {
          key: 'machine',
          labelKey: 'uuidGenParseWorker',
          bits: parsed.binary.slice(42, 52),
          cls: 'text-[#3b82f6]',
          dot: 'bg-[#3b82f6]'
        },
        {
          key: 'seq',
          labelKey: 'uuidGenParseSequence',
          bits: parsed.binary.slice(52, 64),
          cls: 'text-[#22c55e]',
          dot: 'bg-[#22c55e]'
        }
      ]
    : []

  const generateBtnCls = `
    w-full py-2.5 px-6 rounded-lg text-sm font-semibold
    flex items-center justify-center gap-2
    transition-all duration-150 cursor-pointer border-none
    bg-[var(--accent)] text-white
    hover:brightness-110 active:brightness-90
  `

  return (
    <div className="flex flex-col p-6" style={{ height: 'calc(100vh - 56px)' }}>
      {breadcrumb ? <div className="mb-3 shrink-0">{breadcrumb}</div> : <div className="mb-3" />}

      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
        {/* ── Mode switch ── */}
        <section>
          <div className="flex gap-1 flex-wrap">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border-none transition-all duration-100
                  ${
                    mode === m.key
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-secondary)] bg-[var(--bg-warm)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)]'
                  }`}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        </section>

        {/* ── UUID v4 ── */}
        {mode === 'uuid' && (
          <section>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] p-4">
              <div className={PANEL_HEADER_CLS + ' mb-3'}>{t('uuidGenUuidTitle')}</div>

              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div className="w-24">
                  <label className={INPUT_LABEL_CLS}>{t('count')}</label>
                  <InputNumber<number>
                    size="large"
                    min={1}
                    max={100}
                    value={uuidCount}
                    onChange={(v) => v != null && setUuidCount(v)}
                    className="!w-full"
                  />
                </div>
                <button
                  onClick={() => setUuidUpper(!uuidUpper)}
                  className={`h-10 px-4 rounded-lg text-xs font-semibold cursor-pointer border transition-all duration-100
                    flex items-center
                    ${
                      uuidUpper
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'bg-transparent text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]'
                    }`}
                >
                  {t('uuidGenUppercase')}
                </button>
                <button
                  onClick={() => setUuidSimple(!uuidSimple)}
                  className={`h-10 px-4 rounded-lg text-xs font-semibold cursor-pointer border transition-all duration-100
                    flex items-center
                    ${
                      uuidSimple
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'bg-transparent text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]'
                    }`}
                >
                  {t('uuidGenSimple')}
                </button>
              </div>

              <button onClick={handleGenerateUuid} className={generateBtnCls}>
                <ReloadOutlined />
                {t('uuidGenGenerate')}
              </button>

              {uuids.length > 0 && (
                <>
                  <div className="mt-5 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                      {t('count')} · {uuids.length}
                    </span>
                    <button
                      onClick={() => handleCopyAll(uuids)}
                      className="text-[11px] font-semibold uppercase tracking-widest text-[var(--accent)] hover:brightness-110 transition-all duration-150 cursor-pointer border-none bg-transparent"
                    >
                      {t('copyAll')}
                    </button>
                  </div>
                  <ResultList items={uuids} copiedIdx={copiedRow} onCopy={handleCopyRow} />
                </>
              )}
              {uuids.length === 0 && (
                <div className="mt-6 border-2 border-dashed border-[var(--border-subtle)] rounded-lg py-10 text-center">
                  <p className="text-sm text-[var(--text-secondary)] opacity-50 italic">
                    {t('clickGenerate')}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Snowflake ── */}
        {mode === 'snowflake' && (
          <section>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className={PANEL_HEADER_CLS}>{t('uuidGenSnowflakeTitle')}</div>
                <button
                  onClick={handleRandomizeSf}
                  className="text-[11px] font-semibold uppercase tracking-widest text-[var(--accent)] hover:brightness-110 transition-all duration-150 cursor-pointer border-none bg-transparent"
                >
                  {t('uuidGenRandom')}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className={INPUT_LABEL_CLS}>{t('uuidGenSnowflakeWorker')}</label>
                  <InputNumber<number>
                    size="large"
                    min={0}
                    max={1023}
                    value={sfMachine}
                    onChange={(v) => v != null && setSfMachine(v)}
                    className="!w-full"
                  />
                  <div className="text-[10px] text-[var(--text-secondary)] mt-1">
                    0 – 1023 (10 bit)
                  </div>
                </div>
                <div>
                  <label className={INPUT_LABEL_CLS}>{t('uuidGenSnowflakeSequence')}</label>
                  <InputNumber<number>
                    size="large"
                    min={0}
                    max={4095}
                    value={sfSequence}
                    onChange={(v) => v != null && setSfSequence(v)}
                    className="!w-full"
                  />
                  <div className="text-[10px] text-[var(--text-secondary)] mt-1">
                    0 – 4095 (12 bit)
                  </div>
                </div>
                <div>
                  <label className={INPUT_LABEL_CLS}>{t('count')}</label>
                  <InputNumber<number>
                    size="large"
                    min={1}
                    max={100}
                    value={sfCount}
                    onChange={(v) => v != null && setSfCount(v)}
                    className="!w-full"
                  />
                </div>
              </div>

              <div className="text-[11px] text-[var(--text-secondary)] mb-3">
                {t('uuidGenSnowflakeEpochNote')}
              </div>

              <button onClick={handleGenerateSnowflake} className={generateBtnCls}>
                <ReloadOutlined />
                {t('uuidGenGenerate')}
              </button>

              {snowflakes.length > 0 && (
                <>
                  <div className="mt-5 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                      {t('count')} · {snowflakes.length}
                    </span>
                    <button
                      onClick={() => handleCopyAll(snowflakes)}
                      className="text-[11px] font-semibold uppercase tracking-widest text-[var(--accent)] hover:brightness-110 transition-all duration-150 cursor-pointer border-none bg-transparent"
                    >
                      {t('copyAll')}
                    </button>
                  </div>
                  <ResultList items={snowflakes} copiedIdx={copiedRow} onCopy={handleCopyRow} />
                </>
              )}
              {snowflakes.length === 0 && (
                <div className="mt-6 border-2 border-dashed border-[var(--border-subtle)] rounded-lg py-10 text-center">
                  <p className="text-sm text-[var(--text-secondary)] opacity-50 italic">
                    {t('clickGenerate')}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── NanoID ── */}
        {mode === 'nanoid' && (
          <section>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] p-4">
              <div className={PANEL_HEADER_CLS + ' mb-3'}>{t('uuidGenNanoidTitle')}</div>

              <div className="grid grid-cols-[200px_1fr] gap-3 mb-3">
                <div>
                  <label className={INPUT_LABEL_CLS}>{t('uuidGenNanoidAlphabet')}</label>
                  <Select
                    value={nanoPreset}
                    onChange={(v) => setNanoPreset(v as NanoidPresetKey)}
                    options={NANOID_PRESETS.map((p) => ({ value: p.key, label: t(p.labelKey) }))}
                    style={{ width: '100%' }}
                    className="text-xs"
                  />
                </div>
                <div>
                  <label className={INPUT_LABEL_CLS}>{t('uuidGenNanoidCustom')}</label>
                  <input
                    type="text"
                    value={nanoCustom}
                    onChange={(e) => setNanoCustom(e.target.value)}
                    placeholder={t('uuidGenNanoidCustomHint')}
                    spellCheck={false}
                    className="w-full px-3 py-1.5 rounded-lg border border-[var(--border-subtle)]
                      bg-white dark:bg-[var(--surface)] text-[var(--text-primary)]
                      text-sm outline-none focus:border-[var(--accent)] transition-colors duration-150"
                  />
                </div>
              </div>

              <div className="flex gap-3 mb-3">
                <div className="w-24">
                  <label className={INPUT_LABEL_CLS}>{t('uuidGenNanoidLength')}</label>
                  <InputNumber<number>
                    size="large"
                    min={1}
                    max={256}
                    value={nanoLength}
                    onChange={(v) => v != null && setNanoLength(v)}
                    className="!w-full"
                  />
                </div>
                <div className="w-24">
                  <label className={INPUT_LABEL_CLS}>{t('count')}</label>
                  <InputNumber<number>
                    size="large"
                    min={1}
                    max={100}
                    value={nanoCount}
                    onChange={(v) => v != null && setNanoCount(v)}
                    className="!w-full"
                  />
                </div>
              </div>

              <div className="text-[11px] text-[var(--text-secondary)] mb-3 font-mono break-all select-all">
                {effectiveNanoAlphabet}
                <span className="opacity-60"> · {effectiveNanoAlphabet.length}</span>
              </div>

              <button onClick={handleGenerateNanoid} className={generateBtnCls}>
                <ReloadOutlined />
                {t('uuidGenGenerate')}
              </button>

              {nanoids.length > 0 && (
                <>
                  <div className="mt-5 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                      {t('count')} · {nanoids.length}
                    </span>
                    <button
                      onClick={() => handleCopyAll(nanoids)}
                      className="text-[11px] font-semibold uppercase tracking-widest text-[var(--accent)] hover:brightness-110 transition-all duration-150 cursor-pointer border-none bg-transparent"
                    >
                      {t('copyAll')}
                    </button>
                  </div>
                  <ResultList items={nanoids} copiedIdx={copiedRow} onCopy={handleCopyRow} />
                </>
              )}
              {nanoids.length === 0 && (
                <div className="mt-6 border-2 border-dashed border-[var(--border-subtle)] rounded-lg py-10 text-center">
                  <p className="text-sm text-[var(--text-secondary)] opacity-50 italic">
                    {t('clickGenerate')}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Parse ── */}
        {mode === 'parse' && (
          <section>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-white dark:bg-[var(--surface)] p-4">
              <div className={PANEL_HEADER_CLS + ' mb-3'}>{t('uuidGenModeParse')}</div>

              <div className="flex items-center gap-2 mb-4">
                <input
                  type="text"
                  value={parseInput}
                  onChange={(e) => setParseInput(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && handleParse()}
                  placeholder={t('uuidGenParsePlaceholder')}
                  spellCheck={false}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)]
                    bg-white dark:bg-[var(--surface)] text-[var(--text-primary)]
                    font-mono text-sm outline-none focus:border-[var(--accent)] transition-colors duration-150"
                />
                <button onClick={handleParse} className={generateBtnCls + ' !w-auto !px-4'}>
                  {t('uuidGenGenerate')}
                </button>
              </div>

              {parsed ? (
                <div className="space-y-3">
                  {/* Bit layout */}
                  <div>
                    <div className={PANEL_HEADER_CLS + ' mb-1.5'}>{t('uuidGenParseBits')}</div>
                    <div className="font-mono text-[11px] leading-6 bg-[var(--bg-warm)] rounded-md p-3">
                      <div className="flex flex-wrap break-all select-all">
                        {segInfo.map((seg) => (
                          <span key={seg.key} className={seg.cls + ' mr-1'}>
                            {seg.bits}
                          </span>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)]">
                        {segInfo.map((seg) => (
                          <span key={seg.key} className="flex items-center gap-1">
                            <span className={`inline-block w-2 h-2 rounded-sm ${seg.dot}`} />
                            {t(seg.labelKey)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Fields */}
                  {[
                    { key: 'sign', label: t('uuidGenParseSign'), value: '0' },
                    {
                      key: 'tsRaw',
                      label: t('uuidGenParseTimestampRaw'),
                      value: parsed.timestampRaw.toString()
                    },
                    { key: 'utc', label: t('uuidGenParseUtc'), value: parsed.utc },
                    { key: 'local', label: t('timestampLocal'), value: parsed.local },
                    {
                      key: 'machine',
                      label: t('uuidGenParseWorker'),
                      value: `${parsed.machineId}  ·  DC ${parsed.datacenterId} / Worker ${parsed.workerId}`
                    },
                    {
                      key: 'seq',
                      label: t('uuidGenParseSequence'),
                      value: String(parsed.sequence)
                    },
                    {
                      key: 'full',
                      label: t('uuidGenParseFullId'),
                      value: parsed.decimal.toString()
                    }
                  ].map((row) => (
                    <div key={row.key} className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-secondary)] w-28 shrink-0 truncate">
                        {row.label}
                      </span>
                      <code className="flex-1 px-3 py-1.5 rounded-md bg-[var(--bg-warm)] text-sm font-mono text-[var(--text-primary)] break-all min-w-0">
                        {row.value}
                      </code>
                      <button
                        onClick={() => handleCopyField(row.value, row.key)}
                        className="shrink-0 flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)]
                          hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]
                          transition-all duration-150 cursor-pointer border-none bg-transparent"
                      >
                        {copiedField === row.key ? (
                          <CheckOutlined style={{ color: 'var(--accent)', fontSize: 13 }} />
                        ) : (
                          <SnippetsOutlined style={{ fontSize: 13 }} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              ) : parseFailed ? (
                <div className="text-xs text-[#e74c3c]">{t('uuidGenParseInvalid')}</div>
              ) : (
                <div className="text-xs text-[var(--text-secondary)] italic">
                  {t('uuidGenParseNoResult')}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default UuidGenerator
