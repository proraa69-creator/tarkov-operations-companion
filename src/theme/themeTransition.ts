/**
 * The change of colour scheme as one motion instead of a jump (owner, 15.11.2026: «не просто перелистывание, а чтобы какая-то
 * была анимация перехода с одной цветовой схемы в другую»; of eight tried, «примени только вторую анимацию»): the new scheme
 * opens as a circle from the scheme button that was pressed. The browser's view transition takes a picture of the app before
 * and after the change and plays the circle between them (styles/themeMotion.css). Nothing moves with reduced motion or where
 * the browser has no view transitions.
 *
 * Owner, 15.11.2026 («волна идёт… из района кнопки „Обновить данные“», «ближе к правому нижнему краю… резко доходит рывком»,
 * «долго думает перед стартом»): the big textures of a scheme (2048² / 4096² WebP, styles/themes.css) were decoded only after
 * the press, and the browser holds every frame of a view transition until the new picture is fully drawn: half a second
 * of nothing, then the circle already large. So the next scheme's pictures are decoded beforehand (`prepareTheme`: when the
 * app is idle, when the pointer comes to the button, after every change), the press waits for a decode still running, and
 * the circle is centred on the pressed button itself.
 */

/** Where the circle opens: the pressed element (its centre), a point, or the last press anywhere. */
export type ThemeOrigin = Element | { x: number; y: number } | null | undefined

/** Where the last press was: the circle opens from there when no element is given. */
let lastPress: { x: number; y: number } | null = null
let listening = false
function rememberPresses() {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('pointerdown', (event) => { lastPress = { x: event.clientX, y: event.clientY } }, { capture: true, passive: true })
}
rememberPresses()

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

type ViewTransition = { finished: Promise<void>; ready: Promise<void> }
type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => ViewTransition }

/** The longest a press waits for the new scheme's pictures; then the circle starts anyway. */
const PREPARE_WAIT_MS = 900
/**
 * Inside the change: how long the old picture may stay while the new scheme finishes — its pictures decoded and the
 * scheme's own pieces (decorations that follow `data-theme`, their pictures) drawn — before the circle opens it (owner,
 * 15.11.2026, video: «она должна доходить до конца плавно и слева такая же проблема»: the circle opened a scheme still
 * without its texture, and the texture then came over the whole screen at once, so the edges looked never reached).
 */
export const SETTLE_MS = 1500

function centreOf(element: Element) {
  const box = element.getBoundingClientRect()
  return box.width > 0 || box.height > 0 ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null
}

/** The visible top-bar scheme button (desktop or phone). */
function schemeButton() {
  return Array.from(document.querySelectorAll('.theme-cycle')).find((button) => centreOf(button)) ?? null
}

export function originPoint(origin?: ThemeOrigin) {
  if (origin && 'getBoundingClientRect' in origin) {
    const centre = centreOf(origin)
    if (centre) return centre
  } else if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) return { x: origin.x, y: origin.y }
  if (lastPress) return lastPress
  const button = schemeButton()
  return (button && centreOf(button)) ?? { x: window.innerWidth - 40, y: 34 }
}

/** The screen the circle has to cover (a phone's viewport can be taller than innerHeight while its bars hide). */
function screenSize() {
  const root = document.documentElement
  return {
    width: Math.max(window.innerWidth || 0, root.clientWidth || 0, window.visualViewport?.width ?? 0),
    height: Math.max(window.innerHeight || 0, root.clientHeight || 0, window.visualViewport?.height ?? 0),
  }
}

/**
 * The circle's radius: the farthest corner from the centre and a little more, so that corner is covered while the edge still
 * moves and the end is never a jump.
 */
export function circleRadius(point: { x: number; y: number }, size: { width: number; height: number }) {
  const far = Math.hypot(Math.max(point.x, size.width - point.x), Math.max(point.y, size.height - point.y))
  return Math.ceil(far * 1.06 + 8)
}

let pendingChange = 0

/**
 * Runs `apply` (the scheme change) inside the circle, or at once where nothing may move. `prepared`: the new scheme's
 * pictures being decoded (`prepareTheme`); the circle waits for them, at most PREPARE_WAIT_MS.
 */
