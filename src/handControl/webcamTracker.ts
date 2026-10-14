import { HandLandmarker } from '@mediapipe/tasks-vision'
import type { HandObservation } from './types'

export type TrackerErrorCode = 'unsupported' | 'denied' | 'busy' | 'no-camera' | 'model'

export class HandTrackerError extends Error {
  constructor(readonly code: TrackerErrorCode, message: string) { super(message) }
}

export interface TrackerStats {
  fps: number
  inferenceMs: number
  delegate: 'GPU' | 'CPU'
  width: number
  height: number
}

const TARGET_FPS = 30
/** Without a hand in view only every 3rd frame is analysed to keep CPU/GPU free for the game. */
const IDLE_STRIDE = 3

/** Assets are bundled with the app (public/hand-control) — nothing is fetched from the internet. */
function assetUrl(path: string) {
  return new URL(`hand-control/${path}`, document.baseURI).href
}

type Loaded = { landmarker: HandLandmarker; delegate: 'GPU' | 'CPU' }
let landmarkerPromise: Promise<Loaded> | null = null
let gpuBroken = false
let preferCpu = false

/** 'auto' tries the GPU first; switching discards the loaded model so the next start uses the new choice. */
export function setComputePreference(compute: 'auto' | 'GPU' | 'CPU') {
  const cpu = compute === 'CPU'
  if (cpu === preferCpu) return
  preferCpu = cpu
  void landmarkerPromise?.then(({ landmarker }) => landmarker.close()).catch(() => {})
  landmarkerPromise = null
}

function loadLandmarker(): Promise<Loaded> {
  landmarkerPromise ??= (async () => {
    const fileset = { wasmLoaderPath: assetUrl('wasm/vision_wasm_internal.js'), wasmBinaryPath: assetUrl('wasm/vision_wasm_internal.wasm') }
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: assetUrl('hand_landmarker.task'), delegate },
      runningMode: 'VIDEO' as const,
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    })
    if (!gpuBroken && !preferCpu) {
      try {
        return { landmarker: await HandLandmarker.createFromOptions(fileset, options('GPU')), delegate: 'GPU' as const }
      } catch {
        gpuBroken = true
      }
    }
    return { landmarker: await HandLandmarker.createFromOptions(fileset, options('CPU')), delegate: 'CPU' as const }
  })().catch((error: unknown) => {
    landmarkerPromise = null
    throw new HandTrackerError('model', error instanceof Error ? error.message : String(error))
  })
  return landmarkerPromise
}

/** The GPU graph can fail only at the first inference (no WebGL2, driver issues): retry on CPU once. */
async function fallBackToCpu(failed: Loaded) {
  gpuBroken = true
  landmarkerPromise = null
  try { failed.landmarker.close() } catch { /* already broken */ }
  return loadLandmarker()
}

export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((device) => device.kind === 'videoinput')
}

function cameraError(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return new HandTrackerError('denied', name)
  if (name === 'NotReadableError' || name === 'AbortError') return new HandTrackerError('busy', name)
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new HandTrackerError('no-camera', name)
  return new HandTrackerError('no-camera', error instanceof Error ? error.message : String(error))
}

/**
 * Local webcam → MediaPipe Hand Landmarker. Frames are analysed in memory and dropped;
 * only landmark coordinates are passed on.
 */
export class WebcamHandTracker {
  readonly video: HTMLVideoElement
  private stream: MediaStream | null = null
  private running = false
  private frameHandle = 0
  private lastProcessed = 0
  private frameCount = 0
  private emptyFrames = 0
  private fpsWindow: number[] = []
  private stats: TrackerStats = { fps: 0, inferenceMs: 0, delegate: 'GPU', width: 0, height: 0 }
  private cpuCanvas: OffscreenCanvas | null = null

