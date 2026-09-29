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

function burst(ctx: AudioContext, at: number, frequency: number, q: number, peak: number, decay: number) {
  const source = ctx.createBufferSource()
  source.buffer = noise
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = frequency
  filter.Q.value = q
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.001)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  source.connect(filter).connect(gain).connect(master!)
  source.start(at)
  source.stop(at + decay + 0.01)
}

function thock(ctx: AudioContext, at: number, from: number, to: number, peak: number, decay: number, type: OscillatorType = 'triangle') {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(to, at + decay)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  osc.connect(gain).connect(master!)
  osc.start(at)
  osc.stop(at + decay + 0.01)
}

/** Short dry mechanical ticks in the spirit of the EFT menu, synthesized so no audio assets are needed. */
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

function playClickSample(ctx: AudioContext, at: number) {
  if (!clickSample) {
    // First press: fall back to the synthesized tick while the recording loads.
    burst(ctx, at, 2300, 1.8, 0.24, 0.022)
    burst(ctx, at, 850, 0.9, 0.34, 0.048)
    void loadClickSample(ctx)
    return
  }
  const source = ctx.createBufferSource()
  source.buffer = clickSample.buffer
  const gain = ctx.createGain()
  gain.gain.value = 1.4
  source.connect(gain).connect(master!)
  source.start(at, clickSample.offset)
}

/** Loads the click recording ahead of the first press. */
export function preloadUiSounds() {
  const ctx = audio()
  if (ctx) void loadClickSample(ctx)
}
