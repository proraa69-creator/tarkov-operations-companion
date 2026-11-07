// Writes src/startup/intro.html, the markup of the start intro, from the brand artwork in build/brand.
// Usage: node scripts/startup-intro.mjs (only when the logo changes; the result is committed).
//
// The markup stands in index.html, so the intro is on screen before the app's code has even been read. Everything in it
// moves by opacity and transform on elements of their own, which the graphics process animates by itself while the
// app's code keeps the page's main thread busy. That is why the stitch is 25 small pictures and not one animated path.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const STITCH_PATH = 'M68.64 22H187.36C226.58 22 234 29.42 234 68.64V187.36C234 226.58 226.58 234 187.36 234H68.64C29.42 234 22 226.58 22 187.36V68.64C22 29.42 29.42 22 68.64 22Z'
const LEG_CLIP = [[115.904, 132.0824], [198.4, 132.0824], [198.4, 206.04], [130.016, 206.04]]
const TILE = 256
const NAME_WIDTH = 623.75
/** Of each stitch step, the part drawn (the logo's dash 6, gap 4.5). */
const DASH_SHARE = 0.57
const DASH_STEP = 10.5
/** Dashes that appear together: at 8 ms a dash a screen shows two or three in one frame anyway. */
const DASHES_PER_PICTURE = 3
/** The stitch starts at the top centre of the patch and takes this long to go round it. */
const STITCH_START = 59.36
const STITCH_MS = 640
/** Half the thick bright stroke, and a little more. */
const STROKE_ROOM = 2.2

const percent = (value, whole) => +(value / whole * 100).toFixed(3)

function stitchLengthTable() {
  const [, x0, y0] = STITCH_PATH.match(/^M([\d.]+) ([\d.]+)/)
  const points = [[+x0, +y0]]
  const last = () => points[points.length - 1]
  for (const [, command, args] of STITCH_PATH.matchAll(/([HVC])([^HVCZ]+)/g)) {
    const n = args.trim().split(/\s+/).map(Number)
    if (command === 'H') points.push([n[0], last()[1]])
    if (command === 'V') points.push([last()[0], n[0]])
    if (command === 'C') {
      const [px, py] = last()
      for (let i = 1; i <= 200; i++) {
        const t = i / 200
        const u = 1 - t
        points.push([
          u * u * u * px + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t * t * t * n[4],
          u * u * u * py + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t * t * t * n[5],
        ])
      }
    }
  }
  points.push(points[0])
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  return { points, lengths, total: lengths[lengths.length - 1] }
}

function pointAt({ points, lengths, total }, at) {
  const length = ((at % total) + total) % total
  let low = 0
  let high = lengths.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (lengths[middle] <= length) low = middle
    else high = middle
  }
  const share = (length - lengths[low]) / ((lengths[high] - lengths[low]) || 1)
  return [points[low][0] + (points[high][0] - points[low][0]) * share, points[low][1] + (points[high][1] - points[low][1]) * share]
}

function stitchPictures() {
  const table = stitchLengthTable()
  const count = Math.round(table.total / DASH_STEP)
  const step = table.total / count
  const pictures = []
  for (let first = 0; first < count; first += DASHES_PER_PICTURE) {
    const dashes = []
    for (let i = first; i < Math.min(first + DASHES_PER_PICTURE, count); i++) {
      const at = STITCH_START + i * step
      dashes.push([pointAt(table, at), pointAt(table, at + step * DASH_SHARE)])
    }
    const all = dashes.flat()
    const left = Math.min(...all.map((p) => p[0])) - STROKE_ROOM
    const top = Math.min(...all.map((p) => p[1])) - STROKE_ROOM
    const width = Math.max(...all.map((p) => p[0])) + STROKE_ROOM - left
    const height = Math.max(...all.map((p) => p[1])) + STROKE_ROOM - top
    const path = dashes.map(([a, b]) => `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`).join('')
    const place = `left:${percent(left, TILE)}%;top:${percent(top, TILE)}%;width:${percent(width, TILE)}%;height:${percent(height, TILE)}%;--k:${Math.round(first / count * STITCH_MS)}`
    const picture = (name) => `<svg class="${name}" style="${place}" viewBox="${left.toFixed(2)} ${top.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}"><path d="${path}"/></svg>`
    // Twice: the thin one stays, the thick bright one over it fades. Each has only one animation: two of them on one element would
    // be run by the page's own thread, and stop when the page is busy.
    pictures.push(picture('si-d'), picture('si-d si-hot'))
  }
  return pictures.join('')
}