  constructor(
    private readonly onSample: (observation: HandObservation | null, stats: TrackerStats) => void,
    private readonly onFailure: (error: HandTrackerError) => void = () => {},
  ) {
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.setAttribute('aria-hidden', 'true')
    // Kept in the document (but invisible) so Chromium keeps delivering frames.
    Object.assign(this.video.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' })
  }

  get isRunning() { return this.running }

  async start(cameraId = '') {
    if (this.running) return
    if (!navigator.mediaDevices?.getUserMedia) throw new HandTrackerError('unsupported', 'getUserMedia unavailable')
    const modelReady = loadLandmarker()
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...(cameraId ? { deviceId: { exact: cameraId } } : {}), width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: TARGET_FPS, max: TARGET_FPS } },
      })
    } catch (error) {
      throw cameraError(error)
    }
    try {
      const { delegate } = await modelReady
      this.stats.delegate = delegate
      this.video.srcObject = this.stream
      document.body.appendChild(this.video)
      await this.video.play()
    } catch (error) {
      this.stop()
      throw error instanceof HandTrackerError ? error : new HandTrackerError('model', String(error))
    }
    this.running = true
    this.schedule()
  }

  stop() {
    this.running = false
    if (this.frameHandle) {
      if ('cancelVideoFrameCallback' in this.video) this.video.cancelVideoFrameCallback(this.frameHandle)
      cancelAnimationFrame(this.frameHandle)
      this.frameHandle = 0
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.video.srcObject = null
    this.video.remove()
    this.fpsWindow = []
  }

  /** CPU path: hand MediaPipe raw pixels so it does not need WebGL to read the video frame. */
  private pixels() {
    const width = this.video.videoWidth
    const height = this.video.videoHeight
    if (!this.cpuCanvas || this.cpuCanvas.width !== width || this.cpuCanvas.height !== height) this.cpuCanvas = new OffscreenCanvas(width, height)
    const context = this.cpuCanvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(this.video, 0, 0, width, height)
    return context.getImageData(0, 0, width, height)
  }

  private fail(error: unknown) {
    this.stop()
    this.onFailure(error instanceof HandTrackerError ? error : new HandTrackerError('model', error instanceof Error ? error.message : String(error)))
  }

  private schedule() {
    if (!this.running) return
    if ('requestVideoFrameCallback' in this.video) this.frameHandle = this.video.requestVideoFrameCallback(() => void this.tick())
    else this.frameHandle = requestAnimationFrame(() => void this.tick())
  }

  private async tick() {
    if (!this.running) return
    const now = performance.now()
    this.frameCount++
    const idle = this.emptyFrames > TARGET_FPS
    const due = now - this.lastProcessed >= 1000 / TARGET_FPS - 4 && (!idle || this.frameCount % IDLE_STRIDE === 0)
    if (due && this.video.readyState >= 2) {
      this.lastProcessed = now
      let loaded = await loadLandmarker()
      if (!this.running) return
      const started = performance.now()
      let result
      try {
        result = loaded.landmarker.detectForVideo(loaded.delegate === 'CPU' ? this.pixels() : this.video, started)
      } catch (error) {
        if (loaded.delegate === 'GPU') {
          try {
            loaded = await fallBackToCpu(loaded)
            this.stats.delegate = loaded.delegate
            this.schedule()
          } catch (cpuError) {
            this.fail(cpuError)
          }
          return
        }
        this.fail(error)
        return
      }
      const finished = performance.now()
      this.stats.inferenceMs = this.stats.inferenceMs ? this.stats.inferenceMs * 0.9 + (finished - started) * 0.1 : finished - started
      this.stats.width = this.video.videoWidth
      this.stats.height = this.video.videoHeight
      this.fpsWindow.push(finished)
      while (this.fpsWindow.length && finished - this.fpsWindow[0] > 1000) this.fpsWindow.shift()
      this.stats.fps = this.fpsWindow.length
      const image = result.landmarks[0]
      const world = result.worldLandmarks[0]
      if (image && world) {
        this.emptyFrames = 0
        const category = result.handedness[0]?.[0]
        // A hand partly outside the frame is tracked less reliably: scale confidence down.
        const inFrame = image.filter(({ x, y }) => x > 0.02 && x < 0.98 && y > 0.02 && y < 0.98).length / image.length
        this.onSample({
          t: started,
          image: image.map(({ x, y, z }) => ({ x, y, z })),
          world: world.map(({ x, y, z }) => ({ x, y, z })),
          score: (category?.score ?? 0) * inFrame,
          handedness: category?.categoryName === 'Left' ? 'Left' : 'Right',
          frameWidth: this.video.videoWidth,
          frameHeight: this.video.videoHeight,
        }, { ...this.stats })
      } else {
        this.emptyFrames++
        this.onSample(null, { ...this.stats })
      }
    }
    this.schedule()
  }
}
