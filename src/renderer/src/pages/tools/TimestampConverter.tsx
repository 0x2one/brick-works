import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Select, Tooltip } from 'antd'
import { ClockCircleOutlined, CloseOutlined } from '@ant-design/icons'
import { Btn, CopyButton, Panel, Segmented, PANEL_HEADER_CLS } from '../../components/ui'

const ALL_TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
})()

const PRESET_CLOCK_ZONES = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/London']

function nowInTimezone(tz: string): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now)
  const m: Record<string, string> = {}
  for (const p of parts) m[p.type] = p.value
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`
}

function parseDateTimeText(input: string): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
} | null {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m)
    return {
      year: +m[1],
      month: +m[2],
      day: +m[3],
      hour: +m[4],
      minute: +m[5],
      second: +(m[6] ?? '00')
    }
  const d = input.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (d) return { year: +d[1], month: +d[2], day: +d[3], hour: 0, minute: 0, second: 0 }
  return null
}

function getTzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    timeZoneName: 'longOffset'
  }).formatToParts(date)
  const off = parts.find((p) => p.type === 'timeZoneName')?.value
  if (!off) return 0
  const match = off.match(/GMT([+-])(\d+)(?::(\d+))?/)
  if (!match) return 0
  const sign = match[1] === '+' ? 1 : -1
  const h = parseInt(match[2])
  const min = match[3] ? parseInt(match[3]) : 0
  return sign * (h * 60 + min) * 60 * 1000
}

function formatClockTime(
  date: Date,
  tz: string,
  locale: string
): { time: string; dateStr: string } {
  const tf = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const df = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    month: '2-digit',
    day: '2-digit'
  })
  return { time: tf.format(date), dateStr: df.format(date) }
}

function formatTimestamp(ts: number, tz: string): string {
  const d = new Date(ts)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d)
  const m: Record<string, string> = {}
  for (const p of parts) m[p.type] = p.value
  const base = `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`
  const ms = d.getMilliseconds()
  return ms > 0 ? `${base}.${String(ms).padStart(3, '0')}` : base
}

function tzOffsetSuffix(tz: string): string {
  if (tz === 'UTC') return ''
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    timeZoneName: 'longOffset'
  }).formatToParts(Date.now())
  const off = parts.find((p) => p.type === 'timeZoneName')?.value
  if (!off) return ''
  return off.replace('GMT', 'UTC')
}

function tzDisplayName(zone: string): string {
  if (zone === 'UTC') return 'UTC'
  const parts = zone.split('/')
  const name = parts.join(' / ')
  const offset = tzOffsetSuffix(zone)
  return offset ? `${name} (${offset})` : name
}

const TZ_OPTIONS = ALL_TIMEZONES.map((z) => ({ value: z, label: tzDisplayName(z) }))

function TimestampConverter(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { message } = App.useApp()
  const locale = i18n.language === 'zh' ? 'zh-CN' : 'en-US'
  const localTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  // ── Mode ──
  const [mode, setMode] = useState<'time-to-ts' | 'ts-to-time'>('time-to-ts')

  // ── World Clocks ──
  const [clocks, setClocks] = useState<string[]>(() => [
    localTimezone,
    ...PRESET_CLOCK_ZONES.filter((z) => z !== localTimezone)
  ])
  const [clockNow, setClockNow] = useState<number>(() => Date.now())
  const clockTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    clockTimer.current = setInterval(() => setClockNow(Date.now()), 1000)
    return () => {
      if (clockTimer.current) clearInterval(clockTimer.current)
    }
  }, [])

  const addableTimezones = useMemo(() => ALL_TIMEZONES.filter((z) => !clocks.includes(z)), [clocks])

  const handleAddClock = useCallback((zone: string) => {
    setClocks((prev) => [...prev, zone])
  }, [])

  const handleRemoveClock = useCallback((zone: string) => {
    setClocks((prev) => prev.filter((z) => z !== zone))
  }, [])

  // ── Time → Timestamp ──
  const [dateTimeText, setDateTimeText] = useState(() => nowInTimezone(localTimezone))
  const [tsTz, setTsTz] = useState(localTimezone)

  const timestampResult = useMemo(() => {
    const parts = parseDateTimeText(dateTimeText)
    if (!parts) return null
    const { year, month, day, hour, minute, second } = parts
    const padded = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}Z`
    const d = new Date(padded)
    if (isNaN(d.getTime())) return null
    const offset = getTzOffsetMs(d, tsTz)
    const ms = d.getTime() - offset
    return { ms, s: Math.floor(ms / 1000) }
  }, [dateTimeText, tsTz])

  const handleTsNow = useCallback(() => {
    setDateTimeText(nowInTimezone(tsTz))
  }, [tsTz])

  // ── Timestamp → Time ──
  const [tsInput, setTsInput] = useState('')
  const [tsUnit, setTsUnit] = useState<'s' | 'ms'>('s')
  const [timeTz, setTimeTz] = useState(localTimezone)

  const timeResult = useMemo(() => {
    if (!tsInput.trim()) return ''
    const num = Number(tsInput.trim())
    if (isNaN(num)) return ''
    const ms = tsUnit === 's' ? num * 1000 : num
    return formatTimestamp(ms, timeTz)
  }, [tsInput, tsUnit, timeTz])

  const handleTsTimestampNow = useCallback(() => {
    const now = tsUnit === 'ms' ? Date.now() : Math.floor(Date.now() / 1000)
    setTsInput(String(now))
  }, [tsUnit])

  // ── Copy ──
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const handleCopy = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        message.success(t('copied'))
        setCopiedKey(key)
        window.setTimeout(() => setCopiedKey(null), 1500)
      } catch {
        message.error(t('copyFailed'))
      }
    },
    [t, message]
  )

  return (
    <div className="flex flex-col p-6 flex-1 min-h-0">
      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
        {/* ── World Clocks ── */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <ClockCircleOutlined style={{ fontSize: 13, color: 'var(--text-secondary)' }} />
              <span className={PANEL_HEADER_CLS}>{t('timestampWorldClocks')}</span>
            </div>
            <Select
              value={undefined}
              placeholder={<span className="text-xs">+ {t('timestampAddClock')}</span>}
              style={{ width: 140 }}
              showSearch
              variant="borderless"
              onChange={handleAddClock}
              options={addableTimezones.map((z) => ({ value: z, label: tzDisplayName(z) }))}
              labelRender={({ label }) => <span className="text-xs">{label as string}</span>}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
              }
              className="!text-xs"
              popupMatchSelectWidth={false}
            />
          </div>
          <div className="flex gap-2.5 flex-wrap">
            {clocks.map((zone) => {
              const { time, dateStr } = formatClockTime(new Date(clockNow), zone, locale)
              const isLocal = zone === localTimezone
              return (
                <div
                  key={zone}
                  className="relative min-w-[120px] flex-1 max-w-[160px] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
                >
                  {!isLocal && zone !== 'UTC' && (
                    <button
                      onClick={() => handleRemoveClock(zone)}
                      className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center rounded-full
                        text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                        hover:bg-[var(--border-subtle)] cursor-pointer border-none bg-transparent text-[9px]"
                    >
                      <CloseOutlined style={{ fontSize: 8 }} />
                    </button>
                  )}
                  <div className="text-[10px] font-medium text-[var(--text-secondary)] mb-1 truncate pr-3">
                    {isLocal ? t('timestampLocal') : tzDisplayName(zone)}
                  </div>
                  <div className="text-[9px] text-[var(--text-secondary)] mb-1">
                    {zone === 'UTC' ? 'UTC' : tzOffsetSuffix(zone)}
                  </div>
                  <div className="text-lg font-semibold text-[var(--text-primary)] tabular-nums leading-tight">
                    {time}
                  </div>
                  <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">{dateStr}</div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Mode Switch ── */}
        <section>
          <div className="mb-3">
            <Segmented
              size="md"
              options={[
                { value: 'time-to-ts', label: t('timestampModeTimeToTs') },
                { value: 'ts-to-time', label: t('timestampModeTsToTime') }
              ]}
              value={mode}
              onChange={(v) => setMode(v)}
              className="w-fit"
            />
          </div>

          {/* ── Time → Timestamp Panel ── */}
          {mode === 'time-to-ts' && (
            <Panel>
              <div className="grid grid-cols-[1fr_240px] gap-3 mb-4">
                <div>
                  <div className={PANEL_HEADER_CLS + ' mb-1'}>{t('timestampDateTime')}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={dateTimeText}
                      onChange={(e) => setDateTimeText(e.target.value)}
                      placeholder={t('timestampPlaceholder')}
                      spellCheck={false}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)]
                        bg-[var(--surface)] text-[var(--text-primary)]
                        text-sm outline-none focus:border-[var(--accent)] transition-colors duration-150"
                    />
                    <Tooltip title={t('timestampNow')}>
                      <Btn variant="primary" size="sm" onClick={handleTsNow} className="!px-2.5">
                        {t('timestampNow')}
                      </Btn>
                    </Tooltip>
                  </div>
                </div>
                <div>
                  <div className={PANEL_HEADER_CLS + ' mb-1'}>{t('timestampTimezone')}</div>
                  <Select
                    value={tsTz}
                    onChange={setTsTz}
                    showSearch
                    style={{ width: '100%' }}
                    options={TZ_OPTIONS}
                    filterOption={(input, option) =>
                      (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ??
                      false
                    }
                    className="text-xs"
                    popupMatchSelectWidth={false}
                  />
                </div>
              </div>

              <div className={PANEL_HEADER_CLS + ' mb-1'}>{t('timestampResult')}</div>
              {timestampResult ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)] w-14">
                      {t('timestampSeconds')}
                    </span>
                    <code className="flex-1 px-3 py-1.5 rounded-md bg-[var(--bg-warm)] text-sm font-mono text-[var(--text-primary)] break-all">
                      {timestampResult.s.toLocaleString()}
                    </code>
                    <CopyButton
                      copied={copiedKey === 's'}
                      onCopy={() => handleCopy('s', String(timestampResult.s))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-secondary)] w-14">
                      {t('timestampMilliseconds')}
                    </span>
                    <code className="flex-1 px-3 py-1.5 rounded-md bg-[var(--bg-warm)] text-sm font-mono text-[var(--text-primary)] break-all">
                      {timestampResult.ms.toLocaleString()}
                    </code>
                    <CopyButton
                      copied={copiedKey === 'ms'}
                      onCopy={() => handleCopy('ms', String(timestampResult.ms))}
                    />
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[var(--text-secondary)] italic">
                  {t('timestampNoResult')}
                </div>
              )}
            </Panel>
          )}

          {/* ── Timestamp → Time Panel ── */}
          {mode === 'ts-to-time' && (
            <Panel>
              <div className="grid grid-cols-[1fr_120px_240px] gap-3 mb-4">
                <div>
                  <div className={PANEL_HEADER_CLS + ' mb-1'}>{t('timestampUnixTimestamp')}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={tsInput}
                      onChange={(e) => setTsInput(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="1722345678"
                      spellCheck={false}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)]
                        bg-[var(--surface)] text-[var(--text-primary)]
                        font-mono text-sm outline-none focus:border-[var(--accent)] transition-colors duration-150"
                    />
                    <Tooltip title={t('timestampNow')}>
                      <Btn
                        variant="primary"
                        size="sm"
                        onClick={handleTsTimestampNow}
                        className="!px-2.5"
                      >
                        {t('timestampNow')}
                      </Btn>
                    </Tooltip>
                  </div>
                </div>
                <div>
                  <div className={PANEL_HEADER_CLS + ' mb-1'}>{t('timestampUnit')}</div>
                  <Segmented
                    options={[
                      { value: 's', label: t('timestampSeconds') },
                      { value: 'ms', label: 'ms' }
                    ]}
                    value={tsUnit}
                    onChange={(v) => setTsUnit(v)}
                    stretch
                  />
                </div>
                <div>
                  <div className={PANEL_HEADER_CLS + ' mb-1'}>{t('timestampTimezone')}</div>
                  <Select
                    value={timeTz}
                    onChange={setTimeTz}
                    showSearch
                    style={{ width: '100%' }}
                    options={TZ_OPTIONS}
                    filterOption={(input, option) =>
                      (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ??
                      false
                    }
                    className="text-xs"
                    popupMatchSelectWidth={false}
                  />
                </div>
              </div>

              <div className={PANEL_HEADER_CLS + ' mb-1'}>{t('timestampResult')}</div>
              {timeResult ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded-md bg-[var(--bg-warm)] text-sm font-mono text-[var(--text-primary)]">
                    {timeResult}
                  </code>
                  <CopyButton
                    copied={copiedKey === 'time'}
                    onCopy={() => handleCopy('time', timeResult)}
                  />
                </div>
              ) : (
                <div className="text-xs text-[var(--text-secondary)] italic">
                  {t('timestampNoResult')}
                </div>
              )}
            </Panel>
          )}
        </section>
      </div>
    </div>
  )
}

export default TimestampConverter
