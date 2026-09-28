import { createRequire } from 'node:module'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { createWorker } = require('tesseract.js')

const langPath = process.argv[2]
const framesDir = new URL('./frames/', import.meta.url)
const worker = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
await worker.setParameters({ tessedit_pageseg_mode: '6' })
const out = {}
for (const name of readdirSync(framesDir).filter((file) => file.endsWith('.png')).sort()) {
  const { data } = await worker.recognize(readFileSync(join(fileURLToPath(framesDir), name)))
  out[name] = data.text
  console.log('=====', name)
  console.log(data.text)
}
writeFileSync(new URL('./frames-ocr.json', import.meta.url), JSON.stringify(out, null, 2))
await worker.terminate()
