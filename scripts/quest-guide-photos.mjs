#!/usr/bin/env node
/**
 * Photos of the places in the quests' walkthroughs (owner, 28.10.2026: «по каждому квесту найти в интернете… фото места…
 * зайти в комнату такую-то и поднять предмет… найди фотографии и добавь их нам… сопоставь все квесты и задачи»).
 *
 * For every quest of tarkov.dev (json.tarkov.dev/regular/tasks) its EFT Wiki page (tarkov.dev's wikiLink): the pictures
 * of the walkthrough («Выполнение» on the Russian wiki, «Guide» on the English one) with their captions — Russian when
 * the Russian page has the same picture, English otherwise. A picture whose caption shares the words of one objective
 * (and only one) is tied to that objective; the rest belong to the quest. Item icons and maps of the whole location are
 * left out. The pictures themselves are not stored here: the server fetches each listed file from the wiki once and
 * serves it (server/src/routes/guideImages.ts).
 *
 *   node scripts/quest-guide-photos.mjs           → src/data/questGuidePhotos.json
 *   node scripts/quest-guide-photos.mjs --drop-maps   the same rules on the list as it is (no wiki requests)
 *
 * No maps (owner, 02.11.2026: «все фото мест для квестов - удали там фото с картами, там чужие карты … оставь только фото
 * конкретно мест»): a picture whose caption speaks of a map («…отмечено на карте», «marked on map») or whose file is named
 * one («PopulationCensusMap.png»), and the few maps found by eye with neither, are left out. A caption the Russian wiki
 * does not have comes from src/data/questGuideCaptionsRu.json (owner: «где то пишется на английском … что бы был перевод»).
 *
 * Wiki text and pictures: EFT Wiki contributors, CC BY-SA; the screenshots are of Escape from Tarkov (Battlestate Games).
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const UA = 'RaidOS/1.0 (https://raidos.app; raidosapp@gmail.com)'
const EN_API = 'https://escapefromtarkov.fandom.com/api.php'
const RU_API = 'https://escapefromtarkov.fandom.com/ru/api.php'
const OUT = new URL('../src/data/questGuidePhotos.json', import.meta.url)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const CAPTIONS_RU = JSON.parse(readFileSync(new URL('../src/data/questGuideCaptionsRu.json', import.meta.url), 'utf8'))

/** Maps with no word of it in the caption or the file name, found by looking at the pictures (02.11.2026). */
const MAP_FILES = new Set(['WoodsTransitToReserve.png', 'LighthouseTransitToShoreline.png', 'LexOsClaymoreOverview.png', 'Textile 1 and 2 locations.png'].map((file) => file.toLowerCase()))
const MAP_WORD_RU = /(^|[^а-яё])карт(а|е|у|ой|ы|ах|ами)?(?![а-яё])/i
const MAP_WORD_EN = /\bmaps?\b/i

/** A map rather than a screenshot of the place: by its caption, its file name or the list above. */
export function isMapPicture({ file, caption = '', captionEn = '' }) {
  return MAP_FILES.has(file.toLowerCase()) || /map/i.test(file) || MAP_WORD_RU.test(caption) || MAP_WORD_EN.test(caption) || MAP_WORD_EN.test(captionEn)
}

/** A caption in Russian: the Russian wiki's, else our translation of the English one. */
const russianCaption = (english) => CAPTIONS_RU[english] ?? english

