import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import {
  SnippetsOutlined,
  DeleteOutlined,
  TagOutlined,
  FileTextOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'

const PANEL_HEADER_CLS = 'text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]'
const COPY_BTN_CLS =
  'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ' +
  'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] ' +
  'transition-all duration-150 cursor-pointer border-none bg-transparent'

interface ParsedJwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
}

const CLAIM_META: Array<{ key: string; labelKey: string; time?: boolean }> = [
  { key: 'iss', labelKey: 'jwtClaimIss' },
  { key: 'sub', labelKey: 'jwtClaimSub' },
  { key: 'aud', labelKey: 'jwtClaimAud' },
  { key: 'iat', labelKey: 'jwtClaimIat', time: true },
  { key: 'nbf', labelKey: 'jwtClaimNbf', time: true },
  { key: 'exp', labelKey: 'jwtClaimExp', time: true },
  { key: 'jti', labelKey: 'jwtClaimJti' }
]

function base64UrlToUtf8(seg: string): string | null {
  try {
    const base64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function parseJwt(token: string): ParsedJwt | null {
  if (!token.trim()) return null
  const parts = token.trim().split('.')
  if (parts.length < 2 || parts.length > 3) return null
  const headerJson = base64UrlToUtf8(parts[0])
  const payloadJson = base64UrlToUtf8(parts[1])
  if (!headerJson || !payloadJson) return null
  try {
    const header: unknown = JSON.parse(headerJson)
    const payload: unknown = JSON.parse(payloadJson)
    if (typeof header !== 'object' || header === null || Array.isArray(header)) return null
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
    return {
      header: header as Record<string, unknown>,
      payload: payload as Record<string, unknown>,
      signature: parts[2] ?? ''
    }
  } catch {
    return null
  }
}

function base64UrlToHex(seg: string): string {
  try {
    const base64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
  } catch {
    return ''
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (days) return `${days}d ${hours}h ${mins}m`
  if (hours) return `${hours}h ${mins}m`
  if (mins) return `${mins}m ${secs}s`
  return `${secs}s`
}

function formatDateTime(ts: number, locale: string): string {
  return new Date(ts * 1000).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: false
  })
}

function JsonSection({
  title,
  icon,
  json,
  onCopy
}: {
  title: string
  icon: ReactNode
  json: string
  onCopy: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[var(--text-secondary)] text-xs">{icon}</span>
        <span className="text-xs font-semibold text-[var(--text-primary)]">{title}</span>
        <div className="flex-1" />
        <button onClick={onCopy} className={COPY_BTN_CLS}>
          <SnippetsOutlined style={{ fontSize: 11 }} />
          {t('copy')}
        </button>
      </div>
      <pre
        className="m-0 p-3 rounded-md bg-black/[0.03] dark:bg-black/25 border border-[var(--border-subtle)]
        font-mono text-xs leading-relaxed overflow-auto max-h-56 select-all"
      >
        {json}
      </pre>
    </section>
  )
}

function JwtDecoder(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { message } = App.useApp()
  const [input, setInput] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const parsed = useMemo(() => parseJwt(input), [input])

  useEffect(() => {
    if (!parsed) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [parsed])

  const statusKind = useMemo(() => {
    if (!parsed) return null
    const nowSec = now / 1000
    const exp = typeof parsed.payload.exp === 'number' ? parsed.payload.exp : null
    const nbf = typeof parsed.payload.nbf === 'number' ? parsed.payload.nbf : null
    if (exp !== null && nowSec > exp) return 'expired'
    if (nbf !== null && nowSec < nbf) return 'notYetValid'
    return 'valid'
  }, [parsed, now])

  const hexSignature = useMemo(
    () => (parsed?.signature ? base64UrlToHex(parsed.signature) : ''),
    [parsed]
  )

  const copyText = useCallback(
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

  const claimRows = useMemo(() => {
    if (!parsed) return []
    const { payload } = parsed
    const locale = i18n.language
    const rows: Array<{ key: string; label: string; value: ReactNode; extra?: ReactNode }> = []
    for (const meta of CLAIM_META) {
      if (!(meta.key in payload)) continue
      const raw = payload[meta.key]
      let display: ReactNode = '—'
      if (typeof raw === 'string') display = raw
      else if (raw !== null && raw !== undefined) display = JSON.stringify(raw)
      let extra: ReactNode = null
      if (meta.time && typeof raw === 'number') {
        display = formatDateTime(raw, locale)
        if (meta.key === 'exp') {
          extra =
            now > raw * 1000
              ? t('jwtExpiredAgo', { time: formatDuration(now - raw * 1000) })
              : t('jwtExpiresIn', { time: formatDuration(raw * 1000 - now) })
        } else if (meta.key === 'nbf' && now < raw * 1000) {
          extra = t('jwtEffectiveIn', { time: formatDuration(raw * 1000 - now) })
        }
      }
      rows.push({ key: meta.key, label: t(meta.labelKey), value: display, extra })
    }
    return rows
  }, [parsed, t, i18n.language, now])

  const statusBadge = (() => {
    if (statusKind === 'expired')
      return (
        <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
          <CloseCircleOutlined />
          {t('jwtExpired')}
        </span>
      )
    if (statusKind === 'notYetValid')
      return (
        <span className="flex items-center gap-1 text-xs text-amber-500 font-medium">
          <ClockCircleOutlined />
          {t('jwtNotYetValid')}
        </span>
      )
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
        <CheckCircleOutlined />
        {t('jwtValid')}
      </span>
    )
  })()

  const inputStats = input ? `${input.length} chars · ${input.split('\n').length} lines` : ''

  return (
    <div className="flex flex-col p-6 flex-1 min-h-0">
      <div className="sticky top-0 z-10 bg-[var(--content-bg)] pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setInput('')}
            disabled={!input.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5
              transition-all duration-150 cursor-pointer border-none
              bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
              hover:bg-[var(--border-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <DeleteOutlined />
            {t('jwtClear')}
          </button>
          {parsed && (
            <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
              <SafetyCertificateOutlined />
              {t('jwtValid')}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-3">
        {/* Input panel */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-1.5 h-7">
            <span className={PANEL_HEADER_CLS}>{t('jwtInput')}</span>
            <span className="text-xs text-[var(--text-secondary)]">{inputStats}</span>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('jwtInputPlaceholder')}
            spellCheck={false}
            className="flex-1 w-full px-4 py-3 rounded-lg border border-[var(--border-subtle)]
              bg-white dark:bg-[var(--surface)] text-[var(--text-primary)]
              font-mono text-sm leading-relaxed outline-none resize-none
              focus:border-[var(--accent)] transition-colors duration-150"
          />
        </div>

        {/* Result panel */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-1.5 h-7">
            <span className={PANEL_HEADER_CLS}>{t('jwtResult')}</span>
          </div>
          {parsed ? (
            <div
              className="flex-1 min-h-0 overflow-auto rounded-lg border border-[var(--border-subtle)]
              bg-white dark:bg-[var(--surface)] px-4 py-3 flex flex-col gap-5"
            >
              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[var(--text-secondary)] text-xs">{t('jwtAlg')}</span>
                <span className="px-2 py-0.5 rounded-md bg-[var(--border-subtle)] text-xs font-mono">
                  {String(parsed.header.alg ?? '-')}
                </span>
                <span className="w-px h-4 bg-[var(--border-subtle)]" />
                <span className="text-[var(--text-secondary)] text-xs">{t('jwtType')}</span>
                <span className="px-2 py-0.5 rounded-md bg-[var(--border-subtle)] text-xs font-mono">
                  {String(parsed.header.typ ?? '-')}
                </span>
                <span className="w-px h-4 bg-[var(--border-subtle)]" />
                <span className="text-[var(--text-secondary)] text-xs">{t('jwtStatus')}</span>
                {statusBadge}
              </div>

              {/* Claims */}
              {claimRows.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[var(--text-secondary)] text-xs">
                      <ClockCircleOutlined style={{ fontSize: 12 }} />
                    </span>
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {t('jwtClaims')}
                    </span>
                  </div>
                  <div
                    className="rounded-md border border-[var(--border-subtle)] overflow-hidden
                    divide-y divide-[var(--border-subtle)]"
                  >
                    {claimRows.map((row) => (
                      <div key={row.key} className="flex items-start gap-3 px-3 py-1.5">
                        <span className="w-24 shrink-0 font-mono text-[11px] text-[var(--accent)] pt-0.5">
                          {row.key}
                        </span>
                        <div className="min-w-0 flex-1 text-xs text-[var(--text-primary)] break-all">
                          <div>{row.value}</div>
                          {row.extra && (
                            <div className="text-[var(--text-secondary)] text-[11px] mt-0.5">
                              {row.extra}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Header */}
              <JsonSection
                title={t('jwtHeader')}
                icon={<TagOutlined style={{ fontSize: 12 }} />}
                json={JSON.stringify(parsed.header, null, 2)}
                onCopy={() => copyText(JSON.stringify(parsed.header, null, 2))}
              />

              {/* Payload */}
              <JsonSection
                title={t('jwtPayload')}
                icon={<FileTextOutlined style={{ fontSize: 12 }} />}
                json={JSON.stringify(parsed.payload, null, 2)}
                onCopy={() => copyText(JSON.stringify(parsed.payload, null, 2))}
              />

              {/* Signature */}
              <section>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[var(--text-secondary)] text-xs">
                    <KeyOutlined style={{ fontSize: 12 }} />
                  </span>
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {t('jwtSignature')}
                  </span>
                  <div className="flex-1" />
                  {parsed.signature && (
                    <button onClick={() => copyText(parsed.signature)} className={COPY_BTN_CLS}>
                      <SnippetsOutlined style={{ fontSize: 11 }} />
                      {t('copy')}
                    </button>
                  )}
                </div>
                <div
                  className="rounded-md bg-black/[0.03] dark:bg-black/25 border border-[var(--border-subtle)]
                  px-3 py-2 font-mono text-xs break-all select-all"
                >
                  {hexSignature || parsed.signature}
                </div>
              </section>
            </div>
          ) : (
            <div
              className="flex-1 flex items-center justify-center rounded-lg border border-dashed
              border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] px-4"
            >
              {input.trim() ? t('jwtInvalid') : t('jwtNoResult')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default JwtDecoder
