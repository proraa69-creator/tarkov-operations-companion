import type { Quest, StoryObjectiveReading } from '../domain/types'
import { ocrKey } from './questOcr'

const MAIN = /^(?:(?:главн(?:ые|ая)|[а-яё]{0,4}ные)\s*задач[^\n]*|main\s+(?:tasks|objectives))$/i
const OPTIONAL = /^(?:(?:опциональн|[а-яё]{0,4}иональн)[а-яё]*\s*задач[^\n]*|optional\s+(?:tasks|objectives))$/i
const END = /^(?:связанные\s*предметы|стартовое\s*снаряжение|награды|related\s*items|rewards|rarity|редкость|[\d.]+\s|[=\s]*главное\s*меню)/i
const START = /^(?:най[тд]и|на[йи]дите|получ|переда|собра|поговор|рассказ|обеспеч|вы[жй]|вый|выбр|посет|уби|осмотр|отыск|дост|разб|унич|узна|связ|прин|прослед|повыс|find|locate|obtain|collect|hand|give|survive|visit|eliminate|kill|talk|inspect|reach|gain|follow)/i
/**
 * More objective verbs of the story chapters («Добыть», «Забрать», «Ликвидировать», «Дождаться»…). «Выполнить» is left
 * out on purpose: a line «Выполнено» under an objective is its status, not a new objective.
 */
const MORE_START = /^(?:добы|забра|ликвид|спрос|попа[сд]|выясн|верну|дожд|прибы|сообщ|спрят|расспрос|обыск|прочит|доложи|добра|попрос|постро|остав|устан|прилож|извле|сохран|изуч|почин|восстан|запуст|откр|провес|подорв|улучш|допрос|расшифр|запис|включ|прослуш|актив|отказ|заплат|соглас|подтверд|удерж|обрат|пройти|отчита|организ|сжечь|сест[ьи]|войти|ввести|спаст|проанализ|помочь|продолж|разузн|встрет|отнес|отправ|использ|помест|залож|отмет|размест|сфотограф|охран|сопровод|retrieve|return|wait|report|ask|build|install|place|hide|search|read|open|repair|activate|extract)/i

/** Openings of this chapter's own stage titles (two words): a line starting like one of them is a new objective. */
function stageOpenings(quest: Quest) {
  return [...new Set((quest.stages ?? []).flatMap((stage) => [stage.title, ...(stage.ocrAliases ?? [])])
    .map((title) => ocrKey(title.split(/\s+/).slice(0, 2).join(' '))).filter((key) => key.length >= 8))]
}

const STATUS_KEYS = ['выполнено', 'готово', 'completed'].map(ocrKey)

/** The row ends with a stage title / alias of this chapter whose own last word is «выполнено» / «готово» / «completed». */
function endsWithTitleStatus(row: string, quest: Quest) {
  const key = ocrKey(row)
  return (quest.stages ?? []).some((stage) => [stage.title, ...(stage.ocrAliases ?? [])].some((title) => {
    const alias = ocrKey(title)
    return alias.length >= 8 && STATUS_KEYS.some((word) => alias.endsWith(word)) && key.includes(alias)
  }))
}

function startsObjective(line: string, openings: string[]) {
  if (START.test(line) || MORE_START.test(line)) return true
  const key = ocrKey(line)
  return openings.some((opening) => key.startsWith(opening))
}

/** Right panel headers («Предметы для заданий на персонаже / в схроне») and the game version in the corner. */
const NOISE = /^(?:предметы\s+для\s+заданий|items\s+for\s+(?:tasks|quests))|^\d+(?:\.\d+){2,}\s*$/i
const COUNTER_ONLY = /^\d{1,7}\s*\/\s*\d{1,7}$/
/** A row cut after a preposition / conjunction continues on the next line. */
const JOINER = /(?:^|\s)(?:или|и|на|из|в|во|с|со|к|ко|о|об|от|до|для|по|у|за|при|категории|локации|or|and|on|in|of|the|to|from|at)\s*$/i

/** Menu bars and status words: letters, but no lowercase letter at all (ГЛАВНОЕ МЕНЮ …, АКТИВНО). */
function capsOnly(line: string) {
  return /[A-ZА-ЯЁ]{2}/.test(line) && !/[a-zа-яё]/.test(line)
}