export function withThemeTransition(apply: () => void, { origin, prepared }: { origin?: ThemeOrigin; prepared?: PreparedTheme } = {}) {
  const doc = document as ViewTransitionDocument
  if (!doc.startViewTransition || reducedMotion()) { apply(); return }
  // Measured at the press, before anything moves.
  const point = originPoint(origin)
  const change = ++pendingChange
  const start = () => {
    // A newer press while this one waited: that one puts its scheme on.
    if (change !== pendingChange) return
    const root = document.documentElement
    root.style.setProperty('--vt-x', `${Math.round(point.x)}px`)
    root.style.setProperty('--vt-y', `${Math.round(point.y)}px`)
    root.style.setProperty('--vt-r', `${circleRadius(point, screenSize())}px`)
    root.setAttribute('data-theme-motion', 'circle')
    // No CSS transitions inside the change: the new picture is taken at once, and a colour still fading in it would finish
    // only after the circle, as a jump (the sidebar's highlighted item did). Back on when the circle is over.
    root.setAttribute('data-theme-switching', '')
    // The pictures on the page now: the ones the new scheme adds are waited for (settle).
    const before = new Set(Array.from(document.images))
    const transition = doc.startViewTransition!(async () => {
      apply()
      await settle(prepared, before)
    })
    void transition.finished.catch(() => {}).finally(() => { if (change === pendingChange) { root.removeAttribute('data-theme-motion'); root.removeAttribute('data-theme-switching') } })
  }
  if (!prepared || prepared.done) { start(); return }
  let started = false
  const once = () => { if (!started) { started = true; start() } }
  void prepared.promise.then(once, once)
  window.setTimeout(once, PREPARE_WAIT_MS)
}

/**
 * The new scheme, finished: its pictures decoded (`prepared`), the pieces that follow `data-theme` rendered (a
 * MutationObserver and React need a turn or two) and the pictures they added decoded — at most SETTLE_MS. Until then the
 * browser keeps showing the old picture; the circle then opens the whole new scheme, with nothing left to appear after.
 */
export async function settle(prepared: PreparedTheme | undefined, before: ReadonlySet<HTMLImageElement>) {
  const turn = () => new Promise<void>((resolve) => { window.setTimeout(resolve, 0) })
  let timer = 0
  const limit = new Promise<void>((resolve) => { timer = window.setTimeout(resolve, SETTLE_MS) })
  const ready = (async () => {
    await turn()
    await turn()
    const added = Array.from(document.images).filter((image) => !before.has(image) && !image.complete)
    await Promise.all([prepared?.promise ?? Promise.resolve(), ...added.map((image) => image.decode().catch(() => {}))])
  })()
  await Promise.race([ready, limit])
  window.clearTimeout(timer)
}

/* ---------- The pictures of a scheme, decoded before it is put on ---------- */

export interface PreparedTheme { done: boolean; promise: Promise<void> }

const RASTER = /\.(webp|png|jpe?g|avif|gif)(\?|#|$)/i
const prepared = new Map<string, PreparedTheme & { images: HTMLImageElement[] }>()
/** Decoded pictures kept for this many schemes (each 4096² texture is 64 MB once decoded). */
const KEEP = 3

/** The text between `open` (index of the opening bracket) and its closing bracket. */
function bracketed(text: string, open: number) {
  let depth = 0
  for (let index = open; index < text.length; index++) {
    if (text[index] === '(') depth++
    else if (text[index] === ')' && --depth === 0) return { inner: text.slice(open + 1, index), end: index + 1 }
  }
  return null
}

const urlsIn = (text: string) => Array.from(text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/g), (match) => match[1] ?? match[2] ?? match[3] ?? '')

/** Splits at the commas outside brackets. */
function topLevelParts(text: string) {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '(') depth++
    else if (text[index] === ')') depth--
    else if (text[index] === ',' && depth === 0) { parts.push(text.slice(from, index)); from = index + 1 }
  }
  parts.push(text.slice(from))
  return parts
}

/**
 * The picture addresses in a declaration block: of an `image-set()` only the one this screen draws (the smallest
 * resolution at or above the device pixel ratio, else the largest), every other `url()` as it is.
 */
