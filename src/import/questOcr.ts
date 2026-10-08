import { normalizeQuestKey } from '../data/wikiQuestCatalog'
import type { Quest } from '../domain/types'
import { inferStoryStageIndex, storyStageEvidence } from './storyStageOcr'

const SKIP_LINE = /^(задачи|задания|задание|текущие|выполненные|недоступные|сюжетные|побочные|оперативные|завершенные|заблокированные|завершить|уровень лояльности|уровень лояльности \d+|найти|поиск|фильтр|торговцы|торговец|торговля|услуги|карта|уровень|награда|награды|цели|цель|описание|kappa|капа|pmc|scav|чат|персонаж|сводка|опыт|глава истории|история|локация|статус|прогресс|класс|тип|назад|общее|вещи|здоровье|умения|достижения|престиж|убежище|барахолка|сборки|справочник|сообщения|опрос|расширения|любая локация|активно!?|на персонаже|в схроне|pvp zone|берег|таможня|завод|развязка|резерв|маяк|лаборатория|эпицентр|терминал|улицы|лабиринт|лес|улицы таркова|главные задачи|опциональные задачи|связанные предметы|стартовое снаряжение)$/i

const STORY_CHROME_LINE = /^(задачи|задания|задание|текущие|выполненные|недоступные|сюжетные|побочные|оперативные|завершенные|заблокированные|завершить|найти|поиск|фильтр|торговцы|торговец|карта|уровень|награда|награды|цели|цель|описание|глава истории|история|локация|статус|прогресс|назад|активно!?|главные задачи|опциональные задачи|связанные предметы|стартовое снаряжение|любая локация)$/i

/** Story detail pane: «ИСТОРИЯ» header (often cut to «ТОРИЯ») or the objectives blocks. */
const STORY_PANE = /истори|тори[яи]|(?<![а-яё])[а-яё]{0,4}ные\s*задачи|иональн[а-яё]*\s*задачи/i

