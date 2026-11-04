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
 *   node scripts/quest-guide-photos.mjs --link-places  ties the photos on the list to objectives by the wiki's own headings
 *
 * Each place of a walkthrough stands under its own heading (owner, 04.11.2026, «Что-то мне это напоминает…», 40 photos, 27
 * places: «у каждого места должны быть свои фотографии. Разберись, в каком месте какие фотографии. А не просто рандомно
 * раскидай»): a photo with no words of its own takes the words of the heading above it. A file shown under two headings
 * belongs to both places (`alsoFor`). A photo whose place is not clear stays with the whole quest, never a guess.
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

/**
 * What the walkthrough says around each picture: the nearest heading above it («====Vet clinic====», a line of bold text),
 * the text between that heading and the gallery, its own caption. A file used twice gets both.
 */
export function walkthroughPlaces(text) {
  const start = text.search(/==\s*(?:Guide|Выполнение|Прохождение)\s*==/i)
  const places = new Map()
  if (start < 0) return places
  const rest = text.slice(start)
  const end = rest.slice(2).search(/\n==[^=]/)
  const section = (end < 0 ? rest : rest.slice(0, end + 2)).split('\n').slice(1)
  let heading = ''
  let notes = []
  let afterPicture = false
  const add = (file, caption) => {
    const key = file.trim().toLowerCase()
    places.set(key, [...(places.get(key) ?? []), { heading, notes: notes.join(' '), caption: clean(caption ?? '') }])
    afterPicture = true
  }
  let table = false
  for (const raw of section) {
    const line = raw.trim()
    if (line.startsWith('{|')) { table = true; continue }
    if (line.startsWith('|}')) { table = false; continue }
    if (table || !line) continue
    const titled = /^={2,}\s*(.+?)\s*={2,}$/.exec(line) ?? /^[*#;:\s]*'''(.+?)'''\s*:?$/.exec(line) ?? /^;\s*(.+)$/.exec(line)
    if (titled) { heading = clean(titled[1]); notes = []; afterPicture = false; continue }
    const listed = /^(?:<[^>]+>)*\s*(?:File|Файл|Изображение|Image):([^|\n<]+?)\s*(?:\|(.*?))?\s*(?:<\/gallery>.*)?$/i.exec(line)
    if (listed) { add(listed[1], listed[2]); continue }
    const inline = [...line.matchAll(/\[\[(?:File|Файл|Изображение|Image):([^|\]]+)\|([^\]]*(?:\[\[[^\]]*\]\][^\]]*)*)\]\]/gi)].filter((match) => match[2].split('|').some((part) => /^(?:thumb|thumbnail|мини|миниатюра)$/i.test(part.trim())))
    for (const match of inline) add(match[1], match[2].split('|').at(-1))
    const words = clean(line.replace(/\[\[(?:File|Файл|Изображение|Image):[^\]]*\]\]/gi, ''))
    if (!words || /^<\/?(?:gallery|li)/i.test(line)) continue
    // Text after a picture starts the next step of the same place.
    if (afterPicture) { notes = []; afterPicture = false }
    notes.push(words)
  }
  return places
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

