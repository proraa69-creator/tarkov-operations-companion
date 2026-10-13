// Alternative soundtracks for the promo, synthesised sample by sample (no recordings, no licence), each with the same
// interface sounds placed on the cut's events:
//   sfx      interface sounds only (key presses, chimes, pops, whooshes, a ping, soft impacts), no music
//   ambient  a calm pad bed in D minor (chords, sub, a soft echoing arpeggio), no drums
//   tension  a dark drone with wind, a slow heartbeat and distant metal, rising into the end card
//   node sound.mjs --cues=<cues.json> --style=sfx|ambient|tension --out=<file.wav>
// cues.json: { duration, cues: [{ t, kind }] } with kind logo | whoosh | key | ding | pop | ping | tick | end.
// 48 kHz stereo 16-bit WAV, peak −1 dBFS (loudness is set by the mix).
import { readFileSync, writeFileSync } from 'node:fs'

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const style = arg('style') ?? 'sfx'
const { duration, cues } = JSON.parse(readFileSync(arg('cues'), 'utf8'))
const outFile = arg('out')
const SR = 48000
const N = Math.ceil(duration * SR)
const at = (t) => Math.round(t * SR)
let seed = 0x51a7e
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const noise = () => rnd() * 2 - 1
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))

function coeffs(type, f, q) {
  const w = 2 * Math.PI * clamp(f, 10, SR * 0.45) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q)
  let b0, b1, b2
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0 } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0 } else { b0 = al; b1 = 0; b2 = -al }
  const a0 = 1 + al
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * c) / a0, (1 - al) / a0]
}
class Biquad {
  constructor(type, f, q = 0.707) { this.type = type; this.q = q; this.k = coeffs(type, f, q); this.x1 = this.x2 = this.y1 = this.y2 = 0 }
  tune(f) { this.k = coeffs(this.type, f, this.q) }
  run(x) {
    const [b0, b1, b2, a1, a2] = this.k
    const y = b0 * x + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y
    return y
  }
}
class Bus {
  constructor() { this.l = new Float32Array(N); this.r = new Float32Array(N) }
  add(i, v, pan = 0) {
    if (i < 0 || i >= N) return
    const a = (pan + 1) * Math.PI / 4
    this.l[i] += v * Math.cos(a); this.r[i] += v * Math.sin(a)
  }
}
const music = new Bus(), fx = new Bus(), send = new Bus()

