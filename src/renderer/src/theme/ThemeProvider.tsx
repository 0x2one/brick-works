import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { ConfigProvider, theme, App } from 'antd'
import type { Locale } from 'antd/es/locale'

export type ThemeMode = 'system' | 'light' | 'dark'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'light',
  setMode: () => {},
})

export const useTheme = (): ThemeContextValue => useContext(ThemeContext)

function getStoredMode(): ThemeMode {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'system'
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function ThemeProvider({ children, locale }: { children: ReactNode; locale?: Locale }): React.JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode)
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveMode(getStoredMode()))

  const setMode = useCallback((next: ThemeMode): void => {
    setModeState(next)
    localStorage.setItem('theme', next)
    setResolved(resolveMode(next))
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
  }, [resolved])

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      <ConfigProvider
        locale={locale}
        theme={
          resolved === 'dark'
            ? {
                algorithm: theme.darkAlgorithm,
                token: { colorPrimary: '#c8674b' },
              }
            : {
                token: { colorPrimary: '#c8674b' },
              }
        }
      >
        <App>{children}</App>
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}

export default ThemeProvider
