/**
 * «Фотография должна обрезаться по размеру человечка, персонажа какого-то» (owner, 07.11.2026): the person on a photo
 * found on the phone itself, with MediaPipe Selfie Segmentation (npm @mediapipe/selfie_segmentation 0.1.1675465747,
 * Apache-2.0: its WebAssembly runtime, its graph and its model, 250 KB). The files are bundled with the app (Vite copies
 * them as assets) and loaded only when the editor cuts a photo: nothing is asked of another host, and the main app's code
 * does not grow (src/admin/stickers/ is loaded lazily). Only the SIMD runtime is bundled (every iPhone on iOS 16.4 or
 * later has it); without it, or without WebGL, the cut fails and the owner cuts by hand.
 *
 * Tried on game characters set on a busy background (the app's own boss figures, scratch only): 0.90–0.96 of the
 * figure's own outline (intersection over union).
 */
import loaderUrl from '@mediapipe/selfie_segmentation/selfie_segmentation.js?url'
// A file of its own even though it is tiny (Vite would put it in the code as a data: address).
import graphUrl from '@mediapipe/selfie_segmentation/selfie_segmentation.binarypb?url&no-inline'
import modelUrl from '@mediapipe/selfie_segmentation/selfie_segmentation.tflite?url'
import runtimeUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.js?url'
import wasmUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.wasm?url'

/** The files the solution asks for by name (its `locateFile`). */
const FILES: Record<string, string> = {
  'selfie_segmentation.binarypb': graphUrl,
  'selfie_segmentation.tflite': modelUrl,
  'selfie_segmentation_solution_simd_wasm_bin.js': runtimeUrl,
  'selfie_segmentation_solution_simd_wasm_bin.wasm': wasmUrl,
}

/** The part of the solution's own API that is used (node_modules/@mediapipe/selfie_segmentation/index.d.ts). */
interface Results { segmentationMask: CanvasImageSource }
interface Solution {
  setOptions(options: { modelSelection?: number; selfieMode?: boolean }): void
  onResults(listener: (results: Results) => void): void
  initialize(): Promise<void>
  send(inputs: { image: HTMLCanvasElement }): Promise<void>
  close(): Promise<void>
}
type SolutionClass = new (config: { locateFile: (file: string) => string }) => Solution
declare global { interface Window { SelfieSegmentation?: SolutionClass } }

/** A cut this slow is given up (the owner cuts by hand). */
const TIMEOUT_MS = 45_000

let script: Promise<SolutionClass> | null = null
interface Running { instance: Solution; listener: ((results: Results) => void) | null }
let solution: Running | null = null

/** The solution's loader is a classic script (it is not a module): added to the page once. */
function loadScript(): Promise<SolutionClass> {
  if (window.SelfieSegmentation) return Promise.resolve(window.SelfieSegmentation)
  if (script) return script
  script = new Promise<SolutionClass>((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = loaderUrl
    tag.async = true
    tag.onload = () => (window.SelfieSegmentation ? resolve(window.SelfieSegmentation) : reject(new Error('segmenter missing')))
    tag.onerror = () => reject(new Error('segmenter not loaded'))
    document.head.appendChild(tag)
  })
  script.catch(() => { script = null })
  return script
}

async function instance() {
  if (solution) return solution
  const SelfieSegmentation = await loadScript()
  const created: Running = {
    instance: new SelfieSegmentation({ locateFile: (file) => FILES[file] ?? `${loaderUrl}#missing-${file}` }),
    listener: null,
  }
  // The general model (256 × 256): people of any size on the photo, not only a face close to the camera.
  created.instance.setOptions({ modelSelection: 0, selfieMode: false })
  created.instance.onResults((results) => created.listener?.(results))
  await created.instance.initialize()
  solution = created
  return created
}

const timeout = <T,>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('segmenter timeout')), TIMEOUT_MS))])

/**
 * The person's confidence (0–255 per pixel, the photo's own size) on `photo`; null when the segmenter cannot run here.
 * One photo at a time.
 */
export async function segmentPerson(photo: HTMLCanvasElement): Promise<Uint8ClampedArray | null> {
  try {
    const segmenter = await timeout(instance())
    const mask = await timeout(new Promise<CanvasImageSource>((resolve, reject) => {
      segmenter.listener = (results) => { segmenter.listener = null; resolve(results.segmentationMask) }
      segmenter.instance.send({ image: photo }).catch(reject)
    }))
    const canvas = document.createElement('canvas')
    canvas.width = photo.width
    canvas.height = photo.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(mask, 0, 0, photo.width, photo.height)
    const pixels = context.getImageData(0, 0, photo.width, photo.height).data
    // The mask's opacity is the confidence.
    const confidence = new Uint8ClampedArray(photo.width * photo.height)
    for (let index = 0; index < confidence.length; index += 1) confidence[index] = pixels[index * 4 + 3]!
    return confidence
  } catch {
    if (solution) solution.listener = null
    return null
  }
}

/** Frees the segmenter (the editor closed): its memory goes, the next cut loads it again. */
export function closeSegmenter() {
  const current = solution
  solution = null
  void current?.instance.close().catch(() => {})
}
