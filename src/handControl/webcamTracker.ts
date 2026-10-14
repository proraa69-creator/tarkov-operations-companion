import type { HandObservation } from './types'
import type { WorkerHand, WorkerRequest, WorkerResponse } from './workerProtocol'

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
  /** where MediaPipe runs: a worker thread (normal) or the UI thread (fallback) */
  thread: 'worker' | 'main'
}

type Compute = 'auto' | 'GPU' | 'CPU'
type Detection = { hand: WorkerHand | null; inferenceMs: number; delegate: 'GPU' | 'CPU'; width: number; height: number }

interface Detector {
  readonly thread: 'worker' | 'main'
  detect(video: HTMLVideoElement, t: number): Promise<Detection>
  close(): void
}

const TARGET_FPS = 30
/** Without a hand in view only every 3rd frame is analysed to keep CPU/GPU free for the game. */
const IDLE_STRIDE = 3
const WORKER_INIT_TIMEOUT_MS = 20000

let compute: Compute = 'auto'

/** Applies on the next start (a running tracker keeps its detector). */
export function setComputePreference(next: Compute) {
  compute = next
}

/** Assets are bundled with the app (public/hand-control) — nothing is fetched from the internet. */
function assetBase() {
  return new URL('hand-control/', document.baseURI).href
}

/** MediaPipe in a worker: the UI thread only hands over camera frames. */
async function createWorkerDetector(): Promise<Detector> {
  const worker = new Worker(new URL('./handWorker.ts', import.meta.url), { type: 'module' })
  let nextId = 1
  const pending = new Map<number, { resolve: (value: Detection) => void; reject: (error: Error) => void }>()
  let fatal: ((error: Error) => void) | null = null
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    if (message.type === 'result') {
      pending.get(message.id)?.resolve(message)
      pending.delete(message.id)
    } else if (message.type === 'error' && message.id !== undefined) {
      pending.get(message.id)?.reject(new Error(message.message))
      pending.delete(message.id)
    }
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'worker failed')
    fatal?.(error)
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('worker init timeout')), WORKER_INIT_TIMEOUT_MS)
      fatal = (error) => { window.clearTimeout(timer); reject(error) }
      const onReady = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'ready') { window.clearTimeout(timer); worker.removeEventListener('message', onReady); resolve() }
        else if (event.data.type === 'error' && event.data.id === undefined) { window.clearTimeout(timer); reject(new Error(event.data.message)) }
      }
      worker.addEventListener('message', onReady)
      worker.postMessage({ type: 'init', base: assetBase(), compute } satisfies WorkerRequest)
    })
  } catch (error) {
    worker.terminate()
    throw error
  }
  fatal = null
  return {
    thread: 'worker',
    async detect(video, t) {
      const bitmap = await createImageBitmap(video)
      const id = nextId++
      return new Promise<Detection>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ type: 'frame', id, t, bitmap } satisfies WorkerRequest, [bitmap])
      })
    },
    close() {
      worker.postMessage({ type: 'close' } satisfies WorkerRequest)
      worker.terminate()
      for (const entry of pending.values()) entry.reject(new Error('closed'))
      pending.clear()
    },
  }
}

/** Fallback when workers are unavailable: same model on the UI thread. */
async function createMainThreadDetector(): Promise<Detector> {
  const { HandLandmarker } = await import('@mediapipe/tasks-vision')
  const base = assetBase()
  const fileset = { wasmLoaderPath: `${base}wasm/vision_wasm_internal.js`, wasmBinaryPath: `${base}wasm/vision_wasm_internal.wasm` }
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: `${base}hand_landmarker.task`, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  })
  let delegate: 'GPU' | 'CPU' = compute === 'CPU' ? 'CPU' : 'GPU'
  let landmarker = await HandLandmarker.createFromOptions(fileset, options(delegate)).catch(async () => {
    delegate = 'CPU'
    return HandLandmarker.createFromOptions(fileset, options('CPU'))
  })
  let canvas: OffscreenCanvas | null = null
  const pixels = (video: HTMLVideoElement) => {
    if (!canvas || canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight)
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(video, 0, 0)
    return context.getImageData(0, 0, video.videoWidth, video.videoHeight)
  }
  return {
    thread: 'main',
    async detect(video, t) {
      const started = performance.now()
      let result
      try {
        result = landmarker.detectForVideo(delegate === 'CPU' ? pixels(video) : video, t)
      } catch (error) {
        if (delegate !== 'GPU') throw error
        try { landmarker.close() } catch { /* already broken */ }
        delegate = 'CPU'
        landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'))
        result = landmarker.detectForVideo(pixels(video), t)
      }
      const image = result.landmarks[0]
      const world = result.worldLandmarks[0]
      const category = result.handedness[0]?.[0]
      return {
        delegate,
        inferenceMs: performance.now() - started,
        width: video.videoWidth,
        height: video.videoHeight,
        hand: image && world ? {
          image: image.map(({ x, y, z }) => ({ x, y, z })),
          world: world.map(({ x, y, z }) => ({ x, y, z })),
          score: category?.score ?? 0,
          handedness: category?.categoryName === 'Left' ? 'Left' : 'Right',
        } : null,
      }
    },
    close() {
      try { landmarker.close() } catch { /* ignore */ }
    },
  }
}

