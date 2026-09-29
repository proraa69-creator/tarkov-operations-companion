// Procedural materials for the «Снаряжение» / "Gear" theme. Runs inside a browser page (see generate.mjs).
// Every material is built as an albedo + a height map; the height map is lit by one top-left light
// (diffuse + soft specular + cavity/AO + a short cast shadow), so fabric, webbing and loops read as physical.
// All noise is periodic over the tile, so each texture repeats without a seam. Nothing here is traced from
// photos or third-party art: the camouflage is an original multi-colour blob pattern in the same family of
// tones as common tan/green "multi-environment" camo.
(function () {
  'use strict'
  // ------------------------------------------------------------------ basics
  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
  }
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
  const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t) }
  const mix = (a, b, t) => a + (b - a) * t
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)

  // Periodic gradient noise that can be sampled anywhere (for domain warping).
  function makeNoise(seed) {
    const r = rng(seed)
    const p = new Uint8Array(512)
    const a = [...Array(256).keys()]
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
    for (let i = 0; i < 512; i++) p[i] = a[i & 255]
    const gx = new Float32Array(256), gy = new Float32Array(256)
    for (let i = 0; i < 256; i++) { const t = r() * Math.PI * 2; gx[i] = Math.cos(t); gy[i] = Math.sin(t) }
    // x, y are in lattice units; px, py are the periods in lattice cells.
    return function noise(x, y, px, py) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
      const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py
      const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py
      const h00 = p[p[x0 & 255] + (y0 & 255)], h10 = p[p[x1 & 255] + (y0 & 255)]
      const h01 = p[p[x0 & 255] + (y1 & 255)], h11 = p[p[x1 & 255] + (y1 & 255)]
      const n00 = gx[h00] * xf + gy[h00] * yf, n10 = gx[h10] * (xf - 1) + gy[h10] * yf
      const n01 = gx[h01] * xf + gy[h01] * (yf - 1), n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1)
      const u = fade(xf), v = fade(yf)
      const a0 = n00 + u * (n10 - n00), a1 = n01 + u * (n11 - n01)
      return a0 + v * (a1 - a0)
    }
  }
  // Fractal sum over a tile of size S; cx/cy lattice cells at the base octave (integers).
  function fbm(noise, x, y, S, cx, cy, oct, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0
    for (let o = 0; o < oct; o++) {
      const m = 1 << o
      sum += amp * noise((x / S) * cx * m, (y / S) * cy * m, cx * m, cy * m)
      norm += amp; amp *= gain
    }
    return sum / norm
  }
  function fillFbm(S, W, H, cx, cy, oct, seed, gain) {
    const n = makeNoise(seed), out = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = fbm(n, x, y, S, cx, cy, oct, gain)
    return out
  }
  // Separable periodic box blur (applied twice ~ gaussian).
  function blur(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H), d = 2 * r + 1
    for (let pass = 0; pass < 2; pass++) {
      const from = pass === 0 ? src : out
      for (let y = 0; y < H; y++) {
        const row = y * W
        let acc = 0
        for (let k = -r; k <= r; k++) acc += from[row + ((k % W) + W) % W]
        for (let x = 0; x < W; x++) {
          tmp[row + x] = acc / d
          acc += from[row + (x + r + 1) % W] - from[row + ((x - r) % W + W) % W]
        }
      }
      for (let x = 0; x < W; x++) {
        let acc = 0
        for (let k = -r; k <= r; k++) acc += tmp[(((k % H) + H) % H) * W + x]
        for (let y = 0; y < H; y++) {
          out[y * W + x] = acc / d
          acc += tmp[((y + r + 1) % H) * W + x] - tmp[(((y - r) % H + H) % H) * W + x]
        }
      }
    }
    return out
  }

  // ------------------------------------------------------------------ lighting
  // One light for the whole app: top-left, slightly in front of the screen.
  const L = (() => { const v = [-0.55, -0.62, 0.56]; const l = Math.hypot(...v); return v.map((c) => c / l) })()
  const HV = (() => { const v = [L[0], L[1], L[2] + 1]; const l = Math.hypot(...v); return v.map((c) => c / l) })()
  /**
   * Lights albedo (Float32 rgb 0..1, length W*H*3) with height map h. opts: bump (normal strength),
   * spec, shin, ao (cavity strength), aoR (blur radius), shadow (cast shadow strength), shadowLen (px).
   */
  function light(alb, h, W, H, opts) {
    const { bump = 1, spec = 0.06, shin = 24, ao = 0.5, aoR = 4, shadow = 0, shadowLen = 3, ambient = 0.18 } = opts
    const hb = ao ? blur(h, W, H, aoR) : null
    const out = new Uint8ClampedArray(W * H * 4)
    const flat = L[2]
    for (let y = 0; y < H; y++) {
      const ym = ((y - 1 + H) % H) * W, yp = ((y + 1) % H) * W, row = y * W
      for (let x = 0; x < W; x++) {
        const i = row + x
        const xm = (x - 1 + W) % W, xp = (x + 1) % W
        const dx = (h[row + xp] - h[row + xm]) * 0.5 * bump
        const dy = (h[yp + x] - h[ym + x]) * 0.5 * bump
        let nx = -dx, ny = -dy, nz = 1
        const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl
        const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]) / flat
        const sp = Math.pow(Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]), shin) * spec
        let occ = 1
        if (hb) occ = clamp(1 - ao * Math.max(0, hb[i] - h[i]) * 0.5, 0.25, 1)
        if (shadow) {
          // Height of the surface up-left along the light; if it is higher than here, this pixel is shaded.
          let s = 0
          for (let k = 1; k <= shadowLen; k++) {
            const sx = (x - k + W) % W, sy = (y - k + H) % H
            const d = h[sy * W + sx] - h[i] - k * 0.55
            if (d > s) s = d
          }
          occ *= 1 - clamp(s * shadow, 0, 0.6)
        }
        const lit = (ambient + (1 - ambient) * diff) * occ
        out[i * 4] = (alb[i * 3] * lit + sp) * 255
        out[i * 4 + 1] = (alb[i * 3 + 1] * lit + sp) * 255
        out[i * 4 + 2] = (alb[i * 3 + 2] * lit + sp * 0.92) * 255
        out[i * 4 + 3] = 255
      }
    }
    return out
  }

  // ------------------------------------------------------------------ camouflage field
  // Tan / green / olive / brown blobs, dark branch strokes and cream flecks, vertically biased.
  const CAMO = {
    cream: hex('#cfc3a2'), tan: hex('#ad9a75'), light: hex('#8f9064'), olive: hex('#686b46'),
    brown: hex('#77593d'), twig: hex('#3b2d21'), deep: hex('#51563a'),
  }
  function camoField(S, seed) {
    const W = S, H = S
    const nA = makeNoise(seed + 1), nB = makeNoise(seed + 2), nC = makeNoise(seed + 3)
    const nW1 = makeNoise(seed + 4), nW2 = makeNoise(seed + 5), nT = makeNoise(seed + 6), nG = makeNoise(seed + 7)
    const alb = new Float32Array(W * H * 3)
    const k = S / 2048
    const cx = 10, cy = 6 // base blob lattice: wider than tall -> vertically stretched blobs
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // domain warp: soft, painterly edges
        const wx = x + 38 * k * fbm(nW1, x, y, S, 8, 8, 3)
        const wy = y + 38 * k * fbm(nW2, x, y, S, 8, 8, 3)
        const a = fbm(nA, wx, wy, S, cx, cy, 4, 0.52)
        const b = fbm(nB, wx, wy, S, cx + 4, cy + 3, 4, 0.5)
        const c = fbm(nC, wx, wy, S, 22, 14, 3, 0.5)
        const grain = fbm(nG, x, y, S, 256, 256, 2) * 0.035
        let col = CAMO.tan.slice()
        const put = (rgb, m) => { col[0] = mix(col[0], rgb[0], m); col[1] = mix(col[1], rgb[1], m); col[2] = mix(col[2], rgb[2], m) }
        const tone = fbm(nT, x, y, S, 5, 5, 2) // gentle overall hue drift
        const mot = fbm(nC, wx * 1.7 + 311, wy * 1.7, S, 40, 26, 3, 0.55) // mid-scale mottling breaks the blobs up
        put(CAMO.cream, sstep(0.15, 0.17, -a + mot * 0.3) * 0.5)
        put(CAMO.light, sstep(0.05, 0.065, a + mot * 0.22))
        put(CAMO.olive, sstep(0.19, 0.205, a + mot * 0.25) * 0.9)
        put(CAMO.deep, sstep(0.33, 0.345, a + mot * 0.2) * 0.65)
        put(CAMO.brown, sstep(0.17, 0.185, b + mot * 0.28) * (1 - sstep(0.2, 0.24, a) * 0.6))
        put(CAMO.cream, sstep(0.3, 0.315, c) * 0.55 * (1 - sstep(0.05, 0.1, a)))
        put(CAMO.brown, sstep(0.36, 0.375, mot) * 0.55 * (1 - sstep(0.12, 0.2, a)))
        const i = (y * W + x) * 3
        alb[i] = (col[0] / 255) * (1 + grain + tone * 0.06)
        alb[i + 1] = (col[1] / 255) * (1 + grain + tone * 0.04)
        alb[i + 2] = (col[2] / 255) * (1 + grain)
      }
    }
    // Branch strokes: thin, mostly vertical, with short offshoots. Drawn with wrap-around.
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const g = cv.getContext('2d')
    g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineJoin = 'round'
    const count = Math.round(120 * k * k)
    const strokes = []
    const r2 = rng(seed + 99)
    for (let n = 0; n < count; n++) {
      const pts = []
      let x = r2() * W, y = r2() * H, ang = -Math.PI / 2 + (r2() - 0.5) * 0.9
      const len = (30 + r2() * 90) * k, w = (1.4 + r2() * 1.6) * k
      const steps = Math.max(3, Math.round(len / (9 * k)))
      pts.push([x, y])
      const kids = []
      for (let s = 0; s < steps; s++) {
        ang += (r2() - 0.5) * 0.55
        x += Math.cos(ang) * len / steps; y += Math.sin(ang) * len / steps
        pts.push([x, y])
        if (r2() < 0.25) {
          const kp = [[x, y]]; let kx = x, ky = y, ka = ang + (r2() < 0.5 ? -1 : 1) * (0.6 + r2() * 0.7)
          const kl = len * (0.2 + r2() * 0.3)
          for (let t = 0; t < 3; t++) { ka += (r2() - 0.5) * 0.5; kx += Math.cos(ka) * kl / 3; ky += Math.sin(ka) * kl / 3; kp.push([kx, ky]) }
          kids.push(kp)
        }
      }
      strokes.push({ pts, w, kids })
    }
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
      g.save(); g.translate(ox, oy)
      for (const s of strokes) {
        g.lineWidth = s.w
        g.beginPath(); s.pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke()
        g.lineWidth = s.w * 0.65
        for (const kp of s.kids) { g.beginPath(); kp.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke() }
      }
      g.restore()
    }
    const tw = g.getImageData(0, 0, W, H).data
    for (let i = 0; i < W * H; i++) {
      const m = (tw[i * 4 + 3] / 255) * 0.78
      if (m <= 0) continue
      alb[i * 3] = mix(alb[i * 3], CAMO.twig[0] / 255, m)
      alb[i * 3 + 1] = mix(alb[i * 3 + 1], CAMO.twig[1] / 255, m)
      alb[i * 3 + 2] = mix(alb[i * 3 + 2], CAMO.twig[2] / 255, m)
    }
    return alb
  }

  // ------------------------------------------------------------------ fabric heights
  // 500D-style plain weave: 2 px threads, over/under, per-thread slub thickness, fibre fuzz, soft wrinkles.
  function corduraHeight(S, W, H, seed) {
    const r = rng(seed)
    const colT = new Float32Array(W), rowT = new Float32Array(H)
    for (let i = 0; i < W; i++) colT[i] = 0.75 + r() * 0.5
    for (let i = 0; i < H; i++) rowT[i] = 0.75 + r() * 0.5
    const fuzz = fillFbm(S, W, H, 512, 512, 2, seed + 1, 0.5)
    const slubs = fillFbm(S, W, H, 64, 16, 2, seed + 2, 0.5)
    const wr = fillFbm(S, W, H, 6, 9, 4, seed + 3, 0.55)
    const h = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      const tx = x >> 1, ty = y >> 1, fx = (x & 1) + 0.5, fy = (y & 1) + 0.5
      const warpUp = ((tx + ty) & 1) === 0
      const warp = Math.sin((fx / 2) * Math.PI) * colT[tx] // vertical thread, rounded across x
      const weft = Math.sin((fy / 2) * Math.PI) * rowT[ty]
      const weave = warpUp ? 0.55 + 0.45 * warp : 0.55 + 0.45 * weft
      h[i] = weave * 0.9 + fuzz[i] * 0.6 + slubs[i] * 0.5 + wr[i] * 14
    }
    return h
  }

  // ------------------------------------------------------------------ materials
  function toCanvas(px, W, H) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    cv.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0)
    return cv
  }

  /** Multi-tone camo on cordura. */
  function cordura(S) {
    const alb = camoField(S, 11)
    const h = corduraHeight(S, S, S, 21)
    return toCanvas(light(alb, h, S, S, { bump: 1.1, spec: 0.035, shin: 18, ao: 0.6, aoR: 3 }), S, S)
  }

  /** Camo cordura with PALS webbing rows sewn on: 1" webbing, 1.5" pitch, bartack every 1.5". */
  function molle(S) {
    const k = S / 2048
    const pitch = Math.round(32 * k), band = Math.round(21 * k), top = Math.round(5 * k)
    const alb = camoField(S, 11)
    const alb2 = camoField(S, 47) // the webbing is printed separately, so its pattern does not line up
    const base = corduraHeight(S, S, S, 21)
    const nF = fillFbm(S, S, S, 512, 64, 2, 5, 0.5)
    const h = new Float32Array(S * S)
    const bt = Math.round(4 * k) // bartack width
    const edgeW = 2.6 * k
    for (let y = 0; y < S; y++) {
      const ry = (y % pitch) - top
      const inBand = ry > -3 && ry < band + 2
      const yy = ry + 0.5
      // smooth rounded webbing edge, a couple of pixels wide
      const edge = sstep(-0.5, edgeW, yy) * sstep(band + 0.5, band - edgeW, yy)
      for (let x = 0; x < S; x++) {
        const i = y * S + x
        if (!inBand || edge <= 0) { h[i] = base[i] * 0.9; continue }
        const ux = x % pitch
        const onTack = ux < bt && ry >= 2 && ry < band - 2
        const loop = Math.sin(Math.PI * clamp((ux - bt + 1) / (pitch - bt + 2))) // loop bulges between tacks
        const tw = ((x + y) & 3) < 2 ? 1 : 0 // 2/2 twill
        let hh = edge * (2.6 + loop * 1.1) + tw * 0.14 + nF[i] * 0.35
        if (ry === 1 || ry === band - 2) hh += 0.25 // selvedge
        if (onTack) hh = edge * 2.5 + ((ry & 1) ? 0.55 : 0.1) + 0.15 // pinned down, zigzag thread ridges
        h[i] = mix(base[i] * 0.9, hh, edge)
        // albedo: printed webbing, a touch darker and richer; bartack thread is tan-grey
        const j = i * 3
        const shade = (0.9 - (1 - edge) * 0.15) * (0.94 + loop * 0.06)
        const m = edge
        alb[j] = mix(alb[j], alb2[j] * shade, m); alb[j + 1] = mix(alb[j + 1], alb2[j + 1] * shade, m); alb[j + 2] = mix(alb[j + 2], alb2[j + 2] * shade, m)
        if (onTack) { const tt = 0.85; alb[j] = mix(alb[j], 0.6, tt); alb[j + 1] = mix(alb[j + 1], 0.54, tt); alb[j + 2] = mix(alb[j + 2], 0.42, tt) }
      }
    }
    return toCanvas(light(alb, h, S, S, { bump: 0.8, spec: 0.04, shin: 20, ao: 0.7, aoR: 3, shadow: 0.22, shadowLen: 4 }), S, S)
  }

  /** Hook-and-loop field: a dense felt of tiny loops, fuzzy highlights, deep cavities. */
  function velcro(S, colour) {
    const k = S / 1024
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S
    const g = cv.getContext('2d')
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S)
    const r = rng(7)
    g.lineCap = 'round'
    const n = Math.round(95000 * k * k)
    for (let t = 0; t < n; t++) {
      const x = r() * S, y = r() * S, rad = (0.9 + r() * 2.1) * k, a0 = r() * Math.PI * 2, a1 = a0 + Math.PI * (0.8 + r() * 0.6)
      g.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.35})`
      g.lineWidth = (0.6 + r() * 0.7) * k
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const X = x + ox, Y = y + oy
        if (X < -8 || X > S + 8 || Y < -8 || Y > S + 8) continue
        g.beginPath(); g.arc(X, Y, rad, a0, a1); g.stroke()
      }
    }
    const d = g.getImageData(0, 0, S, S).data
    const clump = fillFbm(S, S, S, 24, 24, 3, 9, 0.5)
    const fine = fillFbm(S, S, S, 256, 256, 2, 10, 0.5)
    const h = new Float32Array(S * S), alb = new Float32Array(S * S * 3)
    const c = hex(colour)
    for (let i = 0; i < S * S; i++) {
      const loops = d[i * 4] / 255
      h[i] = loops * 2.6 + clump[i] * 3 + fine[i] * 0.8
      const t = 0.8 + loops * 0.35 + clump[i] * 0.25
      alb[i * 3] = (c[0] / 255) * t; alb[i * 3 + 1] = (c[1] / 255) * t; alb[i * 3 + 2] = (c[2] / 255) * t
    }
    return toCanvas(light(alb, h, S, S, { bump: 1.4, spec: 0.05, shin: 10, ao: 1.4, aoR: 2, ambient: 0.22 }), S, S)
  }

  /** Plain nylon webbing (2/2 twill + selvedge fuzz), tile for buttons / straps. */
  function webbing(S, colour, seed) {
    const W = S, H = S
    const c = hex(colour)
    const fz = fillFbm(S, W, H, 256, 32, 2, seed, 0.5)
    const streak = fillFbm(S, W, H, 4, 64, 3, seed + 1, 0.5)
    const h = new Float32Array(W * H), alb = new Float32Array(W * H * 3)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      const ph = (x + y * 2) & 7 // steep twill (yarn runs along the strap)
      const ridge = Math.sin((ph / 8) * Math.PI * 2) * 0.5 + 0.5
      h[i] = ridge * 1.1 + fz[i] * 0.6 + streak[i] * 1.2
      const t = 0.92 + streak[i] * 0.2 + ridge * 0.05
      alb[i * 3] = (c[0] / 255) * t; alb[i * 3 + 1] = (c[1] / 255) * t; alb[i * 3 + 2] = (c[2] / 255) * t
    }
    return toCanvas(light(alb, h, W, H, { bump: 1, spec: 0.07, shin: 16, ao: 0.5, aoR: 2 }), W, H)
  }

  // ------------------------------------------------------------------ small hardware sprites (alpha)
  // Shapes are painted as a grey height field, then lit with the same light; alpha from the shape mask.
  function sprite(W, H, paint, colourAt, opts) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const g = cv.getContext('2d')
    paint(g)
    const d = g.getImageData(0, 0, W, H).data
    const h = new Float32Array(W * H), alb = new Float32Array(W * H * 3), a = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) { h[i] = (d[i * 4] / 255) * (opts.depth || 10); a[i] = d[i * 4 + 3] / 255 }
    const hs = blur(h, W, H, opts.soft || 1)
    for (let i = 0; i < W * H; i++) { const [r, gg, b] = colourAt(i % W, Math.floor(i / W), d[i * 4 + 1] / 255); alb[i * 3] = r; alb[i * 3 + 1] = gg; alb[i * 3 + 2] = b }
    const lit = light(alb, hs, W, H, { bump: opts.bump || 1, spec: opts.spec || 0.25, shin: opts.shin || 30, ao: 0.4, aoR: 2, ambient: 0.25 })
    for (let i = 0; i < W * H; i++) lit[i * 4 + 3] = a[i] * 255
    return toCanvas(lit, W, H)
  }
  /** Black side-release buckle (female body + male tongue), horizontal. */
  function buckle() {
    const W = 200, H = 84
    return sprite(W, H, (g) => {
      const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r) }
      // strap slots are left transparent; greyscale R = height, G = material id (1 = polymer)
      g.fillStyle = 'rgb(120,255,0)'; rr(8, 10, 110, 64, 14); g.fill()        // female housing
      g.fillStyle = 'rgb(200,255,0)'; rr(14, 16, 98, 52, 10); g.fill()        // raised top face
      g.globalCompositeOperation = 'destination-out'
      rr(26, 26, 16, 32, 4); g.fill()                                         // strap slot
      g.globalCompositeOperation = 'source-over'
      g.fillStyle = 'rgb(150,255,0)'
      rr(52, 24, 52, 36, 7); g.fill()                                         // window showing the tongue
      g.fillStyle = 'rgb(235,255,0)'; rr(58, 30, 40, 24, 5); g.fill()         // centre bar of the tongue
      // side release prongs
      g.fillStyle = 'rgb(170,255,0)'; rr(100, 6, 26, 18, 6); g.fill(); rr(100, 60, 26, 18, 6); g.fill()
      g.fillStyle = 'rgb(210,255,0)'; rr(104, 9, 18, 12, 4); g.fill(); rr(104, 63, 18, 12, 4); g.fill()
      // male tongue with ladder lock
      g.fillStyle = 'rgb(140,255,0)'; rr(118, 16, 76, 52, 10); g.fill()
      g.globalCompositeOperation = 'destination-out'
      rr(150, 26, 12, 32, 3); g.fill(); rr(170, 26, 12, 32, 3); g.fill()
      g.globalCompositeOperation = 'source-over'
      // grip ribs
      g.fillStyle = 'rgb(175,255,0)'
      for (let i = 0; i < 3; i++) { rr(124 + i * 7, 22, 3, 40, 1.5); g.fill() }
    }, () => [0.075, 0.078, 0.07], { depth: 7, soft: 1, bump: 1.4, spec: 0.22, shin: 22 })
  }
  /** Black-oxide press stud: domed cap with rolled rim. */
  function snap() {
    const W = 72, H = 72
    return sprite(W, H, (g) => {
      const grad = g.createRadialGradient(34, 33, 2, 36, 36, 30)
      grad.addColorStop(0, 'rgb(255,255,0)'); grad.addColorStop(0.62, 'rgb(170,255,0)'); grad.addColorStop(0.72, 'rgb(120,255,0)')
      grad.addColorStop(0.82, 'rgb(190,255,0)'); grad.addColorStop(1, 'rgb(60,255,0)')
      g.fillStyle = grad; g.beginPath(); g.arc(36, 36, 30, 0, Math.PI * 2); g.fill()
    }, (x, y) => { const t = 0.12 + 0.03 * Math.sin(x * 0.7 + y * 0.3); return [t * 1.05, t, t * 0.92] }, { depth: 14, soft: 1, bump: 1.2, spec: 0.6, shin: 40 })
  }

  window.gearTex = { cordura, molle, velcro, webbing, buckle, snap }
})()