const TABLE_SPLIT = /любая(?:[ \t]+\S+){0,2}|[‘'"«]?(?:активно|выполнено|доступно|провалено|заблокировано)!?|\[?\s*pvp\s*zone\s*\]?|\d{1,3}\s*%|[ \t]+(берег|таможня|завод|развязка|резерв|маяк|лаборатория|эпицентр|терминал|лабиринт|лес|улицы таркова|ледокол)(?![а-яё])[.,:;]?/gim

const PVP_ZONE_TAG = /\[?\s*pvp\s*zone\s*\]?/gi

function titleKeys(quest: Quest) {
  return [...new Set([quest.name, quest.normalizedName ?? '', quest.name.replace(PVP_ZONE_TAG, '')].map(ocrKey).filter(Boolean))]
}

const GENERIC_KEY = /^(часть\d+|любаялокация|активно|pvzone|pvpzone|локация|статус|прогресс)$/i

/** Map names that collide with story chapter titles — never treat a map column as a chapter. */
const STORY_MAP_COLLISION = new Set(['лабиринт', 'завод', 'берег', 'таможня', 'развязка', 'резерв', 'маяк', 'лаборатория', 'эпицентр', 'терминал', 'лес'])

export interface OcrQuestMatch {
  questId: string
  name: string
  score: number
  line: string
  stageIndex?: number
  /** Status column of the Tasks table row, when it was read on the same OCR line. */
  status?: QuestRowStatus
}

export type QuestRowStatus = 'active' | 'ready' | 'available' | 'locked' | 'failed'

/** Status cell of a Tasks table row: «активно!», «выполнено!», «доступно», … */
export function rowStatus(rawLine: string): QuestRowStatus | undefined {
  const line = rawLine.toLowerCase()
  if (/выполнено|готово к сдаче|завершить/.test(line)) return 'ready'
  if (/активно/.test(line)) return 'active'
  if (/провал/.test(line)) return 'failed'
  if (/заблокир|недоступ/.test(line)) return 'locked'
  if (/доступно|принять/.test(line)) return 'available'
  return undefined
}

export function foldOcrGlyphs(value: string) {
  return value
    .replace(/6/g, 'б')
    .replace(/3/g, 'з')
    .replace(/0/g, 'о')
    .replace(/[Aa]/g, 'а')
    .replace(/[Bb]/g, 'в')
    .replace(/[Cc]/g, 'с')
    .replace(/[Ee]/g, 'е')
    .replace(/[Hh]/g, 'н')
    .replace(/[Kk]/g, 'к')
    .replace(/[Mm]/g, 'м')
    .replace(/[Oo]/g, 'о')
    .replace(/[Pp]/g, 'р')
    .replace(/[Ss]/g, 'с')
    .replace(/[Tt]/g, 'т')
    .replace(/[Xx]/g, 'х')
    .replace(/[Yy]/g, 'у')
}

export function ocrKey(value: string) {
  return normalizeQuestKey(foldOcrGlyphs(value))
}

export function matchQuestsFromOcr(text: string, quests: Quest[]) {
  const catalog = quests.filter((quest) => quest.id && !quest.id.startsWith('wiki:')).map((quest) => ({
    quest,
    keys: [
      ...titleKeys(quest).filter((key) => key.length >= (quest.kind === 'story' ? 3 : 4)),
      // Stage titles only for trader quests — story stages must not invent chapters without a title hit.
      ...(quest.kind === 'story' ? [] : (quest.stages ?? []).flatMap((stage) => [
        ocrKey(stage.title),
        ...(stage.ocrAliases ?? []).map(ocrKey),
      ]).filter((key) => key.length >= 6)),
    ],
  })).filter((entry) => entry.keys.length)
  const found = new Map<string, OcrQuestMatch>()

  const remember = (match: OcrQuestMatch) => {
    const previous = found.get(match.questId)
    // Equal confidence cannot justify skipping an earlier stage.
    const betterStage = match.stageIndex != null && previous?.stageIndex != null && match.stageIndex < previous.stageIndex
      && Math.abs(match.score - previous.score) <= 0.05
    if (!previous || match.score > previous.score || betterStage || (match.stageIndex != null && previous.stageIndex == null)) {
      found.set(match.questId, {
        ...match,
        stageIndex: match.stageIndex ?? previous?.stageIndex,
      })
    }
  }

  const storyTitleLines = storyChapterTitleLines(text)

  // Story chapters: title must appear as its own OCR line (not a map column like «Лабиринт»).
  for (const entry of catalog) {
    if (entry.quest.kind !== 'story') continue
    if (!storyTitleVisible(entry.quest.name, storyTitleLines, text)) continue
    const stageIndex = inferStoryStageIndex(text, entry.quest)
    remember({
      questId: entry.quest.id,
      name: entry.quest.name,
      score: 1,
      line: entry.quest.name,
      stageIndex,
    })
  }

  // Story detail pane whose title is lost in the banner art: the objective lines themselves name
  // exactly one chapter stage («Выжить на локации Таможня…» belongs to Тур only).
  if (STORY_PANE.test(text) && /задачи/i.test(text) && ![...found.values()].length) {
    const evidence = catalog
      .filter((entry) => entry.quest.kind === 'story')
      .map((entry) => ({ entry, stageIndex: storyStageEvidence(text, entry.quest) }))
      .filter((hit) => hit.stageIndex != null)
    if (evidence.length === 1) {
      const { entry } = evidence[0]!
      remember({ questId: entry.quest.id, name: entry.quest.name, score: 0.95, line: entry.quest.name, stageIndex: inferStoryStageIndex(text, entry.quest) })
    }
  }

  // Trader quests: a title must be a whole OCR row (a table cell), never a word inside a sentence
  // («Открыть дверь…» is not the quest «Дверь», «…Резерве» is not «Резерв»).
  const traderCatalog = catalog.filter((entry) => entry.quest.kind !== 'story')
  const rawLines = text.split(/\r?\n/)
  for (const rawLine of rawLines) {
    const status = rowStatus(rawLine)
    for (const line of ocrRowLines(rawLine)) {
      if (SKIP_LINE.test(line.trim())) continue
      const key = ocrKey(line)
      if (key.length < 3 || GENERIC_KEY.test(key)) continue

      const exact = traderCatalog.find((entry) => titleKeys(entry.quest).includes(key))
      if (exact) {
        remember({ questId: exact.quest.id, name: exact.quest.name, score: 1, line, status, stageIndex: resolveStageIndex(exact.quest, text, key) })
        continue
      }

      const unique = uniqueContainedMatch(key, traderCatalog)
      if (unique) {
        remember({
          questId: unique.quest.id,
          name: unique.quest.name,
          score: Math.max(0.9, key.length / Math.max(key.length, unique.keys[0].length)),
          line,
          status,
          stageIndex: resolveStageIndex(unique.quest, text, key),
        })
        continue
      }

      // Short titles (≤5 letters: «Аудит», «Секта», «Дверь») only match exactly.
      if (key.length < 6) continue
      let best: OcrQuestMatch | undefined
      for (const entry of traderCatalog) {
        const candidates = entry.keys.filter((candidate) => candidate.length >= 6 && (candidate.length >= 8 || Math.abs(candidate.length - key.length) <= 1))
        if (!candidates.length) continue
        const score = Math.max(...candidates.map((candidate) => similarity(key, candidate)))
        if (score < thresholdFor(key, entry.keys[0], false)) continue
        const stageIndex = resolveStageIndex(entry.quest, text, key)
        if (!best || score > best.score + 0.02 || (Math.abs(score - best.score) <= 0.02 && entry.quest.name.length > best.name.length)) {
          best = { questId: entry.quest.id, name: entry.quest.name, score, line, status, stageIndex }
        }
      }
      if (best) remember(best)
    }
  }

  // A row cut by OCR noise («Врачебная Ee») still names a long title by its unique leading words.
  // A distinctive inner word also counts when its row is title-sized (not an objective sentence).
  for (const rawLine of rawLines) {
    const status = rowStatus(rawLine)
    for (const { chunk, rowKey } of ocrWordChunks(rawLine)) {
      const key = ocrKey(chunk)
      if (key.length < 7 || GENERIC_KEY.test(key)) continue
      const hits = traderCatalog.filter((entry) => entry.keys.some((candidate) => {
        if (candidate.length <= key.length) return false
        if (key.length >= 8 && candidate.startsWith(key)) return true
        return candidate.includes(key) && rowKey.length >= candidate.length * 0.7 && rowKey.length <= candidate.length * 1.4
      }))
      if (hits.length !== 1) continue
      const hit = hits[0]!
      if (found.has(hit.quest.id)) continue
      remember({ questId: hit.quest.id, name: hit.quest.name, score: 0.9, line: chunk, status, stageIndex: resolveStageIndex(hit.quest, text, key) })
    }
  }

  return [...found.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
}

/** Lines that can name a story chapter — map-only labels outside the story tab are excluded. */
function storyChapterTitleLines(text: string) {
  const inStoryMenu = /сюжетн|главн(ые|ая)\s*задач/i.test(text)
  return extractOcrLines(text)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 3 || STORY_CHROME_LINE.test(line)) return false
      const key = ocrKey(line)
      if (!key || GENERIC_KEY.test(key)) return false
      // «Лабиринт» as a map cell must not unlock the chapter unless we are in the story UI.
      if (STORY_MAP_COLLISION.has(key) && !inStoryMenu) return false
      return true
    })
    .map((line) => ocrKey(line))
}

