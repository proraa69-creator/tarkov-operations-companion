// Wear & damage overlays for the black PVC morale patches on the «Снаряжение» / "Gear" stat cards.
//   node scripts/gear/patch-wear.mjs   -> src/assets/gear/patch-*.webp
// Everything is drawn procedurally on a canvas in Playwright's Chromium (set PW_CHROMIUM to override the path).
// Images are rendered at 2x of their CSS size. Overlays are transparent except for the mark itself;
// the *-cut images are masks: opaque where rubber is MISSING (used with mask-composite: exclude).
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', '..', 'src', 'assets', 'gear')

function lib() {
  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
  }
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')] }
  // smooth 1D value noise for wobbly outlines
  function wobble(seed, n) {
    const r = rng(seed); const v = Array.from({ length: n }, () => r() * 2 - 1)
    return (t) => { const x = ((t % 1) + 1) % 1 * n; const i = Math.floor(x); const f = x - i; const s = f * f * (3 - 2 * f); return v[i % n] * (1 - s) + v[(i + 1) % n] * s }
  }
  // jagged torn line between two points (midpoint displacement + fine fibre jitter)
  function tornLine(seed, a, b, rough, depth = 6) {
    const r = rng(seed)
    let pts = [a, b]
    for (let d = 0; d < depth; d++) {
      const next = [pts[0]]
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i]
        const len = Math.hypot(x1 - x0, y1 - y0); const nx = -(y1 - y0) / len; const ny = (x1 - x0) / len
        const k = (r() * 2 - 1) * len * rough
        next.push([(x0 + x1) / 2 + nx * k, (y0 + y1) / 2 + ny * k], pts[i])
      }
      pts = next
    }
    return pts
  }

  // ---- fine matte-rubber grain: specks, pits and soft mottling (tile) ----
  function grain(size) {
    const [c, g] = canvas(size, size); const r = rng(11)
    const img = g.createImageData(size, size); const d = img.data
    // low-frequency mottling from a few periodic sine blobs
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * Math.PI * 2; const v = y / size * Math.PI * 2
      const m = Math.sin(u * 3 + Math.cos(v * 2) * 1.7) * Math.cos(v * 4 + Math.sin(u * 2)) * 0.5 + Math.sin(u * 7 + v * 5) * 0.2
      const n = r()
      const i = (y * size + x) * 4
      let a = 0; let lum = 0
      if (n > 0.996) { lum = 255; a = 14 + r() * 16 }          // rare dust / raised specks
      else if (n < 0.015) { lum = 0; a = 90 + r() * 70 }        // pits
      else {
        // fine matte micro-texture + soft mottling
        const t = (r() - 0.5) * 2 + m * 0.8
        if (t > 0) { lum = 255; a = t * 7 } else { lum = 0; a = -t * 34 }
      }
      d[i] = d[i + 1] = d[i + 2] = lum; d[i + 3] = a
    }
    g.putImageData(img, 0, 0)
    return c
  }

  // ---- a cluster of fine scratches running in one direction ----
  function scratches(w, h, seed, count, angle) {
    const [c, g] = canvas(w, h); const r = rng(seed)
    g.lineCap = 'round'
    for (let k = 0; k < count; k++) {
      const cx = w * (0.15 + r() * 0.7); const cy = h * (0.15 + r() * 0.7)
      const len = (0.25 + r() * 0.75) * w * 0.55; const a = angle + (r() - 0.5) * 0.18
      const dx = Math.cos(a) * len / 2; const dy = Math.sin(a) * len / 2; const bend = (r() - 0.5) * 10
      const deep = r() < 0.3
      // groove: dark lower lip + light upper lip (lit from the top-left)
      for (const [off, col, lw] of [[1.1, `rgba(0,0,0,${deep ? 0.75 : 0.5})`, deep ? 1.8 : 1.2], [0, `rgba(205,200,188,${deep ? 0.36 : 0.2 + r() * 0.12})`, deep ? 1.3 : 0.8]]) {
        g.strokeStyle = col; g.lineWidth = lw
        // broken into segments: scratches skip where the surface dips
        let t = 0
        while (t < 1) {
          const t1 = Math.min(1, t + 0.08 + r() * 0.35)
          if (r() > 0.15) {
            g.beginPath()
            const p = (s) => [cx - dx + 2 * dx * s + Math.sin(s * Math.PI) * bend * -Math.sin(a), cy - dy + 2 * dy * s + Math.sin(s * Math.PI) * bend * Math.cos(a) + off]
            const [x0, y0] = p(t); g.moveTo(x0, y0)
            for (let s = t; s <= t1; s += 0.02) { const [x, y] = p(s); g.lineTo(x, y) }
            g.stroke()
          }
          t = t1 + 0.02 + r() * 0.05
        }
      }
    }
    // feather everything towards the tile edges so it sits inside the patch
    g.globalCompositeOperation = 'destination-in'
    const f = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.55)
    f.addColorStop(0, '#000'); f.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = f; g.fillRect(0, 0, w, h)
    return c
  }

  // ---- abrasion: a rubbed, lighter, dulled area made of many micro-strokes ----
  function scuff(w, h, seed) {
    const [c, g] = canvas(w, h); const r = rng(seed)
    const halo = g.createRadialGradient(w * 0.5, h * 0.5, 2, w * 0.5, h * 0.5, w * 0.5)
    halo.addColorStop(0, 'rgba(170,166,156,0.12)'); halo.addColorStop(1, 'rgba(190,186,176,0)')
    g.save(); g.translate(w / 2, h / 2); g.scale(1, h / w); g.translate(-w / 2, -w / 2)
    g.fillStyle = halo; g.fillRect(0, 0, w, w); g.restore()
    g.lineCap = 'round'
    for (let k = 0; k < 220; k++) {
      const gx = (r() + r() + r()) / 3; const gy = (r() + r() + r()) / 3
      const x = gx * w; const y = gy * h; const l = 2 + r() * 7; const a = -0.35 + (r() - 0.5) * 0.5
      const fall = 1 - Math.hypot(gx - 0.5, (gy - 0.5) * 1.2) * 1.8
      if (fall <= 0) continue
      g.strokeStyle = `rgba(190,186,176,${(0.07 + r() * 0.16) * fall})`; g.lineWidth = 0.5 + r() * 0.5
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke()
    }
    return c
  }

  // ---- burn: melted glossy crater, bubbled, brownish scorched halo, a little grey ash ----
  function burn(size, seed) {
    const [c, g] = canvas(size, size); const r = rng(seed); const cx = size / 2; const cy = size / 2
    const wob = wobble(seed, 9); const wob2 = wobble(seed + 3, 17)
    const radius = (t, base) => base * (1 + wob(t) * 0.22 + wob2(t) * 0.08)
    const blob = (base, fill) => {
      g.beginPath()
      for (let i = 0; i <= 120; i++) { const t = i / 120; const a = t * Math.PI * 2; const rr = radius(t, base); const x = cx + Math.cos(a) * rr * 1.15; const y = cy + Math.sin(a) * rr; i ? g.lineTo(x, y) : g.moveTo(x, y) }
      g.closePath(); g.fillStyle = fill; g.fill()
    }
    // scorched halo: brown / rust discolouration fading out, a little grey ash on top
    g.filter = 'blur(5px)'
    blob(size * 0.36, 'rgba(62,42,28,0.5)')
    g.filter = 'blur(3px)'
    blob(size * 0.28, 'rgba(84,52,30,0.55)')
    blob(size * 0.3, 'rgba(130,124,116,0.1)')
    g.filter = 'blur(1px)'
    // raised melted lip, lit from the top-left
    blob(size * 0.215, 'rgba(58,38,24,0.95)')
    g.save(); g.translate(-1.2, -1.2); blob(size * 0.2, 'rgba(120,98,80,0.45)'); g.restore()
    // the crater: shrunken, glossy, nearly black
    g.filter = 'none'
    blob(size * 0.18, '#0b0908')
    const gl = g.createRadialGradient(cx - size * 0.05, cy - size * 0.05, 0, cx, cy, size * 0.2)
    gl.addColorStop(0, 'rgba(120,105,95,0.35)'); gl.addColorStop(0.5, 'rgba(40,30,25,0.1)'); gl.addColorStop(1, 'rgba(0,0,0,0)')
    blob(size * 0.18, gl)
    // bubbles and wrinkles in the melt: small rings with a highlight on top-left and shadow under
    for (let k = 0; k < 9; k++) {
      const a = r() * Math.PI * 2; const d = Math.sqrt(r()) * size * 0.14; const x = cx + Math.cos(a) * d * 1.1; const y = cy + Math.sin(a) * d; const br = 0.8 + r() * 2.2
      g.beginPath(); g.arc(x + 0.6, y + 0.7, br, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,0.7)'; g.fill()
      g.beginPath(); g.arc(x, y, br, 0, Math.PI * 2); g.fillStyle = 'rgba(30,24,20,1)'; g.fill()
      g.beginPath(); g.arc(x - br * 0.35, y - br * 0.35, br * 0.4, 0, Math.PI * 2); g.fillStyle = `rgba(200,188,175,${0.1 + r() * 0.15})`; g.fill()
    }
    // a couple of soot streaks outwards
    g.filter = 'blur(1.5px)'; g.lineCap = 'round'
    for (let k = 0; k < 4; k++) {
      const a = r() * Math.PI * 2; g.strokeStyle = 'rgba(40,24,14,0.45)'; g.lineWidth = 2 + r() * 2
      g.beginPath(); g.moveTo(cx + Math.cos(a) * size * 0.18, cy + Math.sin(a) * size * 0.16); g.lineTo(cx + Math.cos(a) * size * 0.33, cy + Math.sin(a) * size * 0.29); g.stroke()
    }
    g.filter = 'none'
    return c
  }

  // ---- torn-off corner (bottom-left): cut mask + edge overlay ----
  function tornPoints(w, h, seed) {
    return tornLine(seed, [0, h * 0.06], [w * 0.97, h], 0.2, 7)
  }
  function tearCut(w, h, seed) {
    const [c, g] = canvas(w, h); const pts = tornPoints(w, h, seed)
    g.beginPath(); g.moveTo(0, 0); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(w, h + 2); g.lineTo(-2, h + 2); g.closePath()
    // opaque where the rubber is gone
    g.beginPath(); g.moveTo(-2, pts[0][1]); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(w, h + 4); g.lineTo(-2, h + 4); g.closePath()
    g.fillStyle = '#000'; g.fill()
    return c
  }
  function tearEdge(w, h, seed) {
    const [c, g] = canvas(w, h); const r = rng(seed + 7); const pts = tornPoints(w, h, seed)
    const path = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))) }
    // keep drawing on the remaining rubber only
    g.save()
    g.beginPath(); g.moveTo(-2, -2); g.lineTo(w + 2, -2); g.lineTo(w + 2, h + 2); pts.slice().reverse().forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(-2, pts[0][1]); g.closePath(); g.clip()
    // stressed, whitened rubber along the rip (stretch marks), then the fresh grey tear face
    path(); g.strokeStyle = 'rgba(140,136,126,0.14)'; g.lineWidth = 12; g.filter = 'blur(2px)'; g.stroke(); g.filter = 'none'
    path(); g.strokeStyle = 'rgba(66,65,61,0.95)'; g.lineWidth = 5; g.stroke()
    path(); g.strokeStyle = 'rgba(112,109,102,0.75)'; g.lineWidth = 2; g.stroke()
    // stretch whitening streaks perpendicular to the edge
    g.lineCap = 'round'
    for (let i = 2; i < pts.length - 2; i += 2) {
      if (r() > 0.55) continue
      const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i + 1]; const len = Math.hypot(x1 - x0, y1 - y0) || 1
      const nx = -(y1 - y0) / len; const ny = (x1 - x0) / len; const l = 3 + r() * 7
      g.strokeStyle = `rgba(175,170,160,${0.12 + r() * 0.2})`; g.lineWidth = 0.8
      g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i][0] - nx * l, pts[i][1] - ny * l); g.stroke()
    }
    g.restore()
    return c
  }

  // ---- small nick / chip bitten out of an edge (edge at the top of the image) ----
  function chipPoints(w, h, seed) {
    const r = rng(seed); const pts = []
    for (let i = 0; i <= 24; i++) {
      const t = i / 24; const x = w * (0.08 + t * 0.84)
      const depth = Math.pow(Math.sin(t * Math.PI), 0.7) * h * (0.78 + (r() - 0.5) * 0.35)
      pts.push([x, depth])
    }
    return pts
  }
  function chipCut(w, h, seed) {
    const [c, g] = canvas(w, h); const pts = chipPoints(w, h, seed)
    g.beginPath(); g.moveTo(pts[0][0], -2); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(pts[pts.length - 1][0], -2); g.closePath()
    g.fillStyle = '#000'; g.fill()
    return c
  }
  function chipEdge(w, h, seed) {
    const [c, g] = canvas(w, h); const pts = chipPoints(w, h, seed)
    g.save(); g.beginPath(); g.moveTo(-2, -2); g.lineTo(pts[0][0], -2); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(pts[pts.length - 1][0], -2); g.lineTo(w + 2, -2); g.lineTo(w + 2, h + 2); g.lineTo(-2, h + 2); g.closePath(); g.clip()
    const path = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))) }
    path(); g.strokeStyle = 'rgba(88,86,80,0.95)'; g.lineWidth = 4; g.stroke()
    path(); g.strokeStyle = 'rgba(140,136,126,0.6)'; g.lineWidth = 1.6; g.stroke()
    g.restore()
    return c
  }
  // rotate a canvas by 90° steps (chip on the left edge etc.)
  function rot(src, quarter) {
    const w = quarter % 2 ? src.height : src.width; const h = quarter % 2 ? src.width : src.height
    const [c, g] = canvas(w, h); g.translate(w / 2, h / 2); g.rotate(quarter * Math.PI / 2); g.drawImage(src, -src.width / 2, -src.height / 2)
    return c
  }
  // ---- the patch's back: stiff black hook velcro (seen on the peeled corner) ----
  function hook(size) {
    const [c, g] = canvas(size, size); const r = rng(31)
    g.fillStyle = '#1c1c1a'; g.fillRect(0, 0, size, size)
    for (let y = 1; y < size; y += 3) for (let x = 1 + (y % 2) * 1.5; x < size; x += 3) {
      const jx = x + (r() - 0.5) * 0.8; const jy = y + (r() - 0.5) * 0.8
      g.beginPath(); g.arc(jx + 0.4, jy + 0.5, 1, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,0.8)'; g.fill()
      g.beginPath(); g.arc(jx, jy, 0.85, 0, Math.PI * 2); g.fillStyle = `rgb(${70 + r() * 30},${70 + r() * 30},${64 + r() * 28})`; g.fill()
    }
    return c
  }
  return { hook, grain, scratches, scuff, burn, tearCut, tearEdge, chipCut, chipEdge, rot }
}