/**
 * The thread that turns while the app loads: the whole stitch as a mask, in the stroke each size of the logo needs, and behind it one
 * bright arc that turns (src/startup/intro.css).
 */
function turningThread() {
  const table = stitchLengthTable()
  const count = Math.round(table.total / DASH_STEP)
  const step = table.total / count
  let path = ''
  for (let i = 0; i < count; i++) {
    const at = STITCH_START + i * step
    const [a, b] = [pointAt(table, at), pointAt(table, at + step * DASH_SHARE)]
    path += `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`
  }
  const mask = (width) => "url('data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}"><path d="${path}" fill="none" stroke="#000" stroke-width="${width}"/></svg>`).replace(/'/g, '%27') + "')"
  return `<div class="si-spin" style="--si-m3:${mask(3.4)};--si-m5:${mask(5)};--si-m7:${mask(7)}"><i></i></div>`
}

const box = (text, what) => {
  if (!text) throw new Error(`${what} not found in build/brand`)
  return text
}

function letters(nameSvg) {
  const found = []
  for (const [, d, fill] of nameSvg.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)) {
    for (const sub of d.match(/M[^M]*/g)) {
      const n = sub.match(/-?\d*\.?\d+/g).map(Number)
      const xs = n.filter((_, i) => i % 2 === 0)
      const x0 = Math.min(...xs)
      const x1 = Math.max(...xs)
      const previous = found[found.length - 1]
      // A closed part inside the last letter (the hole of the D, the A, the O) belongs to it.
      if (previous && x0 >= previous.x0 && x1 <= previous.x1 && previous.fill === fill) { previous.d += sub; continue }
      found.push({ x0, x1, d: sub, fill })
    }
  }
  if (found.length !== 6) throw new Error(`expected the 6 letters of RAID OS, got ${found.length}`)
  return found.map((letter, i) => {
    const x = +(letter.x0 - 1).toFixed(2)
    const width = +(letter.x1 - letter.x0 + 2).toFixed(2)
    const os = letter.fill === '#a9b973'
    return `<span class="si-l${os ? ' si-os' : ''}" style="--i:${i};left:${percent(x + 2, NAME_WIDTH)}%;width:${percent(width, NAME_WIDTH)}%"><svg viewBox="${x} -2 ${width} 125.5" preserveAspectRatio="none"><path d="${letter.d.trim()}"/></svg></span>`
  }).join('')
}

const icon = await readFile('build/brand/icon.svg', 'utf8')
const nameSvg = await readFile('build/brand/name.svg', 'utf8')
const R = box(icon.match(/<g clip-path="url\(#nl168\)"><path d="([^"]+)"/)?.[1], 'the R')
const stitchAt = icon.indexOf('<path d="M68.64 22H')
if (stitchAt < 0) throw new Error('the stitch not found in build/brand/icon.svg')
// The patch without its stitch and without the R: those two are drawn by the intro.
const surface = `${icon.slice(0, stitchAt)}</svg>`
const tile = await sharp(Buffer.from(surface), { density: 288 }).resize(640, 640).webp({ quality: 72, alphaQuality: 90 }).toBuffer()

const clipPoints = LEG_CLIP.map((p) => p.join(',')).join(' ')
const clipPath = `M${LEG_CLIP.map((p) => p.join(' ')).join('L')}Z`
const markup = `<!-- Written by scripts/startup-intro.mjs from build/brand. Inlined into index.html by vite.config.ts. -->
<div id="startup-intro" aria-hidden="true"><div class="si-lockup"><div class="si-mk"><img class="si-tile" src="data:image/webp;base64,${tile.toString('base64')}" alt="" draggable="false" decoding="sync">${stitchPictures()}${turningThread()}<div class="si-shock"></div><svg class="si-fill si-body" viewBox="0 0 ${TILE} ${TILE}"><clipPath id="si-c-body"><path clip-rule="evenodd" d="M-999 -999H2999V2999H-999Z ${clipPath}"/></clipPath><g clip-path="url(#si-c-body)"><path fill="#ecede8" d="${R}"/></g></svg><div class="si-rclip"><svg class="si-fill si-leg" viewBox="0 0 ${TILE} ${TILE}"><clipPath id="si-c-leg"><polygon points="${clipPoints}"/></clipPath><g clip-path="url(#si-c-leg)"><path fill="#a9b973" d="${R}"/></g></svg></div></div><div class="si-nm">${letters(nameSvg)}</div></div></div>
`

await mkdir('src/startup', { recursive: true })
await writeFile('src/startup/intro.html', markup)
console.log(`src/startup/intro.html: ${markup.length} characters, the patch ${tile.length} bytes`)
