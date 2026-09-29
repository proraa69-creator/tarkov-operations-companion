import clickUrl from './assets/click.mp3'

/** The same click as in the app, played on every press of a button, link or menu item. */
const INTERACTIVE = 'button, a[href], [role="button"], summary, select, input[type="checkbox"], input[type="radio"]'

let context: AudioContext | null = null
let sample: { buffer: AudioBuffer; offset: number } | null = null
let loading: Promise<void> | null = null

function audio() {
  if (!context && typeof window !== 'undefined' && window.AudioContext) context = new window.AudioContext()
  return context
}

function load(ctx: AudioContext) {
  loading ??= fetch(clickUrl)
    .then((response) => response.arrayBuffer())
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((buffer) => {
      const channel = buffer.getChannelData(0)
      const first = Math.max(0, channel.findIndex((value) => Math.abs(value) > 0.01))
      // Skip the silence at the start so the click lands on the press.
      sample = { buffer, offset: Math.max(0, first / buffer.sampleRate - 0.003) }
    })
    .catch(() => { loading = null })
  return loading
}

function play() {
  const ctx = audio()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  if (!sample) { void load(ctx); return }
  const source = ctx.createBufferSource()
  source.buffer = sample.buffer
  const gain = ctx.createGain()
  gain.gain.value = 0.75
  source.connect(gain).connect(ctx.destination)
  source.start(ctx.currentTime + 0.002, sample.offset)
}

export function installClickSound() {
  const ctx = audio()
  if (ctx) void load(ctx)
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const element = event.target.closest(INTERACTIVE)
    if (!element || element.matches(':disabled, [aria-disabled="true"]')) return
    play()
  }, { passive: true })
}
