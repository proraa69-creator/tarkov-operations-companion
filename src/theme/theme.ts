export interface ThemeOption { id: string; label: string; swatch: [string, string, string] }

export const THEMES: ThemeOption[] = [
  { id: 'tarkov', label: 'Тарков', swatch: ['#0a0f0c', '#19241e', '#c4a665'] },
  { id: 'steel', label: 'Сталь', swatch: ['#0c0e10', '#272c31', '#b9c6d0'] },
  { id: 'crimson', label: 'Багровый', swatch: ['#12060a', '#3a0f1b', '#e6a35c'] },
  // Material themes: procedural textures from scripts/textures, styles in src/styles/themes.css
  { id: 'blackmc', label: 'Чёрный мультикам', swatch: ['#0d0d0e', '#2e2e31', '#a9b973'] },
  { id: 'ocp', label: 'Мультикам', swatch: ['#b6a27c', '#6d7446', '#7a5b41'] },
  { id: 'woodland', label: 'Вудланд', swatch: ['#4c5f33', '#8c7f58', '#e6c35c'] },
  { id: 'perforated', label: 'Перфорация', swatch: ['#0b0c0e', '#26282c', '#f0a92a'] },
  { id: 'rust', label: 'Ржавая сталь', swatch: ['#62717d', '#7c8d99', '#a4582a'] },
  { id: 'slate', label: 'Сланец', swatch: ['#16191e', '#3b414b', '#d89e68'] },
  { id: 'telnyashka', label: 'Тельняшка', swatch: ['#16171a', '#ece7da', '#1d3f78'] },
  { id: 'gear', label: 'Снаряжение', swatch: ['#12130e', '#5d6041', '#c9ad7a'] },
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
