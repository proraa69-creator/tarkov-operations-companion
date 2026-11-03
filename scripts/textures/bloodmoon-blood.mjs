// «Кровавая луна»: the blood running down from the top bar (owner, 31.10.2026: «кровь сверху сделай реалистичней,
// сгенерируй, реальные подтёки, с реалистичной текстурой крови»). Generated, not drawn: a band along the top with runs
// of different lengths hanging from it (thick at the top, thinning, a heavy drop at the end, a few drops fallen off), as
// a shape; the shape is then rounded into a liquid surface (its thickness from a blur) and lit — dark where thick, a
// lighter, see-through red at the thin edges, sharp wet highlights, a little clotting. Repeats left to right seamlessly.
//   node scripts/textures/bloodmoon-blood.mjs src/assets/textures/bloodmoon/blood-drips.webp
import sharp from 'sharp'

const [output] = process.argv.slice(2)
if (!output) { console.error('usage: node scripts/textures/bloodmoon-blood.mjs <out.webp>'); process.exit(1) }

const W = 1600, H = 150
let seed = 31
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const TAU = Math.PI * 2

// The band's lower edge: sines with whole periods, so the picture repeats.
const waves = Array.from({ length: 7 }, (_, i) => ({ k: [2, 3, 5, 8, 13, 21, 34][i], a: [4, 3, 2.4, 1.6, 1.1, .7, .45][i], p: rnd() * TAU }))
const edge = (x) => 17 + waves.reduce((sum, w) => sum + w.a * Math.sin(TAU * w.k * x / W + w.p), 0)

// The runs: where, how thick, how long, how they wander.
const runs = []
for (let x = 14; x < W - 10; x += 30 + rnd() * 80) {
  const long = rnd()
  const r = 3 + rnd() * rnd() * 7
  runs.push({ x, r, len: long > .82 ? 70 + rnd() * 55 : long > .45 ? 26 + rnd() * 40 : 8 + rnd() * 16, wob: rnd() * TAU, wa: .6 + rnd() * 1.6 })
}
const drops = runs.filter((run) => run.len > 60 && rnd() > .45).map((run) => ({ x: run.x + Math.sin(run.wob + 3) * run.wa, y: edge(run.x) + run.len + 9 + rnd() * 12, r: run.r * (.55 + rnd() * .3) }))

const dx = (a, b) => { let d = a - b; d -= Math.round(d / W) * W; return d }
const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, .5 + .5 * (b - a) / k)); return b * (1 - h) + a * h - k * h * (1 - h) }

// Signed distance to the blood (negative inside).
function sdf(x, y) {
  let d = y - edge(x)
  for (const run of runs) {
    const top = edge(run.x) - 2, bottom = top + run.len
    if (Math.abs(dx(x, run.x)) > run.r * 3 + 10) continue
    const t = Math.max(0, Math.min(1, (y - top) / run.len))
    const cy = top + t * run.len
    const cx = run.x + Math.sin(run.wob + t * 3) * run.wa * t
    const width = run.r * (1 - .38 * Math.sqrt(t))
    const ddx = dx(x, cx)
    d = smin(d, Math.hypot(ddx, y - cy) - width, 5)
    // The heavy drop at the end of the run.
    const bulb = run.r * 1.18
    const bx = run.x + Math.sin(run.wob + 3) * run.wa
    d = smin(d, Math.hypot(dx(x, bx), (y - (bottom - bulb * .3)) * .86) - bulb, 3)
  }
  for (const drop of drops) d = Math.min(d, Math.hypot(dx(x, drop.x), (y - drop.y) * .8) - drop.r)
  return d
}

const S = 2 // supersampling for the outline
const mask = new Float32Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let cover = 0
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
    const d = sdf(x + (sx + .5) / S, y + (sy + .5) / S)
    cover += Math.max(0, Math.min(1, .5 - d))
  }
  mask[y * W + x] = cover / (S * S)
}

// Thickness: the shape blurred (wrapping left and right), kept inside the shape — a rounded liquid surface.
function blur(src, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let k = -r; k <= r; k++) s += src[y * W + ((x + k + W) % W)]; tmp[y * W + x] = s / (2 * r + 1) }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0) { s += 1; n++ } else if (yy < H) { s += tmp[yy * W + x]; n++ } } out[y * W + x] = s / n }
  return out
}
const b1 = blur(blur(mask, 2), 2), b2 = blur(blur(mask, 4), 3)
const height = new Float32Array(W * H)
for (let i = 0; i < W * H; i++) height[i] = mask[i] * (b1[i] * .55 + b2[i] * .45)

// Clotting: a soft cloudy noise, also seamless.
const noiseAt = (() => {
  const cells = 64, rows = 8, grid = Float32Array.from({ length: cells * rows }, rnd)
  const value = (x, y, c, r) => {
    const gx = x / W * c, gy = y / H * r, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0
    const g = (a, b) => grid[(((b % rows) + rows) % rows) * cells + ((a % c) + c) % c]
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
    return (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy
  }
  return (x, y) => value(x, y, 64, 8) * .6 + value(x, y, 32, 4) * .4
})()

// The pooled band is not flat: uneven, so the light catches it here and there like wet blood.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) height[y * W + x] *= .87 + .26 * noiseAt(x * 2.3, y * 2.3)

const light = norm([-.45, -.7, .75]), view = [0, 0, 1]
const half = norm([light[0] + view[0], light[1] + view[1], light[2] + view[2]])
function norm(v) { const l = Math.hypot(...v); return v.map((c) => c / l) }

const out = Buffer.alloc(W * H * 4)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, a = mask[i]
  if (a <= 0) continue
  const h = height[i]
  const hx = height[y * W + (x + 1) % W] - height[y * W + (x - 1 + W) % W]
  const hy = (y + 1 < H ? height[i + W] : h) - (y > 0 ? height[i - W] : 1)
  const n = norm([-hx * 9, -hy * 9, 1])
  const diffuse = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2])
  const specDot = Math.max(0, n[0] * half[0] + n[1] * half[1] + n[2] * half[2])
  const spec = Math.pow(specDot, 60) * 1.1 + Math.pow(specDot, 14) * .12
  const clot = noiseAt(x, y)
  // Thick blood is near black-red; the thin edges let light through — a brighter, warmer red.
  const thin = 1 - Math.min(1, h * 1.35)
  let r = 62 + 120 * thin + 40 * diffuse
  let g = 2 + 10 * thin + 4 * diffuse
  let b = 6 + 12 * thin + 5 * diffuse
  const darken = .78 + .3 * clot
  r *= darken; g *= darken; b *= darken
  r += 255 * spec; g += 215 * spec; b += 210 * spec
  out[i * 4] = Math.min(255, r); out[i * 4 + 1] = Math.min(255, g); out[i * 4 + 2] = Math.min(255, b)
  out[i * 4 + 3] = Math.round(255 * a * (.82 + .18 * Math.min(1, h * 2)))
}

await sharp(out, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 88, alphaQuality: 90, effort: 6 }).toFile(output)
console.log(`${W}×${H}, ${runs.length} runs, ${drops.length} drops → ${output}`)
