import { MAP_DISPLAY_NAMES, canonicalMapId } from './mapIds'
import type { Quest, QuestStage } from '../domain/types'
import { cleanQuestText, isCleanText } from '../shared/questText'

export function normalizeQuestKey(value: string) {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '')
}

const MAP_NAME_MATCHERS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'ground-zero', pattern: /эпицентр|ground\s*zero/i },
  { id: 'customs', pattern: /таможн/i },
  { id: 'factory', pattern: /завод/i },
  { id: 'woods', pattern: /лес\b|woods/i },
  { id: 'shoreline', pattern: /берег|shoreline|побереж/i },
  { id: 'interchange', pattern: /развязк|interchange/i },
  { id: 'reserve', pattern: /резерв/i },
  { id: 'lighthouse', pattern: /маяк|lighthouse/i },
  { id: 'streets-of-tarkov', pattern: /улиц[ыа].*тарков|streets/i },
  { id: 'the-lab', pattern: /лаборатор/i },
  { id: 'the-labyrinth', pattern: /лабиринт/i },
  { id: 'terminal', pattern: /терминал/i },
  { id: 'icebreaker', pattern: /ледокол|icebreaker/i },
]

const LANDMARK_HINT = /интерком|вышк|санатор|общежит|антенн|бензовоз|серверн|офис|причал|маяк|терминал|лаборатор|водосток|накопитель/gi
const GENERIC_DESCRIPTION = /^задание от торговца/i
const STAGE_SKIP_HEADING = /^(награды?|примечани|решени|галере|видео|интересн|ссылки)/i
const OBJECTIVE_ID = /^[0-9a-f-]{16,}$/i
const SKIP_STORY_TITLE = /^(escape from tarkov|концовки|сюжетные истории|квестовые предметы)/i

export interface WikiQuestPage {
  title: string
  description: string
  trader: string
  locationMaps: string[]
  /** Only the infobox «Локация» field — walkthrough text mentions maps that are not quest locations. */
  infoboxMaps?: string[]
  objectives: string[]
  rewards: string[]
  previousTitles: string[]
  nextTitles: string[]
  stages: QuestStage[]
}

