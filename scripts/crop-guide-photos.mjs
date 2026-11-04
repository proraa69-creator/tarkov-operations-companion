#!/usr/bin/env node
/**
 * Cuts the game's version text and the «screenshot saved to C:\Users\…» line off the exit and quest photos our server keeps
 * (owner, 05.11.2026: «на всех скриншотах выходов и квестов, обрежь эти места, что бы не было видно пути скриншота и версии
 * таркова»). Both sit along the bottom edge of a game screenshot, so a screenshot loses its bottom strip.
 *
 *   node scripts/crop-guide-photos.mjs <folder with the photos> [--dry-run]
 *   on the VPS: /var/lib/raidos/map-mirror/images/guides, as raidos-api, from the app's folder (it needs sharp)
 *
 * Run it again after a new photo list reached the server (quest-guide-photos.mjs, extract-guide.mjs): the server downloads
 * new photos as they are and never changes them. It takes only what `<folder>-cropped.json` does not list yet and keeps each
 * original in `<folder>-original`. When pictures already sent change, raise PICTURES_EDITION in src/data/guidePhotoUrl.ts.
 *
 * What it does not touch: photos no list names, other names than wiki-<id> (the «Оружейник» screenshots), and anything not
 * shaped like a screenshot (cards, tall pictures) unless scripts/guide-photo-crops.json names it. That file holds the
 * exceptions found by looking at the pictures: { "<id>": { "bottom": 0.08 } } cuts another share, { "<id>": {} } none.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/**
 * The share of a screenshot's height that goes. Read on all 1 044 listed photos on 05.11.2026 (OCR, and the highest ones by
 * eye): the version begins at about 97.7% of the height, the path's plate at about 95.5%; one higher plate is an exception.
 */
export const BOTTOM = 0.06
const PHOTO = /^wiki-([0-9a-f]+)(-t)?\.[a-z]+$/
const LISTS = ['extractGuide.json', 'questGuidePhotos.json', 'eventGuidePhotos.json']

/** 16:9 and 16:10, the game's own frames; an editor's cut of a frame has lost these lines with its edge. */
export const isScreenshotShape = (width, height) => {
  const ratio = width / height
  return ratio >= 1.55 && ratio <= 1.82
}

/** How much of this picture's height goes, 0 for nothing. */
export function bottomToCut(id, width, height, exceptions) {
  const exception = exceptions[id]
  if (exception) return exception.bottom ?? 0
  return isScreenshotShape(width, height) ? BOTTOM : 0
}

/** The same format the picture has: the names do not say (a «.png» from the wiki is usually WebP). */
function encoder(image, format) {
  if (format === 'webp') return image.webp({ quality: 88 })
  if (format === 'jpeg') return image.jpeg({ quality: 90 })
  return image.png()
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const folder = args.find((arg) => !arg.startsWith('--'))?.replace(/[\\/]+$/, '')
  if (!folder || !existsSync(folder)) throw new Error('Name the folder with the photos')
  const here = dirname(fileURLToPath(import.meta.url))
  const exceptions = JSON.parse(readFileSync(join(here, 'guide-photo-crops.json'), 'utf8'))
  const listed = new Set(LISTS.flatMap((list) => Object.keys(JSON.parse(readFileSync(join(here, '..', 'src', 'data', list), 'utf8')).files)))
  const ledgerFile = `${folder}-cropped.json`
  const originals = `${folder}-original`
  const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : {}
  if (!dryRun) mkdirSync(originals, { recursive: true })
  const counts = { cut: 0, left: 0, before: 0, unlisted: 0 }
  const files = readdirSync(folder).filter((name) => PHOTO.test(name)).sort()
  // A thumbnail follows its full picture's verdict: both must lose the same share, or neither.
  const verdicts = new Map()
  for (const name of files) {
    const [, id, thumb] = PHOTO.exec(name)
    if (thumb || !listed.has(id)) continue
    const { width, height } = await sharp(readFileSync(join(folder, name))).metadata()
    verdicts.set(id, bottomToCut(id, width, height, exceptions))
  }
  for (const name of files) {
    if (ledger[name] !== undefined) { counts.before += 1; continue }
    const id = PHOTO.exec(name)[1]
    if (!listed.has(id)) { counts.unlisted += 1; continue }
    const file = join(folder, name)
    const bytes = readFileSync(file)
    const { width, height, format } = await sharp(bytes).metadata()
    const bottom = verdicts.get(id) ?? bottomToCut(id, width, height, exceptions)
    if (bottom > 0) {
      const keep = Math.max(1, Math.floor(height * (1 - bottom)))
      if (!dryRun) {
        const cropped = await encoder(sharp(bytes).extract({ left: 0, top: 0, width, height: keep }), format).toBuffer()
        if (!existsSync(join(originals, name))) copyFileSync(file, join(originals, name))
        writeFileSync(`${file}.tmp`, cropped)
        renameSync(`${file}.tmp`, file)
      }
      counts.cut += 1
    } else {
      counts.left += 1
    }
    ledger[name] = bottom
  }
  if (!dryRun) writeFileSync(ledgerFile, `${JSON.stringify(ledger)}\n`)
  console.log(`${basename(folder)}: ${counts.cut} cropped, ${counts.left} left as they are, ${counts.before} done before, ${counts.unlisted} not on any list${dryRun ? ' (dry run, nothing written)' : ''}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(String(error)); process.exit(1) })
}
