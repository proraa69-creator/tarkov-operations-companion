import { OneEuroFilter } from '1eurofilter'
import { GHOST_PALM_PX } from './ghostPose'
import { HandAnchor } from './handAnchor'
import { clamp01, fingerFlex, fingerStraightness, imageSpan, inverseDepth, palmCenter, pinchDistance, thumbOut, toWindowSpace, type FingerName } from './handGeometry'
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
  tapMinFlex: 55,
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
  /**
   * Fast scrolling. Flicks made in quick succession grow: each one within `flickChainMs` of the
   * previous scrolls `flickChainGrowth`× more, up to `flickChainMax`× the normal step.
   */
  flickChainMs: 650,
  flickChainGrowth: 1.5,
  flickChainMax: 3,
  /**
   * Swipe: the raised two-finger hand moved at least `flingMinTravel` (window heights) within
   * `flingWindowMs` with the fingers kept still → the content keeps scrolling with momentum
   * (hand speed × scroll speed × `flingGain`, window heights/s). The stroke back the other way
   * right after a swipe (`flingReturnMs`) is ignored, and the slow drag pauses for `flingSettleMs`.
   */
  flingWindowMs: 150,
  flingMinTravel: 0.18,
  flingFoldSteady: 20,
  flingGain: 1.5,
  flingSettleMs: 350,
  flingReturnMs: 600,
  /** how long a fling can still be running after its swipe (a fist stops it) */
  flingLifeMs: 3000,
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
  /**
   * Map zoom, from the product owner's recording. The "L" pose — index up, thumb sticking out
   * (thumb↔index angle ≥ 42°, tips ≥ 0.95 palm lengths apart; plain pointing measured 18–37° and
   * ≤ 0.96) — held for `zoomPoseMs` enters zoom mode. In it, closing the thumb onto the index
   * ("beak": tips ≤ `zoomClosed`, measured 0.28–0.45) zooms out one step, opening it again
   * (≥ `zoomOpen`) zooms in one step. No taps in zoom mode. It ends when the hand is neither in
   * the L nor the beak for `zoomExitMs` (e.g. back to pointing), or other fingers open.
   */
  zoomAngle: 42,
  zoomPinch: 0.95,
  /** the index must be straight up in the L (measured 24–31°; a half-folded index turns away from the thumb) */
  zoomMaxFlex: 45,
  zoomPoseMs: 150,
  zoomClosed: 0.5,
  /** in the beak the index bends ~50–57°; folded much further (a tap, a fist) it is not a zoom */
  zoomCloseMaxFlex: 75,
  zoomOpen: 0.78,
  zoomExitMs: 400,
  /**
   * A slow close passes through a pointing-like pose (the thumb first lies along the hand, then the
   * index bends onto it): while the thumb↔index distance keeps changing this much within
   * `zoomMovingMs`, zoom mode stays.
   */
  zoomMoving: 0.12,
  zoomMovingMs: 300,
  zoomOthersExitMs: 150,
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
  stillWindowMs: 150,
  stillGapMs: 50,
  stillMaxTravel: 0.05,
  frozenMaxTravel: 0.05,
  /**
   * Fist = reset: closing the hand (fingers folding together, not just the index) cancels a press,
   * releases a grab and ends scrolling; nothing new starts until the fingers open again. Inside
   * scrolling the fist must be held longer, because a two-finger flick briefly looks like one.
   */
  fistHoldMs: 200,
  fistHoldScrollMs: 700,
  fistFormedMs: 600,
  /**
   * Finger gestures must be made by the fingers, not by the wrist. Tilting the whole hand (e.g.
   * bending the wrist down from a vertical hand) turns the palm and brings the index towards the
   * camera, which can look like a fold. Measured on real taps the palm turns 16–29° during the
   * fold while the finger folds ~80°; so a fold counts only if the palm turned at most
   * `maxPalmTurn` and the finger folded at least `foldToTurn` times more than the palm turned.
   */
  maxPalmTurn: 35,
  foldToTurn: 2,
  maxPushTurn: 30,
  /** the palm must already be open this long before a push grabs (opening the hand is not a push) */
  openBeforeGrabMs: 400,
  /** the drawn hand's size follows the real palm size this slowly (turning the wrist must not pump it) */
  spanSmoothMs: 1500,
} as const

