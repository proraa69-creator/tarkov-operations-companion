/**
 * What an item of «Тир листы» is needed for (owner, 26.11.2026, with report 243: «модули… для каких квестов оружейника они
 * нужны. А по другим предметам, которые нужны для квестов или для того, чтобы заложить, отметить… при наведении должно
 * показываться окно, для какого квеста нужно, если бартер…»): the quests of this mode's catalog that ask for it (hand over,
 * find, plant, mark, bring, fire, use, a key), the Gunsmith parts whose build takes it, and the traders' barters that take it.
 *
 * Only this mode's catalog and this mode's progress (PvP, PvE and Season apart): a completed quest's use stays, marked done.
 * The counts are raidprep/keepList.ts questItemNeeds' (an objective accepting a large set of items is not a need of each).
 */
import type { ModeProgress, Quest, TaskProgressStatus } from '../domain/types'
import type { Barter } from '../data/economyApi'
import { prestigeMismatch } from '../progression/prestigeQuests'
import { isLiveGameQuest, questFaction } from '../progression/questBasics'
import { questItemNeeds } from '../raidprep/keepList'
import { gunsmithSteps } from '../gunsmith/gunsmith'

export type QuestUseKind = 'handover' | 'find' | 'place' | 'mark' | 'bring' | 'signal' | 'use' | 'key'
/** A Gunsmith part's use: the weapon to modify, a part it must have, one of several it may have, a part of the ready build. */
export type GunsmithRole = 'weapon' | 'required' | 'oneOf' | 'build'

export interface ItemQuestUse {
  questId: string
  name: string
  level: number
  done: boolean
  /** What the quest has the player do with it, the strongest first (hand over before find). */
  kinds: QuestUseKind[]
  count: number
  foundInRaid: boolean
  gunsmith?: GunsmithRole
}

export interface ItemBarterUse {
  id: string
  trader: string
  level: number
  count: number
  rewardId: string
  rewardCount: number
}

const KIND_ORDER: QuestUseKind[] = ['handover', 'find', 'place', 'mark', 'bring', 'signal', 'use', 'key']
const ROLE_ORDER: GunsmithRole[] = ['weapon', 'required', 'oneOf', 'build']

type Progress = Pick<ModeProgress, 'faction' | 'taskProgress'> & Partial<Pick<ModeProgress, 'prestige'>>

/**
 * Every item's quests, open ones first by level, the completed ones last. `statusOf` is the quest's status in this mode
 * (the quest pages' availability, else the profile's progress).
 */
export function itemQuestUses(quests: readonly Quest[], progress: Progress | undefined, statusOf: (questId: string) => TaskProgressStatus | undefined): Map<string, ItemQuestUse[]> {
  const byItem = new Map<string, Map<string, ItemQuestUse>>()
  const entryOf = (itemId: string, quest: Quest, done: boolean) => {
    const uses = byItem.get(itemId) ?? new Map<string, ItemQuestUse>()
    byItem.set(itemId, uses)
    const known = uses.get(quest.id)
    if (known) return known
    const use: ItemQuestUse = { questId: quest.id, name: quest.name, level: quest.level, done, kinds: [], count: 0, foundInRaid: false }
    uses.set(quest.id, use)
    return use
  }

  // «Оружейник»: the weapon, the parts its build must have and the parts of the ready build (gunsmith/gunsmith.ts).
  const gunsmith = gunsmithSteps([...quests], statusOf)
  const gunsmithIds = new Set(gunsmith.map((step) => step.quest.id))
  for (const step of gunsmith) {
    const done = step.status === 'completed'
    const mark = (itemId: string | undefined, role: GunsmithRole) => {
      if (!itemId) return
      const use = entryOf(itemId, step.quest, done)
      if (!use.gunsmith || ROLE_ORDER.indexOf(role) < ROLE_ORDER.indexOf(use.gunsmith)) use.gunsmith = role
      use.count = 1
    }
    for (const build of step.builds) {
      mark(build.weaponId, 'weapon')
      for (const id of build.partIds) mark(id, 'required')
      for (const id of build.anyOfIds ?? []) mark(id, 'oneOf')
      for (const part of build.guide?.parts ?? []) mark(part.itemId, part.required ? 'required' : 'build')
    }
  }

  for (const quest of quests) {
    if (!isLiveGameQuest(quest) || gunsmithIds.has(quest.id)) continue
    const status = statusOf(quest.id)
    if (status === 'failed') continue
    const faction = questFaction(quest.faction)
    if (faction && progress && progress.faction !== 'unknown' && faction !== progress.faction) continue
    if (prestigeMismatch(quest, progress?.prestige ?? 0) === 'before') continue
    const done = status === 'completed'
    const needs = questItemNeeds(quest)
    for (const requirement of quest.raidRequirements ?? []) {
      const { itemId, purpose } = requirement
      if (!itemId || requirement.questItem) continue
      const key = purpose === 'key'
      if (key ? requirement.optional : !needs.has(itemId)) continue
      const use = entryOf(itemId, quest, done)
      if (!use.kinds.includes(purpose)) use.kinds.push(purpose)
    }
    for (const [itemId, need] of needs) {
      const use = byItem.get(itemId)?.get(quest.id)
      if (!use) continue
      use.count = need.count
      use.foundInRaid = need.foundInRaid
    }
  }

  const result = new Map<string, ItemQuestUse[]>()
  for (const [itemId, uses] of byItem) {
    const list = [...uses.values()]
    for (const use of list) {
      use.kinds.sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
      if (!use.count) use.count = 1
    }
    result.set(itemId, list.sort((a, b) => Number(a.done) - Number(b.done) || a.level - b.level || a.name.localeCompare(b.name, 'ru')))
  }
  return result
}

