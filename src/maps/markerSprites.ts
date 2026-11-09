/**
 * The pictures of the map points drawn on one canvas (MarkerCanvasLayer.tsx; report №104): each kind of point is drawn
 * once into a small bitmap — the same picture, size and shadow its DOM icon has (MapsPage markerIcon / containerIcon /
 * documentIcon, pages.css) — and the canvas stamps it at every point.
 */
export interface SpriteSpec {
  /** The picture (an asset URL or an SVG data URL); none: a plate only (the «minimal» style draws its plate). */
  src?: string
  /** The icon's box and where the point sits in it, CSS pixels. */
  size: readonly [number, number]
  anchor: readonly [number, number]
  /** The CSS filter of the icon (its drop shadows). */
  filter?: string
  /** «minimal»: the coloured plate under the glyph. */
  plate?: { color: string; shape: 'circle' | 'rounded' | 'diamond' }
  /** The floor's badge in the corner («2», «Подвал»). */
  badge?: string
  /** «+1» for a second document kind. */
  more?: string
  /** A short name under the icon (a key's). */
  name?: string
  /** The dashed «maybe here» ring, in this colour. */
  possible?: string
  /** Behind a locked door: a very small padlock at the bottom left (report №114). */
  lock?: boolean
}

export interface Sprite {
  canvas: HTMLCanvasElement
  /** CSS pixels: the bitmap's box and where the point sits in it. */
  width: number
  height: number
  anchorX: number
  anchorY: number
  /** The icon's own box inside the bitmap, for the hit test. */
  hit: { x: number; y: number; width: number; height: number }
}

/** Room around the icon for its shadow, badge, ring and name. */
const PAD = 14
const NAME_ROOM = 24

const images = new Map<string, HTMLImageElement | 'loading' | 'failed'>()
const sprites = new Map<string, Sprite | null>()
const waiting = new Set<() => void>()

export function spriteKey(spec: SpriteSpec) {
  return JSON.stringify(spec)
}

/** Called once a picture that a sprite waited for has loaded. */
export function onSpritesReady(listener: () => void) {
  waiting.add(listener)
  return () => { waiting.delete(listener) }
}

function image(src: string) {
  const known = images.get(src)
  if (known) return known
  const next = new Image()
  next.decoding = 'async'
  images.set(src, 'loading')
  next.onload = () => {
    images.set(src, next)
    for (const [key, sprite] of sprites) if (sprite === null) sprites.delete(key)
    for (const listener of waiting) listener()
  }
  next.onerror = () => { images.set(src, 'failed') }
  next.src = src
  return 'loading' as const
}

/**
 * Whether points go on the canvas: a real browser. jsdom (the tests) has no 2D canvas, so there they stay DOM icons.
 */
export const canvasMarkers = typeof document !== 'undefined' && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent)

/** The ratio the bitmaps are drawn at (sharp on HiDPI screens). */
export function pixelRatio() {
  return Math.min(3, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1))
}

