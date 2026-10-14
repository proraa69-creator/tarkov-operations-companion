import { HandGestureEngine } from './gestureEngine'
import { calibrationFromCorners } from './handGeometry'
import { HandUiDispatcher } from './uiDispatcher'
import { DEFAULT_SETTINGS, LM, type HandControlSettings, type HandFrame, type HandObservation } from './types'
import type { TrackerErrorCode, TrackerStats, WebcamHandTracker } from './webcamTracker'

const SETTINGS_KEY = 'raidos-hand-control-v1'
const CALIBRATION_SAMPLE_MS = 1500
const CALIBRATION_SETTLE_MS = 1000
const SNAPSHOT_INTERVAL_MS = 200

export type HandControlStatus = 'off' | 'starting' | 'on' | 'error'
export type CalibrationStep = 'top-left' | 'bottom-right' | null

export interface HandControlSnapshot {
  status: HandControlStatus
  error: TrackerErrorCode | null
  errorDetail: string
  settings: HandControlSettings
  frame: HandFrame | null
  stats: TrackerStats | null
  pose: { index: boolean; middle: boolean; ring: boolean; pinky: boolean }
  counters: { clicks: number; cancels: number; scrolls: number }
  lastTarget: string
  calibration: { step: CalibrationStep; progress: number }
  /** last raw landmarks in camera space, for the preview */
  raw: HandObservation | null
}

function loadSettings(): HandControlSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<HandControlSettings> | null
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}), calibration: { ...DEFAULT_SETTINGS.calibration, ...(stored?.calibration ?? {}) } }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function describe(element: Element | null) {
  if (!element) return ''
  const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || element.tagName.toLowerCase()
  return label.replace(/\s+/g, ' ').trim().slice(0, 60)
}

/** Arms the main-process guard so a hand click can never open a browser, dialog or new window. */
function armFocusGuard() {
  window.tarkovDesktop?.handControl?.markAction()
}

class HandControlRuntime {
  private snapshot: HandControlSnapshot = {
    status: 'off',
    error: null,
    errorDetail: '',
    settings: loadSettings(),
    frame: null,
    stats: null,
    pose: { index: false, middle: false, ring: false, pinky: false },
    counters: { clicks: 0, cancels: 0, scrolls: 0 },
    lastTarget: '',
    calibration: { step: null, progress: 0 },
    raw: null,
  }
  private listeners = new Set<() => void>()
  private frameListeners = new Set<(frame: HandFrame) => void>()
  private engine = new HandGestureEngine(this.snapshot.settings)
  private dispatcher = new HandUiDispatcher(armFocusGuard)
  private tracker: WebcamHandTracker | null = null
  private publishTimer = 0
  private calibrationSamples: { 'top-left': Array<{ x: number; y: number }>; 'bottom-right': Array<{ x: number; y: number }> } = { 'top-left': [], 'bottom-right': [] }
  private calibrationStartedAt = 0

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.snapshot

  onFrame(listener: (frame: HandFrame) => void) {
    this.frameListeners.add(listener)
    return () => { this.frameListeners.delete(listener) }
  }

  get video() { return this.tracker?.video ?? null }

