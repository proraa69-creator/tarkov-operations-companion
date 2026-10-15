/// <reference lib="webworker" />
// MediaPipe hand tracking off the UI thread: inference and model loading never block Raid OS.
// Frames arrive as transferred ImageBitmaps and are closed right after use; only landmark
// coordinates go back.
import { HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision'
import type { WorkerHand, WorkerRequest, WorkerResponse } from './workerProtocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
let landmarker: HandLandmarker | null = null
let delegate: 'GPU' | 'CPU' = 'GPU'
let base = ''
let numHands: 1 | 2 = 1
let canvas: OffscreenCanvas | null = null

const post = (message: WorkerResponse) => scope.postMessage(message)

async function create(kind: 'GPU' | 'CPU') {
  // Module workers cannot importScripts: use the ES-module build of the WASM loader.
  const fileset = { wasmLoaderPath: `${base}wasm/vision_wasm_module_internal.js`, wasmBinaryPath: `${base}wasm/vision_wasm_module_internal.wasm` }
  landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${base}hand_landmarker.task`, delegate: kind },
    runningMode: 'VIDEO',
    numHands,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  })
  delegate = kind
}

function pixels(bitmap: ImageBitmap) {
  if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0)
  return context.getImageData(0, 0, bitmap.width, bitmap.height)
}

function toHands(result: HandLandmarkerResult): WorkerHand[] {
  return result.landmarks.flatMap((image, index) => {
    const world = result.worldLandmarks[index]
    const category = result.handedness[index]?.[0]
    return world ? [{
      image: image.map(({ x, y, z }) => ({ x, y, z })),
      world: world.map(({ x, y, z }) => ({ x, y, z })),
      score: category?.score ?? 0,
      handedness: category?.categoryName === 'Left' ? 'Left' as const : 'Right' as const,
    }] : []
  })
}

async function fallBackToCpu() {
  try { landmarker?.close() } catch { /* already broken */ }
  landmarker = null
  await create('CPU')
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'init') {
    base = message.base
    numHands = message.numHands
    try {
      if (message.compute !== 'CPU') {
        try { await create('GPU') } catch { await create('CPU') }
      } else await create('CPU')
      post({ type: 'ready', delegate })
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  if (message.type === 'close') {
    try { landmarker?.close() } catch { /* ignore */ }
    landmarker = null
    return
  }
  const { bitmap, t, id } = message
  try {
    if (!landmarker) throw new Error('not ready')
    const started = performance.now()
    let result
    try {
      result = landmarker.detectForVideo(delegate === 'CPU' ? pixels(bitmap) : bitmap, t)
    } catch (error) {
      // The GPU graph may only fail at the first inference (no WebGL2 / driver issue).
      if (delegate !== 'GPU') throw error
      await fallBackToCpu()
      result = landmarker!.detectForVideo(pixels(bitmap), t)
    }
    post({
      type: 'result',
      id,
      delegate,
      inferenceMs: performance.now() - started,
      width: bitmap.width,
      height: bitmap.height,
      hands: toHands(result),
    })
  } catch (error) {
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  } finally {
    bitmap.close()
  }
}
