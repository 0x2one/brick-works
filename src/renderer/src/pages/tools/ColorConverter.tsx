import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, ColorPicker } from 'antd'
import { DeleteOutlined, HistoryOutlined } from '@ant-design/icons'
import type { Color } from 'antd/es/color-picker'
import { useTheme } from '../../theme/useTheme'
import { CopyButton, Panel } from '../../components/ui'

const HISTORY_KEY = 'color-converter-history'
const HISTORY_MAX = 10

interface Rgb {
  r: number
  g: number
  b: number
}

// ── Parsers ──

function parseHex(input: string): Rgb | null {
  let s = input.trim().replace(/^#/, '')
  if (s.length === 3 || s.length === 4) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (s.length === 8) s = s.slice(0, 6) // drop alpha
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16)
  }
}

function parseRgb(input: string): Rgb | null {
  const s = input.trim()
  const m = s.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+)?\s*\)$/i
  )
  if (!m) return null
  const r = Number(m[1])
  const g = Number(m[2])
  const b = Number(m[3])
  if (r > 255 || g > 255 || b > 255) return null
  return { r, g, b }
}

function parseHsl(input: string): Rgb | null {
  const s = input.trim()
  const m = s.match(
    /^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*[,/]\s*[\d.]+)?\s*\)$/i
  )
  if (!m) return null
  return hslToRgb(
    norm360(Number(m[1])),
    clamp(Number(m[2]) / 100, 0, 1),
    clamp(Number(m[3]) / 100, 0, 1)
  )
}

function parseHsv(input: string): Rgb | null {
  const s = input.trim()
  const m = s.match(
    /^hsva?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*[,/]\s*[\d.]+)?\s*\)$/i
  )
  if (!m) return null
  return hsvToRgb(
    norm360(Number(m[1])),
    clamp(Number(m[2]) / 100, 0, 1),
    clamp(Number(m[3]) / 100, 0, 1)
  )
}

function parseCmyk(input: string): Rgb | null {
  const s = input.trim()
  const m = s.match(/^cmyk\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i)
  if (!m) return null
  return cmykToRgb(
    clamp(Number(m[1]) / 100, 0, 1),
    clamp(Number(m[2]) / 100, 0, 1),
    clamp(Number(m[3]) / 100, 0, 1),
    clamp(Number(m[4]) / 100, 0, 1)
  )
}

// ── Converters ──

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function norm360(h: number): number {
  return ((h % 360) + 360) % 360
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return {
    r: Math.round(hue2rgb(h / 360 + 1 / 3) * 255),
    g: Math.round(hue2rgb(h / 360) * 255),
    b: Math.round(hue2rgb(h / 360 - 1 / 3) * 255)
  }
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const i = Math.floor(h / 60) % 6
  const f = h / 60 - Math.floor(h / 60)
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  const table = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q]
  ]
  const [r, g, b] = table[i]
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  }
}

function cmykToRgb(c: number, m: number, y: number, k: number): Rgb {
  return {
    r: Math.round(255 * (1 - c) * (1 - k)),
    g: Math.round(255 * (1 - m) * (1 - k)),
    b: Math.round(255 * (1 - y) * (1 - k))
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h = Math.round(h * 60)
  if (h < 0) h += 360
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function rgbToHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h: Math.round(h), s: Math.round(s * 100), v: Math.round(max * 100) }
}

function rgbToCmyk({ r, g, b }: Rgb): { c: number; m: number; y: number; k: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const k = 1 - Math.max(rn, gn, bn)
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 }
  return {
    c: Math.round(((1 - rn - k) / (1 - k)) * 100),
    m: Math.round(((1 - gn - k) / (1 - k)) * 100),
    y: Math.round(((1 - bn - k) / (1 - k)) * 100),
    k: Math.round(k * 100)
  }
}

// ── History ──

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr
      .filter((v): v is string => typeof v === 'string' && !!parseHex(v))
      .slice(0, HISTORY_MAX)
  } catch {
    return []
  }
}