// ---- interface sounds ------------------------------------------------------------------------------------------------
/** A keyboard key: a bright click and a low thock on the press, a softer click on the release. */
function key(t, gain = 1) {
  for (const [dt, g] of [[0, 1], [0.085, 0.45]]) {
    const i0 = at(t + dt), n = at(0.06)
    const bp = new Biquad('bp', 3400, 1.3)
    let ph = 0
    for (let i = 0; i < n; i++) {
      const s = i / SR
      ph += 2 * Math.PI * (210 - 90 * Math.min(1, s / 0.03)) / SR
      const v = (bp.run(noise()) * Math.exp(-s * 260) * 1.6 + Math.sin(ph) * Math.exp(-s * 70) * 0.55) * g * gain
      fx.add(i0 + i, v, -0.1)
      send.add(i0 + i, v * 0.15)
    }
  }
}
/** A soft bell: inharmonic partials with their own decays. */
function bell(t, f, gain = 1, pan = 0) {
  const i0 = at(t), n = at(1.8)
  const parts = [[1, 1, 2.2], [2.76, 0.35, 4.5], [5.4, 0.12, 8], [8.93, 0.05, 12]].map(([m, a, d]) => ({ f: f * m, a, d, ph: rnd() }))
  for (let i = 0; i < n; i++) {
    const s = i / SR
    let v = 0
    for (const p of parts) { p.ph = (p.ph + p.f / SR) % 1; v += Math.sin(2 * Math.PI * p.ph) * p.a * Math.exp(-s * p.d) }
    v *= Math.min(1, s / 0.002) * gain * 0.22
    fx.add(i0 + i, v, pan)
    send.add(i0 + i, v * 0.7, pan)
  }
}
/** Success chime: two bells a fifth apart. */
function ding(t, gain = 1) { bell(t, hz(81), gain, -0.15); bell(t + 0.07, hz(88), gain * 0.8, 0.15) }
/** A card popping up: a short rising bloop. */
function pop(t, gain = 1) {
  const i0 = at(t), n = at(0.08)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph += 2 * Math.PI * (380 + 700 * (s / 0.08)) / SR
    const v = Math.sin(ph) * Math.exp(-s * 40) * Math.min(1, s / 0.002) * gain * 0.3
    fx.add(i0 + i, v, 0.15)
    send.add(i0 + i, v * 0.25)
  }
}
function tick(t, gain = 1) {
  const i0 = at(t), n = at(0.05)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph += 2 * Math.PI * 2100 / SR
    const v = Math.sin(ph) * Math.exp(-s * 90) * gain * 0.22
    fx.add(i0 + i, v, 0.2)
    send.add(i0 + i, v * 0.3)
  }
}
/** Sonar ping for the player's point on the minimap. */
function ping(t, gain = 1) {
  const i0 = at(t), n = at(1.1)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph += 2 * Math.PI * 1320 / SR
    const v = Math.sin(ph) * Math.exp(-s * 5) * Math.min(1, s / 0.003) * gain * 0.16
    fx.add(i0 + i, v, -0.2)
    send.add(i0 + i, v * 0.9)
  }
}
/** Soft whoosh centred on t. */
function whoosh(t, gain = 1) {
  const len = 0.6, i0 = at(t - len * 0.6), n = at(len)
  const bp = new Biquad('bp', 500, 1.1)
  for (let i = 0; i < n; i++) {
    const u = i / n
    if (i % 16 === 0) bp.tune(300 + 2600 * Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 2)
    fx.add(i0 + i, bp.run(noise()) * Math.sin(Math.PI * u) ** 2 * gain * 0.55, -0.6 + 1.2 * u)
  }
}
/** A soft cinematic hit: sub drop and a shimmer, mostly into the reverb. */
function impact(t, gain = 1) {
  const i0 = at(t), n = at(3)
  const lp = new Biquad('lp', 900, 0.7)
  const ring = [293.7, 440, 587.3, 880].map((f) => ({ f, ph: rnd() }))
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph += 2 * Math.PI * (38 + 60 * Math.exp(-s * 6)) / SR
    let v = Math.sin(ph) * Math.exp(-s * 2.4) * 1.1 + lp.run(noise()) * Math.exp(-s * 9) * 0.35
    let m = 0
    for (const r of ring) { r.ph = (r.ph + r.f / SR) % 1; m += Math.sin(2 * Math.PI * r.ph) }
    v += m * 0.05 * Math.exp(-s * 1.8)
    v = Math.tanh(v) * Math.min(1, s / 0.003) * gain * 0.8
    fx.add(i0 + i, v)
    send.add(i0 + i, v * 0.5)
  }
}
/** Reverse swell ending at t1. */
function swell(t0, t1, gain = 1) {
  const i0 = at(t0), n = at(t1 - t0)
  const hp = new Biquad('hp', 2400, 0.7)
  for (let i = 0; i < n; i++) fx.add(i0 + i, hp.run(noise()) * (i / n) ** 3 * gain * 0.5, (rnd() - 0.5) * 0.3)
}

// ---- beds ------------------------------------------------------------------------------------------------------------
/** Pad chord: detuned saws, low-passed, slow attack and release. */
function chord(t0, t1, notes, gain = 1, bright = 1100, attack = 0.9, release = 1.6) {
  const i0 = at(t0), n = at(t1 - t0 + release)
  const voices = notes.flatMap((m) => [-0.08, 0, 0.09].map((d, k) => ({ f: hz(m + d), ph: rnd(), pan: k === 0 ? -0.6 : k === 2 ? 0.6 : 0 })))
  const lpL = new Biquad('lp', bright, 0.7), lpR = new Biquad('lp', bright, 0.7)
  const len = t1 - t0
  for (let i = 0; i < n && i0 + i < N; i++) {
    const s = i / SR
    let l = 0, r = 0
    for (const v of voices) {
      v.ph = (v.ph + v.f / SR) % 1
      const x = 2 * v.ph - 1, a = (v.pan + 1) * Math.PI / 4
      l += x * Math.cos(a); r += x * Math.sin(a)
    }
    const env = Math.min(1, s / attack) * (s < len ? 1 : Math.max(0, 1 - (s - len) / release))
    const g = env * gain * 0.045
    const vl = lpL.run(l) * g, vr = lpR.run(r) * g
    music.l[i0 + i] += vl; music.r[i0 + i] += vr
    send.l[i0 + i] += vl * 0.6; send.r[i0 + i] += vr * 0.6
  }
}
function sub(t0, t1, midi, gain = 1) {
  const i0 = at(t0), n = at(t1 - t0), f = hz(midi)
  let ph = 0
  for (let i = 0; i < n && i0 + i < N; i++) {
    const s = i / SR, len = t1 - t0
    ph += 2 * Math.PI * f / SR
    const env = Math.min(1, s / 0.6) * Math.min(1, (len - s) / 0.8)
    music.add(i0 + i, Math.sin(ph) * env * gain * 0.32)
  }
}
/** Soft pluck (filtered triangle) for the arpeggio; the echo is added on the music bus later. */
function pluck(t, midi, gain = 1, pan = 0) {
  const i0 = at(t), n = at(0.5), f = hz(midi)
  const lp = new Biquad('lp', 2200, 0.9)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph = (ph + f / SR) % 1
    const tri = 4 * Math.abs(ph - 0.5) - 1
    const v = lp.run(tri) * Math.exp(-s * 7) * Math.min(1, s / 0.004) * gain * 0.2
    music.add(i0 + i, v, pan)
    send.add(i0 + i, v * 0.5, pan)
  }
}
/** Heartbeat kick (lub-dub). */
function beat(t, gain = 1) {
  for (const [dt, g] of [[0, 1], [0.22, 0.65]]) {
    const i0 = at(t + dt), n = at(0.35)
    let ph = 0
    for (let i = 0; i < n; i++) {
      const s = i / SR
      ph += 2 * Math.PI * (42 + 60 * Math.exp(-s * 30)) / SR
      music.add(i0 + i, Math.tanh(1.4 * Math.sin(ph) * Math.exp(-s * 9)) * g * gain * 0.55)
    }
  }
}
/** A distant metal hit (a pipe struck far away): inharmonic ring, heavy reverb. */
function metal(t, gain = 1, pan = 0) {
  const i0 = at(t), n = at(2.4)
  const parts = [180, 431, 712, 1043, 1478].map((f, k) => ({ f, a: 1 / (k + 1), ph: rnd() }))
  const lp = new Biquad('lp', 2500, 0.7)
  for (let i = 0; i < n; i++) {
    const s = i / SR
    let v = 0
    for (const p of parts) { p.ph = (p.ph + p.f / SR) % 1; v += Math.sin(2 * Math.PI * p.ph) * p.a }
    v = lp.run(v) * Math.exp(-s * 2.2) * Math.min(1, s / 0.002) * gain * 0.07
    music.add(i0 + i, v * 0.4, pan)
    send.add(i0 + i, v * 1.6, pan)
  }
}

