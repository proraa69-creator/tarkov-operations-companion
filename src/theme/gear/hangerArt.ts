/**
 * Canvas art for the Gear theme's hanging kit. Every piece is painted once per device-pixel scale into an
 * offscreen canvas (lit from the top-left like the textures), together with a soft shadow silhouette.
 * The physics layer then only rotates and blits them. All designs are original, generic field kit.
 */
export type PieceKind = 'dogtag' | 'dogtagSilenced' | 'carabiner' | 'cordlock' | 'strapTip'

export interface Piece {
  image: HTMLCanvasElement
  shadow: HTMLCanvasElement
  /** Size in CSS px. */
  w: number
  h: number
  /** Where the rope attaches, CSS px from the top-left of the piece. */
  pivotX: number
  pivotY: number
}

const PAD = 6 // room for the blurred shadow

function surface(w: number, h: number, scale: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((w + PAD * 2) * scale)
  canvas.height = Math.ceil((h + PAD * 2) * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.translate(PAD, PAD)
  return { canvas, ctx }
}

function silhouette(src: HTMLCanvasElement, scale: number, blur: number, alpha: number) {
  const canvas = document.createElement('canvas')
  canvas.width = src.width; canvas.height = src.height
  const ctx = canvas.getContext('2d')!
  ctx.filter = `blur(${blur * scale}px)`
  ctx.drawImage(src, 0, 0)
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = `rgba(6, 7, 4, ${alpha})`
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

function finish(kind: PieceKind, image: HTMLCanvasElement, scale: number, w: number, h: number, pivotX: number, pivotY: number): Piece {
  void kind
  return { image, shadow: silhouette(image, scale, 1.6, 0.55), w, h, pivotX, pivotY }
}

/** Stamped stainless tag with a rolled rim, notch, chain hole and embossed lines; optional rubber silencer. */
function dogtag(scale: number, silenced: boolean, lines: string[]): Piece {
  const w = 22, h = 36
  const { canvas, ctx } = surface(w, h, scale)
  const outline = () => {
    ctx.beginPath()
    ctx.moveTo(5, 0); ctx.lineTo(w - 5, 0); ctx.quadraticCurveTo(w, 0, w, 5)
    ctx.lineTo(w, h - 5); ctx.quadraticCurveTo(w, h, w - 5, h); ctx.lineTo(5, h); ctx.quadraticCurveTo(0, h, 0, h - 5)
    ctx.lineTo(0, 22); ctx.quadraticCurveTo(2.6, 20, 0, 18) // side notch
    ctx.lineTo(0, 5); ctx.quadraticCurveTo(0, 0, 5, 0); ctx.closePath()
  }
  // brushed steel body
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#f2f4f2'); g.addColorStop(0.28, '#b9bdbd'); g.addColorStop(0.55, '#8d9291'); g.addColorStop(0.78, '#c3c7c5'); g.addColorStop(1, '#6f7473')
  outline(); ctx.fillStyle = g; ctx.fill()
  ctx.save(); outline(); ctx.clip()
  for (let y = 0.5; y < h; y += 0.9) {
    ctx.strokeStyle = `rgba(${y % 2.7 < 1 ? '255,255,255' : '0,0,0'},${0.04 + ((y * 7.13) % 1) * 0.05})`
    ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + 0.3); ctx.stroke()
  }
  // soft specular sheen across the upper-left
  const sheen = ctx.createRadialGradient(5, 6, 0, 5, 6, 18)
  sheen.addColorStop(0, 'rgba(255,255,255,.55)'); sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen; ctx.fillRect(0, 0, w, h)
  // rolled rim: light on the top-left inside edge, dark on the bottom-right
  ctx.lineWidth = 1
  ctx.save(); ctx.translate(0.6, 0.6); ctx.scale((w - 1.2) / w, (h - 1.2) / h); outline(); ctx.restore()
  ctx.strokeStyle = 'rgba(40,44,44,.55)'; ctx.stroke()
  ctx.save(); ctx.translate(1.6, 1.6); ctx.scale((w - 3.2) / w, (h - 3.2) / h); outline(); ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke()
  // embossed text (raised letters): highlight up-left, shadow down-right, then the face
  ctx.font = '700 3.6px "Roboto Mono", ui-monospace, monospace'
  ctx.textBaseline = 'top'
  lines.forEach((line, i) => {
    const y = 10 + i * 5.2
    ctx.fillStyle = 'rgba(30,32,32,.55)'; ctx.fillText(line, 3.9, y + 0.45, w - 7)
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText(line, 3.3, y - 0.3, w - 7)
    ctx.fillStyle = '#a6abaa'; ctx.fillText(line, 3.5, y, w - 7)
  })
  ctx.restore()
  // chain hole
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath(); ctx.arc(w / 2, 4, 1.5, 0, Math.PI * 2); ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  ctx.strokeStyle = 'rgba(40,42,42,.8)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(w / 2, 4, 1.8, 0, Math.PI * 2); ctx.stroke()
  if (silenced) {
    // black rubber silencer ring around the edge
    outline(); ctx.lineWidth = 2.6; ctx.strokeStyle = '#161714'; ctx.stroke()
    ctx.save(); ctx.translate(-0.5, -0.5); outline(); ctx.restore()
    ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(160,165,150,.35)'; ctx.stroke()
  }
  return finish(silenced ? 'dogtagSilenced' : 'dogtag', canvas, scale, w, h, w / 2, 4)
}

/** Black anodised D-carabiner with a lighter wire gate and a small maker's etch. */
function carabiner(scale: number): Piece {
  const w = 16, h = 30
  const { canvas, ctx } = surface(w, h, scale)
  const body = () => {
    ctx.beginPath()
    ctx.moveTo(4.5, 5); ctx.quadraticCurveTo(4.5, 1.5, 8, 1.5); ctx.quadraticCurveTo(13.5, 1.5, 13.5, 8)
    ctx.lineTo(13.5, 22); ctx.quadraticCurveTo(13.5, 28.5, 8, 28.5); ctx.quadraticCurveTo(2.5, 28.5, 2.5, 22)
    ctx.lineTo(2.5, 10)
  }
  // body stroke with a round-tube shading: dark base, lit crest on the upper-left
  body(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.lineWidth = 3.2; ctx.strokeStyle = '#131412'; ctx.stroke()
  body(); ctx.lineWidth = 2.2
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#6c7068'); g.addColorStop(0.45, '#2c2e2a'); g.addColorStop(1, '#1a1b18')
  ctx.strokeStyle = g; ctx.stroke()
  ctx.save(); ctx.translate(-0.55, -0.55); body(); ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(220,226,210,.55)'; ctx.stroke(); ctx.restore()
  // gate (spring wire) on the left side with a gap at the nose
  ctx.beginPath(); ctx.moveTo(2.5, 10); ctx.lineTo(4.3, 5.4)
  ctx.lineWidth = 1.3; ctx.strokeStyle = '#a7aca2'; ctx.stroke()
  ctx.beginPath(); ctx.moveTo(2.2, 9.6); ctx.lineTo(4, 5)
  ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.stroke()
  // etch on the spine
  ctx.fillStyle = 'rgba(150,152,140,.5)'
  for (let i = 0; i < 3; i++) ctx.fillRect(12.8, 13 + i * 2.2, 1.2, 0.6)
  return finish('carabiner', canvas, scale, w, h, 8, 1.5)
}

/** Spring cord lock (barrel) with a coyote paracord knot below — a zipper / flap pull. */
function cordlock(scale: number): Piece {
  const w = 12, h = 26
  const { canvas, ctx } = surface(w, h, scale)
  // cord strands entering the lock
  ctx.strokeStyle = '#6f5b3e'; ctx.lineWidth = 1.6
  ctx.beginPath(); ctx.moveTo(4.6, 0); ctx.lineTo(5, 5); ctx.moveTo(7.4, 0); ctx.lineTo(7, 5); ctx.stroke()
  // barrel
  const b = ctx.createLinearGradient(1, 0, 11, 0)
  b.addColorStop(0, '#4a4c47'); b.addColorStop(0.28, '#262724'); b.addColorStop(0.75, '#121311'); b.addColorStop(1, '#0a0a09')
  ctx.fillStyle = b; ctx.beginPath(); ctx.roundRect(1.5, 4, 9, 11, 3); ctx.fill()
  ctx.strokeStyle = 'rgba(200,205,190,.25)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(3, 5.4); ctx.lineTo(3, 13.2); ctx.stroke()
  // grip ribs
  ctx.fillStyle = 'rgba(0,0,0,.55)'; for (let i = 0; i < 3; i++) ctx.fillRect(2.4, 7 + i * 2.2, 7.2, 0.6)
  ctx.fillStyle = 'rgba(255,255,255,.12)'; for (let i = 0; i < 3; i++) ctx.fillRect(2.4, 6.4 + i * 2.2, 7.2, 0.5)
  // cord between lock and knot
  ctx.strokeStyle = '#6f5b3e'; ctx.lineWidth = 1.6
  ctx.beginPath(); ctx.moveTo(5, 15); ctx.lineTo(5.4, 18.5); ctx.moveTo(7, 15); ctx.lineTo(6.6, 18.5); ctx.stroke()
  // overhand knot: a lumpy braided ball
  const k = ctx.createRadialGradient(4.6, 19.8, 0.4, 6, 21.5, 5)
  k.addColorStop(0, '#c8b28a'); k.addColorStop(0.5, '#8b7453'); k.addColorStop(1, '#4b3d2a')
  ctx.fillStyle = k; ctx.beginPath(); ctx.ellipse(6, 21.3, 3.5, 3.1, 0.2, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(40,30,18,.6)'; ctx.lineWidth = 0.45
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(3 + i * 1.3, 18.8); ctx.lineTo(2.4 + i * 1.5, 23.9); ctx.stroke() }
  // frayed / melted cord ends
  ctx.strokeStyle = '#6f5b3e'; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(5.2, 24); ctx.lineTo(4.6, 25.6); ctx.moveTo(6.9, 24); ctx.lineTo(7.6, 25.4); ctx.stroke()
  ctx.fillStyle = '#3a2f22'; ctx.beginPath(); ctx.arc(4.5, 25.7, 0.8, 0, 7); ctx.arc(7.7, 25.5, 0.8, 0, 7); ctx.fill()
  return finish('cordlock', canvas, scale, w, h, 6, 0)
}

/** Aluminium crimp tip at the end of a webbing tail. */
function strapTip(scale: number): Piece {
  const w = 10, h = 8
  const { canvas, ctx } = surface(w, h, scale)
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#5a5c55'); g.addColorStop(0.5, '#2a2b27'); g.addColorStop(1, '#141512')
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h - 3); ctx.quadraticCurveTo(w, h, w - 3, h); ctx.lineTo(3, h); ctx.quadraticCurveTo(0, h, 0, h - 3); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = 'rgba(230,232,220,.45)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(0.6, h - 2); ctx.lineTo(0.6, 0.6); ctx.lineTo(w - 0.6, 0.6); ctx.stroke()
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(1.5, 2.2, w - 3, 0.6)
  return finish('strapTip', canvas, scale, w, h, w / 2, 0)
}

export function paintPieces(scale: number, tagLines: [string[], string[]]) {
  return {
    dogtag: dogtag(scale, false, tagLines[0]),
    dogtagSilenced: dogtag(scale, true, tagLines[1]),
    carabiner: carabiner(scale),
    cordlock: cordlock(scale),
    strapTip: strapTip(scale),
  } satisfies Record<PieceKind, Piece>
}

export const PIECE_PAD = PAD
