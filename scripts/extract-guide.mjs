#!/usr/bin/env node
/**
 * src/data/extractGuide.json: the text, floor and photos of each exit on the maps, by marker id. The texts are in
 * scripts/extract-guide-notes.mjs; this finds each exit's id in the catalog and each photo's address. The pictures themselves
 * are not stored here: the server keeps a copy of every listed file (server/src/services/guideImages.ts).
 *
 *   node scripts/extract-guide.mjs <the catalog's JSON (GET /v1/catalog/pvp)>
 * After a new list has reached the server, its new photos need cropping: scripts/crop-guide-photos.mjs (docs/linux-server.md).
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { EXIT_NOTES } from './extract-guide-notes.mjs'

const UA = 'RaidOS/1.0 (https://raidos.app)'
const APIS = ['https://escapefromtarkov.fandom.com/api.php', 'https://escapefromtarkov.fandom.com/ru/api.php']
const OUT = new URL('../src/data/extractGuide.json', import.meta.url)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const WHO = {
  pmc: { ru: 'Только для ЧВК.', en: 'PMCs only.' },
  scav: { ru: 'Только для Диких.', en: 'Scavs only.' },
  all: { ru: 'Для ЧВК и Диких.', en: 'For PMCs and Scavs.' },
}

const catalog = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const exits = catalog.markers.filter((marker) => marker.type === 'extract')
const out = { exits: {}, files: {} }
const missing = []
const unused = []
for (const [mapId, notes] of Object.entries(EXIT_NOTES)) {
  const here = exits.filter((marker) => marker.mapId === mapId)
  for (const [title, note] of Object.entries(notes)) {
    const matched = here.filter((marker) => marker.title === title)
    if (!matched.length) unused.push(`${mapId}: ${title}`)
    const photos = (note.files ?? []).map((file) => {
      const id = createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 16)
      out.files[id] = { file }
      return id
    })
    // The transits' rule of who may use them is in the same words as an exit's.
    const who = WHO[note.who]
    for (const marker of matched) {
      out.exits[marker.id] = {
        ru: [note.ru, who.ru].filter(Boolean).join(' '),
        en: [note.en, who.en].filter(Boolean).join(' '),
        ...(note.floor ? { floor: note.floor } : {}),
        ...(photos.length ? { photos } : {}),
      }
    }
  }
  for (const marker of here) if (!notes[marker.title]) missing.push(`${mapId}: ${marker.title}`)
}

const ids = Object.keys(out.files)
// Some files are only on the Russian pages.
for (const API of APIS) {
  const asking = ids.filter((id) => !out.files[id].url)
  for (let index = 0; index < asking.length; index += 50) {
  const chunk = asking.slice(index, index + 50)
  const query = new URLSearchParams({ format: 'json', formatversion: '2', action: 'query', prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '1280', titles: chunk.map((id) => `File:${out.files[id].file}`).join('|') })
  const answer = await (await fetch(`${API}?${query}`, { headers: { 'user-agent': UA } })).json()
  const renamed = new Map((answer.query?.normalized ?? []).map((entry) => [entry.to, entry.from]))
  for (const info of answer.query?.pages ?? []) {
    const asked = (renamed.get(info.title) ?? info.title).replace(/^File:/, '')
    const id = chunk.find((key) => out.files[key].file === asked || out.files[key].file.replace(/_/g, ' ') === asked.replace(/_/g, ' '))
    const image = info.imageinfo?.[0]
    if (id && image) out.files[id].url = image.thumburl ?? image.url
  }
  await sleep(400)
  }
}
const gone = ids.filter((id) => !out.files[id].url)
for (const id of gone) delete out.files[id]
for (const exit of Object.values(out.exits)) {
  if (!exit.photos) continue
  exit.photos = exit.photos.filter((id) => out.files[id])
  if (!exit.photos.length) delete exit.photos
}
writeFileSync(OUT, `${JSON.stringify(out)}\n`)
const list = Object.values(out.exits)
console.log(`exits in the catalog ${exits.length}, with a guide ${list.length}, with a text ${list.filter((exit) => exit.ru.split('. ').length > 1 || exit.ru.length > 20).length}, with photos ${list.filter((exit) => exit.photos).length}, files ${Object.keys(out.files).length}`)
console.log('no guide:', missing.join('; ') || 'none')
console.log('notes matching nothing:', unused.join('; ') || 'none')
console.log('files the wiki does not have:', gone.join(', ') || 'none')
