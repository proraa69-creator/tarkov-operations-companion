// Music for the advert cut of trailer.html, synthesised here sample by sample: no recordings, no samples, no third-party
// audio, so the soundtrack carries no licence. A dark 120 BPM electronic bed in D minor (pad, bass, drums, an arpeggio)
// with trailer hits on the cut's own cues: impacts on the logo and on the end card, a whoosh on every scene change, a
// riser into the end card, quick hits on the boss cuts and soft ticks when a card pops. 48 kHz stereo 16-bit WAV.
//
//   node scripts/trailer/music.mjs --cues=scripts/trailer/out/raidos-ad.cues.json --out=music.wav
//
// The cues file comes from render.mjs --cut=ad: { duration, fade, times: { scene: [a, b] }, cues: [{ t, kind }] }; a scene
// change is the middle of its cross-fade (a + fade / 2), and the cut puts those on beats of this tempo.
import { readFileSync, writeFileSync } from 'node:fs'

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const cuesFile = arg('cues')
const outFile = arg('out')
if (!cuesFile || !outFile) throw new Error('usage: node music.mjs --cues=<cues.json> --out=<music.wav>')
const { duration, fade = 0.4, times, cues = [] } = JSON.parse(readFileSync(cuesFile, 'utf8'))

const SR = 48000
const BEAT = 0.5 // 120 BPM
const BAR = 4 * BEAT
const STEP = BEAT / 4 // a sixteenth
const N = Math.ceil(duration * SR)

// Song form from the cut: the groove starts on the first scene change, gets drums in full on the bosses, breaks down on
// «Честная игра» and resolves with the end card.
const change = (scene) => times[scene][0] + fade / 2
const order = Object.entries(times).sort((a, b) => a[1][0] - b[1][0]).map(([k]) => k)
const changes = order.slice(1).map(change)
const tGroove = changes[0]
const snap = (t) => tGroove + Math.round((t - tGroove) / BEAT) * BEAT
const tFull = snap(times.boss ? change('boss') : tGroove + 4 * BAR)
const tBreak = snap(times.fair ? change('fair') : duration - 6)
const tEnd = snap(times.outro ? change('outro') : duration - 3.5)

// ---- building blocks -----------------------------------------------------------------------------------------------
let seed = 0x5eed1234
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
/** RBJ biquad: lp, hp or bp (0 dB peak); tune() moves the frequency for sweeps. */
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

/** A stereo bus; pan -1 … 1 (equal power). */
class Bus {
  constructor() { this.l = new Float32Array(N); this.r = new Float32Array(N) }
  add(i, v, pan = 0) {
    if (i < 0 || i >= N) return
    const a = (pan + 1) * Math.PI / 4
    this.l[i] += v * Math.cos(a); this.r[i] += v * Math.sin(a)
  }
}
const drums = new Bus(), bass = new Bus(), pad = new Bus(), arp = new Bus(), fx = new Bus(), send = new Bus()
const at = (t) => Math.round(t * SR)

