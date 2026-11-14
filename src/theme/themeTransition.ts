/**
 * The change of colour scheme as one motion instead of a jump (owner, 15.11.2026: «не просто перелистывание, а чтобы какая-то
 * была анимация перехода с одной цветовой схемы в другую»). The browser's view transition takes a picture of the app before
 * and after the scheme changes and plays one of four motions between them (styles/themeMotion.css):
 * - `fade`   «Растворение»: the old scheme melts into the new one;
 * - `circle` «Круг от кнопки»: the new scheme opens as a circle from where the player clicked;
 * - `sweep`  «Шторка»: a soft-edged diagonal curtain passes over the screen;
 * - `scan`   «Сканер»: a bright line runs down the screen, the new scheme behind it.
 * Nothing moves with reduced motion or where the browser has no view transitions: the scheme just changes.
 */
export const THEME_MOTIONS = ['fade', 'circle', 'sweep', 'scan'] as const
export type ThemeMotion = typeof THEME_MOTIONS[number]
/** Until the owner picks one; the previews choose another through localStorage `raidos-theme-motion`. */
export const DEFAULT_THEME_MOTION: ThemeMotion = 'circle'
const MOTION_KEY = 'raidos-theme-motion'

function chosenMotion(): ThemeMotion {
  try {
    const saved = localStorage.getItem(MOTION_KEY)
    if (THEME_MOTIONS.includes(saved as ThemeMotion)) return saved as ThemeMotion
  } catch { /* storage unavailable */ }
  return DEFAULT_THEME_MOTION
}

/** Where the last press was: the circle opens from there (the scheme button, a swatch in Settings). */
let lastPress: { x: number; y: number } | null = null
let listening = false
function rememberPresses() {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('pointerdown', (event) => { lastPress = { x: event.clientX, y: event.clientY } }, { capture: true, passive: true })
}
rememberPresses()

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void>; ready: Promise<void> } }

/** Runs `apply` (the scheme change) inside the chosen motion, or at once where nothing may move. */
export function withThemeTransition(apply: () => void, motion: ThemeMotion = chosenMotion()) {
  const doc = document as ViewTransitionDocument
  if (!doc.startViewTransition || reducedMotion()) { apply(); return }
  const root = document.documentElement
  const x = lastPress?.x ?? window.innerWidth - 40
  const y = lastPress?.y ?? 34
  // The circle has to reach the farthest corner.
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  root.style.setProperty('--vt-x', `${Math.round(x)}px`)
  root.style.setProperty('--vt-y', `${Math.round(y)}px`)
  root.style.setProperty('--vt-r', `${Math.ceil(radius)}px`)
  root.setAttribute('data-theme-motion', motion)
  let line: HTMLElement | null = null
  const transition = doc.startViewTransition(() => {
    apply()
    // «Сканер»: the line is its own layer above both pictures, only in the new one.
    if (motion === 'scan') {
      line = document.createElement('div')
      line.className = 'theme-scan-line'
      line.setAttribute('aria-hidden', 'true')
      document.body.appendChild(line)
    }
  })
  void transition.finished.finally(() => {
    line?.remove()
    root.removeAttribute('data-theme-motion')
  })
}
