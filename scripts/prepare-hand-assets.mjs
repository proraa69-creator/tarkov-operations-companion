// Prepares the local assets for the Hand Control test edition: MediaPipe WASM runtime
// (from node_modules) and the hand landmark model (downloaded once, checksum-verified).
// Output goes to public-hand/, which only `vite --mode handtest` uses as its public dir.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public-hand', 'hand-control')
const wasmSource = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
const MODEL_SHA256 = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'
const modelPath = join(out, 'hand_landmarker.task')

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

await mkdir(join(out, 'wasm'), { recursive: true })
for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  await copyFile(join(wasmSource, file), join(out, 'wasm', file))
}

const existing = await readFile(modelPath).catch(() => null)
if (existing && sha256(existing) === MODEL_SHA256) {
  console.log('hand-control: model is up to date')
} else {
  const source = process.env.HAND_MODEL_FILE
  const model = source ? await readFile(source) : Buffer.from(await (await fetch(MODEL_URL)).arrayBuffer())
  const digest = sha256(model)
  if (digest !== MODEL_SHA256) throw new Error(`hand-control: model checksum mismatch (${digest})`)
  await writeFile(modelPath, model)
  console.log('hand-control: model saved')
}
console.log(`hand-control: assets ready in ${out}`)
