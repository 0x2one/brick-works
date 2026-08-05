export type AccentKey =
  | 'terracotta'
  | 'blue'
  | 'green'
  | 'purple'
  | 'rose'
  | 'cyan'
  | 'amber'
  | 'indigo'
  | 'slate'
  | 'gold'

export interface AccentPalette {
  key: AccentKey
  light: string
  dark: string
  nameKey: string
}

export const ACCENT_PALETTES: AccentPalette[] = [
  { key: 'terracotta', light: '#c8674b', dark: '#d97f66', nameKey: 'accentTerracotta' },
  { key: 'blue', light: '#3b82f6', dark: '#60a5fa', nameKey: 'accentBlue' },
  { key: 'green', light: '#16a34a', dark: '#4ade80', nameKey: 'accentGreen' },
  { key: 'purple', light: '#8b5cf6', dark: '#a78bfa', nameKey: 'accentPurple' },
  { key: 'rose', light: '#e11d48', dark: '#fb7185', nameKey: 'accentRose' },
  { key: 'cyan', light: '#0891b2', dark: '#22d3ee', nameKey: 'accentCyan' },
  { key: 'amber', light: '#d97706', dark: '#fbbf24', nameKey: 'accentAmber' },
  { key: 'indigo', light: '#6366f1', dark: '#818cf8', nameKey: 'accentIndigo' },
  { key: 'slate', light: '#64748b', dark: '#94a3b8', nameKey: 'accentSlate' },
  { key: 'gold', light: '#ca8a04', dark: '#facc15', nameKey: 'accentGold' }
]

export const ACCENT_KEYS = new Set<AccentKey>(ACCENT_PALETTES.map((p) => p.key))