type Pose = Record<FingerName, boolean>
type Sample = {
  t: number; x: number; y: number; flexIndex: number; flexTwo: number; flexOthers: [number, number, number]; pinch: number; thumb: Point3; tip: Point3; depth: number
  /** hand anchor (window space): what the drawn hand does */
  palmX: number; palmY: number
  /** live palm centre (window space, smoothed): what the real hand does, finger-induced shifts included */
  rawX: number; rawY: number
  palmDir: Point3
}

const vectorFilter = (minCutoff: number, beta: number) => ({
  x: new OneEuroFilter(30, minCutoff, beta),
  y: new OneEuroFilter(30, minCutoff, beta),
  z: new OneEuroFilter(30, minCutoff, beta),
})

/** Angle between the thumb (its first joint → tip) and the index finger (knuckle → tip), degrees. */
function thumbIndexAngle(world: Point3[]) {
  const thumb = { x: world[LM.THUMB_TIP].x - world[LM.THUMB_MCP].x, y: world[LM.THUMB_TIP].y - world[LM.THUMB_MCP].y, z: world[LM.THUMB_TIP].z - world[LM.THUMB_MCP].z }
  const index = { x: world[LM.INDEX_TIP].x - world[LM.INDEX_MCP].x, y: world[LM.INDEX_TIP].y - world[LM.INDEX_MCP].y, z: world[LM.INDEX_TIP].z - world[LM.INDEX_MCP].z }
  const n = Math.hypot(thumb.x, thumb.y, thumb.z) * Math.hypot(index.x, index.y, index.z)
  return n ? (Math.acos(Math.max(-1, Math.min(1, (thumb.x * index.x + thumb.y * index.y + thumb.z * index.z) / n))) * 180) / Math.PI : 0
}

/** Unit direction wrist → middle knuckle in camera-aligned world space (the palm's "up"). */
function palmDirection(world: Point3[]): Point3 {
  const x = world[LM.MIDDLE_MCP].x - world[LM.WRIST].x
  const y = world[LM.MIDDLE_MCP].y - world[LM.WRIST].y
  const z = world[LM.MIDDLE_MCP].z - world[LM.WRIST].z
  const n = Math.hypot(x, y, z) || 1
  return { x: x / n, y: y / n, z: z / n }
}

const angleDeg = (a: Point3, b: Point3) => (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180) / Math.PI

