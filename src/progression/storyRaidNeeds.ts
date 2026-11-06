import type { Item, Quest } from '../domain/types'
import { STORY_GUIDE_DATA } from '../data/storyChapterGuideData'
import { storyGuideChapterId } from '../data/storyChapterGuide'
import { STORY_CHAPTER_SEEDS } from '../data/storyChapterSeeds'

/**
 * «Требования рейда» of a story chapter (owner, 06.11.2026: «Если актуальный текущий этап сюжетного квеста включает какой-то предмет,
 * который нужен например, дверь открыть или что-то заложить, то это тоже должно появляться в требованиях рейда»): what the chapter's
 * current stage has the player take: its keys, what it plants, what it uses. What it finds or hands to a trader is no part of a raid's
 * kit. A quest item is not in the catalog: it comes with its name from the chapter's guide.
 */
type RaidRequirement = NonNullable<Quest['raidRequirements']>[number]

export interface StoryRaidNeeds {
  requirements: RaidRequirement[]
  /** The stage's items the catalog does not have. */
  items: Item[]
}

const PURPOSE_OF_ROLE: Partial<Record<string, RaidRequirement['purpose']>> = { key: 'key', place: 'place', bring: 'bring', need: 'use' }

/** A stage's `needs` in the catalog's items; `use`: not a key. */
const NEED_ITEMS: Record<string, Array<{ ids: string[]; purpose: RaidRequirement['purpose'] }>> = {
  'TerraGroup science office key': [{ ids: ['658199aa38c79576a2569e13'], purpose: 'key' }],
  'Local network hacking device': [{ ids: ['68e63a53371639e1e4004b6e'], purpose: 'place' }],
  'Cult victim\'s apartment key': [{ ids: ['68e96180901b9b10270f1eed'], purpose: 'key' }],
  'Cultist priest\'s note, Dorm room 314 marked key / Abandoned factory marked key / RB-BK marked key / RB-PKPM marked key / RB-VO marked key': [
    { ids: ['68ea9b43b8469178710c158e'], purpose: 'use' },
    { ids: ['5780cf7f2459777de4559322', '63a3a93f8a56922e82001f5d', '5d80c60f86f77440373c4ece', '5ede7a8229445733cb4c18e2', '5d80c62a86f7744036212b3f'], purpose: 'key' },
  ],
  'Toolset': [{ ids: ['590c2e1186f77425357b6124'], purpose: 'use' }],
  'Secure Flash drive': [{ ids: ['590c621186f774138d11ea29'], purpose: 'place' }],
  'Dorm room 110 key': [{ ids: ['59136e1e86f774432f15d133'], purpose: 'key' }],
  'Zmeisky 3 apartment key': [{ ids: ['68e960db934bf7b02d005dab'], purpose: 'key' }],
  'Knossos LLC facility key': [{ ids: ['679b9716597ba2ed120c3d3f'], purpose: 'key' }],
  'Compartment C-1 keycard': [{ ids: ['69bb3f278af9f360ee010a7a'], purpose: 'key' }],
  'BBQ-S43 gas torch': [{ ids: ['67ab3d4b83869afd170fdd3f'], purpose: 'use' }],
}

/** RSP-30 and 26x75 of each colour; either will do. */
const FLARES: Record<string, string[]> = {
  yellow: ['624c0b3340357b5f566e8766', '62389be94d5d474bf712e709'],
  green: ['6217726288ed9f0845317459', '62389aaba63f32501b1b444f'],
  red: ['62178c4d4ecf221597654e3d', '62389ba9a63f32501b1b4451'],
}

function questItem(id: string, name: string, icon: boolean): Item {
  return { id, name, shortName: name, category: 'Бартер', description: '', types: [], prices: [], ...(icon ? { iconUrl: `https://assets.tarkov.dev/${id}-icon.webp` } : {}) } as unknown as Item
}

/** What this stage of the chapter has the player take into a raid, on any of its maps. */
export function storyStageRaidNeeds(quest: Quest, stageIndex: number, catalog: ReadonlyMap<string, Item>, locale: 'ru' | 'en' = 'ru'): StoryRaidNeeds {
  const chapter = storyGuideChapterId(quest)
  if (!chapter) return { requirements: [], items: [] }
  const seed = STORY_CHAPTER_SEEDS.find((entry) => entry.id === chapter)?.stages[stageIndex]
  const stageMaps = quest.stages?.[stageIndex]?.mapIds ?? seed?.mapIds ?? []
  const objectiveId = `${quest.id}:stage-${stageIndex}`
  const requirements: RaidRequirement[] = []
  const items: Item[] = []
  const seen = new Set<string>()
  const add = (itemId: string, purpose: RaidRequirement['purpose'], mapIds: string[], count = 1, alternatives = 1, optional?: boolean) => {
    if (seen.has(itemId)) return
    seen.add(itemId)
    requirements.push({ itemId, count, purpose, mapIds, objectiveId, ...(alternatives > 1 ? { alternatives } : {}), ...(optional ? { optional } : {}) })
  }

  const rows = STORY_GUIDE_DATA.find((entry) => entry.id === chapter)?.objectives?.filter((row) => row.stage === stageIndex) ?? []
  for (const row of rows) {
    const mapIds = row.maps?.length ? row.maps : stageMaps
    const taken = (row.items ?? []).filter((item) => PURPOSE_OF_ROLE[item.role])
    // Things to bring that are all optional in one stage are the ways to do it: one of them will do.
    const ways = taken.filter((item) => item.role === 'bring' && item.optional).length
    for (const item of taken) {
      const id = item.id ?? `story:${chapter}:${stageIndex}:${item.en}`
      if (!catalog.has(id)) items.push(questItem(id, locale === 'en' ? item.en : item.ru, Boolean(item.id)))
      add(id, PURPOSE_OF_ROLE[item.role]!, mapIds, item.count ?? 1, item.role === 'bring' && item.optional ? ways : 1, item.optional)
    }
  }
  if (seed?.needs) {
    for (const need of NEED_ITEMS[seed.needs] ?? []) for (const id of need.ids) add(id, need.purpose, stageMaps, 1, need.ids.length)
  }
  const colour = seed ? /\b(yellow|green|red)\b[^.]*signal flare/i.exec(seed.en)?.[1]?.toLowerCase() : undefined
  if (colour) for (const id of FLARES[colour]!) add(id, 'signal', stageMaps, 1, 2)
  return { requirements, items }
}
