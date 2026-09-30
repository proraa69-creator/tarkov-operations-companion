export interface ThemeOption { id: string; label: string; swatch: [string, string, string] }

export const THEMES: ThemeOption[] = [
  { id: 'tarkov', label: 'Тарков', swatch: ['#0a0f0c', '#19241e', '#c4a665'] },
  { id: 'steel', label: 'Сталь', swatch: ['#0c0e10', '#272c31', '#b9c6d0'] },
  { id: 'crimson', label: 'Багровый', swatch: ['#12060a', '#3a0f1b', '#e6a35c'] },
  // Material themes: procedural textures from scripts/textures, styles in src/styles/themes.css
  { id: 'blackmc', label: 'Чёрный мультикам', swatch: ['#060607', '#1b1b1d', '#a9b973'] },
  { id: 'perforated', label: 'Перфорация', swatch: ['#0b0c0e', '#26282c', '#f0a92a'] },
  { id: 'rust', label: 'Ржавая сталь', swatch: ['#62717d', '#7c8d99', '#a4582a'] },
  { id: 'slate', label: 'Металл', swatch: ['#16191e', '#3b414b', '#d89e68'] },
  { id: 'telnyashka', label: 'Тельняшка', swatch: ['#16171a', '#ece7da', '#1d3f78'] },
  { id: 'gear', label: 'Снаряжение', swatch: ['#12130e', '#5d6041', '#c9ad7a'] },
]

const THEME_KEY = 'tarkov-app-theme'

/** Everyone who has not picked a scheme yet starts on «Чёрный мультикам» (the phone app always did). */
export function defaultTheme() {
  return 'blackmc'
}

function read(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}

export function currentTheme() {
  const saved = read(THEME_KEY)
  return THEMES.some((theme) => theme.id === saved) ? saved! : defaultTheme()
}

export function applyAppearance(theme = currentTheme()) {
  const root = document.documentElement
  if (theme === 'tarkov') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export function saveAppearance(theme: string) {
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* storage unavailable */ }
  applyAppearance(theme)
}

/** Next theme in the list, for the top-bar button that cycles through them. */
export function cycleTheme() {
  const index = THEMES.findIndex((theme) => theme.id === currentTheme())
  const next = THEMES[(index + 1) % THEMES.length]!
  saveAppearance(next.id)
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
  return next
}

export const THEME_CHANGED_EVENT = 'tarkov-theme-changed'

/**
 * The "Свой фон" (own background picture) and "Форма элементов" (rounded/angular) settings were removed;
 * drop what older versions stored for them.
 */
export function clearRemovedAppearanceSettings() {
  try { localStorage.removeItem('tarkov-app-shape') } catch { /* storage unavailable */ }
  void import('idb-keyval').then(({ del }) => del('tarkov-custom-background-v1')).catch(() => {})
}
