import { normalizeQuestKey } from '../data/wikiQuestCatalog'
import { STORY_CHAPTER_SEEDS } from '../data/storyChapterSeeds'
import type { Quest } from '../domain/types'
import { inferStoryStageIndex, storyStageEvidence, storyStageHits } from './storyStageOcr'

const SKIP_LINE = /^(задачи|задания|задание|текущие|выполненные|недоступные|сюжетные|побочные|оперативные|завершенные|заблокированные|завершить|уровень лояльности|уровень лояльности \d+|найти|поиск|фильтр|торговцы|торговец|торговля|услуги|карта|уровень|награда|награды|цели|цель|описание|kappa|капа|pmc|scav|чат|персонаж|сводка|опыт|глава истории|история|локация|статус|прогресс|класс|тип|назад|общее|вещи|здоровье|умения|достижения|престиж|убежище|барахолка|сборки|справочник|сообщения|опрос|расширения|любая локация|активно!?|на персонаже|в схроне|pvp zone|берег|таможня|завод|развязка|резерв|маяк|лаборатория|эпицентр|терминал|улицы|лабиринт|лес|улицы таркова|главные задачи|опциональные задачи|связанные предметы|стартовое снаряжение)$/i

const STORY_CHROME_LINE = /^(задачи|задания|задание|текущие|выполненные|недоступные|сюжетные|побочные|оперативные|завершенные|заблокированные|завершить|найти|поиск|фильтр|торговцы|торговец|карта|уровень|награда|награды|цели|цель|описание|глава истории|история|локация|статус|прогресс|назад|активно!?|главные задачи|опциональные задачи|связанные предметы|стартовое снаряжение|любая локация)$/i

/** The English game's menu words, column heads and labels (owner's PvE screenshots, 14.10.2026): never a quest title. */
const EN_CHROME_LINE = /^(trader|type|class|task|tasks|location|status|progress|any location|active!?|story|side|operational|chapter|main objectives|optional objectives|related items|rewards|objective\(s\)|initial equipment|task items on character|task items in stash|show completed|show locked|complete|back|search|overall|gear|health|skills|map|achievements|prestige)$/i

/** Story detail pane: «ИСТОРИЯ» header (often cut to «ТОРИЯ») or the objectives blocks. */
const STORY_PANE = /истори|тори[яи]|(?<![а-яё])[а-яё]{0,4}ные\s*задачи|иональн[а-яё]*\s*задачи|main\s+objectives|optional\s+objectives/i

