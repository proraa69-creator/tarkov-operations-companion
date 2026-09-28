export interface ThemeOption { id: string; label: string; swatch: [string, string, string] }

export const THEMES: ThemeOption[] = [
  { id: 'tarkov', label: 'Тарков', swatch: ['#0a0f0c', '#19241e', '#c4a665'] },
  { id: 'steel', label: 'Сталь', swatch: ['#0c0e10', '#272c31', '#b9c6d0'] },
  { id: 'crimson', label: 'Багровый', swatch: ['#12060a', '#3a0f1b', '#e6a35c'] },
]

export const SHAPES = [
  { id: 'rounded', label: 'Скруглённый' },
  { id: 'angular', label: 'Угловой' },
] as const

const THEME_KEY = 'tarkov-app-theme'
const SHAPE_KEY = 'tarkov-app-shape'

function read(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}

export function currentTheme() {
  const saved = read(THEME_KEY)
  return THEMES.some((theme) => theme.id === saved) ? saved! : 'tarkov'
}

export function currentShape(): (typeof SHAPES)[number]['id'] {
  return read(SHAPE_KEY) === 'angular' ? 'angular' : 'rounded'
}

export function applyAppearance(theme = currentTheme(), shape = currentShape()) {
  const root = document.documentElement
  if (theme === 'tarkov') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  if (shape === 'angular') root.setAttribute('data-shape', 'angular')
  else root.removeAttribute('data-shape')
}

export function saveAppearance(theme: string, shape: string) {
  try {
    localStorage.setItem(THEME_KEY, theme)
    localStorage.setItem(SHAPE_KEY, shape)
  } catch { /* storage unavailable */ }
  applyAppearance(theme, shape === 'angular' ? 'angular' : 'rounded')
}

/** Next theme in the list, for the top-bar button that cycles through them. */
export function cycleTheme() {
  const index = THEMES.findIndex((theme) => theme.id === currentTheme())
  const next = THEMES[(index + 1) % THEMES.length]!
  saveAppearance(next.id, currentShape())
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
  return next
}

export const THEME_CHANGED_EVENT = 'tarkov-theme-changed'
