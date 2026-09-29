// Procedural material textures for the textured app themes (see generate.mjs for how to run it).
// Runs inside a browser page (canvas). Every generator builds an albedo and a height map and lights the
// height map with one consistent top-left light (diffuse + soft specular + cavity/AO), so the surfaces read
// as physical. All noise is periodic over the tile, so every texture repeats without a seam.
// Sizes are expressed relative to a 4096 px master (k1 = S / 4096), so any output size keeps the same look.
(function () {
  'use strict'
  // ---------------------------------------------------------------- basics
  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
  }
  const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v
  const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t) }
  const mix = (a, b, t) => a + (b - a) * t
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)

  function perm(seed) {
    const r = rng(seed)
    const a = [...Array(256).keys()]
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
    const p = new Uint16Array(512)
    for (let i = 0; i < 512; i++) p[i] = a[i & 255]
    const gx = new Float32Array(256), gy = new Float32Array(256)
    for (let i = 0; i < 256; i++) { const t = r() * Math.PI * 2; gx[i] = Math.cos(t); gy[i] = Math.sin(t) }
    return { p, gx, gy }
  }

  // add amp * periodic gradient noise (px x py lattice cells over the tile) into out
  function addNoise(out, S, px, py, seed, amp) {
    const { p, gx, gy } = perm(seed)
    const X0 = new Int32Array(S), X1 = new Int32Array(S), XF = new Float32Array(S), U = new Float32Array(S)
    for (let i = 0; i < S; i++) {
      const X = i * px / S, xi = Math.floor(X)
      X0[i] = xi % px; X1[i] = (xi + 1) % px; XF[i] = X - xi; U[i] = fade(X - xi)
    }
    const hsh = (x, y) => p[(p[(x & 255)] + ((y + (x >> 8) * 37 + (y >> 8) * 91) & 255)) & 511]
    for (let j = 0; j < S; j++) {
      const Y = j * py / S, yi = Math.floor(Y), yf = Y - yi, y0 = yi % py, y1 = (yi + 1) % py, v = fade(yf)
      const row = j * S
      for (let i = 0; i < S; i++) {
        const x0 = X0[i], x1 = X1[i], xf = XF[i], u = U[i]
        const a = hsh(x0, y0), b = hsh(x1, y0), c = hsh(x0, y1), d = hsh(x1, y1)
        const n00 = gx[a] * xf + gy[a] * yf, n10 = gx[b] * (xf - 1) + gy[b] * yf
        const n01 = gx[c] * xf + gy[c] * (yf - 1), n11 = gx[d] * (xf - 1) + gy[d] * (yf - 1)
        const nx0 = n00 + u * (n10 - n00), nx1 = n01 + u * (n11 - n01)
        out[row + i] += amp * (nx0 + v * (nx1 - nx0))
      }
    }
  }
  function fbm(S, px, py, oct, gain, seed, lac = 2) {
    const out = new Float32Array(S * S)
    let amp = 1, sum = 0
    for (let o = 0; o < oct; o++) {
      const f = Math.pow(lac, o)
      addNoise(out, S, Math.max(1, Math.round(px * f)), Math.max(1, Math.round(py * f)), seed + o * 1013, amp)
      sum += amp; amp *= gain
    }
    for (let k = 0; k < out.length; k++) out[k] /= sum
    return out
  }
  function sample(g, S, x, y) {
    x = ((x % S) + S) % S; y = ((y % S) + S) % S
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0
    const x1 = (x0 + 1) % S, y1 = (y0 + 1) % S
    const a = g[y0 * S + x0], b = g[y0 * S + x1], c = g[y1 * S + x0], d = g[y1 * S + x1]
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy
  }
  function warp(src, S, wx, wy, amt) {
    const out = new Float32Array(S * S)
    for (let j = 0, k = 0; j < S; j++) for (let i = 0; i < S; i++, k++) out[k] = sample(src, S, i + wx[k] * amt, j + wy[k] * amt)
    return out
  }
  // separable wrap-around box blur, 3 passes ~ gaussian
  function blur(g, S, r, passes = 3) {
    if (r < 1) return g.slice()
    let a = g.slice(), b = new Float32Array(S * S)
    const n = 2 * r + 1
    for (let pass = 0; pass < passes; pass++) {
      for (let j = 0; j < S; j++) {
        const row = j * S
        let s = 0
        for (let t = -r; t <= r; t++) s += a[row + ((t + S) % S)]
        for (let i = 0; i < S; i++) {
          b[row + i] = s / n
          s += a[row + ((i + r + 1) % S)] - a[row + ((i - r + S) % S)]
        }
      }
      for (let i = 0; i < S; i++) {
        let s = 0
        for (let t = -r; t <= r; t++) s += b[((t + S) % S) * S + i]
        for (let j = 0; j < S; j++) {
          a[j * S + i] = s / n
          s += b[((j + r + 1) % S) * S + i] - b[((j - r + S) % S) * S + i]
        }
      }
    }
    return a
  }
  // periodic worley (cellular) noise; returns f1, f2 in units of cell size
  function worley(S, cx, cy, seed) {
    const r = rng(seed)
    const px = new Float32Array(cx * cy), py = new Float32Array(cx * cy)
    for (let k = 0; k < cx * cy; k++) { px[k] = r(); py[k] = r() }
    const cw = S / cx, ch = S / cy
    const f1 = new Float32Array(S * S), f2 = new Float32Array(S * S), id = new Float32Array(S * S)
    for (let j = 0, k = 0; j < S; j++) {
      const gy = j / ch, cyi = Math.floor(gy)
      for (let i = 0; i < S; i++, k++) {
        const gx = i / cw, cxi = Math.floor(gx)
        let d1 = 1e9, d2 = 1e9, best = 0
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const X = cxi + ox, Y = cyi + oy
          const wi = ((X % cx) + cx) % cx, wj = ((Y % cy) + cy) % cy
          const idx = wj * cx + wi
          const dx = (X + px[idx] - gx) * cw, dy = (Y + py[idx] - gy) * ch
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < d1) { d2 = d1; d1 = d; best = idx } else if (d < d2) d2 = d
        }
        const cs = Math.min(cw, ch)
        f1[k] = d1 / cs; f2[k] = d2 / cs; id[k] = best / (cx * cy)
      }
    }
    return { f1, f2, id }
  }
  // lighting from a height map: returns { lam (flat = 1), spec }
  const LIGHT = [-0.62, -0.72, 0.9]
  function light(H, S, strength, shininess = 0, L = LIGHT) {
    const ll = Math.hypot(L[0], L[1], L[2]), lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll
    let hx = lx, hy = ly, hz = lz + 1; const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl
    const lam = new Float32Array(S * S), spec = shininess ? new Float32Array(S * S) : null
    for (let j = 0; j < S; j++) {
      const up = ((j - 1 + S) % S) * S, dn = ((j + 1) % S) * S, row = j * S
      for (let i = 0; i < S; i++) {
        const l = (i - 1 + S) % S, r = (i + 1) % S
        const dx = (H[row + r] - H[row + l]) * 0.5 * strength
        const dy = (H[dn + i] - H[up + i]) * 0.5 * strength
        const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1)
        const nx = -dx * inv, ny = -dy * inv, nz = inv
        lam[row + i] = Math.max(0, nx * lx + ny * ly + nz * lz) / lz
        if (spec) spec[row + i] = Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), shininess)
      }
    }
    return { lam, spec }
  }
  // cavity / ambient occlusion: how far below the local average a point is
  function cavity(H, S, r, strength) {
    const B = blur(H, S, r, 2)
    const out = new Float32Array(S * S)
    for (let k = 0; k < out.length; k++) out[k] = clamp(1 + (H[k] - B[k]) * strength, 0.25, 1.25)
    return out
  }
  function emit(S) { return new Uint8ClampedArray(S * S * 4).fill(255) }
  const put = (o, k, r, g, b) => { const q = k * 4; o[q] = r; o[q + 1] = g; o[q + 2] = b }

  // draw periodic scratches onto a 2D context (each line also drawn wrapped)
  function scratches(ctx, S, n, seed, style) {
    const r = rng(seed)
    for (let s = 0; s < n; s++) {
      const x = r() * S, y = r() * S, len = (style.min + r() * (style.max - style.min)) * S / 4096
      const a = style.angle != null ? style.angle + (r() - 0.5) * style.spread : r() * Math.PI
      const bend = (r() - 0.5) * len * 0.15
      const w = (style.w0 + r() * style.w1) * S / 4096
      const alpha = style.a0 + r() * style.a1
      for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) {
        const x0 = x + ox, y0 = y + oy, x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len
        const mx = (x0 + x1) / 2 - Math.sin(a) * bend, my = (y0 + y1) / 2 + Math.cos(a) * bend
        // groove shadow (down-right), then lit lip (up-left) -> engraved look
        ctx.lineCap = 'round'
        ctx.strokeStyle = `rgba(${style.dark},${alpha * 0.8})`; ctx.lineWidth = w
        ctx.beginPath(); ctx.moveTo(x0 + w * 0.6, y0 + w * 0.6); ctx.quadraticCurveTo(mx + w * 0.6, my + w * 0.6, x1 + w * 0.6, y1 + w * 0.6); ctx.stroke()
        ctx.strokeStyle = `rgba(${style.light},${alpha})`; ctx.lineWidth = w * 0.8
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke()
      }
    }
  }

  // plain weave with ripstop grid: returns height map (0..~1.4)
  function weave(S, p, ripEvery, fibreSeed, fibreAmp = 0.18, twill = 0) {
    const H = new Float32Array(S * S)
    const fib = fbm(S, S / p * 2, S / p / 3, 2, 0.5, fibreSeed)          // along-thread fibre streaks (vertical)
    const fib2 = fbm(S, S / p / 3, S / p * 2, 2, 0.5, fibreSeed + 7)    // (horizontal)
    for (let j = 0, k = 0; j < S; j++) {
      const v = j / p, vj = Math.floor(v), fv = v - vj
      const cv = Math.sin(Math.PI * fv)
      const ripR = (vj % ripEvery) < 2
      for (let i = 0; i < S; i++, k++) {
        const u = i / p, ui = Math.floor(u), fu = u - ui
        const cu = Math.sin(Math.PI * fu)
        const ripC = (ui % ripEvery) < 2
        // plain weave alternates every cell; an N/1 twill floats the warp over N cells and steps one cell per row,
        // which is what draws the diagonal twill lines
        const warpTop = twill ? (((ui - vj) % (twill + 1)) + twill + 1) % (twill + 1) !== 0 : ((ui + vj) & 1) === 0
        const flat = twill ? 0.8 : 0.6
        let h
        if (warpTop) h = Math.pow(cu, 0.55) * (flat + (1 - flat) * cv) + fib[k] * fibreAmp * cu
        else h = Math.pow(cv, 0.55) * (0.6 + 0.4 * cu) + fib2[k] * fibreAmp * cv
        if (ripC) h += 0.9 * Math.pow(cu, 0.6) * (warpTop ? 1 : 0.6)
        if (ripR) h += 0.9 * Math.pow(cv, 0.6) * (warpTop ? 0.6 : 1)
        H[k] = h
      }
    }
    return H
  }

  const GEN = {}

  // ================================================================ 1. MultiCam Black on ripstop nylon
  GEN.blackmc = function (S) {
    const k1 = S / 4096
    const wx = fbm(S, 6, 6, 3, 0.5, 11), wy = fbm(S, 6, 6, 3, 0.5, 12)
    const fx = fbm(S, 24, 24, 3, 0.5, 13), fy = fbm(S, 24, 24, 3, 0.5, 14)      // small warp -> ragged edges
    let A = fbm(S, 7, 4, 5, 0.5, 15); A = warp(A, S, wx, wy, 260 * k1); A = warp(A, S, fx, fy, 40 * k1)
    let B = fbm(S, 11, 6, 5, 0.5, 16); B = warp(B, S, wy, wx, 220 * k1); B = warp(B, S, fy, fx, 34 * k1)
    let T = fbm(S, 14, 8, 3, 0.5, 17); T = warp(T, S, fx, fy, 90 * k1)          // twigs
    const Tm = fbm(S, 9, 9, 2, 0.5, 18)
    const Sp = fbm(S, 180, 180, 2, 0.45, 19)                                      // speckles
    const G = fbm(S, 3, 3, 3, 0.5, 20)                                            // base tone drift
    const W = weave(S, Math.max(2, 4 * k1), 8, 21, 0.3)
    const F = fbm(S, 2, 2, 3, 0.5, 22)                                            // gentle fabric folds
    const H = new Float32Array(S * S)
    for (let k = 0; k < H.length; k++) H[k] = W[k] * 1.0 + F[k] * 90 * k1
    const { lam, spec } = light(H, S, 0.75, 22)
    const cav = cavity(W, S, 3, 0.9)
    const out = emit(S)
    const c0 = hex('#0d0d0e'), c1 = hex('#212123'), c2 = hex('#2e2e31'), c3 = hex('#3a3a3d')
    for (let k = 0; k < H.length; k++) {
      let r = c0[0], g = c0[1], b = c0[2]
      const t0 = G[k] * 10; r += t0; g += t0; b += t0
      const a = sstep(0.07, 0.085, A[k]); r = mix(r, c1[0], a); g = mix(g, c1[1], a); b = mix(b, c1[2], a)
      const bb = sstep(0.15, 0.165, B[k]); r = mix(r, c2[0], bb); g = mix(g, c2[1], bb); b = mix(b, c2[2], bb)
      const tw = sstep(0.972, 0.984, 1 - Math.abs(T[k])) * sstep(0.08, 0.16, Tm[k]); r = mix(r, c2[0], tw); g = mix(g, c2[1], tw); b = mix(b, c2[2], tw)
      const sp = sstep(0.36, 0.4, Sp[k]); r = mix(r, c2[0], sp); g = mix(g, c2[1], sp); b = mix(b, c2[2], sp)
      const L = (0.45 + 0.62 * lam[k]) * cav[k]
      const s = spec[k] * 34 * (0.6 + W[k] * 0.4)
      put(out, k, r * L + s, g * L + s, b * L + s * 1.05)
    }
    return { data: out }
  }

  // ================================================================ 2. US MultiCam (OCP) on NYCO ripstop
  GEN.ocp = function (S) {
    const k1 = S / 4096
    const P = {
      khaki: hex('#b6a27c'), khaki2: hex('#a2906c'), lgreen: hex('#8d955e'), olive: hex('#6d7446'),
      dgreen: hex('#566036'), brown: hex('#7a5b41'), dbrown: hex('#4d3829'), cream: hex('#d9cfb2'), sand: hex('#c6b690'),
    }
    const wx = fbm(S, 5, 5, 3, 0.5, 31), wy = fbm(S, 5, 5, 3, 0.5, 32)
    const fx = fbm(S, 30, 30, 3, 0.55, 33), fy = fbm(S, 30, 30, 3, 0.55, 34)
    const soft = blur(fbm(S, 3, 4, 3, 0.5, 35), S, Math.round(24 * k1) || 1)      // soft gradient washes
    const soft2 = blur(fbm(S, 4, 3, 3, 0.5, 36), S, Math.round(24 * k1) || 1)
    // vertical-ish brush strokes: more cells in x than y -> narrow, tall shapes
    let G1 = fbm(S, 9, 4, 5, 0.5, 37); G1 = warp(G1, S, wx, wy, 230 * k1); G1 = warp(G1, S, fx, fy, 26 * k1)
    let G2 = fbm(S, 12, 5, 5, 0.5, 38); G2 = warp(G2, S, wy, wx, 200 * k1); G2 = warp(G2, S, fy, fx, 22 * k1)
    let Br = fbm(S, 13, 6, 5, 0.5, 39); Br = warp(Br, S, wx, wy, 180 * k1); Br = warp(Br, S, fx, fy, 22 * k1)
    let Cr = fbm(S, 16, 8, 4, 0.5, 40); Cr = warp(Cr, S, fy, fx, 30 * k1)
    let Tw = fbm(S, 12, 7, 3, 0.5, 41); Tw = warp(Tw, S, fx, fy, 70 * k1)
    const Twm = fbm(S, 8, 8, 2, 0.5, 42)
    const dot = fbm(S, 110, 110, 2, 0.4, 43)
    const W = weave(S, Math.max(2, 4 * k1), 16, 44, 0.3, 2)
    const fuzz = fbm(S, 700, 700, 2, 0.5, 45)
    const F = fbm(S, 2, 2, 3, 0.5, 46)
    const H = new Float32Array(S * S)
    for (let k = 0; k < H.length; k++) H[k] = W[k] + fuzz[k] * 0.25 + F[k] * 70 * k1
    const { lam, spec } = light(H, S, 0.7, 8)
    const cav = cavity(W, S, 3, 0.8)
    const out = emit(S)
    const lerp3 = (c, d, t) => { c[0] = mix(c[0], d[0], t); c[1] = mix(c[1], d[1], t); c[2] = mix(c[2], d[2], t) }
    const c = [0, 0, 0]
    for (let k = 0; k < H.length; k++) {
      c[0] = P.khaki[0]; c[1] = P.khaki[1]; c[2] = P.khaki[2]
      lerp3(c, P.khaki2, sstep(-0.1, 0.25, soft2[k]))
      lerp3(c, P.sand, sstep(0.1, 0.35, -soft2[k]) * 0.6)
      lerp3(c, P.lgreen, sstep(0.0, 0.22, soft[k]) * 0.8)                     // soft green wash
      // printed shapes (slightly soft edges, like ink on cotton)
      lerp3(c, P.lgreen, sstep(0.05, 0.08, G1[k]))
      lerp3(c, P.olive, sstep(0.14, 0.17, G1[k]))
      lerp3(c, P.dgreen, sstep(0.24, 0.27, G1[k]) * 0.8)
      lerp3(c, P.olive, sstep(0.16, 0.19, G2[k]) * 0.85)
      lerp3(c, P.brown, sstep(0.17, 0.2, Br[k]))
      lerp3(c, P.dbrown, sstep(0.27, 0.3, Br[k]) * 0.9)
      lerp3(c, P.cream, sstep(0.22, 0.25, -Cr[k]))
      lerp3(c, P.dbrown, sstep(0.972, 0.982, 1 - Math.abs(Tw[k])) * sstep(0.1, 0.18, Twm[k]))   // twigs
      lerp3(c, P.dbrown, sstep(0.37, 0.41, dot[k]) * 0.9)
      const L = (0.62 + 0.42 * lam[k]) * cav[k] * (1 + fuzz[k] * 0.16)
      const s = spec[k] * 10
      put(out, k, c[0] * L + s, c[1] * L + s, c[2] * L + s)
    }
    return { data: out }
  }

  // ================================================================ 3. Weathered wood planks painted in woodland camo
  GEN.woodland = function (S) {
    const k1 = S / 4096
    const planks = 8, pw = S / planks, gap = Math.round(9 * k1), bev = 16 * k1
    const r = rng(303)
    const PL = Array.from({ length: planks }, () => ({
      freq: (0.013 + r() * 0.012) / k1, c: (r() - 0.5) * pw * 1.6, ph: r() * 20, tone: 0.86 + r() * 0.22,
      knots: Array.from({ length: 1 + Math.floor(r() * 2.2) }, () => ({ x: pw * (0.2 + r() * 0.6), y: r() * S, rad: (14 + r() * 26) * k1 })),
      nailY: [S * (0.22 + (r() - 0.5) * 0.01), S * (0.72 + (r() - 0.5) * 0.01)],
    }))
    const Wl = fbm(S, 3, 5, 3, 0.5, 51)               // ring wander (large)
    const Ws = fbm(S, 12, 16, 3, 0.5, 52)             // ring wobble (small)
    const fib = fbm(S, 900, 24, 2, 0.5, 53)           // fibres: very fine vertical streaks
    const fib2 = fbm(S, 300, 12, 2, 0.5, 54)
    const pore = fbm(S, 600, 70, 1, 0.5, 55)          // pores: tiny dark dashes
    // camo paint: M81 woodland shapes, big and blobby
    const wx = fbm(S, 4, 4, 3, 0.5, 56), wy = fbm(S, 4, 4, 3, 0.5, 57)
    const ex = fbm(S, 28, 28, 2, 0.5, 58), ey = fbm(S, 28, 28, 2, 0.5, 59)
    let CA = fbm(S, 3, 4, 4, 0.45, 60); CA = warp(CA, S, wx, wy, 240 * k1); CA = warp(CA, S, ex, ey, 20 * k1)
    let CB = fbm(S, 4, 5, 4, 0.45, 61); CB = warp(CB, S, wy, wx, 240 * k1); CB = warp(CB, S, ey, ex, 20 * k1)
    let CC = fbm(S, 5, 6, 4, 0.45, 62); CC = warp(CC, S, wx, wy, 200 * k1); CC = warp(CC, S, ex, ey, 18 * k1)
    // wear: blotchy + stretched along the grain
    const wear1 = fbm(S, 10, 10, 5, 0.55, 63), wear2 = fbm(S, 90, 12, 3, 0.5, 64), wear3 = fbm(S, 40, 40, 3, 0.5, 65)
        const grime = fbm(S, 6, 6, 4, 0.5, 67)
    const crackN = fbm(S, 150, 9, 2, 0.5, 68), crackMask = fbm(S, 7, 7, 3, 0.5, 69)   // hairline paint cracks along the grain
    const H = new Float32Array(S * S), paint = new Float32Array(S * S), late = new Float32Array(S * S)
    const alb = new Float32Array(S * S * 3)
    const woodA = hex('#a08b6c'), woodB = hex('#6a5540'), woodGrey = hex('#8c8579')
    const cam = [hex('#9a8a60'), hex('#4c5f33'), hex('#62452b'), hex('#1e1d18')]
    for (let j = 0, k = 0; j < S; j++) for (let i = 0; i < S; i++, k++) {
      const p = Math.floor(i / pw), P = PL[p], lx = i - p * pw
      // push grain around knots
      let gx = lx, knotCore = 0, knotRing = 0
      for (const kn of P.knots) {
        let dy = j - kn.y; if (dy > S / 2) dy -= S; if (dy < -S / 2) dy += S
        const dx = lx - kn.x, d = Math.hypot(dx, dy * 0.55)
        gx += Math.sign(dx || 1) * kn.rad * 2.2 * Math.exp(-((d / (kn.rad * 2.6)) ** 2))
        const dd = Math.hypot(dx, dy) / kn.rad
        knotCore = Math.max(knotCore, 1 - sstep(0.75, 1.05, dd))
        if (dd < 1.6) knotRing = Math.max(knotRing, (0.5 + 0.5 * Math.cos(dd * 14)) * (1 - sstep(1.0, 1.6, dd)))
      }
      const g = Math.abs(gx - P.c) * P.freq + Wl[k] * 5 + Ws[k] * 0.45 + P.ph
      const t = g - Math.floor(g)
      const lw = sstep(0.78, 0.86, t) * (1 - sstep(0.95, 0.995, t)) + t * 0.18   // sharp latewood + earlywood darkening towards it          // latewood band
      late[k] = lw
      // wood height: latewood ridges stand proud (weathered earlywood erodes), fibres, pores
      let h = lw * 0.9 + fib[k] * 0.55 + fib2[k] * 0.35 - sstep(0.3, 0.45, pore[k]) * 0.6 - knotCore * 0.2 + knotRing * 0.25
      // plank bevel + gap
      const e = Math.min(lx, pw - lx)
      if (e < gap) h = -9
      else if (e < gap + bev) h -= ((gap + bev - e) / bev) ** 2 * 3.2
      // nails
      let nail = 0, rustHalo = 0
      for (const ny of P.nailY) for (const nx of [pw * 0.18, pw * 0.82]) {
        const d = Math.hypot(lx - nx, j - ny) / k1
        if (d < 11) { nail = Math.max(nail, 1); h = Math.max(h, 2.2 + Math.sqrt(1 - (d / 11) ** 2) * 2.4) }
        else if (d < 13) h -= 0.6
        rustHalo = Math.max(rustHalo, 1 - sstep(10, 34 + wear3[k] * 30, d))
      }
      // paint coverage: worn off near edges, on ridges, around nails, and in blotches
      const edgeW = 1 - sstep(gap, gap + 60 * k1, e)
      const wv = wear1[k] * 0.9 + wear2[k] * 0.45 + edgeW * 0.55 + lw * 0.12 + rustHalo * 0.25
      const bare = sstep(0.19, 0.205, wv)
      // crazing cracks inside the paint
      const cr = (1 - sstep(0.006, 0.016, Math.abs(crackN[k]))) * sstep(-0.02, 0.08, crackMask[k])
      const pc = e < gap ? 0 : (1 - bare) * (1 - cr * 0.9)
      paint[k] = pc
      h += pc * 1.7
      if (nail) h = Math.max(h, 2.2)
      H[k] = h
      // albedo
      let wr = mix(woodA[0], woodB[0], lw * 0.85), wg = mix(woodA[1], woodB[1], lw * 0.85), wb = mix(woodA[2], woodB[2], lw * 0.85)
      const grey = 0.35 + wear3[k] * 0.4
      wr = mix(wr, woodGrey[0], grey); wg = mix(wg, woodGrey[1], grey); wb = mix(wb, woodGrey[2], grey)
      const fb = 1 + fib[k] * 0.55 + fib2[k] * 0.3 - sstep(0.28, 0.42, pore[k]) * 0.45
      wr *= fb * P.tone; wg *= fb * P.tone; wb *= fb * P.tone
      if (knotCore) { wr = mix(wr, 60, knotCore * 0.8); wg = mix(wg, 44, knotCore * 0.8); wb = mix(wb, 30, knotCore * 0.8) }
      if (knotRing) { wr *= 1 - knotRing * 0.25; wg *= 1 - knotRing * 0.25; wb *= 1 - knotRing * 0.25 }
      // camo colour
      let ci = 1
      if (CA[k] > 0.04) ci = 0
      if (CB[k] > 0.1) ci = 2
      if (CC[k] > 0.19 || (CB[k] < -0.2 && CA[k] < 0)) ci = 3
      const cc = cam[ci]
      // paint follows the wood: grain & fibres print through
      const through = 1 + (lw - 0.4) * 0.16 + fib[k] * 0.12
      let pr = cc[0] * through, pg = cc[1] * through, pb = cc[2] * through
      // chalky weathering of the paint + rust halo
      const chalk = sstep(0.1, 0.3, wv) * 0.18
      pr = mix(pr, 150, chalk); pg = mix(pg, 145, chalk); pb = mix(pb, 125, chalk)
      let R = mix(wr, pr, pc), Gc = mix(wg, pg, pc), Bc = mix(wb, pb, pc)
      if (rustHalo) { const rh = rustHalo * 0.55; R = mix(R, 92, rh); Gc = mix(Gc, 50, rh); Bc = mix(Bc, 24, rh) }
      if (nail) { const n = 64 + wear3[k] * 30; R = n; Gc = n * 0.93; Bc = n * 0.86 }
      // grime towards the gaps
      const gr = (1 - sstep(gap, gap + 40 * k1, e)) * 0.5 + sstep(0.1, 0.4, grime[k]) * 0.18
      R *= 1 - gr; Gc *= 1 - gr; Bc *= 1 - gr
      if (cr && pc < 0.5 && !bare) { const cd = 1 - cr * 0.62; R *= cd; Gc *= cd; Bc *= cd }  // crack floor sits in shadow
      if (e < gap) { R = 12; Gc = 10; Bc = 7 }
      alb[k * 3] = R; alb[k * 3 + 1] = Gc; alb[k * 3 + 2] = Bc
    }
    const { lam, spec } = light(H, S, 0.9, 30)
    const cav = cavity(H, S, Math.round(5 * k1) || 1, 0.18)
    const out = emit(S)
    for (let k = 0; k < H.length; k++) {
      const L = (0.38 + 0.66 * lam[k]) * cav[k]
      const s = spec[k] * (paint[k] * 26 + 6)
      put(out, k, alb[k * 3] * L + s, alb[k * 3 + 1] * L + s, alb[k * 3 + 2] * L + s * 0.95)
    }
    return { data: out }
  }

  // knitted stockinette: returns { H, row } — V-shaped stitches with rounded yarn legs.
  // sw = stitch width, rows = stitch rows across the tile (both in device px of this tile)
  function knit(S, sw, rowsN, foldAmp, seed) {
    const rh = S / rowsN, cols = Math.round(S / sw), cw = S / cols
    const F = fbm(S, 2, 2, 3, 0.5, seed), F2 = fbm(S, 3, 2, 2, 0.5, seed + 1)
    const fuzz = fbm(S, Math.round(S / 4.5), Math.round(S / 4.5), 2, 0.5, seed + 2)
    const yarn = fbm(S, Math.round(S / 16), Math.round(S / 68), 2, 0.5, seed + 3)
    const H = new Float32Array(S * S), row = new Int32Array(S * S), fold = new Float32Array(S * S)
    for (let j = 0, k = 0; j < S; j++) for (let i = 0; i < S; i++, k++) {
      const disp = (F[k] * 0.6 + F2[k] * 0.25) * foldAmp
      const Y = (j + disp) / rh, r = Math.floor(Y), fy = Y - r
      const X = i / cw, fx = X - Math.floor(X)
      // the two legs of the V run from the top corners down to the middle of the stitch
      const cxL = 0.5 - 0.38 * (1 - fy) - 0.02, cxR = 0.5 + 0.38 * (1 - fy) + 0.02
      const dl = Math.abs(fx - cxL) / 0.27, dr = Math.abs(fx - cxR) / 0.27
      const legL = dl < 1 ? Math.sqrt(1 - dl * dl) : 0, legR = dr < 1 ? Math.sqrt(1 - dr * dr) : 0
      const along = 0.55 + 0.45 * Math.sin(Math.PI * clamp(fy * 1.05))
      let h = Math.max(legL, legR) * along
      h += yarn[k] * 0.25 * h + fuzz[k] * 0.12
      fold[k] = F[k] + F2[k] * 0.4
      H[k] = h + fold[k] * foldAmp * 0.9
      row[k] = r
    }
    return { H, row, fold, fuzz }
  }

  // ================================================================ 4a. Telnyashka stripes (accent bands)
  // Classic navy/white striped knit with volume; used for bands and ribbons, not as the page background.
  GEN.stripes = function (S) {
    const sw = S / 150, rowsN = Math.round(S / (sw * 0.86))
    const rows = rowsN - (rowsN % 8)                               // whole stripe pairs -> seamless
    const { H, row } = knit(S, sw, rows, S / 60, 71)
    const { lam, spec } = light(H, S, 1.1, 10)
    const cav = cavity(H, S, Math.max(1, Math.round(S / 1000)), 0.45)
    const heather = fbm(S, Math.round(S / 8), Math.round(S / 8), 2, 0.6, 75)
    const out = emit(S)
    const Wc = hex('#e8ebee'), B = hex('#1d3f78'), B2 = hex('#142f5c')
    for (let k = 0; k < H.length; k++) {
      const blue = (((row[k] % 8) + 8) % 8) < 3
      const ht = clamp(heather[k] * 1.6 + 0.3)
      const r = blue ? mix(B[0], B2[0], ht) : Wc[0] - ht * 12, g = blue ? mix(B[1], B2[1], ht) : Wc[1] - ht * 10, b = blue ? mix(B[2], B2[2], ht) : Wc[2] - ht * 8
      const L = (0.34 + 0.72 * lam[k]) * cav[k]
      const sp = spec[k] * 14
      put(out, k, r * L + sp, g * L + sp, b * L + sp)
    }
    return { data: out }
  }

  // ================================================================ 4b. Tracksuit: near-black tricot jersey
  // Fine knit with a satin sheen along the wales, lint, dust and soft folds.
  GEN.tracksuit = function (S) {
    const k1 = S / 4096
    const sw = 7 * k1, rows = Math.round(S / (6.2 * k1))
    const { H, fold, fuzz } = knit(S, sw, rows, 70 * k1, 81)
    const bigFold = fbm(S, 2, 3, 3, 0.5, 82)
    for (let k = 0; k < H.length; k++) H[k] += bigFold[k] * 60 * k1
    const { lam, spec } = light(H, S, 0.9, 16)
    const cav = cavity(H, S, Math.max(1, Math.round(3 * k1)), 0.4)
    const tone = fbm(S, 3, 3, 4, 0.5, 83), dust = fbm(S, 12, 12, 4, 0.55, 84)
    const lint = worley(S, 300, 300, 85), lintDir = fbm(S, 60, 60, 2, 0.5, 86)
    const out = emit(S)
    const base = hex('#16171a'), warm = hex('#1f1c19')
    for (let k = 0; k < H.length; k++) {
      const t = sstep(-0.2, 0.3, tone[k])
      let r = mix(base[0], warm[0], t), g = mix(base[1], warm[1], t), b = mix(base[2], warm[2], t)
      // satin sheen: tricot catches a broad highlight on the raised side of folds
      const sheen = clamp(0.5 + (fold[k] + bigFold[k]) * 1.4) * 10
      const d = sstep(0.12, 0.45, dust[k]) * 16                             // dusty patches
      const li = (1 - sstep(0.02, 0.05, lint.f1[k])) * sstep(0.2, 0.4, lintDir[k] + 0.3) * 38 // lint fluffs
      const L = (0.42 + 0.66 * lam[k]) * cav[k] * (1 + fuzz[k] * 0.18)
      const sp = spec[k] * 26
      put(out, k, r * L + sp + sheen + d + li, g * L + sp + sheen + d * 0.95 + li, b * L + sp * 1.05 + sheen + d * 0.85 + li)
    }
    return { data: out }
  }

  // ================================================================ 4c. Film grain (overlay with alpha)
  GEN.grain = function (S) {
    const n1 = fbm(S, S / 2, S / 2, 1, 0.5, 91), n2 = fbm(S, S / 4, S / 4, 1, 0.5, 92)
    const out = emit(S)
    for (let k = 0; k < n1.length; k++) {
      const v = n1[k] * 0.7 + n2[k] * 0.3
      const q = k * 4
      const w = v > 0 ? 255 : 0
      out[q] = w; out[q + 1] = w; out[q + 2] = w; out[q + 3] = Math.min(255, Math.abs(v) * 150)
    }
    return { data: out }
  }

  // ================================================================ 5. Dark slate / concrete
  GEN.slate = function (S) {
    const k1 = S / 4096
    const wash = fbm(S, 3, 9, 5, 0.55, 81)                // horizontal streaky wash
    const wash2 = fbm(S, 6, 14, 4, 0.55, 82)
    const mott = fbm(S, 20, 30, 4, 0.55, 83)
    const grain = fbm(S, 700, 700, 2, 0.55, 84)
    const grain2 = fbm(S, 260, 260, 3, 0.5, 85)
    const pits = worley(S, 150, 150, 86)
    const pitMask = fbm(S, 40, 40, 2, 0.5, 89)
    const und = fbm(S, 10, 14, 4, 0.5, 87)
    const glint = fbm(S, 900, 900, 1, 0.5, 88)
    const H = new Float32Array(S * S)
    for (let k = 0; k < H.length; k++) {
      const pit = (1 - sstep(0.03, 0.12 + pits.id[k] * 0.1, pits.f1[k])) * sstep(0.0, 0.15, pitMask[k])
      H[k] = grain[k] * 0.9 + grain2[k] * 1.1 + und[k] * 40 * k1 - pit * 1.4 + mott[k] * 3
    }
    const { lam, spec } = light(H, S, 0.85, 40)
    const cav = cavity(H, S, Math.round(3 * k1) || 1, 0.35)
    const out = emit(S)
    const base = hex('#23262c'), lite = hex('#5b616b'), cool = hex('#2b3240')
    for (let k = 0; k < H.length; k++) {
      const w = sstep(-0.06, 0.3, wash[k] + wash2[k] * 0.5)
      // lighter wash is granular: only the raised grains take it
      const gw = w * sstep(-0.15, 0.25, grain2[k] + grain[k] * 0.6 + mott[k] * 0.4)
      let r = mix(base[0], lite[0], gw), g = mix(base[1], lite[1], gw), b = mix(base[2], lite[2], gw)
      const cl = sstep(0, 0.3, -wash2[k]) * 0.5; r = mix(r, cool[0], cl); g = mix(g, cool[1], cl); b = mix(b, cool[2], cl)
      const n = grain[k] * 18; r += n; g += n; b += n
      const pit = (1 - sstep(0.03, 0.12 + pits.id[k] * 0.1, pits.f1[k])) * sstep(0.0, 0.15, pitMask[k]); r *= 1 - pit * 0.45; g *= 1 - pit * 0.45; b *= 1 - pit * 0.45
      const L = (0.45 + 0.6 * lam[k]) * cav[k]
      const s = spec[k] * 16 + (glint[k] > 0.43 ? 300 * (glint[k] - 0.43) : 0)
      put(out, k, r * L + s, g * L + s, b * L + s * 1.05)
    }
    return { data: out }
  }

  // ================================================================ 6. Black perforated steel sheet
  GEN.perforated = function (S) {
    const k1 = S / 4096
    const pitch = 32 * k1, rad = 8 * k1
    const rowsN = Math.round(S / pitch), ph = S / rowsN, colsN = Math.round(S / pitch), pwid = S / colsN
    const grime = fbm(S, 5, 5, 6, 0.55, 91), grime2 = fbm(S, 14, 14, 5, 0.55, 92)
    const smear = fbm(S, 40, 6, 3, 0.5, 93)              // streaky wipe marks
    const micro = fbm(S, 1000, 1000, 2, 0.5, 94), brushed = fbm(S, 1200, 20, 2, 0.5, 95)
    const pitsW = worley(S, 400, 400, 96)
    // greasy fingerprints: concentric ridge whorls that only show in the sheen
    const fp = new Float32Array(S * S)
    const fr = rng(98)
    for (let n = 0; n < 16; n++) {
      const cx = fr() * S, cy = fr() * S, rx = (46 + fr() * 22) * k1, ry = rx * (1.25 + fr() * 0.2), rot = fr() * Math.PI
      const cs = Math.cos(rot), sn = Math.sin(rot), sp = 4.6 * k1, str = 0.6 + fr() * 0.4
      for (let y = Math.floor(cy - ry * 1.3); y < cy + ry * 1.3; y++) for (let x = Math.floor(cx - ry * 1.3); x < cx + ry * 1.3; x++) {
        const dx = x - cx, dy = y - cy
        const u = (dx * cs + dy * sn) / rx, v = (-dx * sn + dy * cs) / ry
        const d = Math.sqrt(u * u + v * v)
        if (d > 1.1) continue
        const ring = 0.5 + 0.5 * Math.sin((d * rx) / sp * Math.PI * 2 + Math.sin(u * 5) * 0.8)
        const X = ((x % S) + S) % S, Y = ((y % S) + S) % S
        fp[Y * S + X] = Math.max(fp[Y * S + X], ring * (1 - sstep(0.75, 1.1, d)) * str)
      }
    }
    const H = new Float32Array(S * S), hole = new Float32Array(S * S), wall = new Float32Array(S * S)
    for (let j = 0, k = 0; j < S; j++) {
      const ry = Math.round(j / ph)
      for (let i = 0; i < S; i++, k++) {
        // staggered grid: odd rows offset by half a pitch
        let best = 1e9, bdx = 0, bdy = 0
        for (let rr = ry - 1; rr <= ry + 1; rr++) {
          const off = (((rr % 2) + 2) % 2) * pwid / 2
          const cx = Math.round((i - off) / pwid) * pwid + off, cy = rr * ph
          const dx = i - cx, dy = j - cy, d = dx * dx + dy * dy
          if (d < best) { best = d; bdx = dx; bdy = dy }
        }
        const d = Math.sqrt(best)
        let h = micro[k] * 0.15 + brushed[k] * 0.12 - (1 - sstep(0.03, 0.12, pitsW.f1[k])) * 0.4
        if (d < rad) {
          hole[k] = 1
          // inner wall: visible band on the far side; facing up-left light when on the lower-right side
          const dirx = bdx / (d || 1), diry = bdy / (d || 1)
          const band = sstep(rad - 3.2 * k1, rad - 0.6 * k1, d)
          wall[k] = band * (0.5 + 0.5 * (dirx * 0.7 + diry * 0.7))
          h = -6
        } else if (d < rad + 2.2 * k1) {
          h -= ((rad + 2.6 * k1 - d) / (2.6 * k1)) ** 2 * 3.4        // rolled rim
        }
        H[k] = h
      }
    }
    const { lam, spec } = light(H, S, 1.2, 60)
    const out = emit(S)
    const steel = hex('#1d1f22')
    for (let k = 0; k < H.length; k++) {
      if (hole[k]) {
        const w = wall[k]
        const v = 3 + w * 120
        put(out, k, v, v * 1.02, v * 1.06)
        continue
      }
      const gm = sstep(-0.05, 0.35, grime[k] + grime2[k] * 0.5)
      const sm = sstep(0.15, 0.4, smear[k]) * 0.5
      let r = steel[0] + gm * 14 + sm * 10, g = steel[1] + gm * 12 + sm * 10, b = steel[2] + gm * 8 + sm * 11
      const dark = sstep(0.2, 0.45, -grime2[k]) * 0.4
      r *= 1 - dark; g *= 1 - dark; b *= 1 - dark
      const L = 0.4 + 0.65 * lam[k]
      const s = spec[k] * (60 - gm * 30) + brushed[k] * 10 + fp[k] * 20
      put(out, k, r * L + s, g * L + s, b * L + s * 1.08)
    }
    return {
      data: out,
      post(ctx) {
        scratches(ctx, S, 900, 97, { min: 30, max: 260, w0: 0.7, w1: 1.1, a0: 0.05, a1: 0.14, light: '190,195,205', dark: '0,0,0' })
      },
    }
  }

  // ================================================================ 7. Scratched blue-grey painted steel with rust
  GEN.rust = function (S) {
    const k1 = S / 4096
    const wx = fbm(S, 12, 12, 3, 0.5, 101), wy = fbm(S, 12, 12, 3, 0.5, 102)
    let chipBig = fbm(S, 5, 5, 6, 0.55, 103); chipBig = warp(chipBig, S, wx, wy, 60 * k1)
    let chipSmall = fbm(S, 24, 24, 5, 0.55, 104); chipSmall = warp(chipSmall, S, wy, wx, 16 * k1)
    const rustN = fbm(S, 300, 300, 4, 0.55, 105), rustN2 = fbm(S, 60, 60, 4, 0.55, 106)
    const paintV = fbm(S, 6, 4, 5, 0.55, 107), stain = fbm(S, 4, 10, 5, 0.55, 108)
    const peel = fbm(S, 900, 900, 2, 0.5, 109), brush = fbm(S, 12, 700, 2, 0.5, 110)
    const splat = fbm(S, 70, 70, 3, 0.5, 111)
    const streakN = fbm(S, 60, 3, 3, 0.5, 114)
    const mott = fbm(S, 30, 22, 4, 0.6, 115), dirt = fbm(S, 400, 400, 2, 0.6, 116)
    const H = new Float32Array(S * S), rust = new Float32Array(S * S)
    for (let k = 0; k < H.length; k++) {
      const c = Math.max(sstep(0.19, 0.205, chipBig[k]), sstep(0.265, 0.28, chipSmall[k]))
      rust[k] = c
    }
    // rust bleeding downward from chips: accumulate with decay, then soften
    const bleed = new Float32Array(S * S)
    for (let i = 0; i < S; i++) {
      let acc = 0
      for (let pass = 0; pass < 2; pass++) for (let j = 0; j < S; j++) {
        const k = j * S + i
        acc = Math.max(acc * (1 - 0.011 / k1), rust[k])
        if (pass) bleed[k] = acc
      }
    }
    const bleedB = blur(bleed, S, Math.round(6 * k1) || 1)
    const seams = [0.18, 0.61]
    for (let j = 0, k = 0; j < S; j++) {
      // two horizontal pressed seams across the plate
      let seam = 0
      for (const sy of seams) { const d = (j - sy * S) / (14 * k1); seam += Math.exp(-d * d) * 3 - Math.exp(-((d - 1.2) ** 2) * 3) * 1.4 }
      for (let i = 0; i < S; i++, k++) {
        const rs = rust[k]
        let h = seam + peel[k] * 0.12 + brush[k] * 0.1 + paintV[k] * 6
        h += (1 - rs) * 2.4                                             // paint layer thickness -> chip walls
        h += rs * (rustN[k] * 1.6 + rustN2[k] * 2.2)                    // crusty rust
        H[k] = h
      }
    }
    const { lam, spec } = light(H, S, 0.9, 24)
    const cav = cavity(H, S, Math.round(4 * k1) || 1, 0.3)
    const edge = blur(rust, S, Math.round(3 * k1) || 1, 2)                // for the lighter primer lip around chips
    const out = emit(S)
    const paintA = hex('#7c8d99'), paintB = hex('#62717d'), paintC = hex('#9aa7ae')
    const r1 = hex('#5e2c13'), r2 = hex('#8a4a24'), r3 = hex('#2e170c'), r4 = hex('#a8683a')
    for (let k = 0; k < H.length; k++) {
      const rs = rust[k]
      const pv = paintV[k]
      let r = mix(paintA[0], paintB[0], sstep(-0.2, 0.3, pv)), g = mix(paintA[1], paintB[1], sstep(-0.2, 0.3, pv)), b = mix(paintA[2], paintB[2], sstep(-0.2, 0.3, pv))
      const lt = sstep(0.1, 0.4, -stain[k]) * 0.5; r = mix(r, paintC[0], lt); g = mix(g, paintC[1], lt); b = mix(b, paintC[2], lt)
      const dk = sstep(0.12, 0.45, stain[k]) * 0.35; r *= 1 - dk; g *= 1 - dk * 0.95; b *= 1 - dk * 0.9
      const bl = bleedB[k] * (1 - rs) * 0.5 * sstep(-0.15, 0.25, streakN[k])
      r = mix(r, 120, bl); g = mix(g, 72, bl); b = mix(b, 45, bl)
      const lip = sstep(0.05, 0.4, edge[k]) * (1 - rs) * (1 - sstep(0.4, 0.8, edge[k]))
      r = mix(r, 170, lip * 0.12); g = mix(g, 172, lip * 0.12); b = mix(b, 168, lip * 0.12)
      const mo = mott[k] * 38 + dirt[k] * 14; r += mo; g += mo; b += mo * 0.9
      const sp = sstep(0.42, 0.46, splat[k]) * (1 - rs); r = mix(r, 222, sp); g = mix(g, 214, sp); b = mix(b, 190, sp)
      if (rs > 0) {
        const t1 = clamp(rustN[k] * 2 + 0.5), t2 = sstep(-0.1, 0.3, rustN2[k])
        let rr = mix(r1[0], r2[0], t1), rg = mix(r1[1], r2[1], t1), rb = mix(r1[2], r2[2], t1)
        rr = mix(rr, r3[0], t2 * 0.75); rg = mix(rg, r3[1], t2 * 0.75); rb = mix(rb, r3[2], t2 * 0.75)
        const hi = sstep(0.25, 0.4, rustN[k]) * 0.6; rr = mix(rr, r4[0], hi); rg = mix(rg, r4[1], hi); rb = mix(rb, r4[2], hi)
        r = mix(r, rr, rs); g = mix(g, rg, rs); b = mix(b, rb, rs)
      }
      const L = (0.42 + 0.64 * lam[k]) * cav[k]
      const s = spec[k] * (1 - rs) * 22
      put(out, k, r * L + s, g * L + s, b * L + s)
    }
    return {
      data: out,
      post(ctx) {
        scratches(ctx, S, 1100, 112, { min: 14, max: 140, w0: 0.7, w1: 1.0, a0: 0.1, a1: 0.28, light: '225,230,232', dark: '40,45,50', angle: -0.35, spread: 1.6 })
        scratches(ctx, S, 120, 113, { min: 80, max: 420, w0: 0.6, w1: 0.8, a0: 0.1, a1: 0.25, light: '230,232,235', dark: '30,34,38', angle: 0.05, spread: 0.3 })
      },
    }
  }

  // Renders the master once and returns WebP data URLs for every requested size (downscaled, never enlarged).
  window.renderTexture = function (name, S, outputs) {
    const t0 = performance.now()
    const res = GEN[name](S)
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S
    const ctx = cv.getContext('2d')
    ctx.putImageData(new ImageData(res.data, S, S), 0, 0)
    if (res.post) res.post(ctx)
    const urls = outputs.map(({ size, quality }) => {
      if (size > S) throw new Error(`${name}: output ${size} is larger than the master ${S}`)
      let src = cv
      // halve step by step so the downscale averages every master pixel
      while (src.width / 2 >= size) {
        const half = document.createElement('canvas'); half.width = src.width / 2; half.height = src.height / 2
        const hc = half.getContext('2d'); hc.imageSmoothingQuality = 'high'; hc.drawImage(src, 0, 0, half.width, half.height)
        src = half
      }
      if (src.width !== size) {
        const fin = document.createElement('canvas'); fin.width = size; fin.height = size
        const fc = fin.getContext('2d'); fc.imageSmoothingQuality = 'high'; fc.drawImage(src, 0, 0, size, size)
        src = fin
      }
      return src.toDataURL('image/webp', quality)
    })
    return { urls, ms: Math.round(performance.now() - t0) }
  }
})()