const jobs = [
  // [file, expression, quality]  (sizes are 2x the CSS size)
  ['patch-grain.webp', 'L.grain(256)', 0.8],
  ['patch-hook.webp', 'L.hook(64)', 0.9],
  ['patch-scratch-a.webp', 'L.scratches(360, 120, 5, 14, -0.32)', 0.92],
  ['patch-scratch-b.webp', 'L.scratches(200, 90, 23, 7, 0.55)', 0.92],
  ['patch-scuff.webp', 'L.scuff(140, 80, 3)', 0.92],
  ['patch-burn.webp', 'L.burn(96, 4)', 0.92],
  ['patch-tear-cut.webp', 'L.tearCut(92, 60, 9)', 1],
  ['patch-tear-edge.webp', 'L.tearEdge(92, 60, 9)', 0.95],
  ['patch-chip-cut.webp', 'L.chipCut(36, 16, 2)', 1],
  ['patch-chip-edge.webp', 'L.chipEdge(36, 16, 2)', 0.95],
  ['patch-nick-cut.webp', 'L.rot(L.chipCut(20, 10, 6), 3)', 1],
  ['patch-nick-edge.webp', 'L.rot(L.chipEdge(20, 10, 6), 3)', 0.95],
]

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.evaluate(`window.L = (${lib.toString()})()`)
await mkdir(out, { recursive: true })
for (const [file, expr, q] of jobs) {
  const data = await page.evaluate(([e, quality]) => (0, eval)(e).toDataURL('image/webp', quality), [expr, q])
  const buf = Buffer.from(data.split(',')[1], 'base64')
  await writeFile(join(out, file), buf)
  console.log(`${file.padEnd(24)} ${(buf.length / 1024).toFixed(1).padStart(6)} KB`)
}
await browser.close()
