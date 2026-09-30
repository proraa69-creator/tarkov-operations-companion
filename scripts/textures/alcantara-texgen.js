// Alcantara (microfibre suede) detail map for the «Алькантара» theme — see alcantara.mjs for how to run it.
// Runs inside a browser page (canvas). The result is a neutral grey detail map centred on 50 % grey: the theme lays it
// over a flat colour with `background-blend-mode: overlay`, so one tile serves the anthracite panels, the darker
// page and the light-grey primary buttons alike.
//
// What makes it read as suede rather than noise:
//   1. microfibre grain — dense, slightly blurred white noise (the individual split fibres);
//   2. fibres — ~150 000 short strokes, most lying along the nap (to the left, a little down), a few crossing it,
//      light and dark, some with a bright tip (micro-specular);
//   3. nap — elongated low-frequency patches where the pile leans a little differently, i.e. lighter/darker streaks
//      like a seat that has been sat on and brushed;
//   4. relief — the grain + fibres are used as a height map and lit from the top-left, so the pile has depth.
// Every noise is periodic over the tile and every stroke is drawn wrapped, so the tile repeats without a seam.
(function () {
  'use strict'
  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
  }
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
  // add amp * periodic gradient noise (px × py lattice cells over the tile)
  function addNoise(out, S, px, py, seed, amp) {
    const { p, gx, gy } = perm(seed)
    const X0 = new Int32Array(S), X1 = new Int32Array(S), XF = new Float32Array(S), U = new Float32Array(S)
    for (let i = 0; i < S; i++) { const X = i * px / S, xi = Math.floor(X); X0[i] = xi % px; X1[i] = (xi + 1) % px; XF[i] = X - xi; U[i] = fade(X - xi) }
    const hsh = (x, y) => p[(p[x & 255] + ((y + (x >> 8) * 37 + (y >> 8) * 91) & 255)) & 511]
    for (let j = 0; j < S; j++) {
      const Y = j * py / S, yi = Math.floor(Y), yf = Y - yi, y0 = yi % py, y1 = (yi + 1) % py, v = fade(yf), row = j * S
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
  function fbm(S, px, py, oct, gain, seed) {
    const out = new Float32Array(S * S)
    let amp = 1, sum = 0
    for (let o = 0; o < oct; o++) { addNoise(out, S, px << o, py << o, seed + o * 1013, amp); sum += amp; amp *= gain }
    for (let k = 0; k < out.length; k++) out[k] /= sum
    return out
  }
  // separable wrap-around box blur (3 passes ≈ gaussian); r may be fractional (mixes r and r+1)
  function blur(g, S, r, passes = 3) {
    const ri = Math.floor(r), fr = r - ri
    if (r <= 0) return g.slice()
    let a = g.slice(), b = new Float32Array(S * S)
    const pass1 = (src, dst, R, horiz) => {
      const n = 2 * R + 1
      for (let line = 0; line < S; line++) {
        let acc = 0
        const at = (t) => horiz ? src[line * S + ((t % S) + S) % S] : src[(((t % S) + S) % S) * S + line]
        for (let t = -R; t <= R; t++) acc += at(t)
        for (let t = 0; t < S; t++) {
          if (horiz) dst[line * S + t] = acc / n; else dst[t * S + line] = acc / n
          acc += at(t + R + 1) - at(t - R)
        }
      }
    }
    for (let p = 0; p < passes; p++) {
      for (const horiz of [true, false]) {
        if (fr > 0.01 && ri > 0) {
          const c1 = new Float32Array(S * S), c2 = new Float32Array(S * S)
          pass1(a, c1, ri, horiz); pass1(a, c2, ri + 1, horiz)
          for (let k = 0; k < b.length; k++) b[k] = c1[k] * (1 - fr) + c2[k] * fr
        } else pass1(a, b, Math.max(1, Math.round(r)), horiz)
        const t = a; a = b; b = t
      }
    }
    return a
  }
  const normalise = (g) => {
    let m = 0, v = 0
    for (let k = 0; k < g.length; k++) m += g[k]
    m /= g.length
    for (let k = 0; k < g.length; k++) v += (g[k] - m) ** 2
    const sd = Math.sqrt(v / g.length) || 1
    for (let k = 0; k < g.length; k++) g[k] = (g[k] - m) / sd
    return g
  }

  // fibres: short strokes drawn on a canvas (wrapped), returned as signed height and albedo fields
  function fibres(S, seed) {
    const k = S / 2048
    const r = rng(seed)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgb(128,128,128)'
    ctx.fillRect(0, 0, S, S)
    ctx.lineCap = 'round'
    // the nap lies to the left and a little down (the brushing effect in napBrush.ts uses the same direction)
    const nap = Math.PI + 0.36
    const count = Math.round(150000 * k * k)
    const gauss = () => (r() + r() + r() - 1.5) * 1.15
    for (let i = 0; i < count; i++) {
      const x = r() * S, y = r() * S
      const along = r() < 0.8
      const ang = along ? nap + gauss() * 0.45 : r() * Math.PI * 2
      const len = (2 + r() * r() * 11) * k
      const curl = (r() - 0.5) * 0.9
      const light = r() < 0.52
      const a = 0.05 + r() * 0.13
      const w = (0.45 + r() * 0.75) * k
      const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len
      const mx = x + dx * 0.5 - dy * curl * 0.25, my = y + dy * 0.5 + dx * curl * 0.25
      ctx.strokeStyle = light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.1})`
      ctx.lineWidth = w
      const xs = [0], ys = [0]
      if (x - len < 0) xs.push(S); if (x + len > S) xs.push(-S)
      if (y - len < 0) ys.push(S); if (y + len > S) ys.push(-S)
      for (const ox of xs) for (const oy of ys) {
        ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.quadraticCurveTo(mx + ox, my + oy, x + dx + ox, y + dy + oy); ctx.stroke()
      }
      // a bright tip on a few of the light fibres: the micro-specular glints of the pile
      if (light && r() < 0.14) {
        ctx.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.2})`
        ctx.beginPath(); ctx.arc(((x + dx) % S + S) % S, ((y + dy) % S + S) % S, w * 0.7, 0, Math.PI * 2); ctx.fill()
      }
    }
    const data = ctx.getImageData(0, 0, S, S).data
    const out = new Float32Array(S * S)
    for (let p = 0, q = 0; p < out.length; p++, q += 4) out[p] = (data[q] - 128) / 128
    return out
  }

  window.renderAlcantara = async function (S, outputs, seed = 7) {
    const t0 = performance.now()
    const k = S / 2048
    const N = S * S
    // 1. microfibre grain
    const r = rng(seed * 31 + 5)
    const white = new Float32Array(N)
    for (let p = 0; p < N; p++) white[p] = r() - 0.5
    const grain = normalise(blur(white, S, 0.6 * k, 2))
    const grainCoarse = normalise(blur(white, S, 1.6 * k, 3))
    // 2. fibres
    const fib = fibres(S, seed * 7 + 1)
    // 3. nap: patches elongated along the nap (horizontal), plus broad soft variation
    const napA = normalise(fbm(S, 3, 16, 4, 0.55, seed * 13 + 3))
    const napB = normalise(fbm(S, 3, 3, 3, 0.5, seed * 17 + 9))
    const napFine = normalise(fbm(S, 24, 90, 2, 0.5, seed * 19 + 4))
    // 4. height & light (top-left)
    const h = new Float32Array(N)
    for (let p = 0; p < N; p++) h[p] = grain[p] * 0.55 + grainCoarse[p] * 0.35 + fib[p] * 2.4
    const out = new Float32Array(N)
    const L = 0.085
    for (let j = 0; j < S; j++) {
      const jm = ((j - 1 + S) % S) * S, jp = ((j + 1) % S) * S, row = j * S
      for (let i = 0; i < S; i++) {
        const im = (i - 1 + S) % S, ip = (i + 1) % S
        const slope = (h[jm + im] - h[jp + ip]) // lit from the top-left
        const p = row + i
        // the pile is lighter where it leans towards the light: the nap patches also scale the fibres' sheen
        const sheen = 1 + napA[p] * 0.18
        out[p] = 0.5
          + grain[p] * 0.028
          + grainCoarse[p] * 0.02
          + fib[p] * 0.27 * sheen
          + slope * L * 0.12
          + napA[p] * 0.028 + napB[p] * 0.022 + napFine[p] * 0.012
      }
    }
    const urls = []
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(S, S)
    for (let p = 0, q = 0; p < N; p++, q += 4) {
      const v = Math.max(0, Math.min(255, Math.round(out[p] * 255)))
      img.data[q] = img.data[q + 1] = img.data[q + 2] = v; img.data[q + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    for (const { size, quality } of outputs) {
      const c = document.createElement('canvas')
      c.width = c.height = size
      const cx = c.getContext('2d')
      cx.imageSmoothingQuality = 'high'
      cx.drawImage(canvas, 0, 0, size, size)
      urls.push(c.toDataURL('image/webp', quality))
    }
    return { urls, ms: Math.round(performance.now() - t0) }
  }
})()
