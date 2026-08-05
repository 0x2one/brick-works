import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { ConfigProvider, theme, App } from 'antd'
import type { Locale } from 'antd/es/locale'
import { ACCENT_PALETTES, ACCENT_KEYS, type AccentKey } from './accent'

export type ThemeMode = 'system' | 'light' | 'dark'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  accent: AccentKey
  setAccent: (accent: AccentKey) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'light',
  setMode: () => {},
  accent: 'terracotta',
  setAccent: () => {}
})

export const useTheme = (): ThemeContextValue => useContext(ThemeContext)

const accentPaletteByKey = new Map(ACCENT_PALETTES.map((p) => [p.key, p]))

function getStoredMode(): ThemeMode {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'system'
}

function getStoredAccent(): AccentKey {
  const stored = localStorage.getItem('accent')
  return ACCENT_KEYS.has(stored as AccentKey) ? (stored as AccentKey) : 'terracotta'
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function ThemeProvider({
  children,
  locale
}: {
  children: ReactNode
  locale?: Locale
}): React.JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode)
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveMode(getStoredMode()))
  const [accent, setAccentState] = useState<AccentKey>(getStoredAccent)

  const setMode = useCallback((next: ThemeMode): void => {
    setModeState(next)
    localStorage.setItem('theme', next)
    setResolved(resolveMode(next))
  }, [])

  const setAccent = useCallback((next: AccentKey): void => {
    setAccentState(next)
    localStorage.setItem('accent', next)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (): void => {
      if (mode === 'system') {
        setResolved(mq.matches ? 'dark' : 'light')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved)
    document.documentElement.setAttribute('data-accent', accent)
  }, [resolved, accent])

  const palette = accentPaletteByKey.get(accent) ?? ACCENT_PALETTES[0]
  const colorPrimary = resolved === 'dark' ? palette.dark : palette.light

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode, accent, setAccent }}>
      <ConfigProvider
        locale={locale}
        theme={
          resolved === 'dark'
            ? { algorithm: theme.darkAlgorithm, token: { colorPrimary } }
            : { token: { colorPrimary } }
        }
      >
        <App>{children}</App>
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}

export default ThemeProvider
