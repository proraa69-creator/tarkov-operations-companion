import { OneEuroFilter } from '1eurofilter'
import { clamp01, fingerFlex, fingerStraightness, inverseDepth, toWindowSpace, type FingerName } from './handGeometry'
import { LM, type HandEvent, type HandFrame, type HandObservation, type HandPhase, type HandControlSettings, type Point3, type TrackingQuality } from './types'

/**
 * Tuning constants, ms / degrees / log-depth. The tap and flick values come from recordings of
 * real gestures: a pointing index finger sits at 10–40° of flex, a tap folds it to 100–130°
 * within ~0.1–0.15 s and returns; a two-finger flick folds index and middle together the same way.
 */
export const ENGINE = {
  lostGraceMs: 120,
  goodScore: 0.8,
  minScore: 0.5,
  fingerOn: 0.55,
  fingerOff: 0.35,
  /** a fold must happen within this window (fast); slow curling is ignored */
  foldWindowMs: 350,
  tapMinFlex: 65,
  /** release when the finger is back below base + this share of the tap angle */
  tapReleaseRatio: 0.45,
  indexRecentMs: 400,
  scrollPoseMs: 120,
  scrollExitMs: 200,
  flickMinFold: 40,
  flickMinFlex: 65,
  flickResetFold: 20,
  dragFoldLimit: 15,
  /** hand travel (calibrated units) before a two-finger drag engages, and quiet time after a flick */
  dragEngage: 0.05,
  dragSettleMs: 300,
  freezeAt: 0.25,
  aimLookbackMs: 70,
  releaseRatio: 0.55,
  maxPressMs: 1200,
  clickCooldownMs: 200,
  baselineMs: 900,
  baselineAwayMs: 350,
  pointerBeta: 6,
  historyMs: 600,
} as const

type Pose = Record<FingerName, boolean>
type Sample = { t: number; x: number; y: number; flexIndex: number; flexTwo: number }

const vectorFilter = (minCutoff: number, beta: number) => ({
  x: new OneEuroFilter(30, minCutoff, beta),
  y: new OneEuroFilter(30, minCutoff, beta),
  z: new OneEuroFilter(30, minCutoff, beta),
})

/**
 * Turns raw hand observations into pointer, press and scroll state:
 * - the index fingertip drives the pointer (1€-filtered, calibrated, optionally mirrored);
 * - tap: a quick fold of the index finger presses, unfolding clicks (aim is frozen meanwhile);
 *   optionally a quick push of the whole hand towards the camera ("poke") does the same;
 * - index + middle raised (ring and pinky folded) enters scrolling: folding both fingers in a
 *   quick flick scrolls one step, moving the raised hand up/down scrolls continuously.
 * No events are produced without a confidently tracked hand; losing the hand cancels a press.
 */
export class HandGestureEngine {
  private settings: HandControlSettings
  private seq = 0
  private nextId = 1
  private phase: HandPhase = 'idle'
  private lastSeenAt = Number.NEGATIVE_INFINITY
  private lastT = 0
  private pose: Pose = { index: false, middle: false, ring: false, pinky: false }
  private indexExtendedAt = Number.NEGATIVE_INFINITY
  private pointerFilter = vectorFilter(1.2, ENGINE.pointerBeta)
  private handFilter = new OneEuroFilter(30, 1.5, ENGINE.pointerBeta)
  private skeletonFilters: Array<ReturnType<typeof vectorFilter>> = []
  private depthFilter = new OneEuroFilter(30, 3, 8)
  private baseline = Number.NaN
  private history: Sample[] = []
  private aim: { x: number; y: number } | null = null
  private press: { id: number; at: number; x: number; y: number; kind: 'tap' | 'poke'; base: number } | null = null
  private cooldownUntil = 0
  private scrollPoseSince = Number.NaN
  private exitPoseSince = Number.NaN
  private scroll: { id: number; x: number; y: number; lastHandY: number; flicking: boolean; anchorY: number; dragging: boolean; quietUntil: number } | null = null
  private last: HandFrame = emptyFrame(0, 0)

