// Generates src/assets/textures/telnyashka/knit-crumpled-{a,b,c,d}.webp — seamless tiles of a worn telnyashka
// (navy + off-white striped jersey) lying crumpled: the stripes run diagonally but kink over creases, widen where
// the cloth is stretched (stitches open up) and bunch where it is compressed, with soft fold shading on top.
// Everything is procedural and periodic (integer wave vectors on the unit torus), so the tiles repeat without seams.
//   node scripts/textures/telnyashka/crumpled-knit.mjs
import sharp from 'sharp'

const outDir = new URL('../../../src/assets/textures/telnyashka/', import.meta.url).pathname
const OUT = 1024 // published tile size (shown at ~512–720 CSS px, i.e. ~2× density on HiDPI)
const SS = 2 // supersampling
const N = OUT * SS
const TAU = Math.PI * 2

const rng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }
// smooth periodic noise: a sum of sinusoids with random integer wave vectors (no lattice artefacts)
function waves(rnd, count, kmin, kmax) {
  const w = []
  while (w.length < count) {
    const kx = Math.round((rnd() * 2 - 1) * kmax), ky = Math.round((rnd() * 2 - 1) * kmax)
    const k = Math.hypot(kx, ky); if (k < kmin || k > kmax) continue
    w.push({ kx, ky, ph: rnd() * TAU, a: 1 / k })
  }
  const norm = w.reduce((s, x) => s + x.a * x.a, 0) ** 0.5 * Math.SQRT2
  return (u, v) => { let s = 0; for (const x of w) s += x.a * Math.sin(TAU * (x.kx * u + x.ky * v) + x.ph); return s / norm }
}
// tiny periodic value noise for yarn fuzz (high frequency — lattice not visible)
function valueNoise(rnd) {
  const tables = new Map()
  return (u, v, g) => {
    if (!tables.has(g)) { const t = new Float32Array(g * g); for (let i = 0; i < t.length; i++) t[i] = rnd() * 2 - 1; tables.set(g, t) }
    const t = tables.get(g), x = u * g, y = v * g, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
    const x0 = ((xi % g) + g) % g, y0 = ((yi % g) + g) % g, x1 = (x0 + 1) % g, y1 = (y0 + 1) % g
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
    const a = t[y0 * g + x0] + (t[y0 * g + x1] - t[y0 * g + x0]) * sx, b = t[y1 * g + x0] + (t[y1 * g + x1] - t[y1 * g + x0]) * sx
    return a + (b - a) * sy
  }
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const lerp = (a, b, t) => a + (b - a) * t
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))

// dir (p,q): integer stripe direction so the tile stays seamless: (1,1)=45°, (3,2)≈34°, (2,3)≈56°.
// period: target stripe period in tile px; wale: target stitch width in px (both rounded to fit the tile).
// folds: big creases; crumple: amount of small bunched wrinkles; stretch: in-plane pull (stripe width change).
const variants = [
  { name: 'a', seed: 11, dir: [1, 1], period: 62, wale: 7.2, folds: 6, crumple: 0.9, stretch: 1.0 },
  { name: 'b', seed: 29, dir: [3, 2], period: 58, wale: 6.8, folds: 7, crumple: 1.3, stretch: 0.7 },
  { name: 'c', seed: 47, dir: [2, 3], period: 66, wale: 7.4, folds: 5, crumple: 0.6, stretch: 1.35 },
  { name: 'd', seed: 83, dir: [1, 1], period: 54, wale: 6.6, folds: 8, crumple: 1.5, stretch: 0.9 },
]

const NAVY = [29, 55, 102], NAVY_FADED = [54, 74, 110]
const WHITE = [228, 226, 216], WHITE_WORN = [206, 204, 194]

