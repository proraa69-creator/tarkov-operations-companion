// «Кровавая луна» background (owner, 31.10.2026: «возьми картинку… персонажей, зомби… фон отсюда… надписи удали, а всё
// остальное оставь»): the owner's main-menu screenshot of Escape from Tarkov with the game's interface taken out — the
// logo, the season banner, the menu items, the corner labels and the bottom bar — filled from the picture around them
// (pieces of the picture itself, guided by a smooth push-pull fill: see below), then darkened at the centre where the
// pages sit and given a little grain.
//   node scripts/textures/bloodmoon-background.mjs <screenshot> src/assets/textures/bloodmoon/background.webp
import sharp from 'sharp'

const [input, output] = process.argv.slice(2)
if (!input || !output) { console.error('usage: node scripts/textures/bloodmoon-background.mjs <in> <out.webp>'); process.exit(1) }

const source = sharp(input)
const meta = await source.metadata()
// The holes, in the coordinates of a 1080 × 606 screenshot (scaled to the real size).
const sx = meta.width / 1080, sy = meta.height / 606
const holes = [
  [262, 40, 800, 232],   // ESCAPE FROM TARKOV logo
  [340, 236, 742, 314],  // season banner
  [398, 320, 690, 552],  // menu items
  [0, 536, 140, 592],    // «EXPANSIONS»
  [968, 536, 1080, 578], // «PVE ZONE»
].map(([x0, y0, x1, y1]) => [Math.floor(x0 * sx), Math.floor(y0 * sy), Math.ceil(x1 * sx), Math.ceil(y1 * sy)])
const cropBottom = Math.floor(568 * sy) // the game's bottom bar goes

const { data, info } = await source.removeAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = cropBottom
const known = new Uint8Array(W * H).fill(1)
for (const [x0, y0, x1, y1] of holes) for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) known[y * W + x] = 0

// Push-pull fill.
function level(rgb, mask, w, h) { return { rgb, mask, w, h } }
let levels = [level(Float32Array.from({ length: W * H * 3 }, (_, i) => data[(Math.floor(i / 3 / W) * info.width + (Math.floor(i / 3) % W)) * 3 + (i % 3)]), Float32Array.from(known), W, H)]
while (levels.at(-1).w > 2 && levels.at(-1).h > 2) {
  const { rgb, mask, w, h } = levels.at(-1)
  const nw = Math.ceil(w / 2), nh = Math.ceil(h / 2)
  const nrgb = new Float32Array(nw * nh * 3), nmask = new Float32Array(nw * nh)
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let sum = [0, 0, 0], weight = 0
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const px = Math.min(w - 1, x * 2 + dx), py = Math.min(h - 1, y * 2 + dy)
      const m = mask[py * w + px]
      weight += m
      for (let c = 0; c < 3; c++) sum[c] += rgb[(py * w + px) * 3 + c] * m
    }
    const at = y * nw + x
    nmask[at] = weight > 0 ? 1 : 0
    for (let c = 0; c < 3; c++) nrgb[at * 3 + c] = weight > 0 ? sum[c] / weight : 0
  }
  levels.push(level(nrgb, nmask, nw, nh))
}
for (let i = levels.length - 2; i >= 0; i--) {
  const fine = levels[i], coarse = levels[i + 1]
  for (let y = 0; y < fine.h; y++) for (let x = 0; x < fine.w; x++) {
    const at = y * fine.w + x
    if (fine.mask[at] > 0) continue
    // Bilinear from the coarser level.
    const cx = Math.min(coarse.w - 1, (x + 0.5) / 2 - 0.5), cy = Math.min(coarse.h - 1, (y + 0.5) / 2 - 0.5)
    const x0 = Math.max(0, Math.floor(cx)), y0 = Math.max(0, Math.floor(cy)), x1 = Math.min(coarse.w - 1, x0 + 1), y1 = Math.min(coarse.h - 1, y0 + 1)
    const fx = Math.max(0, cx - x0), fy = Math.max(0, cy - y0)
    for (let c = 0; c < 3; c++) {
      const v = (a, b) => coarse.rgb[(b * coarse.w + a) * 3 + c]
      fine.rgb[at * 3 + c] = (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy
    }
    fine.mask[at] = 1
  }
}
const filled = levels[0].rgb

// `--patch`: a content-aware fill instead (owner, 31.10.2026: «не просто замазывать… а прям генерировать в этом же стиле»).
// Tried: 9 × 9 and 13 × 13 pieces of the picture left stairs and copied bits of the badge into the middle — worse than the
// soft fill under the pages; real generation needs an image model, which this script does not have.
if (process.argv.includes('--patch')) {
  const half = 6
  const done = Uint8Array.from(known)
  const srcOf = new Int32Array(W * H).fill(-1)
  const centres = []
  for (let y = half; y < H - half; y += 2) for (let x = half; x < W - half; x += 2) {
    let whole = true
    for (let dy = -half; dy <= half && whole; dy++) for (let dx = -half; dx <= half; dx++) if (!known[(y + dy) * W + x + dx]) { whole = false; break }
    if (whole) centres.push(y * W + x)
  }
  const original = Float32Array.from(filled)
  let seed = 11
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const cost = (t, s, limit) => {
    const tx = t % W, ty = (t / W) | 0, sxx = s % W, syy = (s / W) | 0
    let sum = 0
    for (let dy = -half; dy <= half; dy++) {
      const yt = ty + dy, ys = syy + dy
      if (yt < 0 || yt >= H) continue
      for (let dx = -half; dx <= half; dx++) {
        const xt = tx + dx, xs = sxx + dx
        if (xt < 0 || xt >= W) continue
        const a = yt * W + xt, b = ys * W + xs
        const weight = done[a] ? 1 : 0.35
        for (let c = 0; c < 3; c++) { const d = filled[a * 3 + c] - original[b * 3 + c]; sum += weight * d * d }
      }
      if (sum >= limit) return sum
    }
    return sum
  }
  for (let layer = 0; layer < 400; layer++) {
    const frontier = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const at = y * W + x
      if (done[at]) continue
      let around = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W && done[yy * W + xx]) around++ }
      if (around) frontier.push([at, around])
    }
    if (!frontier.length) break
    frontier.sort((a, b) => b[1] - a[1])
    for (const [t] of frontier) {
      if (done[t]) continue
      const tx = t % W, ty = (t / W) | 0
      let best = -1, bestCost = Infinity
      const tryCentre = (s) => {
        const sx2 = s % W, sy2 = (s / W) | 0
        if (sx2 < half || sx2 >= W - half || sy2 < half || sy2 >= H - half) return
        const c = cost(t, s, bestCost)
        if (c < bestCost) { bestCost = c; best = s }
      }
      // Coherence: the neighbours' sources, shifted.
      for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
        const yy = ty + dy, xx = tx + dx
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue
        const s = srcOf[yy * W + xx]
        if (s >= 0) tryCentre(s - dy * W - dx)
      }
      for (let k = 0; k < 700; k++) tryCentre(centres[(rnd() * centres.length) | 0])
      if (best < 0) continue
      const bx = best % W, by = (best / W) | 0
      for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
        const yy = ty + dy, xx = tx + dx
        if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue
        const a = yy * W + xx
        if (done[a]) continue
        const b = (by + dy) * W + bx + dx
        for (let c = 0; c < 3; c++) filled[a * 3 + c] = original[b * 3 + c]
        done[a] = 1
        srcOf[a] = b
      }
    }
  }
}

