import { OneEuroFilter } from '1eurofilter'
import { clamp01, fingerFlex, fingerStraightness, inverseDepth, palmCenter, pinchDistance, thumbOut, toWindowSpace, type FingerName } from './handGeometry'
import { LM, type HandEvent, type HandFrame, type HandObservation, type HandPhase, type HandControlSettings, type Point3, type TrackingQuality } from './types'

/**
 * Tuning constants, ms / degrees / log-depth / palm lengths. The tap and flick values come from
 * recordings of real gestures: a pointing index finger sits at 10–40° of flex, a tap folds it to
 * 100–130° within ~0.1–0.15 s and returns; a two-finger flick folds index and middle the same way.
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
  /** leave scrolling when neither the two-finger pose nor a flick was seen for this long */
  scrollIdleMs: 700,
  flickMinFold: 40,
  flickMinFlex: 65,
  flickResetFold: 20,
  dragFoldLimit: 15,
  /** hand travel (calibrated units) before a two-finger drag engages, and quiet time after a flick */
  dragEngage: 0.05,
  dragSettleMs: 300,
  /** the aim freezes once a press gesture is this far along, and unfreezes if no press follows */
  freezeAt: 0.35,
  rearmBelow: 0.2,
  maxFreezeMs: 300,
  aimLookbackMs: 70,
  releaseRatio: 0.55,
  maxPressMs: 1000,
  clickCooldownMs: 200,
  baselineMs: 900,
  baselineAwayMs: 350,
  pointerBeta: 6,
  historyMs: 600,
  /** pinch zoom: thumb↔index distance in palm lengths, the move must be quick and made by the thumb */
  pinchClosed: 0.3,
  pinchOpen: 0.75,
  pinchWindowMs: 450,
  pinchMaxFlex: 70,
  thumbLead: 1.2,
  zoomCooldownMs: 350,
  /** palm grab: thumb sticking out + four fingers extended; released by pulling back or closing */
  thumbOutOpen: 0.65,
  grabReleaseRatio: 0.5,
  grabOpenLostMs: 250,
  maxGrabMs: 15000,
  grabMoveEpsilon: 0.0008,
  /** palm travel before a grab starts dragging (the push itself shifts the hand image a little) */
  grabEngage: 0.03,
  /**
   * A push (poke or palm grab) counts only when it is quick and made in place: the distance to the
   * camera must rise within `pushWindowMs` while the palm travels less than `pushMaxTravel` along
   * the screen. Moving the hand across the monitor always drifts a little in depth — that is not a push.
   */
  pushWindowMs: 300,
  pushRiseRatio: 0.8,
  pushMaxTravel: 0.05,
  pushLookbackMs: 200,
  /**
   * No fixation while the hand moves: the aim may be held (and a tap, pinch or push may start) only
   * if the palm stood still just before the gesture; it is released as soon as the palm moves again.
   */
  stillWindowMs: 250,
  stillGapMs: 50,
  stillMaxTravel: 0.04,
  frozenMaxTravel: 0.05,
  /**
   * Fist = reset: closing the hand (fingers folding together, not just the index) cancels a press,
   * releases a grab and ends scrolling; nothing new starts until the fingers open again. Inside
   * scrolling the fist must be held longer, because a two-finger flick briefly looks like one.
   */
  fistHoldMs: 200,
  fistHoldScrollMs: 700,
  fistFormedMs: 600,
} as const

type Pose = Record<FingerName, boolean>
type Sample = { t: number; x: number; y: number; flexIndex: number; flexTwo: number; pinch: number; thumb: Point3; tip: Point3; depth: number; palmX: number; palmY: number }

const vectorFilter = (minCutoff: number, beta: number) => ({
  x: new OneEuroFilter(30, minCutoff, beta),
  y: new OneEuroFilter(30, minCutoff, beta),
  z: new OneEuroFilter(30, minCutoff, beta),
})

