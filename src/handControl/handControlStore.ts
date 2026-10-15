import { CalibrationSession, type CalibrationState } from './calibration'
import { HandGestureEngine } from './gestureEngine'
import { HandUiDispatcher } from './uiDispatcher'
import { DEFAULT_SETTINGS, type HandControlSettings, type HandFrame, type HandObservation } from './types'
import type { TrackerErrorCode, TrackerStats, WebcamHandTracker } from './webcamTracker'

const SETTINGS_KEY = 'raidos-hand-control-v1'
/** Bumped when default gesture thresholds change, so stored settings pick up the new values. */
const SETTINGS_VERSION = 4
const SNAPSHOT_INTERVAL_MS = 200

export type HandControlStatus = 'off' | 'starting' | 'on' | 'error'

export interface HandControlSnapshot {
  status: HandControlStatus
  error: TrackerErrorCode | null
  errorDetail: string
  settings: HandControlSettings
  frame: HandFrame | null
  stats: TrackerStats | null
  pose: { index: boolean; middle: boolean; ring: boolean; pinky: boolean }
  counters: { clicks: number; cancels: number; scrolls: number; zooms: number; grabs: number }
  lastTarget: string
  calibration: CalibrationState
  /** last raw landmarks in camera space, for the preview */
  raw: HandObservation | null
}