// ---- instruments -----------------------------------------------------------------------------------------------------
const kicks = []
function kick(t, gain = 1) {
  kicks.push(t)
  const i0 = at(t), n = at(0.42)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph += 2 * Math.PI * (44 + 115 * Math.exp(-s * 32)) / SR
    const env = Math.exp(-s * 8) * Math.min(1, s / 0.0015)
    const v = Math.tanh(1.8 * Math.sin(ph) * env) * 0.9 + noise() * Math.exp(-s * 450) * 0.25
    drums.add(i0 + i, v * gain)
  }
}
function snare(t, gain = 1, pan = 0) {
  const i0 = at(t), n = at(0.32)
  const bp = new Biquad('bp', 1900, 0.7), hp = new Biquad('hp', 5000)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR, x = noise()
    ph += 2 * Math.PI * 185 / SR
    const v = bp.run(x) * 1.6 * Math.exp(-s * 15) + hp.run(x) * 0.35 * Math.exp(-s * 22) + Math.sin(ph) * 0.5 * Math.exp(-s * 30)
    drums.add(i0 + i, v * gain, pan)
    send.add(i0 + i, v * gain * 0.35, pan)
  }
}
function hat(t, gain = 1, open = false, pan = 0) {
  const i0 = at(t), n = at(open ? 0.3 : 0.06)
  const hp = new Biquad('hp', 7500, 0.9)
  for (let i = 0; i < n; i++) {
    const s = i / SR
    drums.add(i0 + i, hp.run(noise()) * Math.exp(-s * (open ? 11 : 70)) * gain * 0.55, pan)
  }
}
/** Bass note: saw + square an octave down, a low-pass that opens on the attack. */
function bassNote(t, midi, len, gain = 1) {
  const i0 = at(t), n = at(len + 0.04), f = hz(midi)
  const lp = new Biquad('lp', 400, 1.1)
  let p1 = 0, p2 = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    if (i % 16 === 0) lp.tune(170 + 1100 * Math.exp(-s * 14))
    p1 = (p1 + f / SR) % 1; p2 = (p2 + f / 2 / SR) % 1
    const raw = (2 * p1 - 1) * 0.7 + (p2 < 0.5 ? 0.45 : -0.45)
    const env = Math.min(1, s / 0.004) * (s < len ? 1 - 0.35 * (s / len) : Math.max(0, 1 - (s - len) / 0.04))
    const v = Math.tanh(lp.run(raw) * 1.6) * env
    bass.add(i0 + i, v * gain)
  }
}
/** Pad chord: three detuned saws per note, low-passed, slow attack and release, spread across the stereo field. */
function chord(t0, t1, notes, gain = 1, bright = 1300) {
  const i0 = at(t0), n = at(t1 - t0 + 0.9)
  const voices = notes.flatMap((m) => [-0.11, 0, 0.12].map((d, k) => ({ f: hz(m + d), ph: rnd(), pan: k === 0 ? -0.6 : k === 2 ? 0.6 : 0 })))
  const lpL = new Biquad('lp', bright, 0.8), lpR = new Biquad('lp', bright, 0.8)
  const len = t1 - t0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    let l = 0, r = 0
    for (const v of voices) {
      v.ph = (v.ph + v.f / SR) % 1
      const x = 2 * v.ph - 1
      const a = (v.pan + 1) * Math.PI / 4
      l += x * Math.cos(a); r += x * Math.sin(a)
    }
    if (i % 32 === 0) { const f = bright * (1 + 0.15 * Math.sin(2 * Math.PI * 0.25 * (t0 + s))); lpL.tune(f); lpR.tune(f) }
    const env = Math.min(1, s / 0.35) * (s < len ? 1 : Math.max(0, 1 - (s - len) / 0.9))
    const g = env * gain * 0.06
    const vl = lpL.run(l) * g, vr = lpR.run(r) * g
    const j = i0 + i
    if (j >= N) break
    pad.l[j] += vl; pad.r[j] += vr
    send.l[j] += vl * 0.5; send.r[j] += vr * 0.5
  }
}
/** Arpeggio pluck; the echo comes from the ping-pong delay on the bus. */
function pluck(t, midi, gain = 1, pan = 0) {
  const i0 = at(t), n = at(0.22), f = hz(midi)
  const lp = new Biquad('lp', 3000, 1.4)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    if (i % 16 === 0) lp.tune(500 + 3800 * Math.exp(-s * 22))
    ph = (ph + f / SR) % 1
    const v = lp.run(ph < 0.32 ? 0.8 : -0.8) * Math.exp(-s * 13) * Math.min(1, s / 0.002)
    arp.add(i0 + i, v * gain, pan)
  }
}
/** Trailer impact: a falling sub thump, a noise blast and a metallic ring, mostly into the reverb. */
function impact(t, gain = 1) {
  const i0 = at(t), n = at(3.2)
  const lp = new Biquad('lp', 1600, 0.7)
  let ph = 0
  const ring = [196, 293.7, 440.8, 587].map((f) => ({ f, ph: rnd() }))
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph += 2 * Math.PI * (34 + 80 * Math.exp(-s * 7)) / SR
    let v = Math.sin(ph) * Math.exp(-s * 2.2) * 1.3
    v += lp.run(noise()) * Math.exp(-s * 6) * 0.9
    let m = 0
    for (const r of ring) { r.ph = (r.ph + r.f / SR) % 1; m += Math.sin(2 * Math.PI * r.ph) }
    v += m * 0.06 * Math.exp(-s * 2.6)
    v = Math.tanh(v * 1.2) * Math.min(1, s / 0.002) * gain
    fx.add(i0 + i, v)
    send.add(i0 + i, v * 0.6)
  }
}
/** Whoosh centred on t: band-passed noise sweeping up and down, panned across. */
function whoosh(t, gain = 1) {
  const len = 0.7, i0 = at(t - len * 0.6), n = at(len)
  const bp = new Biquad('bp', 500, 1.2)
  for (let i = 0; i < n; i++) {
    const u = i / n
    if (i % 16 === 0) bp.tune(350 + 3200 * Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 2)
    const env = Math.sin(Math.PI * u) ** 2
    fx.add(i0 + i, bp.run(noise()) * env * gain * 1.1, -0.7 + 1.4 * u)
  }
}
/** Rising noise and tone into t1. */
function riser(t0, t1, gain = 1) {
  const i0 = at(t0), n = at(t1 - t0)
  const bp = new Biquad('bp', 300, 2)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const u = i / n
    if (i % 16 === 0) bp.tune(300 * 2 ** (u * 4.2))
    ph += 2 * Math.PI * (180 * 2 ** (u * 2)) / SR
    const v = (bp.run(noise()) * 1.4 + Math.sin(ph) * 0.12) * u ** 2.2 * gain
    fx.add(i0 + i, v)
    send.add(i0 + i, v * 0.4)
  }
}
/** Reverse swell (a cymbal played backwards) ending at t1. */
function swell(t0, t1, gain = 1) {
  const i0 = at(t0), n = at(t1 - t0)
  const hp = new Biquad('hp', 2600, 0.7)
  for (let i = 0; i < n; i++) {
    const u = i / n
    const v = hp.run(noise()) * u ** 3 * gain * 0.9
    fx.add(i0 + i, v, (rnd() - 0.5) * 0.4)
  }
}
/** A short shutter hit for the quick boss cuts. */
function cutHit(t, gain = 1) {
  const i0 = at(t), n = at(0.18)
  const bp = new Biquad('bp', 1200, 0.9)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph += 2 * Math.PI * (90 + 140 * Math.exp(-s * 40)) / SR
    const v = (bp.run(noise()) * Math.exp(-s * 35) * 0.8 + Math.sin(ph) * Math.exp(-s * 22) * 0.7) * gain
    fx.add(i0 + i, v)
    send.add(i0 + i, v * 0.25)
  }
}
/** UI tick when a card pops or a part lights. */
function tick(t, gain = 1, f0 = 1500) {
  const i0 = at(t), n = at(0.09)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph += 2 * Math.PI * (f0 + 900 * (s / 0.09)) / SR
    const v = Math.sin(ph) * Math.exp(-s * 45) * Math.min(1, s / 0.001) * gain * 0.35
    fx.add(i0 + i, v, 0.2)
    send.add(i0 + i, v * 0.3)
  }
}
/** Sonar ping for the player's point on the minimap. */
function ping(t, gain = 1) {
  const i0 = at(t), n = at(0.9)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const s = i / SR
    ph += 2 * Math.PI * 1320 / SR
    const v = Math.sin(ph) * Math.exp(-s * 6) * Math.min(1, s / 0.003) * gain * 0.22
    fx.add(i0 + i, v, -0.2)
    send.add(i0 + i, v * 0.8)
  }
}