  async start() {
    if (this.snapshot.status === 'on' || this.snapshot.status === 'starting') return
    this.set({ status: 'starting', error: null, errorDetail: '' })
    try {
      // Loaded on demand: the main edition never downloads the tracker.
      const { WebcamHandTracker, setComputePreference } = await import('./webcamTracker')
      setComputePreference(this.snapshot.settings.compute)
      this.tracker ??= new WebcamHandTracker(
        (observation, stats) => this.onSample(observation, stats),
        (error) => { this.dispatcher.release(); this.engine.reset(); this.set({ status: 'error', error: error.code, errorDetail: error.message, frame: null }) },
      )
      await this.tracker.start(this.snapshot.settings.cameraId)
      this.engine.reset()
      this.set({ status: 'on' })
    } catch (error) {
      const code = (error as { code?: TrackerErrorCode }).code ?? 'model'
      this.tracker?.stop()
      this.set({ status: 'error', error: code, errorDetail: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Immediate stop: camera off, all highlights and pending presses dropped. */
  stop() {
    this.tracker?.stop()
    this.dispatcher.release()
    this.engine.reset()
    const empty: HandFrame = { seq: 0, t: performance.now(), tracking: 'none', confidence: 0, phase: 'idle', pointer: null, pressProgress: 0, depth: 0, indexFlex: 0, skeleton: null, events: [] }
    this.frameListeners.forEach((listener) => listener(empty))
    this.set({ status: 'off', frame: null, raw: null, calibration: { step: null, progress: 0 } })
  }

  updateSettings(patch: Partial<HandControlSettings>) {
    const settings = { ...this.snapshot.settings, ...patch }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* storage unavailable */ }
    this.engine.configure(settings)
    const restart = (patch.cameraId !== undefined && patch.cameraId !== this.snapshot.settings.cameraId)
      || (patch.compute !== undefined && patch.compute !== this.snapshot.settings.compute)
    this.set({ settings })
    if (restart && this.snapshot.status === 'on') {
      this.tracker?.stop()
      this.set({ status: 'off' })
      void this.start()
    }
  }

  startCalibration() {
    this.dispatcher.release()
    this.calibrationSamples = { 'top-left': [], 'bottom-right': [] }
    this.calibrationStartedAt = 0
    this.set({ calibration: { step: 'top-left', progress: 0 } })
  }

  cancelCalibration() {
    this.set({ calibration: { step: null, progress: 0 } })
  }

  private onSample(observation: HandObservation | null, stats: TrackerStats) {
    if (this.snapshot.calibration.step) {
      this.calibrate(observation)
      this.snapshot = { ...this.snapshot, stats, raw: observation }
      this.schedulePublish()
      return
    }
    const frame = this.engine.process(observation)
    this.apply(frame)
    this.frameListeners.forEach((listener) => listener(frame))
    this.snapshot = { ...this.snapshot, frame, stats, raw: observation, pose: { ...this.engine.currentPose } }
    this.schedulePublish()
  }

  private apply(frame: HandFrame) {
    const toClient = (x: number, y: number) => [x * window.innerWidth, y * window.innerHeight] as const
    const counters = { ...this.snapshot.counters }
    let lastTarget = this.snapshot.lastTarget
    for (const event of frame.events) {
      if (event.type === 'press') this.dispatcher.press(...toClient(event.x, event.y))
      else if (event.type === 'click') {
        const target = this.dispatcher.click(...toClient(event.x, event.y))
        if (target) { counters.clicks++; lastTarget = describe(target) }
      } else if (event.type === 'cancel') { this.dispatcher.cancel(); counters.cancels++ }
      else if (event.type === 'scroll-start') { this.dispatcher.scrollStart(...toClient(event.x, event.y)); counters.scrolls++ }
      else if (event.type === 'scroll') this.dispatcher.scroll(event.dy, event.step)
      else if (event.type === 'scroll-end') this.dispatcher.scrollEnd()
    }
    if (frame.tracking === 'none' || !frame.pointer) this.dispatcher.release()
    else if (frame.phase === 'point' || frame.phase === 'press') this.dispatcher.hover(...toClient(frame.pointer.x, frame.pointer.y))
    this.snapshot = { ...this.snapshot, counters, lastTarget }
  }

  private calibrate(observation: HandObservation | null) {
    const step = this.snapshot.calibration.step!
    if (!observation || observation.score < 0.7) {
      this.calibrationStartedAt = 0
      this.calibrationSamples[step] = []
      this.snapshot = { ...this.snapshot, calibration: { step, progress: 0 } }
      return
    }
    const tip = observation.image[LM.INDEX_TIP]
    const point = { x: this.snapshot.settings.mirror ? 1 - tip.x : tip.x, y: tip.y }
    // Give the user a moment to move the hand into the corner before sampling.
    if (!this.calibrationStartedAt) this.calibrationStartedAt = observation.t + CALIBRATION_SETTLE_MS
    if (observation.t < this.calibrationStartedAt) return
    this.calibrationSamples[step].push(point)
    const progress = Math.min(1, (observation.t - this.calibrationStartedAt) / CALIBRATION_SAMPLE_MS)
    if (progress < 1) {
      this.snapshot = { ...this.snapshot, calibration: { step, progress } }
      return
    }
    if (step === 'top-left') {
      this.calibrationStartedAt = 0
      this.snapshot = { ...this.snapshot, calibration: { step: 'bottom-right', progress: 0 } }
      return
    }
    const box = calibrationFromCorners(this.calibrationSamples['top-left'], this.calibrationSamples['bottom-right'])
    this.snapshot = { ...this.snapshot, calibration: { step: null, progress: 0 } }
    if (box) this.updateSettings({ calibration: box })
    else this.startCalibration()
  }

  private set(patch: Partial<HandControlSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  /** Panels re-render at a few Hz; the cursor layer listens to every frame instead. */
  private schedulePublish() {
    if (this.publishTimer) return
    this.publishTimer = window.setTimeout(() => {
      this.publishTimer = 0
      this.listeners.forEach((listener) => listener())
    }, SNAPSHOT_INTERVAL_MS)
  }
}

export const handControl = new HandControlRuntime()