function loadSettings(): HandControlSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as (Partial<HandControlSettings> & { version?: number }) | null
    const settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}), calibration: { ...DEFAULT_SETTINGS.calibration, ...(stored?.calibration ?? {}) } }
    // v2: softer tap (35°) after the real test — older saved thresholds are replaced.
    if ((stored?.version ?? 1) < 2) settings.tapAngle = DEFAULT_SETTINGS.tapAngle
    // v3: the hand is placed by the palm and presses with the index phalanx; a 5-point map fitted
    // to the fingertip (v2) would be off by the finger length — calibrate again.
    if ((stored?.version ?? 1) < 3) settings.homography = null
    // v4: press by pinching thumb and index (pinch and move drags the map), camera at 60 fps.
    if ((stored?.version ?? 1) < 4) {
      settings.clickMode = DEFAULT_SETTINGS.clickMode
      settings.cameraFps = DEFAULT_SETTINGS.cameraFps
    }
    delete (settings as { version?: number }).version
    return settings
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
    counters: { clicks: 0, cancels: 0, scrolls: 0, zooms: 0, grabs: 0 },
    lastTarget: '',
    calibration: { step: null, progress: 0, hint: 'hold' },
    raw: null,
  }
  private listeners = new Set<() => void>()
  private frameListeners = new Set<(frame: HandFrame, second: HandFrame | null) => void>()
  private engine = new HandGestureEngine(this.snapshot.settings)
  /** The second hand (when enabled) is only drawn: its own engine places it, its events are dropped. */
  private secondEngine = new HandGestureEngine(this.snapshot.settings)
  private dispatcher = new HandUiDispatcher(armFocusGuard)
  private tracker: WebcamHandTracker | null = null
  private publishTimer = 0
  private calibration: CalibrationSession | null = null

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.snapshot

  onFrame(listener: (frame: HandFrame, second: HandFrame | null) => void) {
    this.frameListeners.add(listener)
    return () => { this.frameListeners.delete(listener) }
  }

  get video() { return this.tracker?.video ?? null }

  async start() {
    if (this.snapshot.status === 'on' || this.snapshot.status === 'starting') return
    this.set({ status: 'starting', error: null, errorDetail: '' })
    try {
      // Loaded on demand: the main edition never downloads the tracker.
      const { WebcamHandTracker, setComputePreference, setHandCount, setCameraFps } = await import('./webcamTracker')
      setComputePreference(this.snapshot.settings.compute)
      setCameraFps(this.snapshot.settings.cameraFps)
      setHandCount(this.snapshot.settings.secondHand ? 2 : 1)
      this.tracker ??= new WebcamHandTracker(
        (observation, stats, second) => this.onSample(observation, stats, second),
        (error) => { this.dispatcher.release(); this.engine.reset(); this.set({ status: 'error', error: error.code, errorDetail: error.message, frame: null }) },
      )
      await this.tracker.start(this.snapshot.settings.cameraId)
      this.engine.reset()
      this.secondEngine.reset()
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
    this.secondEngine.reset()
    const empty: HandFrame = { seq: 0, t: performance.now(), tracking: 'none', confidence: 0, phase: 'idle', pointer: null, hand: null, aimOffset: null, pressProgress: 0, depth: 0, indexFlex: 0, pinch: 0, skeleton: null, chirality: null, events: [] }
    this.frameListeners.forEach((listener) => listener(empty, null))
    this.calibration = null
    this.set({ status: 'off', frame: null, raw: null, calibration: { step: null, progress: 0, hint: 'hold' } })
  }

  updateSettings(patch: Partial<HandControlSettings>) {
    const settings = { ...this.snapshot.settings, ...patch }
    // The 5-point map was measured in the old mirroring: it no longer fits.
    if (patch.mirror !== undefined && patch.mirror !== this.snapshot.settings.mirror && patch.homography === undefined) settings.homography = null
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION })) } catch { /* storage unavailable */ }
    this.engine.configure(settings)
    this.secondEngine.configure(settings)
    const restart = (patch.cameraId !== undefined && patch.cameraId !== this.snapshot.settings.cameraId)
      || (patch.compute !== undefined && patch.compute !== this.snapshot.settings.compute)
      || (patch.secondHand !== undefined && patch.secondHand !== this.snapshot.settings.secondHand)
      || (patch.cameraFps !== undefined && patch.cameraFps !== this.snapshot.settings.cameraFps)
    this.set({ settings })
    if (restart && this.snapshot.status === 'on') {
      this.tracker?.stop()
      this.set({ status: 'off' })
      void this.start()
    }
  }

  startCalibration() {
    this.dispatcher.release()
    this.calibration = new CalibrationSession(this.snapshot.settings.mirror)
    this.set({ calibration: { step: 0, progress: 0, hint: 'hold' } })
  }

  cancelCalibration() {
    this.calibration = null
    this.set({ calibration: { step: null, progress: 0, hint: 'hold' } })
  }

  private onSample(observation: HandObservation | null, stats: TrackerStats, secondObservation: HandObservation | null = null) {
    this.engine.setViewport(window.innerWidth, window.innerHeight)
    const frame = this.engine.process(observation)
    let second: HandFrame | null = null
    if (this.snapshot.settings.secondHand) {
      this.secondEngine.setViewport(window.innerWidth, window.innerHeight)
      second = this.secondEngine.process(secondObservation, observation?.t ?? performance.now())
      second.events = []
    }
    if (this.calibration) {
      // The hand keeps moving on screen during calibration; its gestures do nothing meanwhile.
      frame.events = []
      this.dispatcher.release()
      const { state, result } = this.calibration.feed(observation, observation?.t ?? performance.now(), frame.aimOffset)
      this.snapshot = { ...this.snapshot, calibration: state }
      if (result) {
        this.calibration = null
        this.updateSettings({ calibration: result.box, homography: result.homography })
        this.engine.reset()
        this.secondEngine.reset()
      }
    } else this.apply(frame)
    this.frameListeners.forEach((listener) => listener(frame, second))
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
      else if (event.type === 'fling') this.dispatcher.fling(event.v)
      else if (event.type === 'scroll-end') this.dispatcher.scrollEnd()
      else if (event.type === 'zoom') { if (this.dispatcher.zoom(...toClient(event.x, event.y), event.steps)) counters.zooms++ }
      else if (event.type === 'grab-start') { if (this.dispatcher.grabStart(...toClient(event.x, event.y))) counters.grabs++ }
      else if (event.type === 'grab-move') this.dispatcher.grabMove(...toClient(event.x, event.y))
      else if (event.type === 'grab-end') this.dispatcher.grabEnd()
    }
    if (frame.tracking === 'none' || !frame.pointer) this.dispatcher.release()
    else if (frame.phase === 'point' || frame.phase === 'press') this.dispatcher.hover(...toClient(frame.pointer.x, frame.pointer.y))
    this.snapshot = { ...this.snapshot, counters, lastTarget }
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
