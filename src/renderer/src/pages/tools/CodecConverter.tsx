import { useState, useCallback, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import { SnippetsOutlined, DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons'

// ── Format definitions ──

interface CodecFormat {
  key: string
  labelKey: string
}

const ENCODE_FORMATS: CodecFormat[] = [
  { key: 'unicode-enc', labelKey: 'codecUnicodeEnc' },
  { key: 'url-enc', labelKey: 'codecUrlEnc' },
  { key: 'utf16-enc', labelKey: 'codecUtf16Enc' },
  { key: 'base64-enc', labelKey: 'codecBase64Enc' },
  { key: 'md5', labelKey: 'codecMd5' },
  { key: 'hex-enc', labelKey: 'codecHexEnc' },
  { key: 'sha1', labelKey: 'codecSha1' },
  { key: 'html-enc', labelKey: 'codecHtmlEnc' },
  { key: 'html-deep-enc', labelKey: 'codecHtmlDeepEnc' },
  { key: 'html-to-js', labelKey: 'codecHtmlToJs' },
  { key: 'gzip-compress', labelKey: 'codecGzipCompress' },
  { key: 'escape', labelKey: 'codecEscape' }
]

const DECODE_FORMATS: CodecFormat[] = [
  { key: 'unicode-dec', labelKey: 'codecUnicodeDec' },
  { key: 'url-dec', labelKey: 'codecUrlDec' },
  { key: 'utf16-dec', labelKey: 'codecUtf16Dec' },
  { key: 'base64-dec', labelKey: 'codecBase64Dec' },
  { key: 'hex-dec', labelKey: 'codecHexDec' },
  { key: 'proto-hex', labelKey: 'codecProtoHex' },
  { key: 'to-json', labelKey: 'codecToJson' },
  { key: 'html-dec', labelKey: 'codecHtmlDec' },
  { key: 'url-params', labelKey: 'codecUrlParams' },
  { key: 'jwt-decode', labelKey: 'codecJwtDecode' },
  { key: 'cookie', labelKey: 'codecCookie' },
  { key: 'gzip-decompress', labelKey: 'codecGzipDecompress' },
  { key: 'unescape', labelKey: 'codecUnescape' }
]

// ── Utility functions ──

async function computeHash(text: string, algo: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest(algo, data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function gzipCompress(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  await writer.write(data)
  await writer.close()
  const reader = cs.readable.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((a, c) => a + c.length, 0)
  const combined = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    combined.set(c, pos)
    pos += c.length
  }
  return btoa(String.fromCharCode(...combined))
}

async function gzipDecompress(b64: string): Promise<string> {
  const binary = atob(b64)
  const data = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
  const cs = new DecompressionStream('gzip')
  const writer = cs.writable.getWriter()
  await writer.write(data)
  await writer.close()
  const reader = cs.readable.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((a, c) => a + c.length, 0)
  const combined = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    combined.set(c, pos)
    pos += c.length
  }
  return new TextDecoder().decode(combined)
}

function htmlEntitiesEncode(text: string, deep: boolean): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }
  let r = text.replace(/[&<>"']/g, (c) => map[c])
  if (deep) r = r.replace(/[^\x20-\x7E]/g, (c) => '&#' + c.charCodeAt(0) + ';')
  return r
}

function htmlEntitiesDecode(text: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = text
  return el.value
}

function htmlToJs(text: string): string {
  return text
    .split('\n')
    .map((line) => '"' + line.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')
    .join(' +\n')
}

function unicodeEncode(s: string): string {
  return Array.from(s)
    .map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')
}

function unicodeDecode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function utf16Encode(s: string): string {
  return Array.from(s)
    .map((c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
}

function utf16Decode(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function base64Encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}

function base64Decode(s: string): string {
  return decodeURIComponent(escape(atob(s.replace(/\s/g, ''))))
}

function hexEncode(s: string): string {
  return Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexDecode(s: string): string {
  const clean = s.replace(/\s/g, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  return new TextDecoder().decode(bytes)
}

function protoHexParse(s: string): string {
  const bytes = s
    .split(/\s+/)
    .filter(Boolean)
    .map((b) => parseInt(b, 16))
  const result: string[] = []
  let i = 0
  while (i < bytes.length) {
    if (bytes[i] >= 0x20 && bytes[i] <= 0x7e) {
      result.push(String.fromCharCode(bytes[i]))
    } else {
      result.push(`[0x${bytes[i].toString(16).padStart(2, '0')}]`)
    }
    i++
  }
  return result.join('')
}

function decodeJWT(token: string): string {
  const parts = token.trim().split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT format')
  const header = JSON.parse(atob(parts[0]))
  const payload = JSON.parse(atob(parts[1]))
  return `Header:\n${JSON.stringify(header, null, 2)}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
}

function parseUrlParams(input: string): string {
  const query = input.includes('?') ? input.split('?')[1] : input
  const params = new URLSearchParams(query)
  const obj: Record<string, string> = {}
  for (const [k, v] of params) obj[k] = v
  return JSON.stringify(obj, null, 2)
}

function formatCookie(input: string): string {
  const pairs = input
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  const obj: Record<string, string> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq > 0) obj[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return JSON.stringify(obj, null, 2)
}

// ── Component ──

const PANEL_HEADER_CLS = 'text-[11px] font-semibold tracking-widest text-[var(--text-secondary)]'

function CodecConverter({ breadcrumb }: { breadcrumb?: ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [format, setFormat] = useState(ENCODE_FORMATS[0].key)
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [processing, setProcessing] = useState(false)

  const handleConvert = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    setProcessing(true)
    try {
      let result: string
      switch (format) {
        case 'unicode-enc':
          result = unicodeEncode(text)
          break
        case 'unicode-dec':
          result = unicodeDecode(text)
          break
        case 'url-enc':
          result = encodeURIComponent(text)
          break
        case 'url-dec':
          result = decodeURIComponent(text)
          break
        case 'utf16-enc':
          result = utf16Encode(text)
          break
        case 'utf16-dec':
          result = utf16Decode(text)
          break
        case 'base64-enc':
          result = base64Encode(text)
          break
        case 'base64-dec':
          result = base64Decode(text)
          break
        case 'md5':
          result = await computeHash(text, 'MD-5')
          break
        case 'sha1':
          result = await computeHash(text, 'SHA-1')
          break
        case 'hex-enc':
          result = hexEncode(text)
          break
        case 'hex-dec':
          result = hexDecode(text)
          break
        case 'proto-hex':
          result = protoHexParse(text)
          break
        case 'html-enc':
          result = htmlEntitiesEncode(text, false)
          break
        case 'html-deep-enc':
          result = htmlEntitiesEncode(text, true)
          break
        case 'html-dec':
          result = htmlEntitiesDecode(text)
          break
        case 'html-to-js':
          result = htmlToJs(text)
          break
        case 'to-json':
          result = JSON.stringify(JSON.parse(text), null, 2)
          break
        case 'url-params':
          result = parseUrlParams(text)
          break
        case 'jwt-decode':
          result = decodeJWT(text)
          break
        case 'cookie':
          result = formatCookie(text)
          break
        case 'escape':
          result = text.replace(
            /[\\"'\n\r\t\b\f]/g,
            (c) =>
              ({
                '\\': '\\\\',
                '"': '\\"',
                "'": "\\'",
                '\n': '\\n',
                '\r': '\\r',
                '\t': '\\t',
                '\b': '\\b',
                '\f': '\\f'
              })[c] ?? c
          )
          break
        case 'unescape':
          result = text.replace(
            /\\([\\"'\nrtbf])/g,
            (_, c) =>
              ({ '\\': '\\', '"': '"', "'": "'", n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[
                c
              ] ?? c
          )
          break
        case 'gzip-compress':
          result = await gzipCompress(text)
          break
        case 'gzip-decompress':
          result = await gzipDecompress(text)
          break
        default:
          result = text
      }
      setOutput(result)
    } catch (e) {
      setOutput(e instanceof Error ? `Error: ${e.message}` : String(e))
    }
    setProcessing(false)
  }, [input, format])

  const handleCopy = useCallback(async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      message.success(t('copied'))
    } catch {
      message.error(t('copyFailed'))
    }
  }, [output, t, message])

  const handleFileOpen = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setInput(reader.result as string)
    reader.readAsText(file)
  }, [])

  const totalFormats = ENCODE_FORMATS.length + DECODE_FORMATS.length

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 72px)' }}>
      {breadcrumb ? <div className="mb-3 shrink-0">{breadcrumb}</div> : <div className="mb-3" />}

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.json,.html,.js"
        onChange={handleFileOpen}
        className="hidden"
      />

      {/* Two-column layout */}
      <div className="flex-1 min-h-0 flex gap-3">
        {/* Left: Format list */}
        <div className="w-64 shrink-0 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 h-7 shrink-0">
            <span className={PANEL_HEADER_CLS}>{t('codecFormatTitle')}</span>
            <span className="text-[10px] text-[var(--text-secondary)]">{totalFormats}种</span>
          </div>
          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-3">
            {/* Encode section */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1 px-2">
                {t('codecEncode')}
              </div>
              <div className="grid grid-cols-2 gap-0.5">
                {ENCODE_FORMATS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => {
                      setFormat(f.key)
                      setOutput('')
                    }}
                    className={`text-left px-2.5 py-1.5 rounded-md text-xs font-medium leading-snug transition-all duration-100 cursor-pointer border-none truncate
                      ${
                        format === f.key
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
                      }`}
                  >
                    <span className="inline-block w-3 mr-1 text-[10px] opacity-60 shrink-0">
                      {format === f.key ? '●' : '○'}
                    </span>
                    {t(f.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Decode section */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1 px-2">
                {t('codecDecode')}
              </div>
              <div className="grid grid-cols-2 gap-0.5">
                {DECODE_FORMATS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => {
                      setFormat(f.key)
                      setOutput('')
                    }}
                    className={`text-left px-2.5 py-1.5 rounded-md text-xs font-medium leading-snug transition-all duration-100 cursor-pointer border-none truncate
                      ${
                        format === f.key
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
                      }`}
                  >
                    <span className="inline-block w-2.5 mr-1 text-[9px] opacity-60 shrink-0">
                      {format === f.key ? '●' : '○'}
                    </span>
                    {t(f.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Input + Output */}
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          {/* Input */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-1.5 h-7 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleConvert}
                  disabled={!input.trim() || processing}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold
                    flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
                    bg-[var(--accent)] text-white active:brightness-90
                    disabled:opacity-40 disabled:cursor-not-allowed
                    hover:brightness-110 hover:shadow-[0_0_8px_var(--accent)]"
                >
                  {t('codecConvert')}
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium
                    flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
                    bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
                    hover:bg-[var(--border-subtle)]"
                >
                  <FolderOpenOutlined style={{ fontSize: 11 }} />
                </button>
                <button
                  onClick={() => {
                    setInput('')
                    setOutput('')
                  }}
                  disabled={!input && !output}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium
                    flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
                    bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
                    hover:bg-[var(--border-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <DeleteOutlined style={{ fontSize: 11 }} />
                </button>
              </div>
              <span className={PANEL_HEADER_CLS}>{t('codecInput')}</span>
            </div>
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setOutput('')
              }}
              placeholder={t('codecInputPlaceholder')}
              spellCheck={false}
              className="flex-1 w-full px-4 py-3 rounded-lg border border-[var(--border-subtle)]
                bg-white dark:bg-[var(--surface)] text-[var(--text-primary)]
                font-mono text-sm leading-relaxed outline-none resize-none
                focus:border-[var(--accent)] transition-colors duration-150"
            />
          </div>

          {/* Output */}
          <div className="flex flex-col flex-[0.8] min-h-0">
            <div className="flex items-center justify-between mb-1.5 h-7 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  disabled={!output}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium
                    text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                    hover:bg-[var(--border-subtle)] transition-all duration-150 cursor-pointer border-none bg-transparent
                    disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <SnippetsOutlined style={{ fontSize: 12 }} />
                  {t('copy')}
                </button>
              </div>
              <span className={PANEL_HEADER_CLS}>{t('codecOutput')}</span>
            </div>
            <textarea
              value={output}
              readOnly
              placeholder={t('codecOutputPlaceholder')}
              spellCheck={false}
              className="flex-1 w-full px-4 py-3 rounded-lg border border-[var(--border-subtle)]
                bg-white dark:bg-[var(--surface)] text-[var(--text-primary)]
                font-mono text-sm leading-relaxed outline-none resize-none select-all
                focus:border-[var(--accent)] transition-colors duration-150"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default CodecConverter
