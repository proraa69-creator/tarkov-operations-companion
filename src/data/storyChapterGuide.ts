import type { Quest } from '../domain/types'
import type { EndingId } from '../endings/storyEndings'
import { STORY_BRANCHES, STORY_CHAPTER_SEEDS, STORY_NEEDS, type StoryText } from './storyChapterSeeds'
import { STORY_GUIDE_DATA } from './storyChapterGuideData'
import { storyChapterTitles } from './storyChapters'

/**
 * The full guide of every story chapter for the «Показать все» view of the Quests page (owner, 14.10.2026: «откроются все
 * сюжетные квесты которые есть в базе… все точки все предметы которые нужно сдать и найти и все все все»). The data
 * (src/data/storyChapterGuideData.ts) is the wiki's objective list merged with the tracked stages; this module joins it
 * with a chapter of the quest base, in both languages. Display only: chapter progress stays with the tracked stages.
 */

/** What to do with an item: hand it over, find it, plant / stash it, bring it along, a key, a tool needed on the spot. */
export type StoryGuideItemRole = 'handover' | 'find' | 'place' | 'bring' | 'key' | 'need'

export interface StoryGuideItem extends StoryText {
  /** tarkov.dev item id (a catalog item or a quest item); absent when tarkov.dev has no single entry for it. */
  id?: string
  count?: number
  role: StoryGuideItemRole
  /** Must be found in raid (ordinary items; a quest item is always found in raid). */
  fir?: boolean
  optional?: boolean
  /** A quest item: not in the item catalog (no flea page). */
  quest?: boolean
}

export interface StoryGuideStep extends StoryText { optional?: boolean; depth?: number }

export interface StoryGuideObjectiveData {
  /** Index of the tracked stage (quest.stages) this objective is. */
  stage?: number
  en?: string
  ru?: string
  /** On the wiki's list but not among the tracked stages. */
  untracked?: boolean
  /** The route it belongs to (EN header, STORY_BRANCHES has the Russian). */
  branch?: string
  endings?: EndingId[]
  optional?: boolean
  count?: number
  maps?: string[]
  items?: StoryGuideItem[]
  steps?: StoryGuideStep[]
  note?: StoryText
}

export interface StoryGuideRewardGroup {
  title: StoryText
  en: string[]
  ru: string[]
  items: Array<StoryText & { id: string; count?: number; quest?: boolean }>
}

export interface StoryGuideChapterData {
  id: string
  unlock: StoryText
  objectives: StoryGuideObjectiveData[]
  rewards: StoryGuideRewardGroup[]
}

export interface StoryGuideObjective {
  key: string
  text: StoryText
  stage?: number
  untracked: boolean
  optional: boolean
  branch?: StoryText & { key: string }
  endings: EndingId[]
  count?: number
  /** The tracked stage's maps first (they have the points), then the ones the wiki names. */
  maps: string[]
  /** Maps where the tracked stage has a point or an area on the map. */
  pointMaps: string[]
  items: StoryGuideItem[]
  steps: StoryGuideStep[]
  /** A key or an item the stage needs (storyChapterSeeds `needs`). */
  needs?: StoryText
  note?: StoryText
}

export interface StoryGuideChapter {
  /** Chapter id of the seeds (`falling-skies`); the quest is `story-<id>`. */
  id: string
  title: StoryText
  unlock?: StoryText
  objectives: StoryGuideObjective[]
  rewards: StoryGuideRewardGroup[]
  /** Keys and tools the chapter needs: every `key` / `need` item and every stage's `needs`. */
  keys: StoryGuideItem[]
}

const SEEDS = new Map(STORY_CHAPTER_SEEDS.map((chapter) => [chapter.id, chapter]))
const GUIDE = new Map(STORY_GUIDE_DATA.map((chapter) => [chapter.id, chapter]))

/** The guide's chapter id of a story quest of the base (`falling-skies`), or undefined for an unknown chapter. */
export function storyGuideChapterId(quest: Pick<Quest, 'id' | 'name' | 'normalizedName' | 'kind'>): string | undefined {
  if (quest.kind !== 'story') return undefined
  return storyChapterTitles(quest)?.id.replace(/^story-/, '')
}

/** Every chapter the guide has data for (chapter ids, story order). */
export function storyGuideChapterIds(): string[] {
  return STORY_GUIDE_DATA.map((chapter) => chapter.id)
}

