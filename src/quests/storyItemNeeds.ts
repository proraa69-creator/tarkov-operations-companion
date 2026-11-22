import type { Item, ModeProgress, Quest } from '../domain/types'
import { STORY_GUIDE_DATA } from '../data/storyChapterGuideData'
import { storyChapterGuide, storyGuideChapterId, type StoryGuideItem } from '../data/storyChapterGuide'
import { currentStoryStageIndex } from '../progression/requirementEngine'
import { DOLLARS, EUROS, ROUBLES } from '../hideout/hideoutNeeds'
import type { QuestNeed, QuestNeedUse, QuestNeeds } from './questItemNeeds'

const MONEY = new Set([ROUBLES, DOLLARS, EUROS])

/**
 * «Показать только сюжетные» on «Что собрать для квестов» (owner, 17.11.2026, after a player's question «у вас есть
 * отслеживание всех предметов для сюжеток?»): the items the story chapters have the player hand over to the traders
 * (src/data/storyChapterGuideData.ts, role `handover`), in the shape of questNeeds so the same stash shows them.
 *
 * - Money is left out, as on the quests' page; optional stages and optional items too.
 * - A stage of one route only («Если вы приняли предложение мистера Кермана…») is left out: the player may take another one.
 *   An item every route of that stage asks for is needed whatever the route, and counts once.
 * - A stage behind the chapter's current one (or a completed chapter) counts as handed over: it moves to «Собрано».
 *
 * Each use is one stage: `stationId` is `<quest id>#<stage>`, `stationName` the stage's text, `trader` the chapter's title
 * (the page's left column lists the chapters). Quest items are not in the catalog: `questItems` brings them with their names.
 */
export interface StoryNeeds extends QuestNeeds { questItems: Item[] }

export const storyUseQuestId = (stationId: string) => stationId.split('#')[0]!

interface StageItem { stage: number; item: StoryGuideItem }

/** The hand-over items of a chapter, stage by stage, as the rules above take them. */
export function storyHandovers(chapterId: string): StageItem[] {
  const data = STORY_GUIDE_DATA.find((chapter) => chapter.id === chapterId)
  if (!data) return []
  const out: StageItem[] = []
  const routed = new Map<number, Map<string, Map<string, StoryGuideItem>>>()
  for (const objective of data.objectives) {
    if (objective.stage == null || objective.optional) continue
    for (const item of objective.items ?? []) {
      if (item.role !== 'handover' || item.optional || !item.id || MONEY.has(item.id)) continue
      if (!objective.branch) { out.push({ stage: objective.stage, item }); continue }
      const branches = routed.get(objective.stage) ?? new Map<string, Map<string, StoryGuideItem>>()
      const items = branches.get(objective.branch) ?? new Map<string, StoryGuideItem>()
      items.set(item.id, item)
      branches.set(objective.branch, items)
      routed.set(objective.stage, branches)
    }
  }
  // The routes of a stage: an item in every one of them (at least two) is needed whatever the route.
  for (const [stage, branches] of routed) {
    if (branches.size < 2) continue
    const all = [...branches.values()]
    for (const [id, item] of all[0]!) if (all.every((items) => items.has(id))) out.push({ stage, item })
  }
  return out.sort((a, b) => a.stage - b.stage)
}

function questItem(item: StoryGuideItem, locale: 'ru' | 'en'): Item {
  const name = (locale === 'en' ? item.en : item.ru) || item.en
  return { id: item.id!, name, shortName: name, category: 'Квестовый предмет', description: '', types: [], prices: [], width: 1, height: 1, iconUrl: `https://assets.tarkov.dev/${item.id}-icon.webp` } as unknown as Item
}

export function storyNeeds(quests: readonly Quest[], progress: ModeProgress, marked: ReadonlyMap<string, number>, catalog: ReadonlyMap<string, Item>,
  locale: 'ru' | 'en' = 'ru', onlyChapter?: string): StoryNeeds {
  const byItem = new Map<string, QuestNeedUse[]>()
  const questItems = new Map<string, Item>()
  for (const quest of quests) {
    const chapterId = storyGuideChapterId(quest)
    if (!chapterId) continue
    const status = progress.taskProgress[quest.id]?.status
    if (status === 'failed') continue
    const guide = storyChapterGuide(quest)
    const chapter = (locale === 'en' ? guide.title.en : guide.title.ru) || guide.title.ru
    if (onlyChapter && chapter !== onlyChapter) continue
    const current = status === 'completed' ? Infinity : currentStoryStageIndex(quest, progress)
    for (const { stage, item } of storyHandovers(chapterId)) {
      const id = item.id!
      if (!catalog.has(id) && !questItems.has(id)) questItems.set(id, questItem(item, locale))
      const text = guide.objectives.find((objective) => objective.stage === stage)?.text
      const uses = byItem.get(id) ?? []
      uses.push({
        stationId: `${quest.id}#${stage}`, stationName: (locale === 'en' ? text?.en : text?.ru) || chapter, level: stage, trader: chapter,
        count: item.count ?? 1, foundInRaid: Boolean(item.fir || item.quest), done: stage < current,
      })
      byItem.set(id, uses)
    }
  }
  const items = [...byItem].map(([itemId, uses]): QuestNeed => {
    const total = uses.reduce((sum, use) => sum + use.count, 0)
    const completed = uses.filter((use) => use.done).reduce((sum, use) => sum + use.count, 0)
    const found = Math.min(total, completed + Math.max(0, marked.get(itemId) ?? 0))
    return {
      itemId, total, found, remaining: total - found,
      foundInRaid: uses.some((use) => !use.done && use.foundInRaid),
      key: false,
      uses: uses.sort((a, b) => Number(a.done) - Number(b.done) || a.trader.localeCompare(b.trader, 'ru') || a.level - b.level),
    }
  })
  return {
    items,
    money: { roubles: 0, dollars: 0, euros: 0 },
    remaining: items.reduce((sum, item) => sum + item.remaining, 0),
    total: items.reduce((sum, item) => sum + item.total, 0),
    questItems: [...questItems.values()],
  }
}