export function pictureUrls(cssText: string, pixelRatio: number) {
  const found: string[] = []
  let rest = ''
  let index = 0
  const pattern = /(?:-webkit-)?image-set\(/gi
  for (let match = pattern.exec(cssText); match; match = pattern.exec(cssText)) {
    const open = match.index + match[0].length - 1
    const set = bracketed(cssText, open)
    if (!set) break
    rest += cssText.slice(index, match.index)
    index = set.end
    pattern.lastIndex = set.end
    const options = topLevelParts(set.inner).map((part) => {
      const url = urlsIn(part)[0] ?? /^\s*["']([^"']+)["']/.exec(part)?.[1]
      const x = Number(/([\d.]+)x\s*$/.exec(part.trim())?.[1] ?? 1)
      return url ? { url, x } : null
    }).filter((option): option is { url: string; x: number } => Boolean(option)).sort((a, b) => a.x - b.x)
    const chosen = options.find((option) => option.x >= pixelRatio - 0.01) ?? options.at(-1)
    if (chosen) found.push(chosen.url)
  }
  rest += cssText.slice(index)
  found.push(...urlsIn(rest))
  return found
}

function sheetRules(sheet: CSSStyleSheet | CSSGroupingRule, out: Array<{ rule: CSSStyleRule; base: string }>, base: string) {
  let rules: CSSRuleList
  try { rules = sheet.cssRules } catch { return } // another origin's sheet
  for (const rule of Array.from(rules)) {
    if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule && typeof window.matchMedia === 'function' && !window.matchMedia(rule.conditionText).matches) continue
    if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
      out.push({ rule, base })
      if (rule.cssRules?.length) sheetRules(rule as unknown as CSSGroupingRule, out, base) // nested rules
    } else if ('cssRules' in rule) sheetRules(rule as CSSGroupingRule, out, base)
  }
}

/** Every raster picture the styles of scheme `id` draw on this screen, as full addresses. */
export function themePictureUrls(id: string, doc: Document = document) {
  const selector = new RegExp(`\\[data-theme\\s*=\\s*["']?${id.replace(/[^\w-]/g, '')}["']?\\s*\\]`)
  const rules: Array<{ rule: CSSStyleRule; base: string }> = []
  for (const sheet of Array.from(doc.styleSheets)) sheetRules(sheet, rules, sheet.href ?? doc.baseURI)
  const ratio = window.devicePixelRatio || 1
  const urls = new Set<string>()
  for (const { rule, base } of rules) {
    if (!selector.test(rule.selectorText)) continue
    for (const url of pictureUrls(rule.style.cssText, ratio)) {
      if (!url || url.startsWith('data:') || !RASTER.test(url)) continue
      try { urls.add(new URL(url, base).href) } catch { /* not an address */ }
    }
  }
  return [...urls]
}

const DONE: PreparedTheme = { done: true, promise: Promise.resolve() }

/** Decodes the pictures of scheme `id` (once per screen sharpness), so putting it on draws at once. */
export function prepareTheme(id: string): PreparedTheme {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof window === 'undefined') return DONE
  const key = `${id}@${window.devicePixelRatio || 1}`
  const known = prepared.get(key)
  if (known) {
    prepared.delete(key)
    prepared.set(key, known) // most recent last
    return known
  }
  let urls: string[]
  try { urls = themePictureUrls(id) } catch { urls = [] }
  const images = urls.map((url) => {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    return image
  })
  const entry: PreparedTheme & { images: HTMLImageElement[] } = { done: images.length === 0, promise: Promise.resolve(), images }
  entry.promise = Promise.all(images.map((image) => (typeof image.decode === 'function' ? image.decode() : Promise.resolve()).catch(() => {})))
    .then(() => { entry.done = true })
  prepared.set(key, entry)
  while (prepared.size > KEEP) prepared.delete(prepared.keys().next().value!)
  return entry
}

/** `prepareTheme` when the page has nothing else to do. */
export function prepareThemeWhenIdle(id: () => string, delayMs = 0) {
  if (typeof window === 'undefined') return
  const run = () => { try { prepareTheme(id()) } catch { /* nothing to prepare */ } }
  const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback
  window.setTimeout(() => (idle ? idle(run, { timeout: 3000 }) : run()), delayMs)
}