  constructor(settings: HandControlSettings) {
    this.settings = settings
    this.configure(settings)
  }

  configure(settings: HandControlSettings) {
    this.settings = settings
    for (const axis of ['x', 'y', 'z'] as const) this.pointerFilter[axis].setMinCutoff(settings.smoothing)
  }

  reset() {
    const settings = this.settings
    Object.assign(this, new HandGestureEngine(settings))
  }

  process(observation: HandObservation | null, now = observation?.t ?? performance.now()): HandFrame {
    const events: HandEvent[] = []
    const usable = observation && observation.score >= ENGINE.minScore && observation.image.length === 21 && observation.world.length === 21
    if (!usable) return this.lost(now, events)

    const { settings } = this
    const t = observation.t
    const seconds = t / 1000
    const dt = Math.max(0, t - (this.lastT || t))
    this.lastT = t
    this.lastSeenAt = t
    const tracking: TrackingQuality = observation.score >= ENGINE.goodScore ? 'good' : 'weak'
    this.updatePose(observation.world)
    if (this.pose.index) this.indexExtendedAt = t

    // Pointer: calibrated index fingertip. The knuckle line drives two-finger dragging because
    // it barely moves while the fingers flick.
    const raw = toWindowSpace(observation.image[LM.INDEX_TIP], settings.calibration, settings.mirror)
    const pointer = {
      x: clamp01(this.pointerFilter.x.filter(raw.x, seconds)),
      y: clamp01(this.pointerFilter.y.filter(raw.y, seconds)),
    }
    const knuckles = toWindowSpace(observation.image[LM.MIDDLE_MCP], settings.calibration, settings.mirror)
    const handY = this.handFilter.filter(knuckles.y, seconds)

    const flexIndex = fingerFlex(observation.world, 'index')
    const flexTwo = (flexIndex + fingerFlex(observation.world, 'middle')) / 2
    this.history.push({ t, x: pointer.x, y: pointer.y, flexIndex, flexTwo })
    while (this.history.length && t - this.history[0].t > ENGINE.historyMs) this.history.shift()

    const depth = this.updateDepth(observation, seconds, dt)

    const scrollPose = this.pose.index && this.pose.middle && !this.pose.ring && !this.pose.pinky
    const useTap = settings.clickMode !== 'poke'
    const usePoke = settings.clickMode !== 'tap'
    const tapBase = this.minSince(t - ENGINE.foldWindowMs, 'flexIndex')
    const indexRecent = t - this.indexExtendedAt <= ENGINE.indexRecentMs
    const tapProgress = useTap && indexRecent ? clamp01((flexIndex - tapBase) / settings.tapAngle) : 0
    const pokeProgress = usePoke && this.pose.index && !scrollPose ? clamp01(depth / settings.pressThreshold) : 0
    const progress = Math.max(tapProgress, pokeProgress)

    // Freeze the aim point as soon as a press gesture starts: folding the finger moves the
    // fingertip a lot, the cursor must stay on the target.
    if (!this.press && this.phase !== 'scroll' && progress < ENGINE.freezeAt) this.aim = this.pointerAt(t - ENGINE.aimLookbackMs) ?? pointer
    let output = this.press ? { x: this.press.x, y: this.press.y } : (this.aim ?? pointer)

    if (this.phase === 'idle') this.phase = 'point'

    if (this.phase === 'scroll' && this.scroll) {
      output = { x: this.scroll.x, y: this.scroll.y }
      this.updateScroll(events, t, scrollPose, flexTwo, handY)
    } else if (this.phase === 'press' && this.press) {
      this.updatePress(events, t, flexIndex, depth)
    } else {
      if (scrollPose) {
        if (Number.isNaN(this.scrollPoseSince)) this.scrollPoseSince = t
      } else this.scrollPoseSince = Number.NaN

      const ready = tracking === 'good' && t >= this.cooldownUntil
      if (scrollPose && t - this.scrollPoseSince >= ENGINE.scrollPoseMs) {
        const id = this.nextId++
        this.scroll = { id, x: output.x, y: output.y, lastHandY: handY, flicking: false, anchorY: handY, dragging: false, quietUntil: 0 }
        this.exitPoseSince = Number.NaN
        this.phase = 'scroll'
        events.push({ type: 'scroll-start', id, x: output.x, y: output.y })
      } else if (ready && useTap && indexRecent && flexIndex >= ENGINE.tapMinFlex && flexIndex - tapBase >= settings.tapAngle) {
        this.startPress(events, t, output, 'tap', tapBase)
      } else if (ready && usePoke && this.pose.index && !scrollPose && depth >= settings.pressThreshold) {
        this.startPress(events, t, output, 'poke', 0)
      }
    }

    const frame: HandFrame = {
      seq: ++this.seq,
      t,
      tracking,
      confidence: observation.score,
      phase: this.phase,
      pointer: output,
      pressProgress: this.phase === 'press' ? 1 : this.phase === 'scroll' ? 0 : progress,
      depth,
      indexFlex: flexIndex,
      skeleton: this.skeleton(observation, seconds),
      events,
    }
    this.last = frame
    return frame
  }

