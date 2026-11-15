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
  return Math.ceil(far * 1.03 + 4)
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
    const transition = doc.startViewTransition!(apply)
    void transition.finished.catch(() => {}).finally(() => { if (change === pendingChange) root.removeAttribute('data-theme-motion') })
  }
  if (!prepared || prepared.done) { start(); return }
  let started = false
  const once = () => { if (!started) { started = true; start() } }
  void prepared.promise.then(once, once)
  window.setTimeout(once, PREPARE_WAIT_MS)
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
