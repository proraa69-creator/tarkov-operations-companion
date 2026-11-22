#!/usr/bin/env node
/**
 * Builds the item key's picture index (src/overlay/signatureIndex.ts): the icon signature of every catalog item that can
 * lie in a stash, computed by the app's own code (src/overlay/iconSignature.ts) from the catalog icons, written to
 * public/item-signatures.bin (shipped with the app; the main process compares the item under the cursor with it).
 *
 *   node scripts/build-item-signatures.mjs                       # items from json.tarkov.dev, icons from raidos.app
 *   node scripts/build-item-signatures.mjs --icons <dir>         # icons already on disk (<id>-icon.webp) go first
 *   node scripts/build-item-signatures.mjs --items items.json --out public/item-signatures.bin
 *
 * Weapons and presets are left out (a modded gun does not look like its icon; the text finds those), so are items
 * without a size. Items whose icon cannot be had are left out too: the lookup then falls back to the text candidates.
 * Run again when the game adds items; the app works with an older index (new items just are not in it).
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const sharp = require('sharp')
// Node strips the types of these two (they have no runtime imports).
const { pictureSignature, iconArea } = await import(pathToFileURL(join(root, 'src/overlay/iconSignature.ts')).href)
const { encodeSignatureIndex, decodeSignatureIndex, indexable } = await import(pathToFileURL(join(root, 'src/overlay/signatureIndex.ts')).href)

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const out = resolve(option('out', join(root, 'public/item-signatures.bin')))
const iconsDir = option('icons', '')
const itemsFile = option('items', '')
const workers = Number(option('workers', '8'))
const ICON_BASES = ['https://raidos.app/v1/item-images/']

async function loadItems() {
  const raw = itemsFile ? JSON.parse(await readFile(itemsFile, 'utf8')) : await (await fetch('https://json.tarkov.dev/regular/items', { signal: AbortSignal.timeout(120_000) })).json()
  const root = raw.data ?? raw
  return Object.values(root.items ?? root)
}

async function iconBytes(item) {
  const file = `${item.id}-icon.webp`
  if (iconsDir && existsSync(join(iconsDir, file))) return { bytes: await readFile(join(iconsDir, file)), from: 'disk' }
  const urls = [...ICON_BASES.map((base) => base + file), ...(typeof item.iconLink === 'string' && item.iconLink.startsWith('https://assets.tarkov.dev/') ? [item.iconLink] : [])]
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (response.ok) return { bytes: Buffer.from(await response.arrayBuffer()), from: new URL(url).hostname }
    } catch { /* next source */ }
  }
  return null
}

const items = (await loadItems()).filter((item) => /^[0-9a-f]{24}$/.test(item.id ?? '') && item.width >= 1 && item.height >= 1
  && !(item.types ?? []).some((type) => type === 'gun' || type === 'preset'))
console.log(`items: ${items.length}`)
const records = []
const missing = []
const sources = {}
let next = 0
await Promise.all(Array.from({ length: workers }, async () => {
  while (next < items.length) {
    const item = items[next++]
    const icon = await iconBytes(item)
    if (!icon) { missing.push(item.id); continue }
    try {
      const { data, info } = await sharp(icon.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const pixels = { width: info.width, height: info.height, data: new Uint8Array(data), order: 'rgba', alpha: true }
      const record = { id: item.id, cols: item.width, rows: item.height, signature: pictureSignature(pixels, iconArea(info.width, info.height, item.width, item.height)) }
      if (!indexable(record)) { missing.push(item.id); continue }
      records.push(record)
      sources[icon.from] = (sources[icon.from] ?? 0) + 1
    } catch {
      missing.push(item.id)
    }
    if ((records.length + missing.length) % 500 === 0) console.log(`  ${records.length + missing.length} / ${items.length}`)
  }
}))
records.sort((a, b) => (a.id < b.id ? -1 : 1))
const bytes = encodeSignatureIndex(records)
// The file must read back to exactly what was computed.
const check = decodeSignatureIndex(bytes)
if (!check || check.items.length !== records.length || check.items.some((item, index) => item.signature.steps !== records[index].signature.steps || item.signature.colors.join() !== records[index].signature.colors.join())) throw new Error('index does not read back')
await writeFile(out, bytes)
console.log(`written ${out}: ${records.length} items, ${bytes.length} bytes; icons ${JSON.stringify(sources)}; missing ${missing.length}${missing.length ? ` (${missing.slice(0, 10).join(', ')}…)` : ''}`)
