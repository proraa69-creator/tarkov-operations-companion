import clickUrl from '../assets/sounds/click.mp3'

type SoundKind = 'hover' | 'click'

let context: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null

function audio() {
  if (context) return context
  const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext
  if (!Ctor) return null
  context = new Ctor()
  master = context.createGain()
  master.gain.value = 0.55
  master.connect(context.destination)
  noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.05), context.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  return context
}

/** `softAttack` (seconds) fades the burst in linearly instead of the default 1 ms snap. */
function burst(ctx: AudioContext, at: number, frequency: number, q: number, peak: number, decay: number, softAttack?: number) {
  const source = ctx.createBufferSource()
  source.buffer = noise
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = frequency
  filter.Q.value = q
  const gain = ctx.createGain()
  if (softAttack) {
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(peak, at + softAttack)
  } else {
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.001)
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  source.connect(filter).connect(gain).connect(master!)
  source.start(at)
  source.stop(at + decay + 0.01)
}

/** Hover: a short synthesized tick. Press: the owner's click recording (softened, see playClickSample). */
export function playUiSound(kind: SoundKind) {
  const ctx = audio()
  if (!ctx || !master) return
  if (ctx.state === 'suspended') void ctx.resume()
  const at = ctx.currentTime + 0.002
  if (kind === 'hover') {
    burst(ctx, at, 3400, 2.2, 0.06, 0.016)
    return
  }
  playClickSample(ctx, at)
}

/** The owner's click recording, decoded once; leading silence is skipped so it plays on the press. */
let clickSample: { buffer: AudioBuffer; offset: number } | null = null
let clickLoading: Promise<void> | null = null

function loadClickSample(ctx: AudioContext) {
  clickLoading ??= fetch(clickUrl)
    .then((response) => response.arrayBuffer())
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((buffer) => {
      const channel = buffer.getChannelData(0)
      let first = channel.findIndex((sample) => Math.abs(sample) > 0.01)
      if (first < 0) first = 0
      clickSample = { buffer, offset: Math.max(0, first / buffer.sampleRate - 0.003) }
    })
    .catch(() => { clickLoading = null })
  return clickLoading
}

/*
  The click is kept soft: the recording's ticks carry most of their energy above 8 kHz, which made it sharp,
  so it plays through a 4.5 kHz low-pass at a lower level and fades in over 4 ms instead of starting on a hard
  edge (peak −38 %, spectral centroid ≈ 10.5 → 5.2 kHz). The first-press fallback is softened the same way:
  lower, darker and with a 4 ms linear fade-in.
*/
const CLICK_LEVEL = 1.3
const CLICK_LOWPASS_HZ = 4500
const CLICK_ATTACK = 0.004

function playClickSample(ctx: AudioContext, at: number) {
  if (!clickSample) {
    // First press: fall back to a synthesized tick while the recording loads.
    burst(ctx, at, 1800, 1.5, 0.14, 0.022, CLICK_ATTACK)
    burst(ctx, at, 750, 0.9, 0.19, 0.048, CLICK_ATTACK)
    void loadClickSample(ctx)
    return
  }
  const source = ctx.createBufferSource()
  source.buffer = clickSample.buffer
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = CLICK_LOWPASS_HZ
  tone.Q.value = Math.SQRT1_2
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(CLICK_LEVEL, at + CLICK_ATTACK)
  source.connect(tone).connect(gain).connect(master!)
  source.start(at, clickSample.offset)
}

/** Loads the click recording ahead of the first press. */
export function preloadUiSounds() {
  const ctx = audio()
  if (ctx) void loadClickSample(ctx)
}