// The holes' edges softened: around each edge (inside and out) a 15 × 15 average, so no rectangle shows.
if (!process.argv.includes('--patch')) {
  const EDGE = 12
  const blurred = boxBlur(filled, W, H, 7)
  const edge = new Uint8Array(W * H)
  for (const [x0, y0, x1, y1] of holes) for (let y = Math.max(0, y0 - EDGE); y < Math.min(H, y1 + EDGE); y++) for (let x = Math.max(0, x0 - EDGE); x < Math.min(W, x1 + EDGE); x++) {
    const inside = x >= x0 + EDGE && x < x1 - EDGE && y >= y0 + EDGE && y < y1 - EDGE
    if (!inside) edge[y * W + x] = 1
  }
  for (let at = 0; at < W * H; at++) if (edge[at]) for (let c = 0; c < 3; c++) filled[at * 3 + c] = blurred[at * 3 + c]
}

function boxBlur(rgb, w, h, r) {
  const tmp = new Float32Array(rgb.length), out = new Float32Array(rgb.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let sum = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { sum += rgb[(y * w + xx) * 3 + c]; n++ } } tmp[(y * w + x) * 3 + c] = sum / n }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let sum = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { sum += tmp[(yy * w + x) * 3 + c]; n++ } } out[(y * w + x) * 3 + c] = sum / n }
  return out
}

// Grain over the filled parts (and a little everywhere), a vignette and a darker centre where the pages are.
const out = Buffer.alloc(W * H * 3)
let seed = 7
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const at = y * W + x
  const grain = (rand() - 0.5) * (known[at] ? 6 : 16)
  const nx = x / W - 0.55, ny = y / H - 0.45
  const vignette = Math.max(0, 1 - (nx * nx * 1.3 + ny * ny * 1.6))
  const shade = 0.42 + 0.33 * vignette
  for (let c = 0; c < 3; c++) {
    let value = filled[at * 3 + c] * shade + grain
    if (c === 0) value *= 1.08 // a touch more red
    out[at * 3 + c] = Math.max(0, Math.min(255, Math.round(value)))
  }
}
await sharp(out, { raw: { width: W, height: H, channels: 3 } })
  .resize({ width: 1920, kernel: 'lanczos3' })
  .blur(0.6)
  .webp({ quality: 80, effort: 6 })
  .toFile(output)
console.log(`${W}×${H} → ${output}`)