/** The bitmap of one kind of point; null while its picture loads (onSpritesReady then). */
export function sprite(spec: SpriteSpec): Sprite | null {
  const key = spriteKey(spec)
  if (sprites.has(key)) return sprites.get(key)!
  let picture: HTMLImageElement | null = null
  if (spec.src) {
    const loaded = image(spec.src)
    if (loaded === 'loading') { sprites.set(key, null); return null }
    if (loaded !== 'failed') picture = loaded
  }
  const made = draw(spec, picture)
  sprites.set(key, made)
  return made
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

function draw(spec: SpriteSpec, picture: HTMLImageElement | null): Sprite | null {
  if (typeof document === 'undefined') return null
  const [width, height] = spec.size
  const ratio = pixelRatio()
  const boxWidth = width + PAD * 2
  const boxHeight = height + PAD * 2 + (spec.name ? NAME_ROOM : 0)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(boxWidth * ratio)
  canvas.height = Math.ceil(boxHeight * ratio)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.scale(ratio, ratio)
  const x = PAD, y = PAD
  // the icon with its shadows: a canvas filter where the browser has one, a plain shadow elsewhere
  context.save()
  if (spec.filter && 'filter' in context) context.filter = spec.filter
  else { context.shadowColor = 'rgba(0,0,0,.75)'; context.shadowBlur = 3; context.shadowOffsetY = 1 }
  if (spec.plate) {
    context.fillStyle = spec.plate.color
    if (spec.plate.shape === 'circle') { context.beginPath(); context.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2 - 2, 0, Math.PI * 2); context.fill() }
    else if (spec.plate.shape === 'diamond') { context.translate(x + width / 2, y + height / 2); context.rotate(Math.PI / 4); context.fillRect(-(width - 6) / 2, -(height - 6) / 2, width - 6, height - 6); context.setTransform(ratio, 0, 0, ratio, 0, 0) }
    else { roundRect(context, x + 2, y + 2, width - 4, height - 4, 7); context.fill() }
  }
  if (picture) {
    // object-fit: contain
    const scale = Math.min(width / (picture.naturalWidth || width), height / (picture.naturalHeight || height))
    const drawWidth = (picture.naturalWidth || width) * scale, drawHeight = (picture.naturalHeight || height) * scale
    const inset = spec.plate ? Math.round(width * 0.22) : 0
    context.drawImage(picture, x + (width - drawWidth) / 2 + inset / 2, y + (height - drawHeight) / 2 + inset / 2, drawWidth - inset, drawHeight - inset)
  }
  context.restore()
  if (spec.possible) {
    context.save()
    context.strokeStyle = spec.possible
    context.lineWidth = 1.5
    context.setLineDash([4, 3])
    context.globalAlpha = 0.9
    context.beginPath()
    context.arc(x + width / 2, y + height / 2, Math.max(width, height) / 2 + 4, 0, Math.PI * 2)
    context.stroke()
    context.restore()
  }
  context.font = '900 9px system-ui, sans-serif'
  const chip = (text: string, right: number, top: number, background: string, color: string) => {
    const textWidth = context.measureText(text).width
    const chipWidth = Math.max(14, textWidth + 6)
    context.save()
    context.shadowColor = 'rgba(0,0,0,.55)'; context.shadowBlur = 4; context.shadowOffsetY = 1
    context.fillStyle = background
    roundRect(context, right - chipWidth, top, chipWidth, 14, 7)
    context.fill()
    context.restore()
    context.fillStyle = color
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, right - chipWidth / 2, top + 7.5)
  }
  if (spec.lock) {
    // the padlock: shackle and body, dark outline, at the icon's bottom-left corner
    const lx = x - 2, ly = y + height - 9
    context.save()
    context.lineWidth = 1.6
    context.strokeStyle = '#1a1a12'
    context.beginPath()
    context.arc(lx + 4.5, ly + 3, 2.3, Math.PI, 0)
    context.stroke()
    context.fillStyle = '#f2d27a'
    context.lineWidth = 1
    roundRect(context, lx + 1, ly + 3, 7, 5.6, 1.2)
    context.fill()
    context.stroke()
    context.restore()
  }
  if (spec.more) chip(spec.more, x + width + 7, y - 4, 'rgba(14,18,16,.92)', '#f2ead2')
  if (spec.badge) chip(spec.badge, x + width + 6, y - 5, '#e9dcb8', '#1a1a12')
  if (spec.name) {
    context.font = '700 9px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'top'
    context.fillStyle = '#f6f1df'
    context.shadowColor = '#000'; context.shadowBlur = 2
    const words = spec.name.split(/\s+/)
    const lines: string[] = []
    for (const word of words) {
      const last = lines[lines.length - 1]
      if (last !== undefined && context.measureText(`${last} ${word}`).width <= 58) lines[lines.length - 1] = `${last} ${word}`
      else lines.push(word)
    }
    lines.slice(0, 2).forEach((line, index) => context.fillText(line, x + width / 2, y + height + 1 + index * 9.5))
  }
  return { canvas, width: boxWidth, height: boxHeight, anchorX: x + spec.anchor[0], anchorY: y + spec.anchor[1], hit: { x, y, width, height } }
}

/** For tests. */
export function resetSprites() {
  images.clear()
  sprites.clear()
}
