// Removes the background from boss artwork with a local model.
// Usage: node scripts/cutout-boss-posters.mjs <srcDir> <outDir> <file ...>
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { removeBackground } from '@imgly/background-removal-node'

const [src, out, ...files] = process.argv.slice(2)
await mkdir(out, { recursive: true })

for (const file of files) {
  const started = Date.now()
  const type = extname(file) === '.png' ? 'image/png' : 'image/jpeg'
  const blob = new Blob([await readFile(join(src, file))], { type })
  const result = await removeBackground(blob, { model: 'medium', output: { format: 'image/png' } })
  await writeFile(join(out, `${file.replace(/\.\w+$/, '')}.png`), Buffer.from(await result.arrayBuffer()))
  console.log('cutout', file, `${Date.now() - started} ms`)
}