/** Every item's barters: the trader's barters that take it, by the trader's level. */
export function itemBarterUses(barters: readonly Barter[]): Map<string, ItemBarterUse[]> {
  const result = new Map<string, ItemBarterUse[]>()
  for (const barter of barters) {
    const reward = barter.rewardItems[0]
    if (!reward) continue
    for (const { itemId, count } of barter.requiredItems) {
      const list = result.get(itemId) ?? []
      // One barter asks for an item once; the same exchange listed twice (a quest-locked copy of it) is one row.
      if (list.some((use) => use.id === barter.id || (use.trader === barter.traderName && use.level === barter.level && use.count === count && use.rewardId === reward.itemId && use.rewardCount === reward.count))) continue
      list.push({ id: barter.id, trader: barter.traderName, level: barter.level, count, rewardId: reward.itemId, rewardCount: reward.count })
      result.set(itemId, list)
    }
  }
  for (const list of result.values()) list.sort((a, b) => a.level - b.level || a.trader.localeCompare(b.trader, 'ru'))
  return result
}

const KINDS: Record<QuestUseKind, [string, string]> = {
  handover: ['сдать', 'hand over'], find: ['найти', 'find'], place: ['заложить', 'plant'], mark: ['отметить', 'mark'],
  bring: ['взять в рейд', 'bring'], signal: ['запустить ракету', 'fire a flare'], use: ['использовать', 'use'], key: ['ключ', 'key'],
}
const ROLES: Record<GunsmithRole, [string, string]> = {
  weapon: ['оружие', 'weapon'], required: ['обязательно', 'required'], oneOf: ['один из вариантов', 'one of several'], build: ['в сборке', 'in the build'],
}

/**
 * What the quest has the player do with the item: the word, then its count and found-in-raid apart («сдать», « 2 · FIR»),
 * so the other languages' phrases (src/i18n/locales) find the word whole.
 */
export function needParts(use: ItemQuestUse, en: boolean): [word: string, rest: string] {
  if (use.done) return [en ? 'done' : 'выполнен', '']
  if (use.gunsmith) return [ROLES[use.gunsmith][en ? 1 : 0], '']
  const kind = use.kinds[0] ?? 'handover'
  const counted = use.count > 1 && kind !== 'key' && kind !== 'mark'
  return [KINDS[kind][en ? 1 : 0], `${counted ? ` ${use.count}` : ''}${use.foundInRaid && (kind === 'handover' || kind === 'find') ? ' · FIR' : ''}`]
}

/** needParts as one text: «сдать 2 · FIR», «заложить», «обязательно». */
export const needText = (use: ItemQuestUse, en: boolean) => needParts(use, en).join('')