const endT = cues.find((c) => c.kind === 'end')?.t ?? duration - 5
if (style === 'ambient') {
  // Dm – B♭ – F – C, one chord every 3.4 s from the start, resolving on Dm with the end card
  const CH = [[50, 57, 62, 65], [46, 58, 62, 65], [53, 57, 60, 65], [48, 55, 60, 64]]
  const ROOT = [38, 34, 41, 36]
  const len = 3.4
  let k = 0
  for (let t = 0; t < endT - 0.5; t += len, k += 1) {
    const t1 = Math.min(t + len, endT)
    chord(t, t1, CH[k % 4], 1, 1000 + 300 * (k % 2))
    sub(t, t1 + 0.3, ROOT[k % 4], 0.9)
  }
  // a soft arpeggio from the first shot, eighth notes at 84 BPM
  const step = 60 / 84 / 2, first = cues.find((c) => c.kind === 'whoosh')?.t ?? 3.5
  for (let t = first, j = 0; t < endT - 0.3; t += step, j += 1) {
    const c = CH[Math.floor(t / len) % 4]
    const tones = [c[1] + 12, c[2] + 12, c[3] + 12, c[2] + 12]
    pluck(t, tones[j % 4], j % 4 === 0 ? 1 : 0.7, j % 2 ? 0.35 : -0.35)
  }
  chord(endT, duration, [38, 50, 57, 62, 65, 69], 1.1, 1200, 0.4, 1.2)
  sub(endT, duration, 38, 1)
  swell(endT - 1.4, endT, 0.9)
} else if (style === 'tension') {
  // a low D drone with a slowly opening filter, wind, a heartbeat after the intro and distant metal
  const i1 = at(endT)
  const lpD = new Biquad('lp', 200, 1.2), wind = new Biquad('bp', 600, 0.6)
  let p1 = 0, p2 = 0, p3 = 0
  for (let i = 0; i < N; i++) {
    const t = i / SR
    if (i % 64 === 0) { lpD.tune(160 + 380 * Math.min(1, t / endT) + 60 * Math.sin(2 * Math.PI * 0.11 * t)); wind.tune(500 + 400 * Math.sin(2 * Math.PI * 0.07 * t) ** 2) }
    p1 = (p1 + hz(26) / SR) % 1; p2 = (p2 + hz(38.06) / SR) % 1; p3 = (p3 + hz(45) / SR) % 1
    const raw = (2 * p1 - 1) * 0.6 + (2 * p2 - 1) * 0.5 + Math.sin(2 * Math.PI * p3) * 0.4
    const fadeIn = Math.min(1, t / 1.5), out = i < i1 ? 1 : Math.max(0, 1 - (t - endT) / 0.6)
    const v = lpD.run(raw) * 0.5 * fadeIn * out
    const w = wind.run(noise()) * 0.18 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.09 * t + 1)) * fadeIn * out
    music.add(i, v)
    music.add(i, w, Math.sin(2 * Math.PI * 0.05 * t) * 0.6)
    send.add(i, w * 0.3)
  }
  const first = cues.find((c) => c.kind === 'whoosh')?.t ?? 3.5
  for (let t = first, k = 0; t < endT - 0.8; t += 1.6, k += 1) beat(t, 0.55 + 0.45 * Math.min(1, (t - first) / (endT - first)))
  for (const [t, p] of [[2.2, -0.6], [9.1, 0.5], [15.3, -0.4], [19.0, 0.6]]) if (t < endT - 1) metal(t, 1, p)
  // a rising tone into the end card, then a Dm chord that rings out
  {
    const t0 = endT - 3, i0 = at(t0), n = at(3)
    const bp = new Biquad('bp', 300, 2)
    let ph = 0
    for (let i = 0; i < n; i++) {
      const u = i / n
      if (i % 16 === 0) bp.tune(300 * 2 ** (u * 3.5))
      ph += 2 * Math.PI * (110 * 2 ** (u * 2)) / SR
      const v = (bp.run(noise()) * 0.9 + Math.sin(ph) * 0.1) * u ** 2.4 * 0.7
      music.add(i0 + i, v)
      send.add(i0 + i, v * 0.4)
    }
  }
  chord(endT, duration, [38, 50, 57, 62, 65], 1.1, 900, 0.3, 1.2)
  sub(endT, duration, 26, 1.1)
}

