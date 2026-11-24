import { STORY_DECISIONS, type DecisionOption, type Phrase } from '../endings/storyEndings'
import { STORY_CHAPTER_SEEDS } from './storyChapterSeeds'

/**
 * The routes of the story chapters, for marking them by hand (owner, 05.11.2026: «учитывая, что у сюжетных квестов есть развитие
 * событий, разные концовки… если вы сдадите этот предмет тому-то, у вас будет такая концовка»). A chapter's stages are one flat list
 * (storyChapterSeeds.ts), though some are the routes of a choice: Mr. Kerman's offer accepted and refused stand one after the other.
 * So each stage says which answers it belongs to, by its branch header or by itself, and the way on from a stage takes the first later
 * stage the player's answers allow. An answer not given yet is asked when the way on comes to it.
 */
export interface RouteOption {
  id: string
  label: Phrase
  /** Where it leads and to which endings (endings/storyEndings.ts), when the app knows. */
  decision?: DecisionOption
}
export interface RouteQuestion { id: string; title: Phrase; options: RouteOption[] }

const p = (ru: string, en: string): Phrase => ({ ru, en })
const decision = (id: string, index: number) => STORY_DECISIONS.find((entry) => entry.id === id)?.options[index]

export const ROUTE_QUESTIONS: Record<string, RouteQuestion> = {
  'armored-case': {
    id: 'armored-case',
    title: p('Что вы сделали с бронированным кейсом?', 'What did you do with the armored case?'),
    options: [
      { id: 'prapor', label: p('Отдали кейс Прапору', 'Gave the case to Prapor'), decision: decision('armored-case', 0) },
      { id: 'kept', label: p('Оставили кейс себе', 'Kept the case'), decision: decision('armored-case', 1) },
    ],
  },
  'kerman-offer': {
    id: 'kerman-offer',
    title: p('Что вы ответили мистеру Керману?', 'What did you answer Mr. Kerman?'),
    options: [
      { id: 'accept', label: p('Приняли предложение', 'Accepted the offer'), decision: decision('kerman-offer', 1) },
      { id: 'refuse', label: p('Отказались', 'Refused'), decision: decision('kerman-offer', 0) },
    ],
  },
  'kerman-evidence': {
    id: 'kerman-evidence',
    title: p('Компромат на TerraGroup для мистера Кермана', 'The dirt on TerraGroup for Mr. Kerman'),
    options: [
      { id: 'agree', label: p('Помогаете собрать', 'You help collect it'), decision: decision('kerman-evidence', 0) },
      { id: 'refuse', label: p('Не помогаете', 'You do not help'), decision: decision('kerman-evidence', 1) },
      { id: 'betray', label: p('Передали часть и отказались', 'Gave part of it and refused'), decision: decision('kerman-evidence', 2) },
    ],
  },
  'prapor-72h': {
    id: 'prapor-72h',
    title: p('Задания Прапора на 72 часа', 'Prapor\'s 72-hour tasks'),
    options: [
      { id: 'in-time', label: p('Успели', 'Made it in time'), decision: decision('prapor-72h', 0) },
      { id: 'late', label: p('Не успели', 'Missed the time'), decision: decision('prapor-72h', 1) },
    ],
  },
  'major-evidence': {
    id: 'major-evidence',
    title: p('Главная улика из главы «Они уже здесь»', 'The major evidence from «They Are Already Here»'),
    options: [
      { id: 'yes', label: p('Получена', 'Obtained') },
      { id: 'no', label: p('Не получена', 'Not obtained') },
    ],
  },
  'fragment-1156': {
    id: 'fragment-1156',
    title: p('Что вы сделали с фрагментом Изделия 1156?', 'What did you do with the Item 1156 fragment?'),
    options: [
      { id: 'give', label: p('Передали Механику', 'Gave it to Mechanic') },
      { id: 'keep', label: p('Оставили себе', 'Kept it') },
    ],
  },
  'boreas-transport': {
    id: 'boreas-transport',
    title: p('Какое задание у вас выполнено?', 'Which task have you completed?'),
    options: [
      { id: 'independence', label: p('«Цена независимости»', '«The Price of Independence»') },
      { id: 'friends', label: p('«Выбирай друзей с умом»', '«Choose Your Friends Wisely»') },
      { id: 'neither', label: p('Ни одно из них', 'Neither of them') },
    ],
  },
}

/** A stage belongs to these answers: question → the options it stands on. */
type Rule = Record<string, readonly string[]>