async function getJson(url, params) {
  const query = new URLSearchParams({ format: 'json', formatversion: '2', ...params })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${url}?${query}`, { headers: { 'user-agent': UA } }).catch(() => null)
    if (response?.ok) return response.json()
    await sleep(1500 * (attempt + 1))
  }
  throw new Error(`${url} ${params.titles?.slice(0, 60) ?? ''}`)
}

/** Page text (and the Russian page's title) of up to 50 titles at once; the wiki follows redirects. */
async function pages(api, titles, withRu = false) {
  const out = new Map()
  for (let index = 0; index < titles.length; index += 50) {
    const chunk = titles.slice(index, index + 50)
    const answer = await getJson(api, { action: 'query', prop: withRu ? 'revisions|langlinks' : 'revisions', rvprop: 'content', rvslots: 'main', ...(withRu ? { lllang: 'ru', lllimit: 'max' } : {}), redirects: '1', titles: chunk.join('|') })
    const renamed = new Map([...(answer.query?.normalized ?? []), ...(answer.query?.redirects ?? [])].map((entry) => [entry.to, entry.from]))
    for (const page of answer.query?.pages ?? []) {
      let asked = page.title
      while (renamed.has(asked)) asked = renamed.get(asked)
      const text = page.revisions?.[0]?.slots?.main?.content ?? ''
      out.set(asked, { title: page.title, text, ru: page.langlinks?.[0]?.title })
    }
    await sleep(400)
  }
  return out
}

/** The walkthrough's pictures: gallery lines «File:Name.png|caption» and [[File:Name|thumb|caption]]; no icons. */
function walkthroughPictures(text) {
  const start = text.search(/==\s*(?:Guide|Выполнение|Прохождение)\s*==/i)
  if (start < 0) return []
  const rest = text.slice(start)
  const end = rest.slice(2).search(/\n==[^=]/)
  const section = end < 0 ? rest : rest.slice(0, end + 2)
  const pictures = []
  for (const gallery of section.matchAll(/<gallery[^>]*>([\s\S]*?)<\/gallery>/gi)) {
    for (const line of gallery[1].split('\n')) {
      const match = /^\s*(?:File|Файл|Изображение|Image):([^|\n]+?)\s*(?:\|(.*))?$/i.exec(line)
      if (match) pictures.push({ file: match[1].trim(), caption: clean(match[2] ?? '') })
    }
  }
  for (const match of section.matchAll(/\[\[(?:File|Файл|Изображение|Image):([^|\]]+)\|([^\]]*(?:\[\[[^\]]*\]\][^\]]*)*)\]\]/gi)) {
    const parts = match[2].split('|')
    if (!parts.some((part) => /^(?:thumb|thumbnail|мини|миниатюра)$/i.test(part.trim()))) continue
    pictures.push({ file: match[1].trim(), caption: clean(parts[parts.length - 1] ?? '') })
  }
  const seen = new Set()
  return pictures.filter((picture) => /\.(?:png|jpe?g|webp|gif)$/i.test(picture.file) && !seen.has(picture.file.toLowerCase()) && seen.add(picture.file.toLowerCase()))
}

function clean(value) {
  return value.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?|<[^>]+>|\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim()
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'on', 'in', 'at', 'of', 'to', 'a', 'an', 'is', 'location', 'marked', 'map', 'место', 'на', 'в', 'и', 'с', 'по', 'у', 'из', 'к', 'от', 'для', 'отмечен', 'отмечено', 'отмеченный', 'карте', 'локации', 'расположение'])
const words = (value) => new Set(value.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2 && !STOP.has(word)).map((word) => word.slice(0, 6)))

/** Objectives a picture of a place can be about: not handing over, not killing anywhere, not a skill or a level. */
const PLACE_TYPES = new Set(['visit', 'mark', 'plantItem', 'plantQuestItem', 'findQuestItem', 'findItem', 'extract', 'useItem', 'shoot'])

/**
 * The objective a picture shows: with one objective about a place, that one; otherwise the one whose words the caption
 * shares the most (more than any other; one word is enough when it is a name — a map, a building, an item).
 */
function objectiveFor(caption, objectives) {
  const places = objectives.filter((objective) => PLACE_TYPES.has(objective.type) && (objective.type !== 'shoot' || objective.zoned))
  if (places.length === 1) return places[0].id
  // A quest of one objective («Передать письмо»: the find is not an objective of its own) shows that one.
  if (!places.length && objectives.length === 1) return objectives[0].id
  const said = words(caption)
  if (!said.size || !places.length) return undefined
  const scored = places.map((objective) => ({ id: objective.id, score: [...words(objective.text)].filter((word) => said.has(word)).length }))
    .sort((a, b) => b.score - a.score)
  return scored[0] && scored[0].score >= 1 && scored[0].score > (scored[1]?.score ?? 0) ? scored[0].id : undefined
}

async function main() {
  const tasks = (await (await fetch('https://json.tarkov.dev/regular/tasks', { headers: { 'user-agent': UA } })).json()).data.tasks
  const ruNames = (await (await fetch('https://json.tarkov.dev/regular/tasks_ru', { headers: { 'user-agent': UA } })).json()).data
  const list = Array.isArray(tasks) ? tasks : Object.values(tasks)
  const titleOf = (task) => decodeURIComponent(String(task.wikiLink ?? '').replace(/^.*\/wiki\//, '').replace(/_/g, ' ')).trim()
  const english = await pages(EN_API, [...new Set(list.map(titleOf).filter(Boolean))], true)
  const russianTitles = [...new Set([...english.values()].map((page) => page.ru).filter(Boolean))]
  const russian = await pages(RU_API, russianTitles)
  const russianByTitle = new Map([...russian.values()].map((page) => [page.title, page]))

  const quests = {}
  const files = {}
  for (const task of list) {
    const page = english.get(titleOf(task))
    if (!page?.text) continue
    const ruPage = page.ru ? russianByTitle.get(page.ru) ?? russian.get(page.ru) : undefined
    const enPictures = walkthroughPictures(page.text)
    const ruPictures = ruPage ? walkthroughPictures(ruPage.text) : []
    const ruCaption = new Map(ruPictures.map((picture) => [picture.file.toLowerCase(), picture.caption]))
    const pictures = [...enPictures, ...ruPictures.filter((picture) => !enPictures.some((other) => other.file.toLowerCase() === picture.file.toLowerCase()))]
    if (!pictures.length) continue
    const objectives = (task.objectives ?? []).map((objective) => ({ id: objective.id, type: objective.type, zoned: Boolean(objective.zones?.length), text: `${ruNames[objective.description] ?? ''} ${objective.description ?? ''} ${(objective.questItem?.name ? ruNames[objective.questItem.name] ?? '' : '')}` }))
    const photos = pictures.filter((picture) => !isMapPicture({ file: picture.file, caption: ruCaption.get(picture.file.toLowerCase()) || '', captionEn: picture.caption })).map((picture) => {
      const id = createHash('sha1').update(picture.file.toLowerCase()).digest('hex').slice(0, 16)
      files[id] = { file: picture.file }
      const caption = ruCaption.get(picture.file.toLowerCase()) || russianCaption(picture.caption)
      const objectiveId = objectiveFor(`${caption} ${picture.caption}`, objectives)
      return { id, caption, ...(caption !== picture.caption && picture.caption ? { captionEn: picture.caption } : {}), ...(objectiveId ? { objectiveId } : {}) }
    })
    quests[task.id] = { wiki: ruPage ? `https://escapefromtarkov.fandom.com/ru/wiki/${encodeURIComponent(ruPage.title.replace(/ /g, '_'))}` : String(task.wikiLink), photos }
  }

  // Where each file is: the English wiki's file page gives its address (the Russian wiki shows the same files).
  const ids = Object.keys(files)
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50)
    const answer = await getJson(EN_API, { action: 'query', prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '1280', titles: chunk.map((id) => `File:${files[id].file}`).join('|') })
    const renamed = new Map((answer.query?.normalized ?? []).map((entry) => [entry.to, entry.from]))
    for (const info of answer.query?.pages ?? []) {
      const asked = (renamed.get(info.title) ?? info.title).replace(/^File:/, '')
      const id = chunk.find((key) => files[key].file === asked || files[key].file.replace(/_/g, ' ') === asked)
      const image = info.imageinfo?.[0]
      if (id && image) files[id] = { ...files[id], url: image.thumburl ?? image.url, width: image.thumbwidth ?? image.width, height: image.thumbheight ?? image.height }
    }
    await sleep(400)
  }
  // Pictures the wiki no longer has go.
  for (const quest of Object.values(quests)) quest.photos = quest.photos.filter((photo) => files[photo.id]?.url)
  for (const [id, quest] of Object.entries(quests)) if (!quest.photos.length) delete quests[id]
  const used = new Set(Object.values(quests).flatMap((quest) => quest.photos.map((photo) => photo.id)))
  for (const id of Object.keys(files)) if (!used.has(id)) delete files[id]

  const out = { source: 'EFT Wiki (escapefromtarkov.fandom.com), CC BY-SA; screenshots of Escape from Tarkov', builtAt: new Date().toISOString().slice(0, 10), quests, files }
  writeFileSync(OUT, `${JSON.stringify(out)}\n`)
  const photos = Object.values(quests).reduce((sum, quest) => sum + quest.photos.length, 0)
  const tied = Object.values(quests).reduce((sum, quest) => sum + quest.photos.filter((photo) => photo.objectiveId).length, 0)
  console.log(`quests with photos ${Object.keys(quests).length} / ${list.length}, photos ${photos}, tied to an objective ${tied}, files ${Object.keys(files).length}`)
}

