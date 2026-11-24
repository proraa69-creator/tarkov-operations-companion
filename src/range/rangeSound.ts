/**
 * A gunshot made on the spot (owner, 22.11.2026: «звук выстрела какой-нибудь сделай, сгенерируй… один сгенерируй звук на все
 * оружия»): a sharp crack of noise, a low thump under it and a short room tail, from the Web Audio API — no sound file ships.
 */
let context: AudioContext | undefined
let noise: AudioBuffer | undefined

function audio() {
  if (typeof window === 'undefined') return undefined
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return undefined
  context ??= new Context()
  if (context.state === 'suspended') void context.resume()
  if (!noise) {
    noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.6), context.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return context
}

/** One shot; `volume` 0…1. */
export function playShot(volume = 0.5) {
  const ctx = audio()
  if (!ctx || !noise) return
  const now = ctx.currentTime
  const out = ctx.createGain()
  out.gain.value = Math.max(0, Math.min(1, volume))
  out.connect(ctx.destination)

  // the crack: bright noise, a few milliseconds of attack and a fast fall
  const crack = ctx.createBufferSource()
  crack.buffer = noise
  crack.playbackRate.value = 0.9 + Math.random() * 0.2
  const crackFilter = ctx.createBiquadFilter()
  crackFilter.type = 'highpass'
  crackFilter.frequency.value = 900
  const crackGain = ctx.createGain()
  crackGain.gain.setValueAtTime(0.0001, now)
  crackGain.gain.exponentialRampToValueAtTime(1, now + 0.002)
  crackGain.gain.exponentialRampToValueAtTime(0.02, now + 0.09)
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
  crack.connect(crackFilter).connect(crackGain).connect(out)
  crack.start(now)
  crack.stop(now + 0.4)

  // the body: low noise for the muzzle blast
  const body = ctx.createBufferSource()
  body.buffer = noise
  const bodyFilter = ctx.createBiquadFilter()
  bodyFilter.type = 'lowpass'
  bodyFilter.frequency.setValueAtTime(1800, now)
  bodyFilter.frequency.exponentialRampToValueAtTime(220, now + 0.25)
  const bodyGain = ctx.createGain()
  bodyGain.gain.setValueAtTime(0.0001, now)
  bodyGain.gain.exponentialRampToValueAtTime(0.9, now + 0.004)
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)
  body.connect(bodyFilter).connect(bodyGain).connect(out)
  body.start(now)
  body.stop(now + 0.55)

  // the thump: a falling sine
  const thump = ctx.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(140, now)
  thump.frequency.exponentialRampToValueAtTime(42, now + 0.16)
  const thumpGain = ctx.createGain()
  thumpGain.gain.setValueAtTime(0.0001, now)
  thumpGain.gain.exponentialRampToValueAtTime(0.8, now + 0.003)
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
  thump.connect(thumpGain).connect(out)
  thump.start(now)
  thump.stop(now + 0.25)
}