/**
 * Turns raw hand observations into pointer, press, scroll, zoom and grab state:
 * - the pointer sits on the index fingertip but moves with the palm (1€-filtered, calibrated,
 *   optionally mirrored): the fingertip offset is held while fingers fold, so taps never move it;
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
  private openPalmSince = Number.NaN
  private anchor = new HandAnchor()
  private span = Number.NaN
  private handVotes: number[] = []
  private viewport = { width: 1920, height: 1080 }
  private fistLock = false
  private palmFilter = vectorFilter(1.2, ENGINE.pointerBeta)
  private rawFilter = vectorFilter(1.2, ENGINE.pointerBeta)
  private skeletonFilters: Array<ReturnType<typeof vectorFilter>> = []
  private depthFilter = new OneEuroFilter(30, 3, 8)
  private baseline = Number.NaN
  private history: Sample[] = []
  private aim: { x: number; y: number } | null = null
  private frozenAt = Number.NaN
  private rearmBlocked = false
  private press: { id: number; at: number; x: number; y: number; kind: 'tap' | 'poke'; base: number } | null = null
  private cooldownUntil = 0
  private zoomPoseSince = Number.NaN
  private zoom: { id: number; x: number; y: number; closed: boolean; exitSince: number } | null = null
  private scrollPoseSince = Number.NaN
  private exitPoseSince = Number.NaN
  private scroll: {
    id: number; x: number; y: number; lastHandY: number; flicking: boolean; anchorY: number; dragging: boolean; quietUntil: number; activeAt: number
    lastFlickAt: number; chain: number; lastFlingAt: number; lastFlingSign: number
  } | null = null
  private flungAt = Number.NEGATIVE_INFINITY
  private grab: { id: number; at: number; x0: number; y0: number; palmX0: number; palmY0: number; x: number; y: number; openLostSince: number; engaged: boolean } | null = null
  private last: HandFrame = emptyFrame(0, 0)

  constructor(settings: HandControlSettings) {
    this.settings = settings
    this.configure(settings)
  }

  configure(settings: HandControlSettings) {
    this.settings = settings
    for (const axis of ['x', 'y', 'z'] as const) {
      this.palmFilter[axis].setMinCutoff(settings.smoothing)
      this.rawFilter[axis].setMinCutoff(settings.smoothing)
    }
  }

  reset() {
    const { settings, viewport } = this
    Object.assign(this, new HandGestureEngine(settings))
    this.viewport = viewport
  }

  /** CSS size of the window the hand is drawn in: the drawn hand has a fixed size in pixels. */
  setViewport(width: number, height: number) {
    if (width > 0 && height > 0) this.viewport = { width, height }
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

    const flexIndex = fingerFlex(world, 'index')
    const flexMiddle = fingerFlex(world, 'middle')
    const flexTwo = (flexIndex + flexMiddle) / 2
    const flexOthers: [number, number, number] = [flexMiddle, fingerFlex(world, 'ring'), fingerFlex(world, 'pinky')]
    const pinch = pinchDistance(world)

    // Rule 1: the hand on screen moves only when the hand moves. The anchor — the palm centre in
    // camera pixels — ignores tracking noise and is held while the fingers move (HandAnchor).
    // `palm` is that anchor in window space: drags, grabs and "is the hand still" checks use it.
    const span = this.updateSpan(observation, dt)
    const frameW = observation.frameWidth
    const frameH = observation.frameHeight
    const user = (x: number) => (settings.mirror ? 1 - x : x)
    const centerImage = palmCenter(observation.image)
    const held = this.anchor.update(t, { x: user(centerImage.x) * frameW, y: centerImage.y * frameH }, span, [flexIndex, ...flexOthers], pinch, this.phase === 'press')
    // toWindowSpace mirrors by itself, so it gets the point back in camera coordinates.
    const anchor = toWindowSpace({ x: user(held.x / frameW), y: held.y / frameH }, settings.calibration, settings.mirror, settings.homography)
    const palm = { x: this.palmFilter.x.filter(anchor.x, seconds), y: this.palmFilter.y.filter(anchor.y, seconds) }
    const liveCenter = toWindowSpace(centerImage, settings.calibration, settings.mirror, settings.homography)
    const live = { x: this.rawFilter.x.filter(liveCenter.x, seconds), y: this.rawFilter.y.filter(liveCenter.y, seconds) }
    // Rule 2: the drawn hand is the real finger shape at a steady size around that anchor, and the
    // aim is the middle of its index distal phalanx — whatever that phalanx covers on screen.
    const skeleton = this.drawnHand(observation, palm, span, seconds)
    const pointer = {
      x: clamp01((skeleton[LM.INDEX_DIP].x + skeleton[LM.INDEX_TIP].x) / 2),
      y: clamp01((skeleton[LM.INDEX_DIP].y + skeleton[LM.INDEX_TIP].y) / 2),
    }

    const depth = this.updateDepth(observation, seconds, dt)
    const palmDir = palmDirection(world)
    this.history.push({ t, x: pointer.x, y: pointer.y, flexIndex, flexTwo, flexOthers, pinch, thumb: world[LM.THUMB_TIP], tip: world[LM.INDEX_TIP], depth, palmX: palm.x, palmY: palm.y, rawX: live.x, rawY: live.y, palmDir })
    while (this.history.length && t - this.history[0].t > ENGINE.historyMs) this.history.shift()
    // How far the whole hand turned during the last fold window (wrist bends, hand tilts).
    const palmTurn = this.palmTurnSince(t - ENGINE.foldWindowMs, palmDir)

    const scrollPose = this.pose.index && this.pose.middle && !this.pose.ring && !this.pose.pinky
    const thumbAngle = thumbIndexAngle(world)
    const zoomPose = this.pose.index && !this.pose.middle && !this.pose.ring && !this.pose.pinky && flexIndex <= ENGINE.zoomMaxFlex && thumbAngle >= ENGINE.zoomAngle && pinch >= ENGINE.zoomPinch
    if (!zoomPose) this.zoomPoseSince = Number.NaN
    else if (Number.isNaN(this.zoomPoseSince)) this.zoomPoseSince = t
    const openPalm = this.pose.index && this.pose.middle && this.pose.ring && this.pose.pinky && thumbOut(world) >= ENGINE.thumbOutOpen
    if (!openPalm) this.openPalmSince = Number.NaN
    else if (Number.isNaN(this.openPalmSince)) this.openPalmSince = t
    const palmSettled = openPalm && t - this.openPalmSince >= ENGINE.openBeforeGrabMs
    const useTap = settings.clickMode !== 'poke'
    const usePoke = settings.clickMode !== 'tap'
    const tapBase = this.minSince(t - ENGINE.foldWindowMs, 'flexIndex')
    const indexRecent = t - this.indexExtendedAt <= ENGINE.indexRecentMs
    // A tap folds the index alone: if the other fingers were open a moment ago, this is a fist forming.
    const othersFolded = t - this.middleExtendedAt > ENGINE.foldWindowMs
    const fingerFold = flexIndex - tapBase
    const madeByFinger = palmTurn <= ENGINE.maxPalmTurn && fingerFold >= palmTurn * ENGINE.foldToTurn
    const tapProgress = useTap && indexRecent && othersFolded && madeByFinger && !openPalm && !this.fistLock ? clamp01(fingerFold / settings.tapAngle) : 0
    const pokeProgress = usePoke && this.pose.index && !scrollPose && !openPalm ? clamp01(depth / settings.pressThreshold) : 0
    const grabProgress = settings.palmGrab && openPalm ? clamp01(depth / settings.grabThreshold) : 0
    const progress = Math.max(tapProgress, pokeProgress, grabProgress)

    if (this.phase === 'idle') this.phase = 'point'
    // The zoom "beak" (thumb on the index, other fingers folded) looks like a fist: not a reset.
    if (fist && !this.fistLock && this.fistFormedFromOpenHand() && this.phase !== 'zoom') {
      const hold = this.phase === 'scroll' ? ENGINE.fistHoldScrollMs : ENGINE.fistHoldMs
      if (t - this.fistSince >= hold) this.resetByFist(events, t)
    }
    if (this.phase === 'point') this.updateAim(t, pointer, tapProgress)

    if (this.phase === 'scroll' && this.scroll) {
      this.updateScroll(events, t, scrollPose, openPalm, flexTwo, palm.y, palmTurn)
    } else if (this.phase === 'zoom' && this.zoom) {
      this.updateZoom(events, t, pinch, thumbAngle, flexIndex)
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
      if (ready && settings.palmGrab && palmSettled && palmTurn <= ENGINE.maxPushTurn && this.isPush(t, depth, settings.grabThreshold)) {
        const id = this.nextId++
        const start = this.pushStart(t, pointer)
        // Drag relative to where the palm is now (the push itself shifts the image of the hand).
        this.grab = { id, at: t, x0: start.x, y0: start.y, palmX0: palm.x, palmY0: palm.y, x: start.x, y: start.y, openLostSince: Number.NaN, engaged: false }
        this.phase = 'grab'
        events.push({ type: 'grab-start', id, x: start.x, y: start.y })
      } else if (!this.fistLock && scrollPose && t - this.scrollPoseSince >= ENGINE.scrollPoseMs) {
        const id = this.nextId++
        this.scroll = {
          id, x: at.x, y: at.y, lastHandY: palm.y, flicking: false, anchorY: palm.y, dragging: false, quietUntil: 0, activeAt: t,
          lastFlickAt: Number.NEGATIVE_INFINITY, chain: 0, lastFlingAt: Number.NEGATIVE_INFINITY, lastFlingSign: 0,
        }
        this.exitPoseSince = Number.NaN
        this.phase = 'scroll'
        events.push({ type: 'scroll-start', id, x: at.x, y: at.y })
      } else if (ready && useTap && indexRecent && madeByFinger && !openPalm && this.aim && flexIndex >= ENGINE.tapMinFlex && fingerFold >= settings.tapAngle) {
        this.startPress(events, t, at, 'tap', tapBase)
      } else if (ready && usePoke && this.pose.index && !scrollPose && !openPalm && palmTurn <= ENGINE.maxPushTurn && this.isPush(t, depth, settings.pressThreshold)) {
        this.startPress(events, t, this.pushStart(t, pointer), 'poke', 0)
      } else if (settings.pinchZoom && !this.fistLock && zoomPose && t - this.zoomPoseSince >= ENGINE.zoomPoseMs) {
        // Zoom around the point the phalanx was on when the L pose began.
        const center = this.pointerAt(this.zoomPoseSince) ?? at
        this.zoom = { id: this.nextId++, x: center.x, y: center.y, closed: false, exitSince: Number.NaN }
        this.phase = 'zoom'
        this.aim = null
        this.frozenAt = Number.NaN
      }
    }

    const output = this.press ? { x: this.press.x, y: this.press.y }
      : this.zoom ? { x: this.zoom.x, y: this.zoom.y }
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
      hand: palm,
      aimOffset: { x: pointer.x - palm.x, y: pointer.y - palm.y },
      pressProgress: this.phase === 'press' || this.phase === 'grab' ? 1 : this.phase === 'scroll' ? 0 : progress,
      depth,
      indexFlex: flexIndex,
      pinch,
      skeleton,
      chirality: this.chirality(observation),
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
      this.aim = this.aimBeforeFold(t) ?? pointer
      this.frozenAt = t
      return
    }
    this.aim = null
  }

  /** Largest angle (degrees) between the palm direction now and since `from`. */
  private palmTurnSince(from: number, now: Point3) {
    let turn = 0
    for (const sample of this.history) if (sample.t >= from) turn = Math.max(turn, angleDeg(sample.palmDir, now))
    return turn
  }

  /**
   * Hand travel (calibrated units, bounding-box diagonal) between two times: of the anchor (the
   * drawn hand), or of the live palm (the real hand, including the shifts finger folds cause).
   */
  private palmTravel(from: number, to: number, of: 'anchor' | 'live' = 'anchor') {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const sample of this.history) {
      if (sample.t < from || sample.t > to) continue
      const x = of === 'anchor' ? sample.palmX : sample.rawX
      const y = of === 'anchor' ? sample.palmY : sample.rawY
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    return Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0
  }

  /**
   * The real hand stood still during the moment just before `t` — or, while the fingers are
   * moving (the anchor holds), just before they began to move: a fold made by a moving hand is
   * not a gesture.
   */
  private stillBefore(t: number) {
    const end = this.anchor.holding ? Math.min(t - ENGINE.stillGapMs, this.anchor.holdSince) : t - ENGINE.stillGapMs
    return this.palmTravel(end - ENGINE.stillWindowMs + ENGINE.stillGapMs, end, 'live') <= ENGINE.stillMaxTravel
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

  private updateScroll(events: HandEvent[], t: number, scrollPose: boolean, openPalm: boolean, flexTwo: number, handY: number, palmTurn: number) {
    const scroll = this.scroll!
    const { settings } = this
    const base = this.minSince(t - ENGINE.foldWindowMs, 'flexTwo')
    const fold = flexTwo - base
    if (scrollPose) scroll.activeAt = t
    const flickByFingers = palmTurn <= ENGINE.maxPalmTurn && fold >= palmTurn * ENGINE.foldToTurn
    if (!scroll.flicking && flickByFingers && fold >= Math.max(ENGINE.flickMinFold, settings.tapAngle * 0.9) && flexTwo >= ENGINE.flickMinFlex) {
      scroll.flicking = true
      scroll.activeAt = t
      scroll.chain = t - scroll.lastFlickAt <= ENGINE.flickChainMs ? scroll.chain + 1 : 0
      scroll.lastFlickAt = t
      const boost = Math.min(ENGINE.flickChainMax, ENGINE.flickChainGrowth ** scroll.chain)
      const dy = settings.flickStep * boost * (settings.flickDirection === 'down' ? 1 : -1)
      events.push({ type: 'scroll', id: scroll.id, dy, step: true })
    } else if (scroll.flicking && fold <= ENGINE.flickResetFold) {
      scroll.flicking = false
      scroll.quietUntil = t + ENGINE.dragSettleMs
    }

    // Continuous drag only with both fingers raised, after the hand has clearly travelled
    // (a flick and its return also move the knuckles a little — that must not scroll).
    const delta = handY - scroll.lastHandY
    scroll.lastHandY = handY
    // While the anchor holds or glides back after a flick the hand did not move: no drag.
    const canDrag = scrollPose && !scroll.flicking && fold < ENGINE.dragFoldLimit && t >= scroll.quietUntil && !this.anchor.holding && !this.anchor.gliding
    if (!canDrag) {
      scroll.dragging = false
      scroll.anchorY = handY
    } else if (!scroll.dragging && Math.abs(handY - scroll.anchorY) >= ENGINE.dragEngage) {
      scroll.dragging = true
    } else if (scroll.dragging) {
      const dy = (settings.naturalScroll ? -delta : delta) * settings.scrollSpeed
      if (Math.abs(dy) > 0.0015) events.push({ type: 'scroll', id: scroll.id, dy })
    }
    if (scrollPose && !scroll.flicking && t >= scroll.quietUntil) this.detectFling(events, t, scroll, handY)

    // Leave scrolling on another clear pose (pointing, open palm) or when the two-finger pose
    // has been gone for a while. Folded fingers mid-flick keep the mode.
    const pointing = this.pose.index && !this.pose.middle
    if (pointing || openPalm || this.pose.ring || this.pose.pinky) {
      if (Number.isNaN(this.exitPoseSince)) this.exitPoseSince = t
    } else this.exitPoseSince = Number.NaN
    const idle = !scroll.flicking && t - scroll.activeAt >= ENGINE.scrollIdleMs
    if (idle || (!Number.isNaN(this.exitPoseSince) && t - this.exitPoseSince >= ENGINE.scrollExitMs)) this.endScroll(events, t)
  }

  /** A fast swipe of the raised two-finger hand: momentum scrolling in the swipe's direction. */
  private detectFling(events: HandEvent[], t: number, scroll: NonNullable<HandGestureEngine['scroll']>, handY: number) {
    const recent = this.history.filter((sample) => sample.t >= t - ENGINE.flingWindowMs)
    if (recent.length < 3) return
    const travel = handY - recent[0].palmY
    const elapsed = t - recent[0].t
    const folds = recent.map((sample) => sample.flexTwo)
    if (!elapsed || Math.abs(travel) < ENGINE.flingMinTravel || Math.max(...folds) - Math.min(...folds) > ENGINE.flingFoldSteady) return
    const sign = Math.sign(travel)
    const returnStroke = t - scroll.lastFlingAt <= ENGINE.flingReturnMs && sign !== scroll.lastFlingSign
    if (!returnStroke) {
      const handSpeed = travel / (elapsed / 1000)
      const v = (this.settings.naturalScroll ? -handSpeed : handSpeed) * this.settings.scrollSpeed * ENGINE.flingGain
      events.push({ type: 'fling', id: scroll.id, v })
      scroll.lastFlingSign = sign
      this.flungAt = t
    }
    // Either way the slow drag waits: it must neither double the swipe nor pull it back.
    scroll.lastFlingAt = t
    scroll.activeAt = t
    scroll.quietUntil = t + ENGINE.flingSettleMs
    scroll.dragging = false
    scroll.anchorY = handY
  }

  /** The fist was made by closing an open hand (other fingers were extended just before). */
  private fistFormedFromOpenHand() {
    return this.middleExtendedAt >= this.fistSince - ENGINE.fistFormedMs
  }

  /** Fist: drop whatever is in progress and block new actions until the hand opens. */
  private resetByFist(events: HandEvent[], t: number) {
    if (this.press) events.push({ type: 'cancel', id: this.press.id })
    // A fist also stops content still coasting after a swipe.
    if (t - this.flungAt <= ENGINE.flingLifeMs) {
      events.push({ type: 'fling', id: this.scroll?.id ?? 0, v: 0 })
      this.flungAt = Number.NEGATIVE_INFINITY
    }
    if (this.scroll) events.push({ type: 'scroll-end', id: this.scroll.id })
    if (this.grab) events.push({ type: 'grab-end', id: this.grab.id })
    this.press = null
    this.scroll = null
    this.grab = null
    this.zoom = null
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

  /** Zoom mode: the thumb closing onto the index zooms out a step, opening it zooms in a step. */
  private updateZoom(events: HandEvent[], t: number, pinch: number, thumbAngle: number, flexIndex: number) {
    const zoom = this.zoom!
    if (!zoom.closed && pinch <= ENGINE.zoomClosed && flexIndex <= ENGINE.zoomCloseMaxFlex) {
      zoom.closed = true
      events.push({ type: 'zoom', id: this.nextId++, x: zoom.x, y: zoom.y, steps: -1 })
    } else if (zoom.closed && pinch >= ENGINE.zoomOpen) {
      zoom.closed = false
      events.push({ type: 'zoom', id: this.nextId++, x: zoom.x, y: zoom.y, steps: 1 })
    }
    const others = this.pose.middle || this.pose.ring || this.pose.pinky
    const pinches = this.history.filter((sample) => sample.t >= t - ENGINE.zoomMovingMs).map((sample) => sample.pinch)
    const moving = Math.max(...pinches) - Math.min(...pinches) >= ENGINE.zoomMoving
    const inPose = !others && (moving || pinch <= ENGINE.zoomClosed || (pinch >= ENGINE.zoomOpen && thumbAngle >= ENGINE.zoomAngle))
    if (inPose) zoom.exitSince = Number.NaN
    else if (Number.isNaN(zoom.exitSince)) zoom.exitSince = t
    if (!Number.isNaN(zoom.exitSince) && t - zoom.exitSince >= (others ? ENGINE.zoomOthersExitMs : ENGINE.zoomExitMs)) {
      this.zoom = null
      this.zoomPoseSince = Number.NaN
      this.toPoint(t)
    }
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

  /** Where the aim was just before the finger began to fold (lowest index flex of the fold window). */
  private aimBeforeFold(t: number) {
    let best: Sample | null = null
    for (const sample of this.history) {
      if (sample.t >= t - ENGINE.foldWindowMs && (!best || sample.flexIndex <= best.flexIndex)) best = sample
    }
    return best ? { x: best.x, y: best.y } : null
  }

  /**
   * MediaPipe labels handedness as if the image were mirrored; the camera image is not, so its
   * label names the other hand. Shown mirrored, the drawn shape is that labelled hand again.
   * The label is smoothed over recent frames (it can flicker when the hand turns).
   */
  private chirality(observation: HandObservation): 'left' | 'right' {
    this.handVotes.push(observation.handedness === 'Left' ? 1 : -1)
    if (this.handVotes.length > 15) this.handVotes.shift()
    const labelledLeft = this.handVotes.reduce((sum, vote) => sum + vote, 0) > 0
    return labelledLeft === this.settings.mirror ? 'left' : 'right'
  }

  private updateSpan(observation: HandObservation, dt: number) {
    const span = imageSpan(observation)
    this.span = Number.isNaN(this.span) ? span : this.span + (span - this.span) * (1 - Math.exp(-dt / ENGINE.spanSmoothMs))
    return this.span
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
    this.zoom = null
    this.zoomPoseSince = Number.NaN
    this.phase = 'idle'
    this.aim = null
    this.frozenAt = Number.NaN
    this.rearmBlocked = false
    this.baseline = Number.NaN
    this.scrollPoseSince = Number.NaN
    this.history = []
    this.anchor.reset()
    this.span = Number.NaN
    this.handVotes = []
    this.openPalmSince = Number.NaN
    for (const axis of ['x', 'y', 'z'] as const) {
      this.palmFilter[axis].reset()
      this.rawFilter[axis].reset()
    }
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

  /**
   * The drawn hand in window space (z in CSS pixels, positive = towards the viewer): the real
   * finger shape, measured relative to the palm centre in palm spans and 1€-filtered, scaled to
   * GHOST_PALM_PX and placed on the anchor. Fingers move freely; the hand stays on its anchor.
   */
  private drawnHand(observation: HandObservation, palm: { x: number; y: number }, span: number, seconds: number): Point3[] {
    if (this.skeletonFilters.length !== 21) this.skeletonFilters = Array.from({ length: 21 }, () => vectorFilter(this.settings.smoothing * 1.5, ENGINE.pointerBeta))
    const { image, frameWidth, frameHeight } = observation
    const center = palmCenter(image)
    const sign = this.settings.mirror ? -1 : 1
    const unit = Math.max(1, span)
    const wristZ = image[LM.WRIST].z
    return image.map((point, index) => {
      const filter = this.skeletonFilters[index]
      const rx = filter.x.filter((sign * (point.x - center.x) * frameWidth) / unit, seconds)
      const ry = filter.y.filter(((point.y - center.y) * frameHeight) / unit, seconds)
      const rz = filter.z.filter((-(point.z - wristZ) * frameWidth) / unit, seconds)
      return {
        x: palm.x + (rx * GHOST_PALM_PX) / this.viewport.width,
        y: palm.y + (ry * GHOST_PALM_PX) / this.viewport.height,
        z: rz * GHOST_PALM_PX,
      }
    })
  }

}

function emptyFrame(seq: number, t: number): HandFrame {
  return { seq, t, tracking: 'none', confidence: 0, phase: 'idle', pointer: null, hand: null, aimOffset: null, pressProgress: 0, depth: 0, indexFlex: 0, pinch: 0, skeleton: null, chirality: null, events: [] }
}