  get currentPose(): Readonly<Pose> { return this.pose }

  private startPress(events: HandEvent[], t: number, at: { x: number; y: number }, kind: 'tap' | 'poke', base: number) {
    const id = this.nextId++
    this.press = { id, at: t, x: at.x, y: at.y, kind, base }
    this.phase = 'press'
    events.push({ type: 'press', id, x: at.x, y: at.y })
  }

  private updatePress(events: HandEvent[], t: number, flexIndex: number, depth: number) {
    const press = this.press!
    const released = press.kind === 'tap'
      ? flexIndex <= press.base + this.settings.tapAngle * ENGINE.tapReleaseRatio
      : depth <= this.settings.pressThreshold * ENGINE.releaseRatio
    if (t - press.at > ENGINE.maxPressMs) {
      // Held too long: the finger was folded on purpose (resting), not a tap.
      events.push({ type: 'cancel', id: press.id })
      this.press = null
      this.phase = 'point'
      if (press.kind === 'poke') this.baseline = Number.NaN
    } else if (released) {
      events.push({ type: 'click', id: press.id, x: press.x, y: press.y })
      this.press = null
      this.phase = 'point'
      this.cooldownUntil = t + ENGINE.clickCooldownMs
    }
  }

  private updateScroll(events: HandEvent[], t: number, scrollPose: boolean, flexTwo: number, handY: number) {
    const scroll = this.scroll!
    const { settings } = this
    const base = this.minSince(t - ENGINE.foldWindowMs, 'flexTwo')
    const fold = flexTwo - base
    if (!scroll.flicking && fold >= Math.max(ENGINE.flickMinFold, settings.tapAngle * 0.9) && flexTwo >= ENGINE.flickMinFlex) {
      scroll.flicking = true
      const dy = settings.flickStep * (settings.flickDirection === 'down' ? 1 : -1)
      events.push({ type: 'scroll', id: scroll.id, dy, step: true })
    } else if (scroll.flicking && fold <= ENGINE.flickResetFold) {
      scroll.flicking = false
      scroll.quietUntil = t + ENGINE.dragSettleMs
    }

    // Continuous drag only with both fingers raised, after the hand has clearly travelled
    // (a flick and its return also move the knuckles a little — that must not scroll).
    const delta = handY - scroll.lastHandY
    scroll.lastHandY = handY
    const canDrag = scrollPose && !scroll.flicking && fold < ENGINE.dragFoldLimit && t >= scroll.quietUntil
    if (!canDrag) {
      scroll.dragging = false
      scroll.anchorY = handY
    } else if (!scroll.dragging && Math.abs(handY - scroll.anchorY) >= ENGINE.dragEngage) {
      scroll.dragging = true
    } else if (scroll.dragging) {
      const dy = (settings.naturalScroll ? -delta : delta) * settings.scrollSpeed
      if (Math.abs(dy) > 0.0015) events.push({ type: 'scroll', id: scroll.id, dy })
    }

    // Leave scrolling when the hand clearly shows another pose: pointing or an open palm.
    // Folded fingers (mid-flick) keep the mode.
    const pointing = this.pose.index && !this.pose.middle
    const open = this.pose.ring || this.pose.pinky
    if (pointing || open) {
      if (Number.isNaN(this.exitPoseSince)) this.exitPoseSince = t
      if (t - this.exitPoseSince >= ENGINE.scrollExitMs) this.endScroll(events)
    } else this.exitPoseSince = Number.NaN
  }

