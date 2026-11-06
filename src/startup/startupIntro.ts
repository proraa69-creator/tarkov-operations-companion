import { prefersReducedMotion } from '../shared/motion'

/**
 * The start intro (owner, 06.11.2026: «просто появилось интро, а во время этого уже идет загрузка»). It is drawn by
 * index.html (src/startup/intro.css, intro.html, public/startup-intro.js) over the app, which meanwhile loads and asks
 * for its subscription underneath. The screens call `endStartupIntro` once they have what to show:
 * - it plays to its end first, so a fast start is never cut;
 * - a slow start holds the last frame, with no words;
 * - after 20 seconds without an answer (public/startup-intro.js) the app's own screen shows whatever it has.
 * The site opens the same way (website/vite.config.ts, website/src/startupIntroHead.js), once in a browser. On both the
 * emblem then flies to its place at the top left while the rest puts itself together (src/startup/opening.ts, with
 * src/startup/appOpening.ts and website/src/siteOpening.ts).
 */

const ID = 'startup-intro'
const ON = 'data-startup-intro'
const OUT = 'data-startup-intro-out'

/** A moment on the finished logo before it opens. */
export const HOLD_MS = 130
/** No animations running (motion turned off): the logo stands this long from the start of the page. */
export const STATIC_HOLD_MS = 600
/** The animations did not report their end (the window hidden): it goes on anyway. */
export const MAX_PLAY_MS = 2500
/** The fade in src/startup/intro.css, and a little more in case its end event never comes. */
export const FADE_MS = 500

const wait = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms) })

/** While it is on screen a page change must not start a View Transition: it would freeze the intro in a snapshot. */
export function startupIntroShown(doc: Document = document) {
  return doc.documentElement.hasAttribute(ON)
}

/** At once, with no fade: for a start that failed, whose message must be read. */
export function removeStartupIntro(doc: Document = document) {
  doc.getElementById(ID)?.remove()
  doc.documentElement.removeAttribute(ON)
  doc.documentElement.removeAttribute(OUT)
}

async function playedToTheEnd(intro: HTMLElement, doc: Document) {
  if (doc.documentElement.getAttribute(ON) === 'still') return
  const animations = typeof intro.getAnimations === 'function' ? intro.getAnimations({ subtree: true }) : []
  if (animations.length) {
    await Promise.race([Promise.allSettled(animations.map((animation) => animation.finished)), wait(MAX_PLAY_MS)])
    await wait(HOLD_MS)
    return
  }
  if (prefersReducedMotion()) await wait(Math.max(0, STATIC_HOLD_MS - performance.now()))
}

/**
 * The app has what to show. Safe to call any number of times, and when no intro is on (a browser under automation).
 * `open`, when given, takes over the moment it opens instead of the fade; it may return nothing to leave it the fade.
 */
export function endStartupIntro(doc: Document = document, open?: (intro: HTMLElement, doc: Document) => Promise<void> | undefined) {
  const intro = doc.getElementById(ID)
  if (!intro || intro.dataset.ending !== undefined) return
  if (!startupIntroShown(doc)) { intro.remove(); return }
  intro.dataset.ending = ''
  void playedToTheEnd(intro, doc).then(() => {
    doc.documentElement.setAttribute(OUT, '')
    const finish = () => removeStartupIntro(doc)
    let opening: Promise<void> | undefined
    try { opening = open?.(intro, doc) } catch { /* the page must open whatever happens to the show */ }
    if (opening) {
      void opening.then(finish, finish)
      return
    }
    intro.style.removeProperty('animation')
    intro.style.removeProperty('background')
    intro.addEventListener('animationend', (event) => { if (event.target === intro) finish() })
    window.setTimeout(finish, FADE_MS)
  })
}