function storyTitleVisible(name: string, titleLines: string[], text: string) {
  const nameKey = ocrKey(name)
  if (nameKey.length < 3) return false
  // The chapter header sits on the banner art, so OCR appends junk: «Тур = = т, . “ae Rae /».
  const headWords = STORY_PANE.test(text)
    ? text.split(/\r?\n/).map((line) => ocrKey(line.trim().split(/[^\p{L}\p{N}]+/u)[0] ?? ''))
    : []
  const onLine = titleLines.some((line) => (
    line === nameKey
    || (!STORY_MAP_COLLISION.has(nameKey) && nameKey.length >= 4 && line.startsWith(nameKey) && line.length <= nameKey.length + 6)
  )) || (!STORY_MAP_COLLISION.has(nameKey) && !/\s/.test(name.trim()) && headWords.includes(nameKey))
  if (!onLine) return false

  // Colliding map/chapter names: only from the story tab, and when a detail pane is open
  // only the chapter title directly above «Главные задачи» counts (not a map chip elsewhere).
  if (STORY_MAP_COLLISION.has(nameKey)) {
    if (!/сюжетн/i.test(text)) return false
    const focused = focusedStoryChapterKey(text)
    if (focused) return focused === nameKey
    return true
  }
  return true
}

/** Chapter title sitting just above the detail pane («Главные задачи»). */
function focusedStoryChapterKey(text: string) {
  const lines = extractOcrLines(text)
  const detailLineIdx = lines.findIndex((line) => /главн(?:ые|ая)\s*задач/i.test(line))
  if (detailLineIdx <= 0) return undefined
  for (let index = detailLineIdx - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim()
    if (!line || STORY_CHROME_LINE.test(line) || /^активно!?$/i.test(line)) continue
    const key = ocrKey(line)
    if (!key || GENERIC_KEY.test(key)) continue
    return key
  }
  return undefined
}