// ---- the arrangement -----------------------------------------------------------------------------------------------
// i – VI – III – VII: Dm, B♭, F, C (pad voicings and bass roots)
const CHORDS = [
  { pad: [50, 62, 65, 69], root: 38 }, // Dm
  { pad: [46, 58, 62, 65], root: 34 }, // B♭
  { pad: [53, 57, 60, 65], root: 41 }, // F
  { pad: [48, 60, 64, 67], root: 36 }, // C
]
const chordAt = (t) => CHORDS[Math.floor((t - tGroove) / BAR + 1e-6) % 4]

// intro: the logo impact, a low Dm drone and a reverse swell into the groove
const logo = cues.find((c) => c.kind === 'logo')?.t ?? 0.1
impact(logo, 0.9)
chord(0, tGroove, [38, 50, 57], 0.9, 700)
swell(tGroove - 1.1, tGroove, 0.8)

// groove: chords per bar until the break
for (let t = tGroove; t < tBreak - 1e-6; t += BAR) chord(t, Math.min(t + BAR, tBreak), chordAt(t).pad, t < tFull ? 1 : 0.85)

for (let t = tGroove; t < tBreak - 1e-6; t += STEP) {
  const step = Math.round((t - tGroove) / STEP) % 16, bar = Math.floor((t - tGroove) / BAR + 1e-6)
  const c = chordAt(t)
  if (t < tFull) {
    // half-time: kick on 1 and the «and» of 3, snare on 3, offbeat hats, offbeat bass
    if (step === 0 || step === 10 || (step === 7 && bar % 2 === 1)) kick(t, step === 0 ? 1 : 0.8)
    if (step === 8) snare(t, 0.75)
    if (step % 2 === 0) hat(t, step % 4 === 2 ? 0.8 : 0.4, false, step % 4 === 2 ? 0.25 : -0.25)
    if (step % 4 === 2) bassNote(t, c.root + (step === 14 ? 12 : 0), BEAT * 0.45, 0.9)
  } else {
    // full: four on the floor, snare on 2 and 4, sixteenth hats (open on the offbeats), rolling bass, arpeggio
    if (step % 4 === 0) kick(t, 1)
    if (step === 4 || step === 12) snare(t, 1)
    if (step % 4 === 2) hat(t, 0.7, true, 0.2)
    else hat(t, step % 2 ? 0.35 : 0.5, false, step % 2 ? -0.3 : 0.3)
    if (step % 4 !== 0) bassNote(t, c.root + (step % 8 === 7 ? 12 : 0), STEP * 0.8, 0.85)
    const tones = [...c.pad.slice(1), c.pad[1] + 12, c.pad[2] + 12]
    pluck(t, tones[[0, 2, 1, 3, 2, 4, 3, 1][step % 8]] + 12, step % 4 === 0 ? 1 : 0.75, step % 2 ? 0.35 : -0.35)
  }
}

