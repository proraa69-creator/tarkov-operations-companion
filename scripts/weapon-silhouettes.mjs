#!/usr/bin/env node
/**
 * Silhouettes of the weapon pictures for «Сборка оружия» (src/arsenal/weaponAnchors.ts): the callouts point at the place
 * of each part on the default build's 512 px picture (tarkov.dev `<preset id>-512.webp`, muzzle on the left). No data
 * source gives part positions, so the opaque outline of every picture is sampled once: for SILHOUETTE_COLUMNS columns,
 * the top and bottom of the weapon (0…255 of the picture height), plus the picture's aspect ratio.
 *
 *   node scripts/weapon-silhouettes.mjs <json.tarkov.dev regular/items file> [out]
 *
 * Re-run when weapons are added; weapons missing from the file get evenly spread callouts.
 */
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const SILHOUETTE_COLUMNS = 48
const ALPHA = 40
const NON_BULLET = new Set(['Caliber40x46', 'Caliber40mmRU', 'Caliber26x75', 'Caliber30x29'])
const CLASSES = new Set(['assault-rifle', 'assault-carbine', 'smg', 'handgun', 'revolver', 'shotgun', 'marksman-rifle', 'sniper-rifle', 'machinegun'])

const [, , source, out = 'src/arsenal/weaponSilhouettes.json'] = process.argv
if (!source) { console.error('usage: node scripts/weapon-silhouettes.mjs <items.json> [out]'); process.exit(1) }
const root = JSON.parse(await readFile(source, 'utf8'))
const data = root.data ?? root
const items = data.items
const categories = data.itemCategories ?? {}

const weapons = Object.values(items).filter((item) => {
  if (!item.types?.includes('gun') || item.types.includes('preset')) return false
  const category = categories[item.categories?.[0]]
  return CLASSES.has(category?.normalizedName) && !NON_BULLET.has(item.properties?.caliber)
})

async function silhouette(id) {
  const response = await fetch(`https://assets.tarkov.dev/${id}-512.webp`)
  if (!response.ok) return undefined
  const { data: pixels, info } = await sharp(Buffer.from(await response.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cols = []
  for (let column = 0; column < SILHOUETTE_COLUMNS; column++) {
    const x0 = Math.floor(column * info.width / SILHOUETTE_COLUMNS)
    const x1 = Math.max(x0 + 1, Math.floor((column + 1) * info.width / SILHOUETTE_COLUMNS))
    let top = -1
    let bottom = -1
    for (let y = 0; y < info.height; y++) {
      for (let x = x0; x < x1; x++) {
        if (pixels[(y * info.width + x) * 4 + 3] > ALPHA) { if (top < 0) top = y; bottom = y; break }
      }
    }
    cols.push(top < 0 ? [] : [Math.round(top * 255 / (info.height - 1)), Math.round(bottom * 255 / (info.height - 1))])
  }
  return { ratio: Math.round(info.width / info.height * 1000) / 1000, cols }
}

const result = {}
for (const weapon of weapons) {
  const presetId = weapon.properties?.defaultPreset
  const picture = presetId ?? weapon.id
  const shape = await silhouette(picture).catch(() => undefined)
  if (shape) result[picture] = shape
  else console.warn('no picture', weapon.id, picture)
}
await writeFile(out, JSON.stringify(result) + '\n')
console.log(`${Object.keys(result).length} of ${weapons.length} weapons → ${out}`)
