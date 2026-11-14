/**
 * The change of colour scheme as one motion instead of a jump (owner, 15.11.2026: «не просто перелистывание, а чтобы какая-то
 * была анимация перехода с одной цветовой схемы в другую»; of eight tried, «примени только вторую анимацию»): the new scheme
 * opens as a circle from where the player clicked — the scheme button, a menu line, a picture in Settings. The browser's view
 * transition takes a picture of the app before and after the change and plays the circle between them
 * (styles/themeMotion.css). Nothing moves with reduced motion or where the browser has no view transitions.
 */

/** Where the last press was: the circle opens from there. */
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

/** Runs `apply` (the scheme change) inside the circle, or at once where nothing may move. */
export function withThemeTransition(apply: () => void) {
  const doc = document as ViewTransitionDocument
  if (!doc.startViewTransition || reducedMotion()) { apply(); return }
  const root = document.documentElement
  const press = lastPress ?? { x: window.innerWidth - 40, y: 34 }
  // The circle has to reach the farthest corner.
  const radius = Math.hypot(Math.max(press.x, window.innerWidth - press.x), Math.max(press.y, window.innerHeight - press.y))
  root.style.setProperty('--vt-x', `${Math.round(press.x)}px`)
  root.style.setProperty('--vt-y', `${Math.round(press.y)}px`)
  root.style.setProperty('--vt-r', `${Math.ceil(radius)}px`)
  root.setAttribute('data-theme-motion', 'circle')
  const transition = doc.startViewTransition(apply)
  void transition.finished.finally(() => root.removeAttribute('data-theme-motion'))
}