  private updateDepth(observation: HandObservation, seconds: number, dt: number) {
    const q = inverseDepth(observation)
    if (!Number.isFinite(q)) return this.last.depth
    const value = this.depthFilter.filter(Math.log(q), seconds)
    if (!Number.isFinite(this.baseline)) this.baseline = value
    // The baseline drifts towards the current distance (slow leans are absorbed) but is fixed
    // during a poke so the pull-back can be measured.
    if (this.press?.kind !== 'poke') {
      const tau = value < this.baseline ? ENGINE.baselineAwayMs : ENGINE.baselineMs
      this.baseline += (value - this.baseline) * (1 - Math.exp(-dt / tau))
    }
    return value - this.baseline
  }

  private minSince(from: number, key: 'flexIndex' | 'flexTwo') {
    let min = Infinity
    for (const sample of this.history) if (sample.t >= from && sample[key] < min) min = sample[key]
    return min
  }

  private pointerAt(t: number) {
    let found: Sample | null = null
    for (const sample of this.history) {
      if (sample.t > t) break
      found = sample
    }
    return found ? { x: found.x, y: found.y } : null
  }

  private lost(now: number, events: HandEvent[]): HandFrame {
    if (now - this.lastSeenAt < ENGINE.lostGraceMs && this.last.pointer) {
      // Brief dropout: hold the pointer, never start or finish anything.
      const frame: HandFrame = { ...this.last, seq: ++this.seq, t: now, tracking: 'weak', events }
      this.last = frame
      return frame
    }
    if (this.press) events.push({ type: 'cancel', id: this.press.id })
    if (this.scroll) events.push({ type: 'scroll-end', id: this.scroll.id })
    this.press = null
    this.scroll = null
    this.phase = 'idle'
    this.aim = null
    this.baseline = Number.NaN
    this.scrollPoseSince = Number.NaN
    this.history = []
    for (const axis of ['x', 'y', 'z'] as const) this.pointerFilter[axis].reset()
    this.handFilter.reset()
    this.depthFilter.reset()
    this.skeletonFilters = []
    this.lastT = 0
    const frame = emptyFrame(++this.seq, now)
    frame.events = events
    this.last = frame
    return frame
  }

  private endScroll(events: HandEvent[]) {
    if (this.scroll) events.push({ type: 'scroll-end', id: this.scroll.id })
    this.scroll = null
    this.phase = 'point'
    this.scrollPoseSince = Number.NaN
    this.exitPoseSince = Number.NaN
  }

  private updatePose(world: Point3[]) {
    for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
      const straight = fingerStraightness(world, finger)
      if (this.pose[finger] && straight < ENGINE.fingerOff) this.pose[finger] = false
      else if (!this.pose[finger] && straight > ENGINE.fingerOn) this.pose[finger] = true
    }
  }

  private skeleton(observation: HandObservation, seconds: number): Point3[] {
    if (this.skeletonFilters.length !== 21) this.skeletonFilters = Array.from({ length: 21 }, () => vectorFilter(this.settings.smoothing * 1.5, ENGINE.pointerBeta))
    return observation.image.map((point, index) => {
      const mapped = toWindowSpace(point, this.settings.calibration, this.settings.mirror)
      const filter = this.skeletonFilters[index]
      return { x: filter.x.filter(mapped.x, seconds), y: filter.y.filter(mapped.y, seconds), z: filter.z.filter(point.z, seconds) }
    })
  }
}

function emptyFrame(seq: number, t: number): HandFrame {
  return { seq, t, tracking: 'none', confidence: 0, phase: 'idle', pointer: null, pressProgress: 0, depth: 0, indexFlex: 0, skeleton: null, events: [] }
}
