import type { Quest, TaskRequirement } from '../../domain/types'
import { chronologyStages, traderKeyOf } from '../../progression/chronology'
import { traderChronologyGroups } from '../../progression/chronologyView'
import { isLiveGameQuest, questRequirements } from '../../progression/questBasics'
import { sortQuestsChronologically } from '../../progression/questChronology'

/**
 * «Дерево квестов» (owner, 05.11.2026: «какой за каким идет, какой квест какой открывает. Прям вот дерево»).
 *
 * The game opens a quest in two ways, and the tree shows both as they are:
 * - a chain: the quest's own requirements (`questRequirements`, the same ones the status engine reads). These are the links.
 * - a stage of its trader: the first dialogue, a level of a trader's line, a loyalty level (`traderChronologyGroups`, the
 *   same order as «Каталог заданий»). Which quest raises a line's level is not in the data, so nothing is drawn from a
 *   quest to a stage: the stages stand on the trader's trunk, and a quest with no earlier quest of its trader hangs from its stage.
 *
 * Each trader has a lane. A link between two traders' quests is not drawn across the lanes: each side shows the other quest
 * as a chip that leads to it, so one trader's tree can be read on its own.
 */
export type QuestLinkKind = 'complete' | 'active' | 'failed' | 'closed'

export interface QuestTreeLink {
  from: string
  to: string
  kind: QuestLinkKind
  /** The two quests are in different lanes. */
  crossLane: boolean
  /** The two quests stand under different stages of one lane (an extra requirement): shown as chips, not as a line across the tree. */
  apart?: boolean
}

/** A link shown as a chip on both sides instead of a line. */
export const isChipLink = (link: QuestTreeLink) => link.crossLane || Boolean(link.apart)

export interface QuestTreeStep {
  key: string
  kind: 'start' | 'line' | 'stage' | 'other' | 'story'
  /** Loyalty level of the stage or line. */
  ll?: number
  /** Line: its place among the trader's lines. */
  order?: number
  /** Line: the level that opens this step. */
  level?: number
  /** The step's quests with no earlier quest of their own trader: they hang from the step. */
  roots: string[]
}

export interface QuestTreeLane {
  key: string
  trader: string
  traderId?: string
  story: boolean
  /** The trader gives tasks by lines (the seven main traders). */
  hasLines: boolean
  steps: QuestTreeStep[]
  /** Every quest of the lane, from the first stage to the last. */
  questIds: string[]
}

export interface QuestTreeModel {
  lanes: QuestTreeLane[]
  quests: ReadonlyMap<string, Quest>
  laneOf: ReadonlyMap<string, string>
  links: QuestTreeLink[]
  incoming: ReadonlyMap<string, QuestTreeLink[]>
  outgoing: ReadonlyMap<string, QuestTreeLink[]>
  /** A quest's place in the tree: its latest earlier quest of the same lane. */
  parentOf: ReadonlyMap<string, string>
  children: ReadonlyMap<string, string[]>
  /** Column of a quest: always to the right of every earlier quest of its lane. */
  ranks: ReadonlyMap<string, number>
  /** Requirements that would close a circle (broken data): left out, so the quests still stand in the tree. */
  broken: QuestTreeLink[]
  /** Requirements on a quest the tree does not have. */
  unresolved: Array<{ questId: string; taskId: string }>
}

/** Prapor, Therapist, Fence, Skier, Peacekeeper, Mechanic, Ragman, Jaeger, Ref, the BTR driver, Lightkeeper. */
const TRADER_ORDER = [
  '54cb50c76803fa8b248b4571', '54cb57776803fa99248b456e', '579dc571d53a0658a154fbec', '58330581ace78e27b8b10cee',
  '5935c25fb3acc3127c3d8cd9', '5a7c2eca46aef81a7ca2145d', '5ac3b934156ae10c4430e83c', '5c0647fdd443bc2504c2d371',
  '6617beeaa9cfa777ca915b7c', '656f0f98d80a697f855d34b1', '638f541a29ffd1183d187f57',
]
const STORY_LANE = 'story'

const isStory = (quest: Quest) => quest.kind === 'story'

/** The quests of the tree: what the catalog lists, and the story chapters. A chapter's inner objectives and bare wiki pages are not quests of their own. */
export const isQuestTreeQuest = (quest: Quest) => isLiveGameQuest(quest) || isStory(quest)