async function createDetector(): Promise<Detector> {
  if (typeof Worker === 'function' && typeof createImageBitmap === 'function') {
    try {
      return await createWorkerDetector()
    } catch (error) {
      console.warn('Hand Control: worker unavailable, tracking on the UI thread', error)
    }
  }
  try {
    return await createMainThreadDetector()
  } catch (error) {
    throw new HandTrackerError('model', error instanceof Error ? error.message : String(error))
  }
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
 * Local webcam → MediaPipe Hand Landmarker (in a worker). Frames are analysed in memory and
 * dropped; only landmark coordinates are passed on. At most one frame is in flight: if the
 * tracker falls behind, camera frames are skipped instead of queuing up (no growing lag).
 */
export class WebcamHandTracker {
  readonly video: HTMLVideoElement
  private stream: MediaStream | null = null
  private detector: Detector | null = null
  private running = false
  private busy = false
  private frameHandle = 0
  private lastProcessed = 0
  private frameCount = 0
  private emptyFrames = 0
  private fpsWindow: number[] = []
  private stats: TrackerStats = { fps: 0, inferenceMs: 0, delegate: 'GPU', width: 0, height: 0, thread: 'worker' }

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
    const detectorReady = createDetector()
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...(cameraId ? { deviceId: { exact: cameraId } } : {}), width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: TARGET_FPS, max: TARGET_FPS } },
      })
    } catch (error) {
      void detectorReady.then((detector) => detector.close(), () => {})
      throw cameraError(error)
    }
    try {
      this.detector = await detectorReady
      this.stats.thread = this.detector.thread
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
    this.detector?.close()
    this.detector = null
    this.busy = false
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.video.srcObject = null
    this.video.remove()
    this.fpsWindow = []
  }

  private fail(error: unknown) {
    this.stop()
    this.onFailure(error instanceof HandTrackerError ? error : new HandTrackerError('model', error instanceof Error ? error.message : String(error)))
  }

  private schedule() {
    if (!this.running) return
    if ('requestVideoFrameCallback' in this.video) this.frameHandle = this.video.requestVideoFrameCallback(() => this.tick())
    else this.frameHandle = requestAnimationFrame(() => this.tick())
  }

  private tick() {
    if (!this.running) return
    this.schedule()
    const now = performance.now()
    this.frameCount++
    const idle = this.emptyFrames > TARGET_FPS
    const due = now - this.lastProcessed >= 1000 / TARGET_FPS - 4 && (!idle || this.frameCount % IDLE_STRIDE === 0)
    if (this.busy || !due || this.video.readyState < 2 || !this.detector) return
    this.busy = true
    this.lastProcessed = now
    const detector = this.detector
    detector.detect(this.video, now).then((detection) => {
      if (!this.running || detector !== this.detector) return
      this.publish(now, detection)
    }, (error) => {
      if (this.running && detector === this.detector) this.fail(error)
    }).finally(() => { this.busy = false })
  }

  private publish(capturedAt: number, detection: Detection) {
    const finished = performance.now()
    this.stats.inferenceMs = this.stats.inferenceMs ? this.stats.inferenceMs * 0.9 + detection.inferenceMs * 0.1 : detection.inferenceMs
    this.stats.delegate = detection.delegate
    this.stats.width = detection.width
    this.stats.height = detection.height
    this.fpsWindow.push(finished)
    while (this.fpsWindow.length && finished - this.fpsWindow[0] > 1000) this.fpsWindow.shift()
    this.stats.fps = this.fpsWindow.length
    const hand = detection.hand
    if (!hand) {
      this.emptyFrames++
      this.onSample(null, { ...this.stats })
      return
    }
    this.emptyFrames = 0
    // A hand partly outside the frame is tracked less reliably: scale confidence down.
    const inFrame = hand.image.filter(({ x, y }) => x > 0.02 && x < 0.98 && y > 0.02 && y < 0.98).length / hand.image.length
    this.onSample({
      t: capturedAt,
      image: hand.image,
      world: hand.world,
      score: hand.score * inFrame,
      handedness: hand.handedness,
      frameWidth: detection.width,
      frameHeight: detection.height,
    }, { ...this.stats })
  }
}
