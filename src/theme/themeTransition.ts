/**
 * The change of colour scheme as one motion instead of a jump (owner, 15.11.2026: «не просто перелистывание, а чтобы какая-то
 * была анимация перехода с одной цветовой схемы в другую»). The browser's view transition takes a picture of the app before
 * and after the scheme changes and plays a motion between them (styles/themeMotion.css):
 * - `circle`  «Круг от кнопки»: the new scheme opens as a circle from where the player clicked — the owner's pick so far
 *             («понравился второй вариант… запомни второй вариант»);
 * - `fade`    «Растворение», `sweep` «Шторка», `scan` «Сканер»: the first round of ideas;
 * - `cards`   «Переворот карточек»: every block turns over like a card, one after another from the top left;
 * - `buttons` «Волна по кнопкам»: the buttons and menu lines flip over in a wave from the press, the rest melts;
 * - `blinds`  «Жалюзи»: the new scheme comes through horizontal slats that open.
 * Nothing moves with reduced motion or where the browser has no view transitions: the scheme just changes.
 */
export const THEME_MOTIONS = ['circle', 'fade', 'sweep', 'scan', 'cards', 'buttons', 'blinds'] as const
export type ThemeMotion = typeof THEME_MOTIONS[number]
export const DEFAULT_THEME_MOTION: ThemeMotion = 'circle'
const MOTION_KEY = 'raidos-theme-motion'

function chosenMotion(): ThemeMotion {
  try {
    const saved = localStorage.getItem(MOTION_KEY)
    if (THEME_MOTIONS.includes(saved as ThemeMotion)) return saved as ThemeMotion
  } catch { /* storage unavailable */ }
  return DEFAULT_THEME_MOTION
}

/** Where the last press was: the circle and the wave start there (the scheme button, a swatch in Settings). */
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

/** What turns over in `cards` and `buttons`: the blocks, or the buttons and menu lines. */
const PIECES: Partial<Record<ThemeMotion, string>> = {
  cards: '.panel, .stat-card, .sidebar, .topbar',
  buttons: '.icon-button, .button, .nav-link, .tag, .segmented button, .seg button',
}
/** One flip half (the old face away, then the new one in), and the most any piece waits for its turn. */
const FLIP_MS = { cards: 230, buttons: 170 } as const
const SPREAD_MS = { cards: 520, buttons: 480 } as const
const MAX_PIECES = 120

/** The pieces on screen, outermost only, each with its turn: by place (cards) or by distance from the press (buttons). */
function namePieces(motion: 'cards' | 'buttons', press: { x: number; y: number }) {
  const found: HTMLElement[] = []
  for (const element of document.querySelectorAll<HTMLElement>(PIECES[motion]!)) {
    const box = element.getBoundingClientRect()
    if (box.width < 4 || box.height < 4 || box.bottom < 0 || box.right < 0 || box.top > window.innerHeight || box.left > window.innerWidth) continue
    if (found.some((outer) => outer.contains(element))) continue
    found.push(element)
    if (found.length >= MAX_PIECES) break
  }
  const order = found.map((element) => {
    const box = element.getBoundingClientRect()
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    return motion === 'cards' ? cx / window.innerWidth * 0.55 + cy / window.innerHeight * 0.45 : Math.hypot(cx - press.x, cy - press.y) / Math.hypot(window.innerWidth, window.innerHeight)
  })
  const flip = FLIP_MS[motion]
  const spread = SPREAD_MS[motion]
  const axis = motion === 'cards' ? 'Y' : 'X'
  const rules: string[] = []
  found.forEach((element, index) => {
    const name = `theme-piece-${index}`
    element.style.setProperty('view-transition-name', name)
    const delay = Math.round(order[index]! * spread)
    rules.push(`::view-transition-group(${name}){animation:none}`,
      `::view-transition-image-pair(${name}){perspective:900px}`,
      `::view-transition-old(${name}){animation:theme-flip-out-${axis} ${flip}ms cubic-bezier(.55,0,1,.45) ${delay}ms both;backface-visibility:hidden}`,
      `::view-transition-new(${name}){animation:theme-flip-in-${axis} ${flip}ms cubic-bezier(0,.55,.45,1) ${delay + flip}ms both;backface-visibility:hidden}`)
  })
  const style = document.createElement('style')
  style.id = 'theme-motion-pieces'
  style.textContent = rules.join('\n')
  document.head.appendChild(style)
  // The background under them changes over the same time.
  document.documentElement.style.setProperty('--vt-total', `${spread + 2 * flip}ms`)
  return () => {
    for (const element of found) element.style.removeProperty('view-transition-name')
    style.remove()
  }
}

/** Runs `apply` (the scheme change) inside the chosen motion, or at once where nothing may move. */
export function withThemeTransition(apply: () => void, motion: ThemeMotion = chosenMotion()) {
  const doc = document as ViewTransitionDocument
  if (!doc.startViewTransition || reducedMotion()) { apply(); return }
  const root = document.documentElement
  const press = lastPress ?? { x: window.innerWidth - 40, y: 34 }
  // The circle has to reach the farthest corner.
  const radius = Math.hypot(Math.max(press.x, window.innerWidth - press.x), Math.max(press.y, window.innerHeight - press.y))
  root.style.setProperty('--vt-x', `${Math.round(press.x)}px`)
  root.style.setProperty('--vt-y', `${Math.round(press.y)}px`)
  root.style.setProperty('--vt-r', `${Math.ceil(radius)}px`)
  root.setAttribute('data-theme-motion', motion)
  const unname = motion === 'cards' || motion === 'buttons' ? namePieces(motion, press) : undefined
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
    unname?.()
    root.removeAttribute('data-theme-motion')
  })
}