/**
 * What OCR makes of the checkbox in front of an objective (real readings of one frame: «= [1]», «[С]», «Г]», «[_]», «CD»,
 * «ГО»): leading words without letters, short bracketed words, and one- or two-letter capitals before a capitalised word.
 */
function stripCheckbox(line: string) {
  const words = line.split(/\s+/)
  let start = 0
  while (start < words.length - 1) {
    const word = words[start]!
    const noLetters = !/\p{L}/u.test(word)
    const bracketed = word.length <= 4 && /[[\]{}()|<>]/.test(word)
    const capitals = word.length <= 2 && /^\p{Lu}+$/u.test(word) && /^\p{Lu}/u.test(words[start + 1]!) && words.length - start >= 3
    if (!noLetters && !bracketed && !capitals) break
    start += 1
  }
  return words.slice(start).join(' ')
}

/**
 * The progress bar between an objective and its counter («№8», «[i», «18%», «|8»): trailing symbol junk. A plain number
 * stays — it can be the end of a title («Изделия 1156», «выше 4.0»).
 */
function stripProgressBar(label: string) {
  const words = label.split(/\s+/)
  while (words.length > 1) {
    const word = words.at(-1)!
    const junk = word.length <= 4 && /[[\]{}()|<>%№#]/.test(word)
    if (!junk && (/\p{L}/u.test(word) || /^\d+(?:[.,]\d+)?$/.test(word))) break
    words.pop()
  }
  return words.join(' ')
}

/** Digits the game font turns into each other on a small counter («1/3» read as «1/5» next to the progress bar). */
const LOOK_ALIKE: Record<string, string> = { 0: '86', 1: '7', 3: '582', 5: '36', 6: '580', 7: '1', 8: '3650', 2: '3' }

/**
 * The denominator of a counter: the catalog's when OCR read a look-alike of it, otherwise what the game shows (a count
 * the game changed is read as it is, not replaced).
 */
function catalogTotal(read: number, expected: number | undefined) {
  if (!expected || read === expected) return read
  const a = String(read)
  const b = String(expected)
  if (a.length !== b.length) return read
  return [...a].every((digit, index) => digit === b[index] || LOOK_ALIKE[b[index]!]?.includes(digit)) ? expected : read
}

/** Stage indexes whose title / alias this objective text shows (longest match first). */
export function objectiveStageCandidates(label: string, quest: Quest) {
  const key = ocrKey(label)
  return (quest.stages ?? []).flatMap((stage, index) => {
    const length = Math.max(0, ...[stage.title, ...(stage.ocrAliases ?? [])].map(ocrKey)
      .filter(alias => (alias.length >= 14 && key.includes(alias)) || (alias.length >= 8 && key === alias)).map(alias => alias.length))
    return length ? [{ index, length }] : []
  }).sort((a, b) => b.length - a.length || a.index - b.index)
}

/**
 * An objective saved by an older version: the same clean-up as a fresh reading — junk around the text, a look-alike
 * denominator, and the stage when only the junk hid it. Shown at once, without waiting for the chapter to be opened again.
 */
export function cleanSavedStoryObjective(objective: StoryObjectiveReading, quest: Quest): StoryObjectiveReading {
  const text = stripProgressBar(stripCheckbox(objective.text.trim()))
  if (ocrKey(text).length < 8) return objective
  const stageIndex = objective.stageIndex ?? objectiveStageCandidates(text, quest)[0]?.index
  const expected = stageIndex != null ? quest.stages?.[stageIndex]?.progressTotal : undefined
  const total = objective.total != null ? catalogTotal(objective.total, expected) : undefined
  const counter = objective.current != null && total != null && total > 0 && objective.current <= total
  const cleaned: StoryObjectiveReading = { ...objective, text, completed: objective.completed || (counter && objective.current === total) }
  if (stageIndex != null) cleaned.stageIndex = stageIndex
  if (counter) cleaned.total = total
  else { delete cleaned.current; delete cleaned.total }
  return cleaned
}

/**
 * Read the objectives pane only. Unknown objectives remain readable, but get no invented map point. The grey line under
 * an objective («Для ремонта понадобится набор инструментов») is its hint, not part of its title.
 */
export function readStoryObjectives(text: string, quest: Quest): StoryObjectiveReading[] {
  const rows: Array<{ text: string; optional: boolean; hint?: string }> = []
  const openings = stageOpenings(quest)
  let active = false
  let optional = false
  for (const raw of text.slice(0, 20000).split(/\r?\n/)) {
    let line = stripCheckbox(raw.trim().replace(/^(?:\[[^\]]{0,3}\]|[•●○✓✔☑\-*]+|(?:CJ|СJ|CП|□))\s*/, '').trim())
    const checkbox = line.match(/^.{1,3}\s+(.+)$/)
    if (checkbox && startsObjective(checkbox[1]!, openings)) line = checkbox[1]!
    if (MAIN.test(line)) { active = true; optional = false; continue }
    if (!active) continue
    if (OPTIONAL.test(line)) { optional = true; continue }
    if (END.test(line)) break
    if (!line || line.length > 600 || NOISE.test(line) || capsOnly(line)) continue
    // A stray letter of the art or the menu («ы», «|») is not a wrapped piece of the objective above.
    if (!COUNTER_ONLY.test(line) && !/\p{L}[^\n]*\p{L}/u.test(line)) continue
    const last = rows.at(-1)
    const same = last && last.optional === optional ? last : undefined
    if (same && (COUNTER_ONLY.test(line) || JOINER.test(same.text) || (/^[a-zа-яё]/.test(line) && !startsObjective(line, openings)))) {
      if (same.text.length + line.length < 600) same.text += ` ${line}`
    } else if (startsObjective(line, openings)) rows.push({ text: line, optional })
    // A title the screen OCR broke in two: the second half completes a known objective.
    else if (same && !objectiveStageCandidates(same.text, quest).length && objectiveStageCandidates(`${same.text} ${line}`, quest).length) same.text += ` ${line}`
    // An unknown objective is still the first line of its block (no verb list is ever complete).
    else if (!same && /[a-zа-яё]/.test(line) && line.split(/\s+/).length >= 2) rows.push({ text: line, optional })
    else if (same && line.split(/\s+/).length >= 3 && /[a-zа-яё]/.test(line)) same.hint = same.hint ? `${same.hint} ${line}` : line
    // Anything else (an item label of the stash grid like «Патч Богат.», a stray UI word) is not an objective.
    if (rows.length >= 40) break
  }
  const seen = new Set<string>()
  return rows.flatMap(({ text: row, optional, hint }) => {
    const counter = row.match(/(?:^|\s)(\d{1,7})\s*\/\s*(\d{1,7})(?:\s|$)/)
    const current = counter ? Number(counter[1]) : undefined
    // OCR sometimes appends isolated digits / checkbox fragments after the counter.
    const withoutTail = counter && /^[\s\d|.,:;-]*$/.test(row.slice(counter.index! + counter[0].length)) ? row.slice(0, counter.index) : row
    const counterless = stripProgressBar(withoutTail.replace(/(?:^|\s)\d{1,7}\s*\/\s*\d{1,7}(?=\s|$)/g, '').trim())
    // «Сообщить Скупщику, что поручение выполнено» ends with the status word as part of its own title: only a second
    // one after it is the status.
    const ownWord = endsWithTitleStatus(counterless, quest)
    const status = ownWord ? /(?:выполнено|готово|completed)\s*[.!]?\s+(?:выполнено|готово|completed)\s*[.!]?\s*$/i : /(?:выполнено|готово|completed)\s*[.!]?\s*$/i
    const label = stripProgressBar((status.test(counterless) ? counterless.replace(/\s*(?:выполнено|готово|completed)\s*[.!]?\s*$/i, '') : counterless).trim())
    const key = ocrKey(label)
    if (key.length < 8 || seen.has(`${optional}:${key}`)) return []
    seen.add(`${optional}:${key}`)
    // Repeated instructions: the first copy here; storyScan.ts moves it to the copy of the stage being played.
    const stageIndex = objectiveStageCandidates(label, quest)[0]?.index
    const total = counter ? catalogTotal(Number(counter[2]), stageIndex != null ? quest.stages?.[stageIndex]?.progressTotal : undefined) : undefined
    const validCounter = current != null && total != null && total > 0 && current <= total
    const completed = status.test(counterless) || (validCounter && current === total)
    return [{ id: `${optional ? 'optional' : 'main'}:${key}`, text: label, optional, completed,
      ...(stageIndex != null ? { stageIndex } : {}), ...(validCounter ? { current, total } : {}), ...(hint ? { hint: hint.slice(0, 300) } : {}) }]
  })
}
