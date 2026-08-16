import { createContext, useContext } from 'react'
import type { AccentKey } from './accent'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface ThemeContextValue {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  accent: AccentKey
  setAccent: (accent: AccentKey) => void
}

export const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'light',
  setMode: () => {},
  accent: 'terracotta',
  setAccent: () => {}
})

export const useTheme = (): ThemeContextValue => useContext(ThemeContext)
