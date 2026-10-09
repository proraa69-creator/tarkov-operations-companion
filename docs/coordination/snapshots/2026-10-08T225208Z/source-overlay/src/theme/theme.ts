export interface ThemeOption { id: string; label: string; swatch: [string, string, string] }

export const THEMES: ThemeOption[] = [
  // The original olive scheme (id «tarkov», kept so saved choices stay); shown as «Олива» since 08.10.2026.
  { id: 'tarkov', label: 'Олива', swatch: ['#0a0f0c', '#19241e', '#c4a665'] },
  // Material themes: procedural textures from scripts/textures, styles in src/styles/themes.css
  { id: 'blackmc', label: 'Чёрный мультикам', swatch: ['#060607', '#1b1b1d', '#a9b973'] },
  { id: 'slate', label: 'Металл', swatch: ['#16191e', '#3b414b', '#d89e68'] },
  { id: 'telnyashka', label: 'Тельняшка', swatch: ['#16171a', '#ece7da', '#1d3f78'] },
  { id: 'gear', label: 'Снаряжение', swatch: ['#12130e', '#5d6041', '#c9ad7a'] },
  // «Сталь», «Перфорация» and «Алькантара» were removed from the picker on 04.10.2026, «Багровый» and «Ржавая сталь» on
  // 06.10.2026 (their CSS stays; a saved choice falls back to the default)
]

/** «Алькантара»: the thread colour of the seams (Settings → «Цветовая схема» → «Строчка»). */
export const ALCANTARA_STITCHES = [
  { id: 'dark', label: 'Тёмная', swatch: '#5d6066' },
  { id: 'grey', label: 'Серая', swatch: '#a7aab0' },
  { id: 'contrast', label: 'Контрастная', swatch: '#c8773f' },
] as const
export type AlcantaraStitch = typeof ALCANTARA_STITCHES[number]['id']
const STITCH_KEY = 'tarkov-app-alcantara-stitch'

export function currentStitch(): AlcantaraStitch {
  const saved = read(STITCH_KEY)
  return ALCANTARA_STITCHES.find((stitch) => stitch.id === saved)?.id ?? 'dark'
}

export function saveStitch(stitch: AlcantaraStitch) {
  try { localStorage.setItem(STITCH_KEY, stitch) } catch { /* storage unavailable */ }
  document.documentElement.setAttribute('data-alc-stitch', stitch)
}

const THEME_KEY = 'tarkov-app-theme'

/** Everyone who has not picked a scheme yet starts on the olive scheme «Олива» (id «tarkov»), phone and desktop. */
export function defaultTheme() {
  return 'tarkov'
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
  root.setAttribute('data-alc-stitch', currentStitch())
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