const distance3 = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/**
 * Turns raw hand observations into pointer, press, scroll, zoom and grab state:
 * - the centre of the palm drives the pointer (1€-filtered, calibrated, optionally mirrored), so
 *   moving the fingers never moves the cursor — the hand stays, only the fingers act;
 * - tap: a quick fold of the index finger presses, unfolding clicks (aim is frozen meanwhile);
 *   optionally a quick push of the whole hand towards the camera ("poke") does the same;
 * - index + middle raised (ring and pinky folded) enters scrolling: a quick fold of both
 *   fingers scrolls one step, moving the raised hand up/down scrolls continuously;
 * - pinch zoom: quickly moving the thumb away from the index tip zooms in, pinching zooms out;
 * - open palm pushed towards the camera holds the "mouse button"; moving the hand drags,
 *   pulling back or closing the hand releases.
 * No events are produced without a confidently tracked hand; losing the hand cancels everything.
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
  private middleExtendedAt = Number.NEGATIVE_INFINITY
  private fistSince = Number.NaN
  private fistLock = false
  private palmFilter = vectorFilter(1.2, ENGINE.pointerBeta)
  private skeletonFilters: Array<ReturnType<typeof vectorFilter>> = []
  private depthFilter = new OneEuroFilter(30, 3, 8)
  private baseline = Number.NaN
  private history: Sample[] = []
  private aim: { x: number; y: number } | null = null
  private frozenAt = Number.NaN
  private rearmBlocked = false
  private press: { id: number; at: number; x: number; y: number; kind: 'tap' | 'poke'; base: number } | null = null
  private cooldownUntil = 0
  private zoomCooldownUntil = 0
  private scrollPoseSince = Number.NaN
  private exitPoseSince = Number.NaN
  private scroll: { id: number; x: number; y: number; lastHandY: number; flicking: boolean; anchorY: number; dragging: boolean; quietUntil: number; activeAt: number } | null = null
  private grab: { id: number; at: number; x0: number; y0: number; palmX0: number; palmY0: number; x: number; y: number; openLostSince: number; engaged: boolean } | null = null
  private last: HandFrame = emptyFrame(0, 0)

  constructor(settings: HandControlSettings) {
    this.settings = settings
    this.configure(settings)
  }

  configure(settings: HandControlSettings) {
    this.settings = settings
    for (const axis of ['x', 'y', 'z'] as const) this.palmFilter[axis].setMinCutoff(settings.smoothing)
  }

  reset() {
    const settings = this.settings
    Object.assign(this, new HandGestureEngine(settings))
  }

  get currentPose(): Readonly<Pose> { return this.pose }

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
    const { world } = observation
    this.updatePose(world)
    if (this.pose.index) this.indexExtendedAt = t
    if (this.pose.middle || this.pose.ring || this.pose.pinky) this.middleExtendedAt = t
    const fist = !this.pose.index && !this.pose.middle && !this.pose.ring && !this.pose.pinky
    if (!fist) {
      this.fistSince = Number.NaN
      this.fistLock = false
    } else if (Number.isNaN(this.fistSince)) this.fistSince = t

    // Live pointer: the calibrated palm centre. Fingers folding, flicking or pinching barely move
    // it (measured: ~3× less than the fingertip during a tap). `palm` is the same point unclamped,
    // used for drags, grabs and the "is the hand still" checks.
    const center = toWindowSpace(palmCenter(observation.image), settings.calibration, settings.mirror)
    const palm = { x: this.palmFilter.x.filter(center.x, seconds), y: this.palmFilter.y.filter(center.y, seconds) }
    const pointer = { x: clamp01(palm.x), y: clamp01(palm.y) }

    const flexIndex = fingerFlex(world, 'index')
    const flexTwo = (flexIndex + fingerFlex(world, 'middle')) / 2
    const pinch = pinchDistance(world)
    const depth = this.updateDepth(observation, seconds, dt)
    this.history.push({ t, x: pointer.x, y: pointer.y, flexIndex, flexTwo, pinch, thumb: world[LM.THUMB_TIP], tip: world[LM.INDEX_TIP], depth, palmX: palm.x, palmY: palm.y })
    while (this.history.length && t - this.history[0].t > ENGINE.historyMs) this.history.shift()

    const scrollPose = this.pose.index && this.pose.middle && !this.pose.ring && !this.pose.pinky
    const openPalm = this.pose.index && this.pose.middle && this.pose.ring && this.pose.pinky && thumbOut(world) >= ENGINE.thumbOutOpen
    const useTap = settings.clickMode !== 'poke'
    const usePoke = settings.clickMode !== 'tap'
    const tapBase = this.minSince(t - ENGINE.foldWindowMs, 'flexIndex')
    const indexRecent = t - this.indexExtendedAt <= ENGINE.indexRecentMs
    // A tap folds the index alone: if the other fingers were open a moment ago, this is a fist forming.
    const othersFolded = t - this.middleExtendedAt > ENGINE.foldWindowMs
    const tapProgress = useTap && indexRecent && othersFolded && !openPalm && !this.fistLock ? clamp01((flexIndex - tapBase) / settings.tapAngle) : 0
    const pokeProgress = usePoke && this.pose.index && !scrollPose && !openPalm ? clamp01(depth / settings.pressThreshold) : 0
    const grabProgress = settings.palmGrab && openPalm ? clamp01(depth / settings.grabThreshold) : 0
    const progress = Math.max(tapProgress, pokeProgress, grabProgress)

    if (this.phase === 'idle') this.phase = 'point'
    if (fist && !this.fistLock && this.fistFormedFromOpenHand()) {
      const hold = this.phase === 'scroll' ? ENGINE.fistHoldScrollMs : ENGINE.fistHoldMs
      if (t - this.fistSince >= hold) this.resetByFist(events, t)
    }
    if (this.phase === 'point') this.updateAim(t, pointer, tapProgress)

    if (this.phase === 'scroll' && this.scroll) {
      this.updateScroll(events, t, scrollPose, openPalm, flexTwo, palm.y)
    } else if (this.phase === 'press' && this.press) {
      this.updatePress(events, t, flexIndex, depth)
    } else if (this.phase === 'grab' && this.grab) {
      this.updateGrab(events, t, openPalm, depth, palm)
    } else {
      const at = this.aim ?? pointer
      if (scrollPose) {
        if (Number.isNaN(this.scrollPoseSince)) this.scrollPoseSince = t
      } else this.scrollPoseSince = Number.NaN

      const ready = tracking === 'good' && t >= this.cooldownUntil && !this.fistLock
      if (ready && settings.palmGrab && openPalm && this.isPush(t, depth, settings.grabThreshold)) {
        const id = this.nextId++
        const start = this.pushStart(t, pointer)
        // Drag relative to where the palm is now (the push itself shifts the image of the hand).
        this.grab = { id, at: t, x0: start.x, y0: start.y, palmX0: palm.x, palmY0: palm.y, x: start.x, y: start.y, openLostSince: Number.NaN, engaged: false }
        this.phase = 'grab'
        events.push({ type: 'grab-start', id, x: start.x, y: start.y })
      } else if (!this.fistLock && scrollPose && t - this.scrollPoseSince >= ENGINE.scrollPoseMs) {
        const id = this.nextId++
        this.scroll = { id, x: at.x, y: at.y, lastHandY: palm.y, flicking: false, anchorY: palm.y, dragging: false, quietUntil: 0, activeAt: t }
        this.exitPoseSince = Number.NaN
        this.phase = 'scroll'
        events.push({ type: 'scroll-start', id, x: at.x, y: at.y })
      } else if (ready && useTap && indexRecent && !openPalm && this.aim && flexIndex >= ENGINE.tapMinFlex && flexIndex - tapBase >= settings.tapAngle) {
        this.startPress(events, t, at, 'tap', tapBase)
      } else if (ready && usePoke && this.pose.index && !scrollPose && !openPalm && this.isPush(t, depth, settings.pressThreshold)) {
        this.startPress(events, t, this.pushStart(t, pointer), 'poke', 0)
      } else if (settings.pinchZoom && tracking === 'good' && !this.fistLock && t >= this.zoomCooldownUntil) {
        const steps = this.detectPinch(t, pinch)
        if (steps) {
          this.zoomCooldownUntil = t + ENGINE.zoomCooldownMs
          events.push({ type: 'zoom', id: this.nextId++, x: at.x, y: at.y, steps })
        }
      }
    }

    const output = this.press ? { x: this.press.x, y: this.press.y }
      : this.grab ? { x: this.grab.x, y: this.grab.y }
        : this.scroll ? { x: this.scroll.x, y: this.scroll.y }
          : (this.aim ?? pointer)

    const frame: HandFrame = {
      seq: ++this.seq,
      t,
      tracking,
      confidence: observation.score,
      phase: this.phase,
      pointer: output,
      hand: pointer,
      pressProgress: this.phase === 'press' || this.phase === 'grab' ? 1 : this.phase === 'scroll' ? 0 : progress,
      depth,
      indexFlex: flexIndex,
      pinch,
      skeleton: this.skeleton(observation, seconds),
      events,
    }
    this.last = frame
    return frame
  }

  /**
   * The aim follows the live pointer. It freezes (at the position from just before the gesture)
   * only when a press gesture is clearly under way, and lets go again if no press follows —
   * ordinary finger wobble must never leave the cursor stuck.
   */
  private updateAim(t: number, pointer: { x: number; y: number }, progress: number) {
    if (!Number.isNaN(this.frozenAt)) {
      const moved = this.palmTravel(this.frozenAt - ENGINE.stillGapMs, t) > ENGINE.frozenMaxTravel
      if (!moved && t - this.frozenAt <= ENGINE.maxFreezeMs) return
      this.frozenAt = Number.NaN
      this.rearmBlocked = true
    }
    if (this.rearmBlocked && progress < ENGINE.rearmBelow) this.rearmBlocked = false
    if (!this.rearmBlocked && progress >= ENGINE.freezeAt && this.stillBefore(t)) {
      this.aim = this.pointerAt(t - ENGINE.aimLookbackMs) ?? pointer
      this.frozenAt = t
      return
    }
    this.aim = null
  }

  /** Palm travel (calibrated units, bounding-box diagonal) between two times. */
  private palmTravel(from: number, to: number) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const sample of this.history) {
      if (sample.t < from || sample.t > to) continue
      minX = Math.min(minX, sample.palmX); maxX = Math.max(maxX, sample.palmX)
      minY = Math.min(minY, sample.palmY); maxY = Math.max(maxY, sample.palmY)
    }
    return Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0
  }

  /** The palm stood still during the moment just before `t`. */
  private stillBefore(t: number) {
    return this.palmTravel(t - ENGINE.stillWindowMs, t - ENGINE.stillGapMs) <= ENGINE.stillMaxTravel
  }

  private startPress(events: HandEvent[], t: number, at: { x: number; y: number }, kind: 'tap' | 'poke', base: number) {
    const id = this.nextId++
    this.press = { id, at: t, x: at.x, y: at.y, kind, base }
    this.phase = 'press'
    events.push({ type: 'press', id, x: at.x, y: at.y })
  }

  private toPoint(t: number) {
    this.phase = 'point'
    this.aim = null
    this.frozenAt = Number.NaN
    this.rearmBlocked = true
    this.cooldownUntil = Math.max(this.cooldownUntil, t)
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
      this.toPoint(t)
      if (press.kind === 'poke') this.baseline = Number.NaN
    } else if (released) {
      events.push({ type: 'click', id: press.id, x: press.x, y: press.y })
      this.press = null
      this.toPoint(t)
      this.cooldownUntil = t + ENGINE.clickCooldownMs
    }
  }

  private updateGrab(events: HandEvent[], t: number, openPalm: boolean, depth: number, palm: { x: number; y: number }) {
    const grab = this.grab!
    if (!grab.engaged) {
      // Re-anchor when the drag really begins, so the engage distance does not jump the map.
      if (Math.hypot(palm.x - grab.palmX0, palm.y - grab.palmY0) >= ENGINE.grabEngage) {
        grab.engaged = true
        grab.palmX0 = palm.x
        grab.palmY0 = palm.y
      }
    }
    const x = grab.engaged ? clamp01(grab.x0 + palm.x - grab.palmX0) : grab.x
    const y = grab.engaged ? clamp01(grab.y0 + palm.y - grab.palmY0) : grab.y
    if (Math.hypot(x - grab.x, y - grab.y) > ENGINE.grabMoveEpsilon) {
      grab.x = x
      grab.y = y
      events.push({ type: 'grab-move', id: grab.id, x, y })
    }
    if (openPalm) grab.openLostSince = Number.NaN
    else if (Number.isNaN(grab.openLostSince)) grab.openLostSince = t
    const closed = !openPalm && t - grab.openLostSince >= ENGINE.grabOpenLostMs
    if (depth <= this.settings.grabThreshold * ENGINE.grabReleaseRatio || closed || t - grab.at > ENGINE.maxGrabMs) {
      events.push({ type: 'grab-end', id: grab.id })
      this.grab = null
      this.toPoint(t)
      this.cooldownUntil = t + ENGINE.clickCooldownMs
      this.baseline = Number.NaN
    }
  }

  private updateScroll(events: HandEvent[], t: number, scrollPose: boolean, openPalm: boolean, flexTwo: number, handY: number) {
    const scroll = this.scroll!
    const { settings } = this
    const base = this.minSince(t - ENGINE.foldWindowMs, 'flexTwo')
    const fold = flexTwo - base
    if (scrollPose) scroll.activeAt = t
    if (!scroll.flicking && fold >= Math.max(ENGINE.flickMinFold, settings.tapAngle * 0.9) && flexTwo >= ENGINE.flickMinFlex) {
      scroll.flicking = true
      scroll.activeAt = t
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

    // Leave scrolling on another clear pose (pointing, open palm) or when the two-finger pose
    // has been gone for a while. Folded fingers mid-flick keep the mode.
    const pointing = this.pose.index && !this.pose.middle
    if (pointing || openPalm || this.pose.ring || this.pose.pinky) {
      if (Number.isNaN(this.exitPoseSince)) this.exitPoseSince = t
    } else this.exitPoseSince = Number.NaN
    const idle = !scroll.flicking && t - scroll.activeAt >= ENGINE.scrollIdleMs
    if (idle || (!Number.isNaN(this.exitPoseSince) && t - this.exitPoseSince >= ENGINE.scrollExitMs)) this.endScroll(events, t)
  }

  /** The fist was made by closing an open hand (other fingers were extended just before). */
  private fistFormedFromOpenHand() {
    return this.middleExtendedAt >= this.fistSince - ENGINE.fistFormedMs
  }

  /** Fist: drop whatever is in progress and block new actions until the hand opens. */
  private resetByFist(events: HandEvent[], t: number) {
    if (this.press) events.push({ type: 'cancel', id: this.press.id })
    if (this.scroll) events.push({ type: 'scroll-end', id: this.scroll.id })
    if (this.grab) events.push({ type: 'grab-end', id: this.grab.id })
    this.press = null
    this.scroll = null
    this.grab = null
    this.scrollPoseSince = Number.NaN
    this.exitPoseSince = Number.NaN
    this.toPoint(t)
    this.fistLock = true
    this.baseline = Number.NaN
  }

  /** A quick push towards the camera made in place (see ENGINE.pushWindowMs). */
  private isPush(t: number, depth: number, threshold: number) {
    if (depth < threshold) return false
    const window = this.history.filter((sample) => sample.t >= t - ENGINE.pushWindowMs)
    if (window.length < 3) return false
    const rise = depth - Math.min(...window.map((sample) => sample.depth))
    const xs = window.map((sample) => sample.palmX)
    const ys = window.map((sample) => sample.palmY)
    const travel = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    return rise >= threshold * ENGINE.pushRiseRatio && travel <= ENGINE.pushMaxTravel && this.stillBefore(t - ENGINE.pushWindowMs + ENGINE.stillWindowMs)
  }

  /** Where the hand was just before the push began: the target the user aimed at. */
  private pushStart(t: number, pointer: { x: number; y: number }) {
    let found: Sample | null = null
    for (const sample of this.history) {
      if (sample.t > t - ENGINE.pushLookbackMs) break
      found = sample
    }
    const latest = this.history[this.history.length - 1]
    const sample = found ?? latest
    return { x: sample?.x ?? pointer.x, y: sample?.y ?? pointer.y }
  }

  /** +1 when the thumb quickly moves away from the index tip, -1 when it quickly pinches it. */
  private detectPinch(t: number, pinch: number) {
    const window = this.history.filter((sample) => sample.t >= t - ENGINE.pinchWindowMs)
    if (window.length < 3) return 0
    if (Math.max(...window.map((sample) => sample.flexIndex)) >= ENGINE.pinchMaxFlex) return 0
    if (this.palmTravel(t - ENGINE.pinchWindowMs, t) > ENGINE.pushMaxTravel) return 0
    const first = window[0]
    const last = window[window.length - 1]
    // The thumb must do the moving — a folding index finger (tap) also closes the gap.
    if (distance3(first.thumb, last.thumb) < distance3(first.tip, last.tip) * ENGINE.thumbLead) return 0
    const pinches = window.map((sample) => sample.pinch)
    if (pinch >= ENGINE.pinchOpen && Math.min(...pinches) <= ENGINE.pinchClosed) return 1
    if (pinch <= ENGINE.pinchClosed && Math.max(...pinches) >= ENGINE.pinchOpen) return -1
    return 0
  }

  private updateDepth(observation: HandObservation, seconds: number, dt: number) {
    const q = inverseDepth(observation)
    if (!Number.isFinite(q)) return this.last.depth
    const value = this.depthFilter.filter(Math.log(q), seconds)
    if (!Number.isFinite(this.baseline)) this.baseline = value
    // The baseline drifts towards the current distance (slow leans are absorbed) but is fixed
    // during a poke or a grab so the pull-back can be measured.
    if (this.press?.kind !== 'poke' && !this.grab) {
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
    if (this.grab) events.push({ type: 'grab-end', id: this.grab.id })
    this.press = null
    this.scroll = null
    this.grab = null
    this.phase = 'idle'
    this.aim = null
    this.frozenAt = Number.NaN
    this.rearmBlocked = false
    this.baseline = Number.NaN
    this.scrollPoseSince = Number.NaN
    this.history = []
    for (const axis of ['x', 'y', 'z'] as const) this.palmFilter[axis].reset()
    this.depthFilter.reset()
    this.skeletonFilters = []
    this.lastT = 0
    const frame = emptyFrame(++this.seq, now)
    frame.events = events
    this.last = frame
    return frame
  }

  private endScroll(events: HandEvent[], t: number) {
    if (this.scroll) events.push({ type: 'scroll-end', id: this.scroll.id })
    this.scroll = null
    this.scrollPoseSince = Number.NaN
    this.exitPoseSince = Number.NaN
    this.toPoint(t)
    this.rearmBlocked = false
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
      // z comes in image-width units: scale it like x so the 3D hand keeps its proportions.
      const zScale = 1 / Math.max(0.05, this.settings.calibration.x1 - this.settings.calibration.x0)
      return { x: filter.x.filter(mapped.x, seconds), y: filter.y.filter(mapped.y, seconds), z: filter.z.filter(point.z * zScale, seconds) }
    })
  }
}

function emptyFrame(seq: number, t: number): HandFrame {
  return { seq, t, tracking: 'none', confidence: 0, phase: 'idle', pointer: null, hand: null, pressProgress: 0, depth: 0, indexFlex: 0, pinch: 0, skeleton: null, events: [] }
}