const TABLE_SPLIT = /любая(?:[ \t]+\S+){0,2}|[‘'"«]?(?:активно|выполнено|доступно|провалено|заблокировано)!?|\[?\s*pvp\s*zone\s*\]?|\d{1,3}\s*%|[ \t]+(берег|таможня|завод|развязка|резерв|маяк|лаборатория|эпицентр|терминал|лабиринт|лес|улицы таркова|ледокол)(?![а-яё])[.,:;]?/gim

/**
 * The English table's cells after the title: «Any location», the status («active!», OCR often «activel») and the
 * progress. A map name only right before the status: titles carry map names too («The Huntsman Path - Woods Keeper»).
 */
const EN_TABLE_SPLIT = /[ \t]+any\s+location\b|[ \t]+(?:factory|customs|woods|shoreline|interchange|reserve|lighthouse|streets\s+of(?:\s+tarkov)?|the\s+lab|ground\s+zero|labyrinth|terminal|icebreaker)(?=[ \t]+(?:active|complete|available|failed|locked))|[ \t]+(?:active|completed?|available|failed|locked)[!l1|]?(?=[ \t]|$)/gim

const PVP_ZONE_TAG = /\[?\s*pvp\s*zone\s*\]?/gi

/**
 * The story chapters' names in both languages and the other wordings the game has used («Небеса в огне», «Falling
 * Skies», «Падающие небеса»), by chapter id: a catalog that does not carry `nameRu` / `nameEn` / `ocrAliases` yet still
 * finds a chapter whatever the game's language.
 */
const CHAPTER_NAMES = new Map<string, string[]>([
  ['tour', ['Тур', 'Tour']],
  ...STORY_CHAPTER_SEEDS.map((chapter): [string, string[]] => [chapter.id, [chapter.ru, chapter.en, ...chapter.aliases]]),
])

/** Per quest object: a catalog is loaded once and read every frame, so its titles and keys are worked out once. */
const titleCache = new WeakMap<Quest, string[]>()
const titleKeyCache = new WeakMap<Quest, string[]>()

/**
 * Every title the game may show for a quest, in Russian and in English, whatever the app's language (audit P11; product
 * roadmap: «Quest counts must not change when switching interface language»): `name` (the app's language), the game's
 * `nameRu` and `nameEn`, every `ocrAliases` entry; a story chapter also by the names its seed knows.
 */
export function questTitles(quest: Quest): string[] {
  const known = titleCache.get(quest)
  if (known) return known
  const chapter = quest.kind === 'story'
    ? CHAPTER_NAMES.get(quest.normalizedName ?? '') ?? CHAPTER_NAMES.get(quest.id.replace(/^story-/, ''))
    : undefined
  const titles = [...new Set([quest.name, quest.nameRu, quest.nameEn, ...(quest.ocrAliases ?? []), ...(chapter ?? [])]
    .map((title) => title?.trim() ?? '').filter(Boolean))]
  titleCache.set(quest, titles)
  return titles
}

/** The OCR keys of every title of a quest (questTitles), each also without its «[PVP ZONE]» tag, and of its English slug. */
export function titleKeys(quest: Quest): string[] {
  const known = titleKeyCache.get(quest)
  if (known) return known
  const keys = [...new Set([...questTitles(quest).flatMap((title) => [title, title.replace(PVP_ZONE_TAG, '')]), quest.normalizedName ?? '']
    .map(ocrKey).filter(Boolean))]
  titleKeyCache.set(quest, keys)
  return keys
}

const GENERIC_KEY = /^(часть\d+|любаялокация|активно|pvzone|pvpzone|локация|статус|прогресс)$/i

/**
 * Similarity below 0.74 needs no edit distance: two keys whose lengths differ by more than this share of the longer one
 * cannot reach it (the distance is at least the difference). Exactly the matches as before, without most of the work.
 */
const FUZZY_LENGTH_SLACK = 0.26

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

/**
 * Status cell of a Tasks table row: «активно!», «выполнено!», «доступно», …; in the English game «active!», … The Russian
 * words also with a Latin look-alike or a digit read in them («aктивнo!»).
 */
export function rowStatus(rawLine: string): QuestRowStatus | undefined {
  const line = rawLine.toLowerCase()
  const ru = foldOcrGlyphs(rawLine).toLowerCase()
  if (/выполнено|готово к сдаче|завершить/.test(ru) || /\bcompleted?!|ready to turn in/.test(line)) return 'ready'
  if (/активно/.test(ru) || /\bactive[!l1|]?(?![a-z])/.test(line)) return 'active'
  if (/провал/.test(ru) || /\bfailed\b/.test(line)) return 'failed'
  if (/заблокир|недоступ/.test(ru) || /\blocked\b|unavailable/.test(line)) return 'locked'
  if (/доступно|принять/.test(ru) || /\bavailable\b/.test(line)) return 'available'
  return undefined
}

export function foldOcrGlyphs(value: string) {
  return value
    // «Л» read as two Latin letters («Jlec» for «Лес», «JIовкач»).
    .replace(/[Jj][lI1|]/g, 'л')
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

/**
 * A story frame asks for the key of the same catalog titles and aliases thousands of times (every stage against every
 * line): each one is worked out once. Bounded, as OCR lines pass through here too.
 */
const keyCache = new Map<string, string>()
const KEY_CACHE_LIMIT = 20_000

export function ocrKey(value: string) {
  const known = keyCache.get(value)
  if (known !== undefined) return known
  const key = normalizeQuestKey(foldOcrGlyphs(value))
  if (keyCache.size >= KEY_CACHE_LIMIT) keyCache.clear()
  keyCache.set(value, key)
  return key
}

/** A quest as the matcher reads it: its title keys (exact matches) and every key the looser matches may use. */
interface CatalogEntry { quest: Quest; titles: string[]; keys: string[] }
const entryCache = new WeakMap<Quest, CatalogEntry>()

function catalogEntry(quest: Quest): CatalogEntry {
  const known = entryCache.get(quest)
  if (known) return known
  const titles = titleKeys(quest)
  const entry = {
    quest,
    titles,
    keys: [
      ...titles.filter((key) => key.length >= (quest.kind === 'story' ? 3 : 4)),
      // Stage titles only for trader quests — story stages must not invent chapters without a title hit.
      ...(quest.kind === 'story' ? [] : (quest.stages ?? []).flatMap((stage) => [
        ocrKey(stage.title),
        ...(stage.ocrAliases ?? []).map(ocrKey),
      ]).filter((key) => key.length >= 6)),
    ],
  }
  entryCache.set(quest, entry)
  return entry
}

/**
 * The catalog of one quest list: its trader quests by exact title key (the first of a key wins, as in list order) and by
 * the length of their title keys (titleAtRowStart), and the story chapters' title keys.
 */
interface Catalog {
  all: CatalogEntry[]
  trader: CatalogEntry[]
  exact: Map<string, CatalogEntry>
  byLength: Map<number, Array<{ entry: CatalogEntry; key: string }>>
  storyTitles: Set<string>
}
const catalogCache = new WeakMap<readonly Quest[], Catalog>()

function questCatalog(quests: Quest[]): Catalog {
  const known = catalogCache.get(quests)
  if (known) return known
  const all = quests.filter((quest) => quest.id && !quest.id.startsWith('wiki:')).map(catalogEntry).filter((entry) => entry.keys.length)
  const trader = all.filter((entry) => entry.quest.kind !== 'story')
  const exact = new Map<string, CatalogEntry>()
  const byLength = new Map<number, Array<{ entry: CatalogEntry; key: string }>>()
  for (const entry of trader) {
    for (const key of entry.titles) {
      if (!exact.has(key)) exact.set(key, entry)
      const same = byLength.get(key.length)
      if (same) same.push({ entry, key })
      else byLength.set(key.length, [{ entry, key }])
    }
  }
  const storyTitles = new Set(all.filter((entry) => entry.quest.kind === 'story').flatMap((entry) => entry.titles))
  const catalog = { all, trader, exact, byLength, storyTitles }
  catalogCache.set(quests, catalog)
  return catalog
}

export function matchQuestsFromOcr(text: string, quests: Quest[]) {
  const catalogs = questCatalog(quests)
  const { all: catalog, trader: traderCatalog, exact: exactTitles } = catalogs
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
    // Its name in either language (audit P11): a Russian game read by the English app shows «Небеса в огне».
    if (!questTitles(entry.quest).some((title) => storyTitleVisible(title, storyTitleLines, text))) continue
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
  if (STORY_PANE.test(text) && /задачи|objectives/i.test(text) && ![...found.values()].length) {
    const evidence = catalog
      .filter((entry) => entry.quest.kind === 'story')
      .map((entry) => ({ entry, stageIndex: storyStageEvidence(text, entry.quest) }))
      .filter((hit) => hit.stageIndex != null)
    // Shared wording names several chapters: the one more of whose objectives are on screen, if that is clear.
    const ranked = evidence.map((hit) => ({ ...hit, hits: storyStageHits(text, hit.entry.quest) })).sort((a, b) => b.hits - a.hits)
    if (evidence.length === 1 || (ranked.length > 1 && ranked[0]!.hits > ranked[1]!.hits)) {
      const { entry } = evidence.length === 1 ? evidence[0]! : ranked[0]!
      remember({ questId: entry.quest.id, name: entry.quest.name, score: 0.95, line: entry.quest.name, stageIndex: inferStoryStageIndex(text, entry.quest) })
    }
  }

  // Trader quests: a title must be a whole OCR row (a table cell), never a word inside a sentence
  // («Открыть дверь…» is not the quest «Дверь», «…Резерве» is not «Резерв»).
  const rawLines = text.split(/\r?\n/)
  /** The rows that named a quest here: the word-chunk pass below is for the rows that named none. */
  const namedRows = new Set<number>()
  rawLines.forEach((rawLine, row) => {
    const status = rowStatus(rawLine)
    let exactly = false
    /** The looser readings of the row's cells (one per cell): a title the cell is part of or holds, or a close one. */
    const loose: OcrQuestMatch[] = []
    for (const line of ocrRowLines(rawLine)) {
      if (SKIP_LINE.test(line.trim()) || EN_CHROME_LINE.test(line.trim())) continue
      const key = ocrKey(line)
      if (key.length < 3 || GENERIC_KEY.test(key)) continue

      const exact = exactTitles.get(key)
      if (exact) {
        remember({ questId: exact.quest.id, name: exact.quest.name, score: 1, line, status, stageIndex: resolveStageIndex(exact.quest, text, key) })
        exactly = true
        continue
      }

      const unique = uniqueContainedMatch(key, traderCatalog)
      if (unique) {
        loose.push({
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
        // Lengths further apart than a quarter cannot reach the threshold (0.74 and up): no edit distance for those.
        const candidates = entry.keys.filter((candidate) => candidate.length >= 6 && (candidate.length >= 8 || Math.abs(candidate.length - key.length) <= 1)
          && Math.abs(candidate.length - key.length) <= Math.max(candidate.length, key.length) * FUZZY_LENGTH_SLACK)
        if (!candidates.length) continue
        const score = Math.max(...candidates.map((candidate) => similarity(key, candidate)))
        if (score < thresholdFor(key, entry.keys[0], false)) continue
        const stageIndex = resolveStageIndex(entry.quest, text, key)
        if (!best || score > best.score + 0.02 || (Math.abs(score - best.score) <= 0.02 && entry.quest.name.length > best.name.length)) {
          best = { questId: entry.quest.id, name: entry.quest.name, score, line, status, stageIndex }
        }
      }
      if (best) loose.push(best)
    }
    // A row of the table (its status cell read) none of whose cells is a title as it stands: the title may still start
    // it, beside the icons' junk or a column read wrong (titleAtRowStart). That reading wins over a looser one of a cell,
    // which takes a word of the title for a shorter title («Хонтр-компромат» is not «Компромат», «Разведка баем» not
    // «Разведка») or counts the column's letters as the title's («Загладить вину Jlec» is not «Загладить вину. ПО»).
    const start = exactly || !status ? undefined : titleAtRowStart(rawLine, catalogs)
    if (start) {
      remember({
        questId: start.entry.quest.id,
        name: start.entry.quest.name,
        score: start.distance ? Math.max(0.75, 1 - start.distance / start.key.length) : 1,
        line: rawLine.trim(),
        status,
        stageIndex: resolveStageIndex(start.entry.quest, text, start.key),
      })
    } else for (const match of loose) remember(match)
    if (exactly || start || loose.length) namedRows.add(row)
  })

  // A row cut by OCR noise («Врачебная Ee») still names a long title by its unique leading words.
  // A distinctive inner word also counts when its row is title-sized (not an objective sentence). Only on a row that
  // named no quest above: the row «Компромат» is not also «Контр-компромат», «Инвентаризация» not «… Часть 2».
  rawLines.forEach((rawLine, row) => {
    if (namedRows.has(row)) return
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
  })

  return [...found.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
}

/** Lines that can name a story chapter — map-only labels outside the story tab are excluded. */
function storyChapterTitleLines(text: string) {
  const inStoryMenu = /сюжетн|главн(ые|ая)\s*задач|main\s+objectives|(?:^|\s)story(?:\s|$)/i.test(text)
  return extractOcrLines(text)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 3 || STORY_CHROME_LINE.test(line) || EN_CHROME_LINE.test(line)) return false
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
  const detailLineIdx = lines.findIndex((line) => /главн(?:ые|ая)\s*задач|main\s+objectives/i.test(line))
  if (detailLineIdx <= 0) return undefined
  for (let index = detailLineIdx - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim()
    if (!line || STORY_CHROME_LINE.test(line) || EN_CHROME_LINE.test(line) || /^(?:активно|active)!?$/i.test(line)) continue
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
  for (const raw of text.replace(TABLE_SPLIT, '\n').replace(EN_TABLE_SPLIT, '\n').split(/\r?\n|[•·|]/g)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 3) continue
    out.push(line)
    const stripped = line.replace(/^[^0-9a-zа-яё]+/i, '').replace(/^\d+\s+/, '').trim()
    if (stripped && stripped !== line && stripped.length >= 3) out.push(stripped)
    // The trader, type and class icons before an English title come out as one- or two-letter junk («x №1 п The …»).
    const untagged = stripped.replace(/^(?:\S{1,2}\s+)+(?=[A-Za-z]{3})/, '')
    if (untagged !== stripped && untagged.length >= 3) out.push(untagged)
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

/**
 * Where a row's columns after the title start, in the Russian and the English game: «Любая локация», the status, the
 * progress, the «[PVP ZONE]» tag. Not at a Russian map name — some titles hold one («Ревизия. Резерв»): after the title
 * it is a column word (columnWord).
 */
const FIRST_CELL_END = [
  /любая(?:[ \t]+\S+){0,2}|[‘'"«]?(?:активно|выполнено|доступно|провалено|заблокировано)!?|\[?\s*pvp\s*zone\s*\]?|\d{1,3}\s*%/im,
  new RegExp(EN_TABLE_SPLIT.source, 'im'),
]
/** Words of the row's icons before its title: a letter or two each («Ш», «я», «9,»), two at most. */
const ROW_ICON_WORDS = 2
/** The most words of a title the row-start reading tries. */
const ROW_TITLE_WORDS = 8
/** The words of a row's columns after the title, in both languages: the locations and the status. */
const COLUMN_WORDS = [
  'любая', 'локация', 'таможня', 'развязка', 'лес', 'берег', 'резерв', 'маяк', 'эпицентр', 'улицы', 'таркова', 'лаборатория',
  'лабиринт', 'завод', 'терминал', 'ледокол', 'активно', 'выполнено', 'доступно', 'провалено', 'заблокировано',
  'any', 'location', 'factory', 'customs', 'woods', 'shoreline', 'interchange', 'reserve', 'lighthouse', 'streets', 'tarkov',
  'lab', 'ground', 'zero', 'labyrinth', 'terminal', 'icebreaker', 'active', 'completed', 'available', 'failed', 'locked',
].map(ocrKey)

/**
 * A word of a column after the title, as it is or with a letter or two read wrong («Jlec», «Таможия»), or a bit of junk.
 * Not a number: after a title it is the title's own («Каратель. Часть 1»).
 */
function columnWord(word: string) {
  if (/\d/.test(word)) return false
  const key = ocrKey(word)
  if (key.length <= 2) return true
  const slack = key.length <= 4 ? 1 : 2
  return COLUMN_WORDS.some((column) => boundedDistance(key, column, slack) <= slack)
}

/** The row's text before its first column after the title. */
function leadingCell(rawLine: string) {
  let end = rawLine.length
  for (const pattern of FIRST_CELL_END) {
    const hit = pattern.exec(rawLine)
    if (hit && hit.index < end) end = hit.index
  }
  return rawLine.slice(0, end)
}

/**
 * The quest whose title starts a Tasks table row that named none as a whole (owner, 03.11.2026: «Аудит» and «Ловкач»
 * were never found on the PvP Tasks screen; «квесты у всех называются одинаково в игре — по этим названиям и шло
 * определение»). The row's icons come out as a letter or two before the title («Ш Аудит»), and a location read wrong
 * after it («Ловкач Jlec») is not cut off as a column: the title is the longest run of the cell's words from its start
 * (after up to two such bits) that is a quest's title — as the game writes it, or with the few letters OCR gets wrong
 * when no other title is as close (closestTitle) — and is followed by column words only (columnWord): a title cut short
 * of its own words is no reading. Only for a row with a status cell (matchQuestsFromOcr), never a story chapter's row.
 */
function titleAtRowStart(rawLine: string, catalog: Catalog) {
  const words = leadingCell(rawLine).split(/\s+/).filter((word) => ocrKey(word).length > 0)
  // From each word on, only column words to the cell's end.
  const columns = new Array<boolean>(words.length + 1).fill(true)
  for (let index = words.length - 1; index >= 0; index -= 1) columns[index] = columns[index + 1]! && columnWord(words[index]!)
  let best: { entry: CatalogEntry; key: string; distance: number; worth: number } | undefined
  for (let start = 0; start <= Math.min(ROW_ICON_WORDS, words.length - 1); start += 1) {
    if (start > 0 && ocrKey(words[start - 1]!).length > 2) break
    for (let end = start + 1; end <= Math.min(words.length, start + ROW_TITLE_WORDS); end += 1) {
      if (!columns[end]) continue
      const key = ocrKey(words.slice(start, end).join(' '))
      if (key.length < 4 || GENERIC_KEY.test(key)) continue
      // A story chapter's row (the «Сюжетные» tab) is no trader quest, however close a title is.
      if (catalog.storyTitles.has(key)) return undefined
      const hit = closestTitle(key, catalog)
      if (!hit) continue
      // The longest title read, each letter read wrong counting against it.
      const worth = hit.key.length - 2 * hit.distance
      if (!best || worth > best.worth) best = { ...hit, worth }
    }
  }
  return best
}

/** Letters OCR may get wrong in a title of this many letters: none below four, then one, two from ten, three from fifteen. */
function titleSlack(length: number) {
  return length < 4 ? 0 : length < 10 ? 1 : length < 15 ? 2 : 3
}

/**
 * The trader quest whose title key is `key`, or the one closest to it within the slack when no other title is as close —
 * for a key of five letters or fewer, not even one letter further («Ауднт» is «Аудит» only while no other title is two
 * letters from it). Quests of one and the same title are one title: the first of them, as for an exact title.
 */
function closestTitle(key: string, catalog: Catalog) {
  const exact = catalog.exact.get(key)
  if (exact) return { entry: exact, key, distance: 0 }
  const slack = titleSlack(key.length)
  if (!slack) return undefined
  const reach = slack + 1
  let best: { entry: CatalogEntry; key: string; distance: number } | undefined
  let rival = Infinity
  for (let length = key.length - reach; length <= key.length + reach; length += 1) {
    for (const candidate of catalog.byLength.get(length) ?? []) {
      if (best && candidate.key === best.key) continue
      const distance = boundedDistance(key, candidate.key, reach)
      if (distance > reach) continue
      if (!best || distance < best.distance) {
        if (best && best.entry !== candidate.entry) rival = Math.min(rival, best.distance)
        best = { ...candidate, distance }
      } else if (candidate.entry !== best.entry) rival = Math.min(rival, distance)
    }
  }
  if (!best || best.distance > slack) return undefined
  if (rival <= best.distance + (key.length <= 5 ? 1 : 0)) return undefined
  return best
}

/** The edit distance of two keys, or `max + 1` as soon as it must be more than `max`. */
function boundedDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    let lowest = i
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      current.push(value)
      if (value < lowest) lowest = value
    }
    if (lowest > max) return max + 1
    previous = current
  }
  return Math.min(previous[b.length]!, max + 1)
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