function linkKind(requirement: TaskRequirement): QuestLinkKind {
  const statuses = new Set(requirement.allowedStatuses.length ? requirement.allowedStatuses : ['complete'])
  if (statuses.has('active')) return 'active'
  if (statuses.has('failed')) return statuses.has('complete') ? 'closed' : 'failed'
  return 'complete'
}

const pushTo = <T,>(map: Map<string, T[]>, key: string, value: T) => {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

export function buildQuestTree(allQuests: readonly Quest[]): QuestTreeModel {
  const catalog = allQuests as Quest[]
  const shown = catalog.filter(isQuestTreeQuest)
  const quests = new Map(shown.map((quest) => [quest.id, quest]))
  const laneKey = (quest: Quest) => isStory(quest) ? STORY_LANE : traderKeyOf(quest)
  const laneOf = new Map(shown.map((quest) => [quest.id, laneKey(quest)]))

  // A requirement on a chapter's inner objective is a requirement on the chapter.
  const chapters = new Map<string, Quest>()
  for (const quest of shown) {
    if (!isStory(quest)) continue
    chapters.set(quest.id.replace(/^story-/, ''), quest)
    if (quest.normalizedName) chapters.set(quest.normalizedName, quest)
  }
  const inner = new Map(catalog.filter((quest) => quest.storyChapterId).map((quest) => [quest.id, quest.storyChapterId!]))
  const resolve = (taskId: string) => quests.get(taskId) ?? chapters.get(inner.get(taskId) ?? '')

  const unresolved: QuestTreeModel['unresolved'] = []
  const rawParents = new Map<string, QuestTreeLink[]>()
  for (const quest of shown) {
    const seen = new Set<string>()
    for (const requirement of questRequirements(quest)) {
      const from = resolve(requirement.taskId)
      if (!from) { unresolved.push({ questId: quest.id, taskId: requirement.taskId }); continue }
      if (from.id === quest.id || seen.has(from.id)) continue
      seen.add(from.id)
      pushTo(rawParents, quest.id, { from: from.id, to: quest.id, kind: linkKind(requirement), crossLane: laneKey(from) !== laneKey(quest) })
    }
  }

  // Broken data must not hang the page or lose a quest: a requirement that closes a circle is left out.
  const broken: QuestTreeLink[] = []
  const links: QuestTreeLink[] = []
  const state = new Map<string, 'open' | 'done'>()
  const visit = (id: string) => {
    state.set(id, 'open')
    for (const link of rawParents.get(id) ?? []) {
      if (state.get(link.from) === 'open') { broken.push(link); continue }
      if (!state.has(link.from)) visit(link.from)
      links.push(link)
    }
    state.set(id, 'done')
  }
  for (const quest of shown) if (!state.has(quest.id)) visit(quest.id)

  const incoming = new Map<string, QuestTreeLink[]>()
  const outgoing = new Map<string, QuestTreeLink[]>()
  for (const link of links) {
    pushTo(incoming, link.to, link)
    pushTo(outgoing, link.from, link)
  }
  const sameLaneParents = (id: string) => (incoming.get(id) ?? []).filter((link) => !link.crossLane)

  const ranks = new Map<string, number>()
  const rankOf = (id: string): number => {
    const known = ranks.get(id)
    if (known !== undefined) return known
    const parents = sameLaneParents(id)
    // A first quest stands right after its stage; with a quest of another trader before it, one column further.
    const rank = parents.length
      ? 1 + Math.max(...parents.map((link) => rankOf(link.from)))
      : (incoming.get(id)?.length ? 2 : 1)
    ranks.set(id, rank)
    return rank
  }
  for (const quest of shown) rankOf(quest.id)

  const parentOf = new Map<string, string>()
  for (const quest of shown) {
    const latest = sameLaneParents(quest.id).reduce<QuestTreeLink | undefined>((best, link) => !best || rankOf(link.from) > rankOf(best.from) ? link : best, undefined)
    if (latest) parentOf.set(quest.id, latest.from)
  }

  // Lanes: in the game's order, unknown traders after the known ones, the story last.
  const byLane = new Map<string, Quest[]>()
  for (const quest of shown) pushTo(byLane, laneKey(quest), quest)
  const place = (key: string) => {
    if (key === STORY_LANE) return Number.MAX_SAFE_INTEGER
    const index = TRADER_ORDER.indexOf(key)
    return index < 0 ? TRADER_ORDER.length : index
  }
  const orderedLanes = [...byLane].sort(([a, own], [b, others]) => place(a) - place(b) || own[0].trader.localeCompare(others[0].trader, 'ru'))
  const stages = chronologyStages(shown)
  const live = shown.filter((quest) => !isStory(quest))

  const children = new Map<string, string[]>()
  const lanes = orderedLanes.map(([key, own]): QuestTreeLane => {
    const story = key === STORY_LANE
    const sorted = story
      ? [...own].sort((a, b) => (a.storyOrder ?? 99) - (b.storyOrder ?? 99) || a.name.localeCompare(b.name, 'ru'))
      : sortQuestsChronologically(own, live)
    const position = new Map(sorted.map((quest, index) => [quest.id, index]))
    for (const quest of sorted) {
      const parent = parentOf.get(quest.id)
      if (parent) pushTo(children, parent, quest.id)
    }
    for (const quest of sorted) children.get(quest.id)?.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0))
    const roots = (list: Quest[]) => list.filter((quest) => !parentOf.has(quest.id)).map((quest) => quest.id)
    const steps: QuestTreeStep[] = story
      ? [{ key: `${key}:chapters`, kind: 'story', roots: roots(sorted) }]
      : traderChronologyGroups(sorted, stages, live).flatMap((group) => group.steps.map((step) => ({
        key: `${key}:${group.key}:${step.level ?? 'all'}`,
        kind: group.kind,
        ...(group.ll ? { ll: group.ll } : {}),
        ...(group.order ? { order: group.order } : {}),
        ...(step.level !== undefined ? { level: step.level } : {}),
        roots: roots(step.quests),
      })))
    const hasLines = own.some((quest) => quest.unlock?.lines?.length)
    // A trader without lines (Fence, Ref, the BTR driver, Lightkeeper) starts with the quests no stage holds back.
    const liveSteps = steps.filter((step) => step.roots.length).sort((a, b) => hasLines ? 0 : Number(b.kind === 'other') - Number(a.kind === 'other'))
    const questIds: string[] = []
    const walk = (id: string) => { questIds.push(id); for (const child of children.get(id) ?? []) walk(child) }
    for (const step of liveSteps) for (const root of step.roots) walk(root)
    return {
      key,
      trader: own[0].trader,
      ...(own[0].traderId ? { traderId: own[0].traderId } : {}),
      story,
      hasLines,
      steps: liveSteps,
      questIds,
    }
  })

  const stepOf = new Map<string, string>()
  for (const lane of lanes) {
    for (const step of lane.steps) {
      const walk = (id: string) => { stepOf.set(id, step.key); for (const child of children.get(id) ?? []) walk(child) }
      for (const root of step.roots) walk(root)
    }
  }
  for (const link of links) if (!link.crossLane && stepOf.get(link.from) !== stepOf.get(link.to)) link.apart = true

  return { lanes, quests, laneOf, links, incoming, outgoing, parentOf, children, ranks, broken, unresolved }
}

