import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Just enough of an AudioContext for the UI sounds; suspend / resume settle a moment later, as in the browser. */
class FakeAudioContext {
  static created: FakeAudioContext[] = []
  state: AudioContextState = 'running'
  currentTime = 0
  sampleRate = 48_000
  destination = {}
  suspend = vi.fn(() => Promise.resolve().then(() => { this.state = 'suspended' }))
  resume = vi.fn(() => Promise.resolve().then(() => { this.state = 'running' }))
  constructor() { FakeAudioContext.created.push(this) }
  createGain() {
    const param = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }
    return { gain: param, connect: <T,>(next: T) => next }
  }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) } }
  createBufferSource() { return { buffer: null, connect: <T,>(next: T) => next, start() {}, stop() {} } }
  createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: <T,>(next: T) => next } }
}

describe('UI sounds rest while nothing plays', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    FakeAudioContext.created = []
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('suspends the audio context a few seconds after the last sound and resumes it for the next one', async () => {
    const { playUiSound, UI_SOUND_REST_MS } = await import('./uiSound')
    playUiSound('hover')
    const [context] = FakeAudioContext.created
    expect(context.state).toBe('running')

    // The player keeps moving over buttons: no pause in between.
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(UI_SOUND_REST_MS - 500)
      playUiSound('hover')
    }
    expect(context.suspend).not.toHaveBeenCalled()

    // Back to the game: the context rests.
    await vi.advanceTimersByTimeAsync(UI_SOUND_REST_MS)
    expect(context.suspend).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('suspended')

    playUiSound('hover')
    await vi.advanceTimersByTimeAsync(0)
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('running')
    expect(FakeAudioContext.created).toHaveLength(1)
  })

  it('a sound right as the context is being suspended still resumes it', async () => {
    const { playUiSound, UI_SOUND_REST_MS } = await import('./uiSound')
    playUiSound('hover')
    const [context] = FakeAudioContext.created
    vi.advanceTimersByTime(UI_SOUND_REST_MS)
    // suspend() asked for, not settled yet: the context still says 'running'.
    expect(context.suspend).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('running')
    playUiSound('hover')
    await vi.advanceTimersByTimeAsync(0)
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.state).toBe('running')
  })
})