// break: B♭ then C opening up, a snare roll and a riser into the end card
chord(tBreak, (tBreak + tEnd) / 2, CHORDS[1].pad, 1.15, 900)
chord((tBreak + tEnd) / 2, tEnd, CHORDS[3].pad, 1.15, 1500)
riser(tBreak + 0.4, tEnd, 1)
for (let t = tEnd - 2 * BEAT, k = 0; t < tEnd - 1e-6; k++) {
  const u = (t - (tEnd - 2 * BEAT)) / (2 * BEAT)
  snare(t, 0.25 + 0.6 * u, (k % 2 ? 0.2 : -0.2))
  t += u < 0.5 ? STEP : STEP / 2
}

// end card: the big impact on the resolving Dm, one last low note, then it rings out
impact(tEnd, 1.15)
kick(tEnd, 1)
chord(tEnd, duration, [38, 50, 57, 62, 65, 69], 1.2, 1100)
bassNote(tEnd, 38, 1.6, 0.8)

// every scene change gets a whoosh (the logo and the end card have their impacts)
for (const t of changes) if (Math.abs(t - tEnd) > 0.05) whoosh(t, t === tFull ? 0.8 : 0.6)
if (times.boss) impact(tFull, 0.55)
for (const c of cues) {
  if (c.kind === 'cut') cutHit(c.t, 0.8)
  else if (c.kind === 'pop') tick(c.t, 1, 1300)
  else if (c.kind === 'tick') tick(c.t, 0.7, 1700)
  else if (c.kind === 'ping') ping(c.t, 1)
}

// ---- mix ----------------------------------------------------------------------------------------------------------
// side-chain: the pad and the bass dip under every kick
const duck = new Float32Array(N).fill(1)
for (const t of kicks) {
  const i0 = at(t), n = at(0.32)
  for (let i = 0; i < n && i0 + i < N; i++) duck[i0 + i] = Math.min(duck[i0 + i], 1 - 0.55 * Math.exp(-(i / SR) * 11))
}
// ping-pong delay on the arpeggio (a dotted eighth)
{
  const d = at(BEAT * 0.75), fb = 0.38
  for (let i = d; i < N; i++) {
    arp.l[i] += arp.r[i - d] * fb
    arp.r[i] += arp.l[i - d] * fb
  }
}
// Freeverb (Jezar's tuning, scaled to 48 kHz) on the send bus
function freeverb(inL, inR, room = 0.84, damp = 0.3) {
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
const hpL = new Biquad('hp', 32), hpR = new Biquad('hp', 32)
for (let i = 0; i < N; i++) {
  const d = duck[i]
  let l = drums.l[i] * 0.9 + bass.l[i] * 0.5 * d + pad.l[i] * 0.55 * d + arp.l[i] * 0.16 + fx.l[i] * 0.75 + revL[i] * 0.32
  let r = drums.r[i] * 0.9 + bass.r[i] * 0.5 * d + pad.r[i] * 0.55 * d + arp.r[i] * 0.16 + fx.r[i] * 0.75 + revR[i] * 0.32
  l = hpL.run(l); r = hpR.run(r)
  // gentle bus saturation, a short fade-in and the fade-out over the last 1.3 s
  const t = i / SR
  const g = Math.min(1, t / 0.005) * (t > duration - 1.3 ? Math.cos((Math.PI / 2) * (t - (duration - 1.3)) / 1.3) : 1)
  L[i] = Math.tanh(l * 1.1) * g
  R[i] = Math.tanh(r * 1.1) * g
}
// peak -1 dBFS (ffmpeg's loudnorm sets the loudness afterwards), 16-bit with TPDF dither
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
console.log(`music: ${duration}s, groove ${tGroove}s, full ${tFull}s, break ${tBreak}s, end card ${tEnd}s → ${outFile}`)
