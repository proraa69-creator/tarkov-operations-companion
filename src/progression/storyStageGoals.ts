import type { Quest } from '../domain/types'
import { STORY_CHAPTER_SEEDS, STORY_NEEDS } from '../data/storyChapterSeeds'
import { storyChapterId } from '../endings/storyEndings'

/**
 * What a player marks on a story stage (owner, 05.11.2026: «все подзадачи должны отмечаться галочкой, а если их несколько, там,
 * например, посетить таможню 3 раза, или выжить 1 раз… Если 1 раз надо выжить, значит 1 галочка, а если нужно 3 раза посетить, то это
 * отдельная будет кнопка… плюс-минус»). Worked out from the stage's own data: «выжить или посетить 3 раза» is either of two goals;
 * «передать 5 предметов» a counter; a stage's steps go under it, those the game marks as optional do not hold the way on.
 */
export interface StageGoal {
  /** Stable within the stage: what the player's marks are kept by. */
  key: string
  text: { ru: string; en?: string }
  /** A counter with plus and minus up to this; none: one tick. */
  target?: number
  optional?: boolean
  /** One of the stage's goals of which any one is enough. */
  either?: boolean
}

export interface StageGoals {
  goals: StageGoal[]
  /** What helps with it: where, what to bring. */
  hint?: string
}

/** The player's marks on one stage: goal → 1 for a tick, the number for a counter. */
export type StageMarks = Readonly<Record<string, number>>

const VISIT_RU = /^(.*?) или посетить (.+?) (\d+) раза?$/i
const VISIT_EN = /^(.*?) or visit (.+?) (\d+) times?$/i
/** A number of things to hand over, get or kill; not «5-го класса», «1 000 000 долларов», «уровня». */
const COUNTED_RU = /^(?:Передать|Доставить|Добыть|Ликвидировать|Убить)\s[^0-9]*?(\d{1,3})\s+(?!\d)/
const COUNTED_EN = /^(?:Hand over|Hand in|Deliver|Obtain|Eliminate|Kill)\s[^0-9]*?(\d{1,3})\s+(?!\d)/i

const either = (place: string, placeEn: string, accusative: string, times: number): StageGoal[] => [
  { key: 'survive', text: { ru: `Выжить на локации ${place} и выйти`, en: `Survive and extract from ${placeEn}` }, either: true },
  { key: 'visit', text: { ru: `Посетить ${accusative}`, en: `Visit ${placeEn}` }, target: times, either: true },
]

/** The Tour's stages whose goals stand only in their description: «Обеспечить доступ…» is several things to do. */
const TOUR_GOALS: Record<string, StageGoal[]> = {
  'story-tour-2': [{ key: 'pay', text: { ru: 'Передать Терапевту 250 000 ₽', en: 'Hand over 250,000 ₽ to Therapist' } }],
  'story-tour-19': [
    ...either('Берег', 'Shoreline', 'Берег', 3),
    { key: 'tags', text: { ru: 'Передать Прапору 5 армейских жетонов', en: 'Hand over 5 PMC dogtags to Prapor' }, target: 5 },
  ],
  'story-tour-20': [{ key: 'pay', text: { ru: 'Передать Механику 8 000 долларов', en: 'Hand over $8,000 to Mechanic' } }],
  'story-tour-21': [
    { key: 'reach', text: { ru: 'Попасть на секретный объект TerraGroup', en: 'Access the secret TerraGroup facility' } },
    { key: 'offices', text: { ru: 'Осмотреть офисы топ-менеджеров', en: 'Search the top management offices' } },
    { key: 'servers', text: { ru: 'Осмотреть серверную', en: 'Search the server room' } },
    { key: 'drain', text: { ru: 'Найти путь отхода через водосток', en: 'Locate the escape path through the drainage system' } },
    { key: 'card', text: { ru: 'Найти ключ-карту или коды доступа', en: 'Obtain a keycard or access codes' }, optional: true },
    { key: 'factory', text: { ru: 'Найти вход на локации Завод', en: 'Locate the entrance on Factory' }, optional: true },
    { key: 'streets', text: { ru: 'Найти вход на локации Улицы Таркова', en: 'Locate the entrance on Streets of Tarkov' }, optional: true },
  ],
}

/** The goals of a stage of a chapter; a stage the app does not know has none. */
export function stageGoals(quest: Pick<Quest, 'id' | 'name' | 'normalizedName' | 'kind' | 'stages'>, index: number): StageGoals {
  const stage = quest.stages?.[index]
  if (!stage) return { goals: [] }
  const chapter = storyChapterId(quest)
  const seed = chapter ? STORY_CHAPTER_SEEDS.find((entry) => entry.id === chapter)?.stages[index] : undefined
  // The chapter's own words: the stage's title is in the app's language, and a stage's goals must not depend on it.
  const hint = seed ? (seed.needs ? STORY_NEEDS[seed.needs] ?? seed.needs : undefined) : stage.description || undefined
  const listed = TOUR_GOALS[stage.id]
  if (listed) return { goals: listed }
  const visitRu = VISIT_RU.exec(stage.title)
  const visitEn = visitRu ? null : VISIT_EN.exec(stage.title)
  if (visitRu || visitEn) {
    const visit = (visitRu ?? visitEn)!
    return {
      goals: [
        { key: 'survive', text: { ru: visit[1]! }, either: true },
        { key: 'visit', text: { ru: `${visitRu ? 'Посетить' : 'Visit'} ${visit[2]}` }, target: Number(visit[3]), either: true },
      ],
    }
  }
  const counted = Number((seed ? COUNTED_RU.exec(seed.ru) : COUNTED_RU.exec(stage.title) ?? COUNTED_EN.exec(stage.title))?.[1] ?? 0)
  const main: StageGoal = { key: 'main', text: seed ? { ru: seed.ru, en: seed.en } : { ru: stage.title }, ...(counted >= 2 ? { target: counted } : {}), ...(stage.optional ? { optional: true } : {}) }
  const steps = (seed?.steps ?? []).map((step, position): StageGoal => ({ key: `step-${position}`, text: { ru: step.ru, en: step.en }, ...(step.optional ? { optional: true } : {}) }))
  return { goals: [main, ...steps], ...(hint ? { hint } : {}) }
}

export function goalDone(goal: StageGoal, marks: StageMarks) {
  return (marks[goal.key] ?? 0) >= (goal.target ?? 1)
}

/** The way on is open: every required goal is done, of those where either is enough, one. A stage with only optional goals never holds it. */
export function stageDone({ goals }: StageGoals, marks: StageMarks) {
  const required = goals.filter((goal) => !goal.optional)
  const alternatives = required.filter((goal) => goal.either)
  return required.filter((goal) => !goal.either).every((goal) => goalDone(goal, marks)) && (!alternatives.length || alternatives.some((goal) => goalDone(goal, marks)))
}