const BRANCH_RULES: Record<string, Rule> = {
  'If the Armored case was given to Prapor in Falling Skies': { 'armored-case': ['prapor'] },
  'If you gave the Armored case to Prapor in Falling Skies': { 'armored-case': ['prapor'] },
  'If you kept the Armored case from Prapor in Falling Skies': { 'armored-case': ['kept'] },
  'If you accept Mr. Kerman\'s offer': { 'kerman-offer': ['accept'] },
  'If you refuse Mr. Kerman\'s offer': { 'kerman-offer': ['refuse'] },
  'If you accept Mr. Kerman\'s offer and agree to find evidence on TerraGroup': { 'kerman-offer': ['accept'], 'kerman-evidence': ['agree', 'betray'] },
  'If you accept Mr. Kerman\'s offer and refuse to find evidence on TerraGroup': { 'kerman-offer': ['accept'], 'kerman-evidence': ['refuse'] },
  'If you accept Mr. Kerman\'s offer and agree to find evidence on TerraGroup, but refuse to hand in more than 2 major evidence': { 'kerman-offer': ['accept'], 'kerman-evidence': ['betray'] },
  'If player failed to obtain the major evidence from They Are Already Here': { 'kerman-offer': ['accept'], 'kerman-evidence': ['agree', 'betray'], 'major-evidence': ['no'] },
  'If player received the major evidence from They Are Already Here': { 'kerman-offer': ['accept'], 'kerman-evidence': ['agree'], 'major-evidence': ['yes'] },
  'Only if you fail to complete Prapor\'s tasks in time': { 'kerman-offer': ['refuse'], 'prapor-72h': ['late'] },
  'If you have completed The Price of Independence': { 'boreas-transport': ['independence'] },
  'If you have completed Choose Your Friends Wisely': { 'boreas-transport': ['friends'] },
  'If you have not completed either The Price of Independence or Choose Your Friends Wisely': { 'boreas-transport': ['neither'] },
}

/** Stages that are a choice themselves, with no header of their own: the rest of the chapter does not depend on it. */
const STAGE_RULES: Record<string, Record<number, Rule>> = {
  'falling-skies': { 18: { 'armored-case': ['prapor'] }, 19: { 'armored-case': ['kept'] } },
  'blue-fire': { 4: { 'fragment-1156': ['give'] }, 5: { 'fragment-1156': ['keep'] } },
}

/** Headers that depend on another chapter: `If you have not completed Falling Skies`. */
const UNLESS_DONE: Record<string, string> = { 'If you have not completed Falling Skies': 'falling-skies' }

export type RouteChoices = Readonly<Record<string, string>>
/** What the app knows besides the answers: a chapter (its seed id) marked as completed. */
export type ChapterDone = (chapterId: string) => boolean

function stageRule(chapterId: string, index: number): Rule {
  const stage = STORY_CHAPTER_SEEDS.find((chapter) => chapter.id === chapterId)?.stages[index]
  return { ...(stage?.branch ? BRANCH_RULES[stage.branch] : undefined), ...STAGE_RULES[chapterId]?.[index] }
}

function excludedByChapter(chapterId: string, index: number, done: ChapterDone) {
  const branch = STORY_CHAPTER_SEEDS.find((chapter) => chapter.id === chapterId)?.stages[index]?.branch
  const other = branch ? UNLESS_DONE[branch] : undefined
  return Boolean(other && done(other))
}

/** The way on from a stage: the next stage the answers allow, `null` at the chapter's end, or the question that decides it. */
export function nextStoryStage(chapterId: string | undefined, from: number, total: number, choices: RouteChoices, done: ChapterDone = () => false): { index: number | null; ask?: RouteQuestion } {
  if (!chapterId) return { index: from + 1 < total ? from + 1 : null }
  for (let index = from + 1; index < total; index += 1) {
    if (excludedByChapter(chapterId, index, done)) continue
    let allowed = true
    for (const [question, options] of Object.entries(stageRule(chapterId, index))) {
      const answer = choices[question]
      if (answer === undefined) return { index: null, ask: ROUTE_QUESTIONS[question] }
      if (!options.includes(answer)) { allowed = false; break }
    }
    if (allowed) return { index }
  }
  return { index: null }
}

/** «Вернуться к прошлому этапу»: the stage before on the player's route; a route not answered does not stand in the way. */
export function previousStoryStage(chapterId: string | undefined, from: number, choices: RouteChoices, done: ChapterDone = () => false): number | null {
  for (let index = from - 1; index >= 0; index -= 1) {
    if (!chapterId) return index
    if (excludedByChapter(chapterId, index, done)) continue
    const fits = Object.entries(stageRule(chapterId, index)).every(([question, options]) => choices[question] === undefined || options.includes(choices[question]))
    if (fits) return index
  }
  return null
}

/** The answers a stage stands on, when picked by hand from the chapter's list: a stage of one route says which route was taken. */
export function choicesOfStage(chapterId: string | undefined, index: number): Record<string, string> {
  if (!chapterId) return {}
  const implied: Record<string, string> = {}
  for (const [question, options] of Object.entries(stageRule(chapterId, index))) if (options.length === 1) implied[question] = options[0]!
  return implied
}