export function extractOcrLines(text: string) {
  const prepared = text.replace(TABLE_SPLIT, '\n')
  const out: string[] = []
  for (const raw of prepared.split(/\r?\n|[•·|]/g)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 3) continue
    out.push(line)
    const stripped = line.replace(/^[^0-9a-zа-яё]+/i, '').trim()
    if (stripped && stripped !== line) out.push(stripped)
    for (const chunk of line.match(/[а-яё]{4,}(?:\s*[.\-–—]?\s*часть\s*\d+)?/gi) ?? []) {
      const piece = chunk.trim()
      if (piece.length >= 4) out.push(piece)
    }
  }
  return [...new Set(out)]
}

/** Whole OCR rows after splitting table columns — no single-word fragments. */
function ocrRowLines(text: string) {
  const out: string[] = []
  for (const raw of text.replace(TABLE_SPLIT, '\n').split(/\r?\n|[•·|]/g)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 3) continue
    out.push(line)
    const stripped = line.replace(/^[^0-9a-zа-яё]+/i, '').replace(/^\d+\s+/, '').trim()
    if (stripped && stripped !== line && stripped.length >= 3) out.push(stripped)
  }
  return [...new Set(out)]
}

function ocrWordChunks(text: string) {
  const out: Array<{ chunk: string; rowKey: string }> = []
  for (const line of ocrRowLines(text)) {
    const rowKey = ocrKey(line)
    for (const chunk of line.match(/[а-яё]{4,}(?:\s*[.\-–—]?\s*часть\s*\d+)?/gi) ?? []) out.push({ chunk: chunk.trim(), rowKey })
  }
  return out
}

function uniqueContainedMatch(lineKey: string, catalog: Array<{ quest: Quest; keys: string[] }>) {
  if (lineKey.length < 7 || GENERIC_KEY.test(lineKey)) return undefined
  const hits = catalog.filter((entry) => entry.keys.some((candidate) => {
    if (candidate.includes(lineKey)) return lineKey.length >= 7 && lineKey.length >= candidate.length * 0.6
    return lineKey.length >= 10 && candidate.length >= 8 && lineKey.includes(candidate)
  }))
  return hits.length === 1 ? hits[0] : undefined
}

function thresholdFor(lineKey: string, questKey: string, story = false) {
  const length = Math.min(lineKey.length, questKey.length)
  if (story && lineKey === questKey && length >= 3) return 0.99
  if (length >= 12) return 0.74
  if (length >= 8) return 0.76
  return 0.75
}

function resolveStageIndex(quest: Quest, fullText: string, lineKey: string) {
  if (quest.kind === 'story') {
    const inferred = inferStoryStageIndex(fullText, quest)
    if (inferred != null) return inferred
  }
  return matchingStageIndex(quest, lineKey)
}

function matchingStageIndex(quest: Quest, lineKey: string) {
  if (!quest.stages?.length) return undefined
  let bestIndex: number | undefined
  let bestScore = 0
  quest.stages.forEach((stage, index) => {
    const keys = [ocrKey(stage.title), ...(stage.ocrAliases ?? []).map(ocrKey)].filter((key) => key.length >= 5)
    for (const key of keys) {
      const score = similarity(lineKey, key)
      const contained = lineKey.includes(key) || key.includes(lineKey)
      const effective = contained ? Math.max(score, 0.82) : score
      if (effective >= 0.75 && effective > bestScore) {
        bestScore = effective
        bestIndex = index
      }
    }
  })
  return bestIndex
}

function similarity(a: string, b: string) {
  if (!a || !b) return 0
  if (a === b) return 1
  if (Math.min(a.length, b.length) < 5) return 1 - levenshtein(a, b) / Math.max(a.length, b.length)
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length)
}

function levenshtein(a: string, b: string) {
  const rows = a.length + 1
  const cols = b.length + 1
  const grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i += 1) grid[i][0] = i
  for (let j = 0; j < cols; j += 1) grid[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost)
    }
  }
  return grid[a.length][b.length]
}