const branchText = (branch: string): StoryText & { key: string } => ({ key: branch, en: branch, ru: STORY_BRANCHES[branch] ?? branch })

/**
 * The guide of a story quest of the base: the wiki's objectives joined with the quest's tracked stages (their titles in
 * both languages, maps and points), items, rewards and keys. A chapter the guide has no data for lists the quest's own
 * stages, so every chapter of the base shows up.
 */
export function storyChapterGuide(quest: Quest): StoryGuideChapter {
  const id = storyGuideChapterId(quest) ?? quest.normalizedName ?? quest.id
  const titles = storyChapterTitles(quest)
  const seed = SEEDS.get(id)
  const data = GUIDE.get(id)
  const stages = quest.stages ?? []
  const stageText = (index: number): StoryText => {
    const seedStage = seed?.stages[index]
    if (seedStage) return { ru: seedStage.ru, en: seedStage.en }
    const title = stages[index]?.title ?? ''
    return { ru: title, en: title }
  }
  const stagePart = (index: number | undefined) => {
    if (index == null) return { maps: [] as string[], pointMaps: [] as string[], steps: [] as StoryGuideStep[], needs: undefined }
    const stage = stages[index]
    const seedStage = seed?.stages[index]
    const needs = seedStage?.needs ? { en: seedStage.needs, ru: STORY_NEEDS[seedStage.needs] ?? seedStage.needs } : undefined
    return {
      maps: stage?.mapIds ?? seedStage?.mapIds ?? [],
      pointMaps: [...new Set((stage?.points ?? []).map((point) => point.mapId))],
      steps: (seedStage?.steps ?? []).map((step) => ({ en: step.en, ru: step.ru, ...(step.optional ? { optional: true } : {}) })),
      needs,
    }
  }
  const rows: StoryGuideObjectiveData[] = data?.objectives ?? stages.map((_, index) => ({ stage: index }))
  const objectives = rows.map((row, index): StoryGuideObjective => {
    const own = stagePart(row.stage)
    const base = row.stage != null ? stageText(row.stage) : { en: row.en ?? '', ru: row.ru ?? row.en ?? '' }
    const seedStage = row.stage != null ? seed?.stages[row.stage] : undefined
    return {
      key: `${id}-${index}`,
      text: { en: row.en ?? base.en, ru: row.ru ?? base.ru },
      stage: row.stage,
      untracked: row.stage == null,
      optional: Boolean(row.optional ?? (seedStage?.optional || stages[row.stage ?? -1]?.optional)),
      branch: row.branch ? branchText(row.branch) : seedStage?.branch ? branchText(seedStage.branch) : undefined,
      endings: row.endings ?? [],
      count: row.count ?? (row.stage != null ? stages[row.stage]?.progressTotal : undefined),
      maps: [...new Set([...own.maps, ...(row.maps ?? [])])],
      pointMaps: own.pointMaps,
      items: row.items ?? [],
      steps: [...own.steps, ...(row.steps ?? [])],
      needs: own.needs,
      note: row.note,
    }
  })
  const keys: StoryGuideChapter['keys'] = []
  const seen = new Set<string>()
  for (const objective of objectives) {
    for (const item of objective.items) {
      if ((item.role !== 'key' && item.role !== 'need') || seen.has(item.id ?? item.en)) continue
      seen.add(item.id ?? item.en)
      keys.push(item)
    }
    if (objective.needs && !seen.has(objective.needs.en)) {
      seen.add(objective.needs.en)
      keys.push({ ...objective.needs, role: 'need' })
    }
  }
  return {
    id,
    title: titles ? { ru: titles.ru, en: titles.en } : { ru: quest.nameRu ?? quest.name, en: quest.nameEn ?? quest.name },
    unlock: data?.unlock,
    objectives,
    rewards: data?.rewards ?? [],
    keys,
  }
}

/** All of a guide chapter's searchable text in one language (the view's search). */
export function storyGuideSearchText(chapter: StoryGuideChapter, lang: 'ru' | 'en'): string {
  const parts: string[] = [chapter.title.ru, chapter.title.en]
  for (const objective of chapter.objectives) {
    parts.push(objective.text[lang], ...objective.steps.map((step) => step[lang]), ...objective.items.map((item) => item[lang]))
    if (objective.branch) parts.push(objective.branch[lang])
  }
  for (const group of chapter.rewards) parts.push(group.title[lang], ...group[lang], ...group.items.map((item) => item[lang]))
  return parts.join('\n').toLowerCase()
}