/** The rules above on the list as it is: maps out, English-only captions translated, files no photo uses dropped. */
function dropMaps() {
  const out = JSON.parse(readFileSync(OUT, 'utf8'))
  let removed = 0
  let translated = 0
  for (const [id, quest] of Object.entries(out.quests)) {
    const before = quest.photos.length
    quest.photos = quest.photos.filter((photo) => !isMapPicture({ file: out.files[photo.id]?.file ?? '', caption: photo.caption, captionEn: photo.captionEn }))
    removed += before - quest.photos.length
    for (const photo of quest.photos) {
      if (photo.captionEn || !photo.caption || /[а-яё]/i.test(photo.caption) || !CAPTIONS_RU[photo.caption]) continue
      Object.assign(photo, { caption: CAPTIONS_RU[photo.caption], captionEn: photo.caption })
      translated += 1
    }
    if (!quest.photos.length) delete out.quests[id]
  }
  const used = new Set(Object.values(out.quests).flatMap((quest) => quest.photos.map((photo) => photo.id)))
  for (const id of Object.keys(out.files)) if (!used.has(id)) delete out.files[id]
  writeFileSync(OUT, `${JSON.stringify(out)}\n`)
  console.log(`maps removed ${removed}, captions translated ${translated}, quests with photos ${Object.keys(out.quests).length}, files ${Object.keys(out.files).length}`)
}

if (process.argv.includes('--drop-maps')) dropMaps()
else main().catch((error) => { console.error(error); process.exitCode = 1 })