for (const V of variants) {
  const rnd = rng(V.seed)
  const fuzz = valueNoise(rng(V.seed + 1))
  const [p, q] = V.dir
  const len = Math.hypot(p, q)
  const rows = 9 // knit courses per stripe period: 3 navy + 6 white (white ≈ 2× navy)
  const K = Math.max(1, Math.round(OUT / (V.period * len)))
  const L = K * rows
  const M = Math.round(OUT / (V.wale * len))

  // folds: ridges along lines perpendicular to integer wave vectors, their phase bent by smooth noise
  const bend = waves(rnd, 6, 1, 2.5)
  const mask = waves(rnd, 5, 1, 2.2) // where the cloth is crumpled vs lying smooth
  const folds = []
  const addFolds = (count, kmin, kmax, amp, sharp) => {
    while (count > 0) {
      const kx = Math.round((rnd() * 2 - 1) * kmax), ky = Math.round((rnd() * 2 - 1) * kmax), k = Math.hypot(kx, ky)
      if (k < kmin || k > kmax) continue
      folds.push({ kx, ky, k, ph: rnd() * TAU, amp: amp * (0.6 + rnd() * 0.6), sharp: sharp * (0.7 + rnd() * 0.6), sign: rnd() < 0.7 ? 1 : -1, env: waves(rnd, 3, 1, 2), bendAmt: 1.5 + rnd() * 2 })
      count--
    }
  }
  addFolds(V.folds, 2, 4.5, 1.15, 3.5)
  addFolds(Math.round(10 * V.crumple), 5, 11, 0.55 * V.crumple, 7)
  const pullX = waves(rnd, 6, 1, 2.2), pullY = waves(rnd, 6, 1, 2.2)

  // fields at full resolution: height (for shading) and displacement (for bending the knit)
  const Hh = new Float32Array(N * N), Du = new Float32Array(N * N), Dv = new Float32Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N
    const b = bend(u, v), m = smooth(-0.35, 0.55, mask(u, v))
    let h = 0, du = 0, dv = 0
    for (let i = 0; i < folds.length; i++) {
      const f = folds[i]
      const small = i >= V.folds
      const env = small ? m * smooth(-0.4, 0.5, f.env(u, v)) : 0.35 + 0.65 * smooth(-0.6, 0.4, f.env(u, v))
      if (env < 0.01) continue
      const th = TAU * (f.kx * u + f.ky * v) + f.ph + b * f.bendAmt
      const c = Math.pow((1 + Math.cos(th)) / 2, f.sharp) // sharp crest, broad trough
      const a = f.amp * env * f.sign
      h += a * c
      // the cloth slides along the crease line where it folds: stripes crossing it kink into a chevron
      const t = 0.017 / f.k * 3 * a * c
      du += (-f.ky / f.k) * t; dv += (f.kx / f.k) * t
      // and is drawn in across the fold (bunched): a push toward the crest
      const s = 0.008 / f.k * 3 * a * Math.sin(th) * c
      du += (f.kx / f.k) * s; dv += (f.ky / f.k) * s
    }
    const o = y * N + x
    Hh[o] = h
    Du[o] = du + pullX(u, v) * 0.03 * V.stretch
    Dv[o] = dv + pullY(u, v) * 0.03 * V.stretch
  }

  const img = Buffer.alloc(N * N * 3)
  const lx = -0.5, ly = -0.7, lz = 0.5 // light from the upper left
  const lnorm = Math.hypot(lx, ly, lz)
  const hScale = N * 0.0085 // height → slope scale
  for (let y = 0; y < N; y++) {
    const ym = ((y - 1 + N) % N) * N, yp = ((y + 1) % N) * N, y0 = y * N
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N, xp = (x + 1) % N
      const o = y0 + x
      const u = x / N, v = y / N
      const gx = (Hh[y0 + xp] - Hh[y0 + xm]) * 0.5 * hScale, gy = (Hh[yp + x] - Hh[ym + x]) * 0.5 * hScale
      // local stretch of the cloth (divergence of the displacement): >0 stretched, <0 bunched
      const div = ((Du[y0 + xp] - Du[y0 + xm]) + (Dv[yp + x] - Dv[ym + x])) * 0.5 * N
      const wu = u + Du[o], wv = v + Dv[o]
      const cPhase = (p * wu + q * wv) * L // courses (across stripes)
      const wPhase = (q * wu - p * wv) * M // wales (along stripes)
      const course = Math.floor(cPhase), fc = cPhase - course
      const fw = wPhase - Math.floor(wPhase)
      const navy = (((course % rows) + rows) % rows) < 3
      // jersey face: every stitch is a V of two slanted legs meeting at the bottom of the course
      const jitter = fuzz(u, v, 97) * 0.06
      const l1 = 0.14 + 0.3 * fc + jitter, l2 = 0.86 - 0.3 * fc + jitter
      const open = clamp(div * 2.2, -0.35, 0.6) // stretched knit shows gaps between the legs
      const w2 = 0.020 * (1 - open * 0.45)
      const leg = Math.exp(-((fw - l1) ** 2) / w2) + Math.exp(-((fw - l2) ** 2) / w2)
      const seam = Math.exp(-((fc - 0.0) ** 2) / 0.010) + Math.exp(-((fc - 1.0) ** 2) / 0.010)
      const gap = 0.3 + Math.max(0, open) * 0.35
      let knit = 1 - gap + Math.min(1.1, leg) * gap - seam * (0.16 + Math.max(0, open) * 0.2)
      knit += fuzz(u, v, 700) * 0.07 + fuzz(u, v, 1400) * 0.05
      // wash-out varies over the cloth; navy yarn fades more on the ridges
      const wear = smooth(-0.4, 0.8, mask(u + 0.31, v + 0.17) + Hh[o] * 0.25)
      const base = navy ? NAVY.map((c, i) => lerp(c, NAVY_FADED[i], wear)) : WHITE.map((c, i) => lerp(c, WHITE_WORN[i], wear))
      // fold shading: lambert on the height field, cavity darkening in troughs, a little sheen on ridges
      const nl = Math.hypot(gx, gy, 1)
      const lambert = Math.max(0, (-gx * lx - gy * ly + lz) / (nl * lnorm))
      const flat = lz / lnorm
      const cavity = clamp(Hh[o] * 0.3 - 0.08, -0.4, 0.3)
      let shade = 0.86 + (lambert - flat) * 1.35 + cavity - Math.max(0, -div) * 0.4
      shade = clamp(shade, 0.18, 1.3)
      const sheen = Math.pow(Math.max(0, lambert - flat - 0.12), 2) * 90
      const k = shade * clamp(knit, 0.45, 1.12)
      const oi = o * 3
      for (let ch = 0; ch < 3; ch++) img[oi + ch] = clamp(base[ch] * k + sheen, 0, 255)
    }
  }
  const file = `${outDir}knit-crumpled-${V.name}.webp`
  const info = await sharp(img, { raw: { width: N, height: N, channels: 3 } })
    .resize(OUT, OUT, { kernel: 'lanczos3' })
    .webp({ quality: 72, effort: 6 })
    .toFile(file)
  console.log(file, info.size)
}
