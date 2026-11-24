#!/usr/bin/env node
/**
 * src/data/documentGuidePhotos.json: the photos of where each battle pass document spawns (owner, 05.11.2026: «найди все
 * возможные фото спавна где находятся документы боевого пропуска на всех картах и добавь в описание каждой точки»): every
 * `…_spawn_<n>` photo of the EFT Wiki's eight document pages with its caption in both languages, by map and kind, and which
 * spot each one shows (scripts/document-guide-points.mjs). The wiki's maps are left out, as for the quests. The pictures are
 * not stored here: the server keeps a copy of every listed file (server/src/services/guideImages.ts).
 *
 *   node scripts/document-guide-photos.mjs
 * After a new list has reached the server, its new photos need cropping: scripts/crop-guide-photos.mjs (docs/linux-server.md).
 */
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { PHOTO_SPOTS, RU_CAPTIONS } from './document-guide-points.mjs'

const UA = 'RaidOS/1.0 (https://raidos.app)'
const OUT = new URL('../src/data/documentGuidePhotos.json', import.meta.url)
const PAGES = {
  financial: ['Financial documents', 'Финансовая документация'],
  medical: ['Medical documents', 'Медицинская документация'],
  blueprints: ['Blueprints and technical documentation', 'Чертежи и тех. документация'],
  'pmc-files': ['PMC personnel files', 'Личные данные ЧВК'],
  'user-docs': ['User documentation', 'Пользовательская документация'],
  'test-docs': ['Test documentation', 'Тестовая документация'],
  technical: ['Technical documentation', 'Эксплуатационная документация'],
  project: ['Project documentation', 'Проектная документация'],
}
const MAPS = {
  customs: 'customs', streets_of_tarkov: 'streets-of-tarkov', interchange: 'interchange', the_lab: 'the-lab', ground_zero: 'ground-zero',
  the_labyrinth: 'the-labyrinth', factory: 'factory', reserve: 'reserve', lighthouse: 'lighthouse', icebreaker: 'icebreaker', shoreline: 'shoreline', woods: 'woods',
}
const SPAWN = new RegExp(`_(${Object.keys(MAPS).join('|')})_spawn_(\\d+)\\.`, 'i')
const LINK = /<a href="(https:\/\/static\.wikia\.nocookie\.net\/[^"]+?\/images\/[^"]+?\/([^"/]+?\.(?:png|jpe?g|webp))\/revision\/latest[^"]*)"[^>]*class="mw-file-description image"[^>]*title="([^"]*)"/g

const clean = (text) => text.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

async function photosOn(host, title) {
  const url = `https://${host}/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&redirects=1`
  const answer = await (await fetch(url, { headers: { 'User-Agent': UA } })).json()
  if (!answer.parse) throw new Error(`${host}: no page «${title}»`)
  const found = new Map()
  for (const [, link, file, caption] of answer.parse.text['*'].matchAll(LINK)) found.set(decodeURIComponent(file), { link: link.replace(/&amp;/g, '&'), caption: clean(caption) })
  return found
}

const out = { files: {}, photos: {}, maps: {}, spots: {} }
const problems = []
const number = new Map()
for (const [kind, [en, ru]] of Object.entries(PAGES)) {
  const english = await photosOn('escapefromtarkov.fandom.com', en)
  const russian = await photosOn('escapefromtarkov.fandom.com/ru', ru)
  const rows = [...english].flatMap(([file, photo]) => {
    const match = SPAWN.exec(file)
    return match ? [{ file, photo, mapId: MAPS[match[1].toLowerCase()], n: Number(match[2]) }] : []
  }).sort((left, right) => left.mapId.localeCompare(right.mapId) || left.n - right.n)
  for (const { file, photo, mapId, n } of rows) {
    const id = createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 16)
    const captionRu = russian.get(file)?.caption || RU_CAPTIONS[file]
    if (!/[а-яё]/i.test(captionRu ?? '')) problems.push(`no Russian caption: ${file}`)
    if (!photo.caption) problems.push(`no caption: ${file}`)
    out.files[id] = { file, url: photo.link.replace('/revision/latest?', '/revision/latest/scale-to-width-down/1280?') }
    out.photos[id] = { kind, ru: captionRu ?? '', en: photo.caption }
    ;((out.maps[mapId] ??= {})[kind] ??= []).push(id)
    number.set(`${mapId}|${kind}|${n}`, id)
  }
}

for (const [mapId, kinds] of Object.entries(PHOTO_SPOTS)) {
  const spots = new Map()
  for (const [kind, photos] of Object.entries(kinds)) {
    for (const [n, places] of Object.entries(photos)) {
      const id = number.get(`${mapId}|${kind}|${n}`)
      if (!id) { problems.push(`no photo: ${mapId} ${kind} ${n}`); continue }
      for (const [x, z] of places) {
        const key = `${x},${z}`
        if (!spots.has(key)) spots.set(key, { x, z, photos: [] })
        spots.get(key).photos.push(id)
      }
    }
  }
  out.spots[mapId] = [...spots.values()]
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
writeFileSync(OUT, `${JSON.stringify(out)}\n`)
const placed = new Set(Object.values(out.spots).flat().flatMap((spot) => spot.photos))
console.log(`${Object.keys(out.files).length} photos, ${placed.size} of them on ${Object.values(out.spots).flat().length} points`)