/** Everything before a quest and everything it leads to: what lights up when a quest is chosen. */
export function questChain(model: Pick<QuestTreeModel, 'incoming' | 'outgoing'>, questId: string): Set<string> {
  const chain = new Set<string>([questId])
  const walk = (id: string, next: (id: string) => string[]) => {
    for (const other of next(id)) {
      if (chain.has(other)) continue
      chain.add(other)
      walk(other, next)
    }
  }
  walk(questId, (id) => (model.incoming.get(id) ?? []).map((link) => link.from))
  walk(questId, (id) => (model.outgoing.get(id) ?? []).map((link) => link.to))
  return chain
}

const fold = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

/** The quests whose title has the query, in either game language, in the tree's order. `shownName`: the title as the app shows it. */
export function searchQuestTree(model: Pick<QuestTreeModel, 'lanes' | 'quests'>, query: string, shownName: (quest: Quest) => string = (quest) => quest.name, laneKeys?: ReadonlySet<string>): string[] {
  const wanted = fold(query)
  if (!wanted) return []
  return model.lanes.filter((lane) => !laneKeys || laneKeys.has(lane.key)).flatMap((lane) => lane.questIds).filter((id) => {
    const quest = model.quests.get(id)!
    return fold(`${quest.name} ${quest.nameRu ?? ''} ${quest.nameEn ?? ''} ${shownName(quest)}`).includes(wanted)
  })
}
