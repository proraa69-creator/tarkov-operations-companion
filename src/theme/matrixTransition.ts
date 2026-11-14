/**
 * «Матрица» (owner, 15.11.2026: «на всех кнопках, картинках появлялся будто зеленый вот этот код… не в одну строку, а рандомно
 * просто занимает всю площадь окна, всех окон. Меняется быстро, очень быстро… и меняет тему»): green letters, digits and signs
 * pour over every block, button and picture, a new set in new places on every frame; under them the scheme changes, and the code
 * drains away from the new one. One canvas over the app, gone when it ends; it never takes a click.
 */
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789ABCDEFZ<>[]{}=+*#$%&@'
/** What the code covers: the blocks, the bars, the buttons and the pictures. */
const COVERED = '.panel, .stat-card, .sidebar, .topbar, .icon-button, .button, .nav-link, img'
const CELL = 15
/** The code comes up, holds while the scheme changes under it, and drains away. */
const RISE_MS = 280
const HOLD_MS = 160
const FALL_MS = 620
const TOTAL_MS = RISE_MS + HOLD_MS + FALL_MS
const SWITCH_AT = RISE_MS + HOLD_MS / 2

const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeIn = (t: number) => t * t

/** How much of the code is on screen at this moment (0–1). */
function coverAt(elapsed: number) {
  if (elapsed < RISE_MS) return easeOut(elapsed / RISE_MS)
  if (elapsed < RISE_MS + HOLD_MS) return 1
  return 1 - easeIn(Math.min(1, (elapsed - RISE_MS - HOLD_MS) / FALL_MS))
}

function coveredRects() {
  const rects: DOMRect[] = []
  for (const element of document.querySelectorAll<HTMLElement>(COVERED)) {
    const box = element.getBoundingClientRect()
    if (box.width < 6 || box.height < 6 || box.bottom < 0 || box.right < 0 || box.top > window.innerHeight || box.left > window.innerWidth) continue
    rects.push(box)
  }
  return rects
}

/** Runs `apply` (the scheme change) under the code; `done` when the code has gone. */
export function runMatrixTransition(apply: () => void, done?: () => void) {
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  const canvas = document.createElement('canvas')
  canvas.className = 'theme-matrix'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.width = Math.round(window.innerWidth * ratio)
  canvas.height = Math.round(window.innerHeight * ratio)
  document.body.appendChild(canvas)
  const context = canvas.getContext('2d')
  if (!context) { canvas.remove(); apply(); done?.(); return }
  context.scale(ratio, ratio)
  context.font = `600 ${CELL - 2}px "JetBrains Mono", Consolas, monospace`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  let rects = coveredRects()
  const started = performance.now()
  let switched = false

  const draw = () => {
    const elapsed = performance.now() - started
    if (!switched && elapsed >= SWITCH_AT) {
      switched = true
      apply()
      // The new scheme may move things a little: the code follows it.
      rects = coveredRects()
    }
    const cover = coverAt(elapsed)
    context.clearRect(0, 0, window.innerWidth, window.innerHeight)
    // A dark green veil over the whole screen hides the change between the blocks too.
    context.fillStyle = `rgb(1 8 3 / ${(cover * 0.82).toFixed(3)})`
    context.fillRect(0, 0, window.innerWidth, window.innerHeight)
    for (const rect of rects) {
      context.fillStyle = `rgb(0 10 3 / ${cover.toFixed(3)})`
      context.fillRect(rect.left, rect.top, rect.width, rect.height)
      // The whole block, in random places, a new set every frame.
      const count = Math.ceil((rect.width * rect.height) / (CELL * CELL) * 0.72 * cover)
      for (let i = 0; i < count; i++) {
        const x = rect.left + Math.random() * rect.width
        const y = rect.top + Math.random() * rect.height
        const bright = Math.random()
        context.fillStyle = bright > 0.94 ? `rgb(220 255 225 / ${cover})` : `rgb(${30 + bright * 40} ${150 + bright * 105} ${60 + bright * 30} / ${(0.35 + bright * 0.65) * cover})`
        context.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!, x, y)
      }
    }
    if (elapsed < TOTAL_MS) requestAnimationFrame(draw)
    else { canvas.remove(); done?.() }
  }
  requestAnimationFrame(draw)
}