/** Words that say nothing about a place by themselves: «Cargo on the first floor» is not the first cargo. */
const COMMON = new Set(['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'sevent', 'eighth', 'room', 'rooms', 'floor', 'door', 'doors', 'buildi', 'area', 'side', 'level', 'locati', 'spot', 'inside', 'outsid', 'перв', 'первый', 'первая', 'первую', 'первом', 'второй', 'вторая', 'вторую', 'втором', 'третий', 'третья', 'третью', 'третье', 'четвер', 'пятый', 'пятую', 'комнат', 'этаж', 'этаже', 'этажа', 'дверь', 'двери', 'дверью', 'здание', 'здании'])

/**
 * The objective these words are about: a word counts for less the more objectives of the quest share it («Установить»,
 * «Камеру»), one objective must come out ahead of every other, and at least one word of it must be more than a common one.
 * `named`: how many such words it shares.
 */
export function bestObjective(said_, objectives) {
  const said = words(said_)
  if (!said.size || !objectives.length) return undefined
  const texts = objectives.map((objective) => ({ id: objective.id, words: words(objective.text) }))
  const share = (word) => texts.filter((entry) => entry.words.has(word)).length
  const scored = texts.map((entry) => {
    const shared = [...entry.words].filter((word) => said.has(word))
    return { id: entry.id, named: shared.filter((word) => !COMMON.has(word)).length, score: shared.reduce((sum, word) => sum + (share(word) === texts.length && texts.length > 1 ? 0 : 1 / share(word)), 0) }
  }).sort((a, b) => b.score - a.score)
  return scored[0].score > 0 && scored[0].named > 0 && scored[0].score > (scored[1]?.score ?? 0) ? scored[0] : undefined
}

/**
 * The objectives a picture shows, from what the walkthrough says around it: its place's heading (with the text under it
 * when the heading alone does not tell), and its caption, which overrules the heading only with two words of its own
 * («Walk down the corridor and go through the second door» under «X-ray technician's room» is not the second pharmacy).
 * The text before the first heading is about the whole quest: it names every place, so it decides nothing.
 */
export function objectivesOfPicture(contexts, objectives) {
  const places = objectives.filter((objective) => PLACE_TYPES.has(objective.type) && (objective.type !== 'shoot' || objective.zoned))
  if (places.length === 1) return [places[0].id]
  if (!places.length && objectives.length === 1) return [objectives[0].id]
  const found = contexts.map((context) => {
    const caption = bestObjective(context.caption, places)
    const heading = context.heading ? bestObjective(context.heading, places) ?? bestObjective(`${context.heading} ${context.notes}`, places) : undefined
    return caption && heading && caption.id !== heading.id && caption.named < 2 ? heading.id : (caption ?? heading)?.id
  })
  return [...new Set(found.filter(Boolean))]
}

/** Read by eye (04.11.2026): numbered places whose numbers the wiki and the game count differently. */
const UNCLEAR_QUESTS = new Set([
  '675c15fbf7da9792a4059871', // Обеспечить просмотры
  '675c03d1f7da9792a405549a', // Брошенный груз
])
/** And single places the words get wrong, by their heading or caption. */
const UNCLEAR_PLACES = [
  ['66aba85403e0ee3101042877', "The Lab to Streets of Tarkov"], // Непарадный Тарков: the same words as the way back
  ['608974af4b05530f55550c21', "Eastern Barracks - Black Pawn"], // Знаток Резерва: a whole building with three objectives
  ['63966fbeea19ac7ed845db2e', "First hideout"], // Пропавший информатор: the objective speaks of the spare one
  ['5936da9e86f7742d65037edf', "The tanker truck"], // Проверка на вшивость: matched the key, not the place
]
const isUnclear = (questId, contexts) => UNCLEAR_QUESTS.has(questId) || contexts.some((context) => UNCLEAR_PLACES.some(([id, text]) => id === questId && (context.heading === text || context.caption === text)))

/** Ties the photos on the list to objectives. Nothing else changes: the same photos, the same captions. */
async function linkPlaces() {
  const out = JSON.parse(readFileSync(OUT, 'utf8'))
  const tasks = (await (await fetch('https://json.tarkov.dev/regular/tasks', { headers: { 'user-agent': UA } })).json()).data.tasks
  const ruNames = (await (await fetch('https://json.tarkov.dev/regular/tasks_ru', { headers: { 'user-agent': UA } })).json()).data
  // An objective's `description` is a key of these lists; the English wiki's headings speak the English one.
  const enNames = (await (await fetch('https://json.tarkov.dev/regular/tasks_en', { headers: { 'user-agent': UA } })).json()).data
  const list = (Array.isArray(tasks) ? tasks : Object.values(tasks)).filter((task) => out.quests[task.id])
  const titleOf = (task) => decodeURIComponent(String(task.wikiLink ?? '').replace(/^.*\/wiki\//, '').replace(/_/g, ' ')).trim()
  const english = await pages(EN_API, [...new Set(list.map(titleOf).filter(Boolean))], true)
  const russian = await pages(RU_API, [...new Set([...english.values()].map((page) => page.ru).filter(Boolean))])
  const russianByTitle = new Map([...russian.values()].map((page) => [page.title, page]))
  let linked = 0
  let also = 0
  let kept = 0
  for (const task of list) {
    const quest = out.quests[task.id]
    const page = english.get(titleOf(task))
    const ruPage = page?.ru ? russianByTitle.get(page.ru) ?? russian.get(page.ru) : undefined
    if (!page?.text) continue
    const en = walkthroughPlaces(page.text)
    const ru = ruPage ? walkthroughPlaces(ruPage.text) : new Map()
    const objectives = (task.objectives ?? []).map((objective) => ({ id: objective.id, type: objective.type, zoned: Boolean(objective.zones?.length), text: `${ruNames[objective.description] ?? ''} ${enNames[objective.description] ?? ''} ${(objective.questItem?.name ? `${ruNames[objective.questItem.name] ?? ''} ${enNames[objective.questItem.name] ?? ''}` : '')}` }))
    for (const photo of quest.photos) {
      // A link its own caption gave stays: a caption says more than a heading.
      if (photo.objectiveId) { kept += 1; continue }
      const name = String(out.files[photo.id]?.file ?? '').toLowerCase()
      const contexts = [...(en.get(name) ?? []), ...(ru.get(name) ?? [])]
      if (isUnclear(task.id, contexts)) continue
      const fromEn = objectivesOfPicture(en.get(name) ?? [], objectives)
      const ids = fromEn.length ? fromEn : objectivesOfPicture(ru.get(name) ?? [], objectives)
      if (!ids.length) continue
      photo.objectiveId = ids[0]
      linked += 1
      if (ids.length > 1) { photo.alsoFor = ids.slice(1); also += 1 }
    }
  }
  writeFileSync(OUT, `${JSON.stringify(out)}\n`)
  const photos = Object.values(out.quests).reduce((sum, quest) => sum + quest.photos.length, 0)
  console.log(`photos ${photos}, tied by the walkthrough ${linked} (of them to several places ${also}), kept from before ${kept}`)
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
else if (process.argv.includes('--link-places')) linkPlaces().catch((error) => { console.error(error); process.exitCode = 1 })
else main().catch((error) => { console.error(error); process.exitCode = 1 })