export function wikiQuestUrl(title: string) {
  return `https://escapefromtarkov.fandom.com/ru/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

export function parseWikiQuestPage(title: string, wikitext: string): WikiQuestPage {
  const infobox = extractInfobox(wikitext)
  // Only the trader quote is a description; the first article line is infobox or header junk.
  const quote = balancedTemplateBody(wikitext, /\{\{\s*(?:Цитаты|Цитата|Quote)\s*\|/i)
  const quoteText = quote ? cleanQuestText(quote) : ''
  const description = isCleanText(quoteText) ? quoteText : ''
  const infoboxMaps = mapsFromText(infobox.location ?? '')
  const locationMaps = infobox.location ? infoboxMaps : mapsFromText(title)
  const objectives = parseListSection(wikitext, /^(цел|задач)/i)
  const rewards = parseListSection(wikitext, /наград/i)
  const stages = parseExecutionStages(title, wikitext)
  const fallbackStages = stages.length ? stages : objectivesToStages(title, objectives, locationMaps)
  return {
    title,
    description,
    trader: stripWiki(infobox['given by'] || infobox.givenby || ''),
    locationMaps: unique([
      ...locationMaps,
      ...fallbackStages.flatMap((stage) => stage.mapIds),
    ]),
    infoboxMaps,
    objectives: objectives.length ? objectives : fallbackStages.map((stage) => stage.title),
    rewards,
    previousTitles: wikiLinks(infobox.previous),
    nextTitles: wikiLinks(infobox['leads to'] || infobox.leadsto),
    stages: fallbackStages,
  }
}

export function parseStoryIndex(wikitext: string): Array<{ title: string; english: string; order: number }> {
  const rows: Array<{ title: string; english: string; order: number }> = []
  const table = wikitext.match(/\{\|[\s\S]*?\|\}/)?.[0] ?? wikitext
  const chunks = table.split(/\|-\s*/).slice(1)
  for (const chunk of chunks) {
    const links = wikiLinks(chunk)
    const title = links.find((link) => !SKIP_STORY_TITLE.test(link) && !/^file:/i.test(link))
    const english = chunk.match(/\n\|([A-Za-z][A-Za-z0-9' -]{1,40})\s*(?:\n|$)/)?.[1]?.trim() ?? ''
    if (!title || SKIP_STORY_TITLE.test(title)) continue
    rows.push({ title, english, order: rows.length + 1 })
  }
  return rows
}

export function storyQuestFromPage(page: WikiQuestPage, order: number, english = ''): Quest {
  const slug = storySlug(page.title, english)
  const mapIds = unique(page.locationMaps.length ? page.locationMaps : page.stages.flatMap((stage) => stage.mapIds))
  return {
    id: `story-${slug}`,
    normalizedName: slug,
    name: displayStoryTitle(page.title),
    trader: 'Глава истории',
    kind: 'story',
    storyOrder: order,
    mapId: mapIds[0],
    mapIds,
    level: 1,
    kappa: false,
    description: page.description || 'Сюжетная глава Escape from Tarkov.',
    objectives: page.objectives,
    stages: page.stages.map((stage, index) => ({
      ...stage,
      id: stage.id || `story-${slug}-${index}`,
    })),
    rewards: page.rewards,
    wikiLink: wikiQuestUrl(page.title),
  }
}

export function mergeWikiQuestDetails(quests: Quest[], pages: WikiQuestPage[]): Quest[] {
  const merged = quests.map((quest) => ({ ...quest }))
  const byKey = indexQuests(merged)
  for (const page of pages) {
    const quest = byKey.get(normalizeQuestKey(page.title))
      ?? byKey.get(normalizeQuestKey(displayStoryTitle(page.title)))
    if (!quest || quest.kind === 'story') continue
    if (isCleanText(page.description) && (!quest.description || GENERIC_DESCRIPTION.test(quest.description))) {
      quest.description = page.description
    }
    if (page.objectives.length && !hasPlayableObjectives(quest.objectives)) {
      quest.objectives = page.objectives
    }
    // Objective maps from tarkov.dev are authoritative; the Wiki only fills quests that have none.
    const wikiMaps = page.infoboxMaps ?? []
    if (!quest.mapIds?.length && !quest.mapId && !quest.anyMap && wikiMaps.length) {
      quest.mapIds = wikiMaps
      quest.mapId = wikiMaps[0]
    }
    quest.wikiLink = quest.wikiLink || wikiQuestUrl(page.title)
    const previous = page.previousTitles.map((title) => byKey.get(normalizeQuestKey(title))?.id).filter((id): id is string => Boolean(id))
    if (previous.length && !quest.previous?.length) quest.previous = previous
  }
  return merged
}

export function mergeStoryChapters(quests: Quest[], chapters: Quest[]): Quest[] {
  const merged = quests.map((quest) => ({ ...quest }))
  const byKey = indexQuests(merged)
  for (const chapter of chapters) {
    const existing = byKey.get(normalizeQuestKey(chapter.name))
    if (existing) {
      existing.kind = 'story'
      existing.storyOrder = chapter.storyOrder
      existing.trader = existing.trader && existing.trader !== 'Неизвестный торговец' ? existing.trader : 'Глава истории'
      existing.stages = chapter.stages
      existing.wikiLink = existing.wikiLink || chapter.wikiLink
      if (!hasPlayableObjectives(existing.objectives)) existing.objectives = chapter.objectives
      if (!existing.description || GENERIC_DESCRIPTION.test(existing.description)) existing.description = chapter.description
      existing.mapIds = unique([...(existing.mapIds ?? []), ...(chapter.mapIds ?? [])])
      existing.mapId = existing.mapId ?? chapter.mapId
      continue
    }
    merged.push(chapter)
    byKey.set(normalizeQuestKey(chapter.name), chapter)
  }
  // Chapters are not one linear chain — each has its own unlock condition, so no implied `previous`.
  return merged
}

export function mapsFromText(value: string) {
  const maps: string[] = []
  for (const link of [...wikiLinks(value), value]) {
    const exact = Object.entries(MAP_DISPLAY_NAMES).find(([, name]) => normalizeQuestKey(name) === normalizeQuestKey(link))
    if (exact) {
      maps.push(exact[0])
      continue
    }
    const canonical = canonicalMapId(link)
    if (canonical && MAP_DISPLAY_NAMES[canonical]) {
      maps.push(canonical)
      continue
    }
    const matched = MAP_NAME_MATCHERS.find((entry) => entry.pattern.test(link))
    if (matched) maps.push(matched.id)
  }
  return unique(maps)
}

function parseExecutionStages(title: string, wikitext: string): QuestStage[] {
  const body = sectionBody(wikitext, /^(выполнение|прохождение)/i)
  if (!body) return []
  const stages: QuestStage[] = []
  for (const match of body.matchAll(/(?:^|\n)===(?!=)\s*(.+?)\s*===(?!=)([\s\S]*?)(?=\n===(?!=)|$)/g)) {
    const heading = cleanQuestText(match[1] ?? '')
    const text = cleanQuestText((match[2] ?? '')
      .replace(/<gallery[\s\S]*?<\/gallery>/gi, ' ')
      .replace(/\{\|[\s\S]*?\|\}/g, ' ')
      .replace(/\n====[\s\S]*$/, ''))
    if (!heading || STAGE_SKIP_HEADING.test(heading)) continue
    const blob = `${heading}\n${text}`
    stages.push({
      id: `${normalizeQuestKey(title)}-${stages.length}`,
      title: heading,
      description: text.slice(0, 600),
      mapIds: mapsFromText(blob),
      landmarkHints: landmarkHints(blob),
    })
  }
  return stages
}

function objectivesToStages(title: string, objectives: string[], locationMaps: string[]): QuestStage[] {
  return objectives.filter((objective) => !/^\(опционально\)/i.test(objective)).map((objective, index) => ({
    id: `${normalizeQuestKey(title)}-${index}`,
    title: objective,
    description: objective,
    mapIds: unique([...mapsFromText(objective), ...locationMaps]),
    optional: false,
    landmarkHints: landmarkHints(objective),
  }))
}

function parseListSection(wikitext: string, heading: RegExp) {
  const body = sectionBody(wikitext, heading)
  if (!body) return []
  return [...body.matchAll(/^\*\s*(?!\*)(.+)$/gm)]
    .map((match) => stripWiki(match[1] ?? ''))
    .filter((line) => line.length > 2)
}

function sectionBody(wikitext: string, heading: RegExp) {
  const chunks = wikitext.split(/\n==(?!=)\s*/)
  const chunk = chunks.find((entry) => heading.test(entry.split(/\s*==/)[0] ?? ''))
  if (!chunk) return ''
  return chunk.replace(/^[^=\n]*==\s*/, '')
}

const INFOBOX_KEYS: Record<string, string> = {
  'локация': 'location',
  'выдает': 'given by',
  'выдаёт': 'given by',
  'предыдущий_квест': 'previous',
  'предыдущий квест': 'previous',
  'следующий_квест': 'leads to',
  'следующий квест': 'leads to',
  'уровень': 'level',
}

function extractInfobox(wikitext: string) {
  const block = wikitext.match(/\{\{\s*(?:Infobox quest|Инфобокс квест)\s*([\s\S]*?)\n\}\}/i)?.[1] ?? ''
  const fields: Record<string, string> = {}
  for (const match of block.matchAll(/\|\s*([^=\n]+?)\s*=\s*([^\n]*)/g)) {
    const key = match[1].trim().toLowerCase()
    fields[INFOBOX_KEYS[key] ?? key] = match[2].trim()
  }
  return fields
}

/** Longest positional argument of the first `{{Name|…}}` template (the quote text, not the author). */
function balancedTemplateBody(wikitext: string, opener: RegExp) {
  const match = opener.exec(wikitext)
  if (!match) return ''
  let depth = 1
  let squareDepth = 0
  const start = match.index + match[0].length
  const segments: string[] = []
  let segmentStart = start
  for (let index = start; index < wikitext.length - 1; index += 1) {
    const pair = wikitext.slice(index, index + 2)
    if (pair === '{{') { depth += 1; index += 1; continue }
    if (pair === '[[') { squareDepth += 1; index += 1; continue }
    if (pair === ']]') { squareDepth = Math.max(0, squareDepth - 1); index += 1; continue }
    if (pair === '}}') {
      depth -= 1
      if (depth === 0) {
        segments.push(wikitext.slice(segmentStart, index))
        return segments
          .filter((segment) => !/^\s*[\w\u0400-\u04FF ]{1,20}=/.test(segment))
          .sort((left, right) => right.length - left.length)[0] ?? ''
      }
      index += 1
      continue
    }
    if (wikitext[index] === '|' && depth === 1 && squareDepth === 0) {
      segments.push(wikitext.slice(segmentStart, index))
      segmentStart = index + 1
    }
  }
  return ''
}

function wikiLinks(value: string) {
  return [...(value ?? '').matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1].trim())
    .filter((link) => link && !/^file:/i.test(link) && !/^категория:/i.test(link))
}

export function stripWiki(value: string) {
  return cleanQuestText(value)
}

function landmarkHints(value: string) {
  const hints = [
    ...wikiLinks(value).filter((link) => !mapsFromText(link).length),
    ...(value.match(LANDMARK_HINT) ?? []),
  ].map((hint) => stripWiki(hint)).filter((hint) => hint.length >= 4)
  return unique(hints).slice(0, 8)
}

function hasPlayableObjectives(objectives: string[]) {
  return objectives.some((objective) => objective.length > 8 && !OBJECTIVE_ID.test(objective) && !/^[0-9a-f]{24}$/i.test(objective))
}

function indexQuests(quests: Quest[]) {
  const byKey = new Map<string, Quest>()
  for (const quest of quests) {
    byKey.set(normalizeQuestKey(quest.name), quest)
    if (quest.normalizedName) byKey.set(normalizeQuestKey(quest.normalizedName), quest)
  }
  return byKey
}

function displayStoryTitle(title: string) {
  return title.replace(/\s*\(глава истории\)\s*/i, '').trim()
}

function storySlug(title: string, english: string) {
  const fromEnglish = english.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (fromEnglish) return fromEnglish
  return normalizeQuestKey(displayStoryTitle(title)) || 'chapter'
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}