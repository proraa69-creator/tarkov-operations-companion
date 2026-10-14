// Hand Control: shared contract between a hand source (webcam today, phone later),
// the gesture engine and the Raid OS UI layer. Coordinates never leave the device.

export interface Point3 { x: number; y: number; z: number }

/** One tracker sample. `image` is MediaPipe's normalized image space, `world` is metric (metres, hand-centred). */
export interface HandObservation {
  /** performance.now() of the camera frame, ms */
  t: number
  image: Point3[]
  world: Point3[]
  /** handedness score / presence confidence, 0..1 */
  score: number
  handedness: 'Left' | 'Right'
  /** camera frame size in pixels, used to undo the aspect ratio of normalized coordinates */
  frameWidth: number
  frameHeight: number
}

export type HandPhase = 'idle' | 'point' | 'press' | 'scroll' | 'grab'
export type TrackingQuality = 'none' | 'weak' | 'good'

export type HandEvent =
  | { type: 'press'; id: number; x: number; y: number }
  | { type: 'click'; id: number; x: number; y: number }
  | { type: 'cancel'; id: number }
  | { type: 'scroll-start'; id: number; x: number; y: number }
  /** dy in window heights; `step` marks a discrete two-finger flick (animated by the UI) */
  | { type: 'scroll'; id: number; dy: number; step?: boolean }
  | { type: 'scroll-end'; id: number }
  /** pinch zoom step at the aim point: +1 = thumb moved away from the index (zoom in), -1 = pinched (zoom out) */
  | { type: 'zoom'; id: number; x: number; y: number; steps: number }
  /** open palm pushed towards the camera = mouse held down; moving drags (e.g. pans the map) */
  | { type: 'grab-start'; id: number; x: number; y: number }
  | { type: 'grab-move'; id: number; x: number; y: number }
  | { type: 'grab-end'; id: number }

/** Processed state for one frame — the only thing the UI layer consumes. */
export interface HandFrame {
  seq: number
  t: number
  tracking: TrackingQuality
  confidence: number
  phase: HandPhase
  /** aim point in window-normalized coordinates (0..1) — frozen during a press, scroll or grab; null when the hand is not usable */
  pointer: { x: number; y: number } | null
  /** live palm centre (never frozen), used to place the drawn hand */
  hand: { x: number; y: number } | null
  /** held fingertip offset from the palm centre (window units): pointer ≈ hand + aimOffset */
  aimOffset: { x: number; y: number } | null
  /** 0..1 how far the current poke is towards a press */
  pressProgress: number
  /** relative distance to camera: >0 closer than the resting baseline, <0 further (log scale) */
  depth: number
  /** index finger fold relative to the palm, degrees (pointing ≈ 10–40, tap ≈ 100+) */
  indexFlex: number
  /** thumb tip ↔ index tip distance in palm lengths (pinched < 0.3, spread > 0.75) */
  pinch: number
  /** 21 landmarks mapped into window-normalized space for the drawn hand (z relative, in x units) */
  skeleton: Point3[] | null
  events: HandEvent[]
}

export interface CalibrationBox { x0: number; y0: number; x1: number; y1: number }

export interface HandControlSettings {
  mirror: boolean
  /** drawn hand: 3D model, flat outline or just a cursor */
  cursor: 'hand3d' | 'ghost' | 'finger'
  calibration: CalibrationBox
  /** how a press is made: folding the index finger (tap), pushing the hand forward (poke), or either */
  clickMode: 'tap' | 'poke' | 'both'
  /** degrees the index finger must fold for a tap; smaller = more sensitive */
  tapAngle: number
  /** poke depth (log ratio) needed for a press; smaller = more sensitive */
  pressThreshold: number
  /** pixels of scroll per window height of hand movement */
  scrollSpeed: number
  naturalScroll: boolean
  /** window heights scrolled by one two-finger flick */
  flickStep: number
  /** direction of a two-finger flick (fold both fingers forward and back) */
  flickDirection: 'down' | 'up'
  /** pointer smoothing: 1euro min cutoff, Hz; lower = steadier, more lag */
  smoothing: number
  cameraId: string
  showPreview: boolean
  /** where MediaPipe runs: GPU is faster, CPU leaves the graphics card to the game */
  compute: 'auto' | 'GPU' | 'CPU'
  /** quick thumb-from-index spread / pinch zooms the map */
  pinchZoom: boolean
  /** open palm pushed towards the camera drags like a held mouse button */
  palmGrab: boolean
  /** push depth (log ratio) for the palm grab */
  grabThreshold: number
}

export const DEFAULT_SETTINGS: HandControlSettings = {
  mirror: true,
  cursor: 'hand3d',
  calibration: { x0: 0.2, y0: 0.15, x1: 0.8, y1: 0.75 },
  clickMode: 'tap',
  tapAngle: 35,
  pressThreshold: 0.07,
  scrollSpeed: 2.2,
  naturalScroll: true,
  flickStep: 0.35,
  flickDirection: 'down',
  smoothing: 1.2,
  cameraId: '',
  showPreview: true,
  compute: 'auto',
  pinchZoom: true,
  palmGrab: true,
  grabThreshold: 0.08,
}

/** MediaPipe hand landmark indices. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
} as const

export const HAND_BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]