// interface sounds on the cut's events (all styles)
for (const c of cues) {
  if (c.kind === 'logo') impact(c.t, style === 'sfx' ? 0.8 : 0.6)
  else if (c.kind === 'end') impact(c.t, 1)
  else if (c.kind === 'whoosh') whoosh(c.t, 0.8)
  else if (c.kind === 'key') key(c.t, 1)
  else if (c.kind === 'ding') ding(c.t, 1)
  else if (c.kind === 'pop') pop(c.t, 0.9)
  else if (c.kind === 'tick') tick(c.t, 0.9)
  else if (c.kind === 'ping') ping(c.t, 1)
}

// ---- mix: an echo on the arpeggio bed, a small room reverb, a gentle limiter -------------------------------------------
if (style === 'ambient') {
  const d = at(60 / 84 * 0.75), fb = 0.32
  for (let i = d; i < N; i++) { music.l[i] += music.r[i - d] * fb * 0.5; music.r[i] += music.l[i - d] * fb * 0.5 }
}
function freeverb(inL, inR, room = 0.82, damp = 0.35) {
  const sc = SR / 44100
  const make = (spread) => ({
    combs: [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * sc)), i: 0, store: 0 })),
    aps: [556, 441, 341, 225].map((d) => ({ buf: new Float32Array(Math.round((d + spread) * sc)), i: 0 })),
  })
  const chans = [make(0), make(23)]
  const out = [new Float32Array(N), new Float32Array(N)]
  for (let i = 0; i < N; i++) {
    const x = (inL[i] + inR[i]) * 0.015
    for (let ch = 0; ch < 2; ch++) {
      const c = chans[ch]
      let y = 0
      for (const cb of c.combs) {
        const o = cb.buf[cb.i]
        cb.store = o * (1 - damp) + cb.store * damp
        cb.buf[cb.i] = x + cb.store * room
        cb.i = (cb.i + 1) % cb.buf.length
        y += o
      }
      for (const ap of c.aps) {
        const b = ap.buf[ap.i]
        ap.buf[ap.i] = y + b * 0.5
        ap.i = (ap.i + 1) % ap.buf.length
        y = b - y
      }
      out[ch][i] = y * 3
    }
  }
  return out
}
const [revL, revR] = freeverb(send.l, send.r)
const L = new Float32Array(N), R = new Float32Array(N)
const hpL = new Biquad('hp', 30), hpR = new Biquad('hp', 30)
for (let i = 0; i < N; i++) {
  const t = i / SR
  const g = Math.min(1, t / 0.005) * (t > duration - 1 ? Math.cos((Math.PI / 2) * (t - (duration - 1))) : 1)
  L[i] = Math.tanh(hpL.run(music.l[i] + fx.l[i] + revL[i] * 0.3) * 1.05) * g
  R[i] = Math.tanh(hpR.run(music.r[i] + fx.r[i] + revR[i] * 0.3) * 1.05) * g
}
let peak = 1e-9
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
const norm = 0.891 / peak
const pcm = Buffer.alloc(44 + N * 4)
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12)
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28)
pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40)
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(clamp(Math.round(L[i] * norm * 32767 + (rnd() - rnd())), -32768, 32767), 44 + i * 4)
  pcm.writeInt16LE(clamp(Math.round(R[i] * norm * 32767 + (rnd() - rnd())), -32768, 32767), 46 + i * 4)
}
writeFileSync(outFile, pcm)
console.log(`sound ${style}: ${duration.toFixed(2)} s → ${outFile}`)