function saveHistory(list: string[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
}

function ColorConverter(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { resolved: themeResolved } = useTheme()

  const [rgb, setRgb] = useState<Rgb>({ r: 200, g: 103, b: 75 }) // terracotta
  const [inputs, setInputs] = useState({
    hex: '#C8674B',
    rgb: 'rgb(200, 103, 75)',
    hsl: 'hsl(13, 53%, 54%)',
    hsv: 'hsv(13, 63%, 78%)',
    cmyk: 'cmyk(0%, 49%, 63%, 22%)'
  })
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const pendingApply = useRef(false)
  const rgbRef = useRef<Rgb>({ r: 200, g: 103, b: 75 })

  const syncInputs = useCallback((next: Rgb): void => {
    const hsl = rgbToHsl(next)
    const hsv = rgbToHsv(next)
    const cmyk = rgbToCmyk(next)
    setInputs({
      hex: rgbToHex(next),
      rgb: `rgb(${next.r}, ${next.g}, ${next.b})`,
      hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      hsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
      cmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`
    })
  }, [])

  const apply = useCallback(
    (next: Rgb, recordHistory = true): void => {
      const rr = {
        r: Math.round(clamp(next.r, 0, 255)),
        g: Math.round(clamp(next.g, 0, 255)),
        b: Math.round(clamp(next.b, 0, 255))
      }
      rgbRef.current = rr
      setRgb(rr)
      syncInputs(rr)
      if (recordHistory) {
        setHistory((prev) => {
          const hex = rgbToHex(rr)
          const nextList = [hex, ...prev.filter((h) => h !== hex)].slice(0, HISTORY_MAX)
          saveHistory(nextList)
          return nextList
        })
      }
    },
    [syncInputs]
  )

  const handleFormatInput = useCallback(
    (format: keyof typeof inputs, value: string): void => {
      setInputs((prev) => ({ ...prev, [format]: value }))
      pendingApply.current = true
      const parse = {
        hex: parseHex,
        rgb: parseRgb,
        hsl: parseHsl,
        hsv: parseHsv,
        cmyk: parseCmyk
      }[format]
      const parsed = parse(value)
      if (parsed) {
        apply(parsed, false)
      }
    },
    [apply]
  )

  const handlePickerChange = useCallback(
    (color: Color): void => {
      const c = color.toRgb()
      apply({ r: c.r, g: c.g, b: c.b }, false)
    },
    [apply]
  )

  const handlePickerClose = useCallback(() => {
    // Only record into recent colors once the picker panel is closed
    setHistory((prev) => {
      const hex = rgbToHex(rgbRef.current)
      const nextList = [hex, ...prev.filter((h) => h !== hex)].slice(0, HISTORY_MAX)
      saveHistory(nextList)
      return nextList
    })
  }, [])

  const handleCopy = useCallback(
    async (key: string, value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        message.success(t('copied'))
        setCopiedKey(key)
        window.setTimeout(() => setCopiedKey(null), 1500)
      } catch {
        message.error(t('copyFailed'))
      }
    },
    [t, message]
  )

  const handleClearHistory = useCallback(() => {
    setHistory([])
    saveHistory([])
  }, [])

  useEffect(() => {
    if (!pendingApply.current) {
      syncInputs(rgb)
    }
    pendingApply.current = false
  }, [rgb, syncInputs])

  const swatchText = themeResolved === 'dark' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)'

  const formatRows: Array<{
    key: keyof typeof inputs
    labelKey: string
  }> = [
    { key: 'hex', labelKey: 'colorHex' },
    { key: 'rgb', labelKey: 'colorRgb' },
    { key: 'hsl', labelKey: 'colorHsl' },
    { key: 'hsv', labelKey: 'colorHsv' },
    { key: 'cmyk', labelKey: 'colorCmyk' }
  ]

  return (
    <div className="flex flex-col p-6 flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {/* Picker + preview */}
        <Panel title={t('colorPicker')}>
          <div className="flex items-center gap-4 flex-wrap">
            <ColorPicker
              value={rgbToHex(rgb)}
              onChange={handlePickerChange}
              onOpenChange={(open) => {
                if (!open) handlePickerClose()
              }}
              size="large"
              showText
            />
            <div
              className="flex-1 min-w-[200px] h-16 rounded-lg border border-[var(--border-subtle)] flex items-center px-4"
              style={{ background: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`, color: swatchText }}
            >
              <span className="font-mono text-sm select-all">{rgbToHex(rgb)}</span>
            </div>
          </div>
        </Panel>

        {/* Format rows */}
        <Panel title={t('colorFormats')}>
          <div className="space-y-3">
            {formatRows.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs font-medium text-[var(--text-secondary)]">
                  {t(row.labelKey)}
                </span>
                <input
                  value={inputs[row.key]}
                  onChange={(e) => handleFormatInput(row.key, e.target.value)}
                  spellCheck={false}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-[var(--border-subtle)]
                    bg-[var(--bg-warm)] text-[var(--text-primary)] font-mono text-sm
                    outline-none focus:border-[var(--accent)] transition-colors duration-150"
                />
                <CopyButton
                  copied={copiedKey === row.key}
                  onCopy={() => handleCopy(row.key, inputs[row.key])}
                  title={t('copy')}
                />
              </div>
            ))}
          </div>
        </Panel>

        {/* History */}
        <Panel
          title={
            <span className="flex items-center gap-1.5">
              <HistoryOutlined style={{ fontSize: 13 }} />
              {t('colorHistory')}
            </span>
          }
          actions={
            <button
              onClick={handleClearHistory}
              disabled={history.length === 0}
              className="text-[11px] font-semibold uppercase tracking-widest text-[var(--accent)]
                hover:brightness-110 transition-all duration-150 cursor-pointer border-none bg-transparent
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <DeleteOutlined style={{ fontSize: 11 }} />
              {t('colorClearHistory')}
            </button>
          }
        >
          {history.length === 0 ? (
            <div className="h-9 border-2 border-dashed border-[var(--border-subtle)] rounded-lg flex items-center justify-center">
              <p className="text-xs text-[var(--text-secondary)] opacity-60 italic">
                {t('colorHistoryEmpty')}
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {history.map((hex) => {
                const parsed = parseHex(hex)
                if (!parsed) return null
                return (
                  <button
                    key={hex}
                    onClick={() => apply(parsed)}
                    title={hex}
                    className="w-9 h-9 rounded-lg border border-[var(--border-subtle)] cursor-pointer
                      hover:scale-110 transition-transform duration-100"
                    style={{ background: hex }}
                  />
                )
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

export default ColorConverter
