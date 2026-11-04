/**
 * The quest chain's rules as checks (owner, 02.11.2026: «построй логическую систему проверок … главное, не допусти
 * регресса обнаружения квестов»). Each check restates one rule of docs/quests/quest-state-engine.md on its own — it never
 * calls the engine — and is run on a mode's inputs, the engine's decision and the lists' availability: an empty answer
 * means every rule holds. The tests run them over every scenario and over random inputs (questChecks.test.ts), so a
 * change that breaks a rule fails there; the owner's «Диагностика квестов» runs them on the live state.
 */
import type { ModeProgress, Quest, QuestInputLayers, TaskProgressRecord } from '../domain/types'
import { gunsmithSteps } from '../gunsmith/gunsmith'
import { isCompletionOnly, questFaction, questRequirements } from '../progression/questBasics'
import type { TaskAvailability } from '../progression/requirementEngine'
import type { QuestResolution, QuestSourceKind } from './questEngine'
import { partHoldingBack } from './screenChain'

export type QuestCheckRule =
  /** Nothing older than the mode's reset floor decides a quest. */
  | 'floor'
  /** The game's newest event (logs, other PCs through the server) hands a quest in or fails it: so it is, unless a newer mark. */
  | 'game-closes'
  /** Where the game reported a quest, the Tasks table or a legacy record never decides it. */
  | 'game-over-screen'
  /** A quest seen held — in the logs, on the screen, by a mark or in the story pane — after the floor is never dropped. */
  | 'seen-stays'
  /** The Tasks table never decides «выполнено». */
  | 'screen-never-completes'
  /** A part of a numbered chain known from the Tasks table only does not stand while the logs say an earlier part was open at that reading. */
  | 'screen-chain'
  /** A «Ручная отметка» at or after the game's event decides; a newer game event beats the mark. */
  | 'mark-order'
  /** The stored statuses are the engine's decision, nothing else (no writer bypasses it). */
  | 'stored-is-decided'
  /** A held or handed-in quest's mandatory prerequisites count as done. */
  | 'chain'
  /** A quest offered as open does not need a higher character level than the player has. */
  | 'level'
  /** A quest offered as open belongs to the player's faction. */
  | 'faction'

export const QUEST_CHECK_TITLES: Record<QuestCheckRule, string> = {
  floor: 'Ниже сброса ничего не решает',
  'game-closes': 'Логи закрывают квест',
  'game-over-screen': 'Логи главнее экрана',
  'seen-stays': 'Найденный квест не пропадает',
  'screen-never-completes': 'Экран не ставит «выполнено»',
  'screen-chain': 'Экран не обгоняет части цепочки',
  'mark-order': 'Ручная отметка против логов',
  'stored-is-decided': 'Статусы — только решение системы',
  chain: 'Цепочка: предыдущие задания выполнены',
  level: 'Уровень персонажа',
  faction: 'Фракция',
}

export interface QuestCheckFinding { rule: QuestCheckRule; questId: string; detail: string }

export interface QuestCheckInput {
  layers: QuestInputLayers
  floor?: string
  resolution: Pick<QuestResolution, 'states'>
  /** The mode's stored records (ModeProgress.taskProgress), checked against the decision. */
  stored?: Record<string, TaskProgressRecord>
  /** The lists' availability over the decision (questReadModel.ts questAvailabilityOf), with its catalog. */
  availability?: ReadonlyMap<string, TaskAvailability>
  quests?: readonly Quest[]
  player?: Pick<ModeProgress, 'playerLevel' | 'faction'>
}

/** The rules that do not hold for this state; empty when the chain is sound. */
export function checkQuestRules(input: QuestCheckInput): QuestCheckFinding[] {
  const { layers, floor, resolution } = input
  const findings: QuestCheckFinding[] = []
  const add = (rule: QuestCheckRule, questId: string, detail: string) => findings.push({ rule, questId, detail })
  const fresh = (at: string | undefined) => Boolean(at) && (!floor || at! >= floor)
  const ids = new Set<string>()
  for (const layer of Object.values(layers)) for (const id of Object.keys(layer ?? {})) ids.add(id)

  for (const taskId of ids) {
    const state = resolution.states.get(taskId)
    const status = state?.status ?? 'not-started'
    const source: QuestSourceKind | undefined = state?.source
    const log = layers.log?.[taskId]
    const server = layers.server?.[taskId]
    const game = [log, server].filter((entry) => entry && fresh(entry.at)).sort((a, b) => b!.at.localeCompare(a!.at))[0]
    const mark = layers.manual?.[taskId]
    const liveMark = mark && mark.status !== 'cleared' && fresh(mark.at) ? mark : undefined
    const story = layers.story?.[taskId] && fresh(layers.story[taskId]!.updatedAt) ? layers.story[taskId] : undefined
    const table = layers.table?.[taskId] && fresh(layers.table[taskId]!.updatedAt) ? layers.table[taskId] : undefined

    if (state?.at && floor && state.at < floor) add('floor', taskId, `решено событием ${state.at} раньше сброса ${floor}`)

    const markWins = Boolean(liveMark && (!game || liveMark.at >= game.at))
    const storyNewer = Boolean(story && game && story.updatedAt > game.at)
    if (game && !markWins && !storyNewer) {
      if (game.status !== 'active' && status !== game.status) add('game-closes', taskId, `логи: ${game.status} (${game.at}), решено: ${status}`)
      if (source === 'table' || source === 'legacy') add('game-over-screen', taskId, `логи: ${game.status}, решил слой ${source}`)
    }
    if (liveMark) {
      if (markWins && (source !== 'manual' || status !== liveMark.status) && !(story && story.updatedAt > liveMark.at && source === 'story')) {
        add('mark-order', taskId, `отметка ${liveMark.status} (${liveMark.at}) не решила: ${source ?? '—'} ${status}`)
      }
      if (!markWins && source === 'manual') add('mark-order', taskId, `событие игры ${game!.status} (${game!.at}) новее отметки (${liveMark.at})`)
    }

    const seenHeld = [game?.status, liveMark?.status, story?.status, table?.status].includes('active')
    if (seenHeld && status === 'not-started') add('seen-stays', taskId, 'есть «взято» после сброса, но квест не показан')
    if (source === 'table' && status === 'completed') add('screen-never-completes', taskId, 'экран решил «выполнено»')

    if (input.stored) {
      const kept = input.stored[taskId]
      if (status === 'not-started' ? Boolean(kept) : kept?.status !== status) add('stored-is-decided', taskId, `сохранено: ${kept?.status ?? 'нет'}, решено: ${status}`)
    }
  }
  if (input.stored) {
    for (const [taskId, kept] of Object.entries(input.stored)) if (!ids.has(taskId)) add('stored-is-decided', taskId, `сохранено ${kept.status} без источника`)
  }

  if (input.availability && input.quests) checkAvailability(input, add)
  return findings
}

function checkAvailability(input: QuestCheckInput, add: (rule: QuestCheckRule, questId: string, detail: string) => void) {
  const availability = input.availability!
  const quests = input.quests!
  const byId = new Map(quests.map((quest) => [quest.id, quest]))
  const held = quests.filter((quest) => ['active', 'completed'].includes(input.resolution.states.get(quest.id)?.status ?? ''))
  const gunsmith = new Set(gunsmithSteps(quests as Quest[], () => undefined).map((step) => step.quest.id))
  // The level the quests the game reported prove (the engine's knownLevel is never lower than this).
  const proven = Math.max(input.player?.playerLevel ?? 0, ...held.map((quest) => quest.level ?? 0))
  for (const quest of input.stored ? quests : []) {
    const record = input.stored![quest.id]
    if (record?.status !== 'active' || record.source !== 'screen-scan') continue
    const before = partHoldingBack(quest, record.updatedAt, input.stored!, byId)
    if (before) add('screen-chain', quest.id, `только с экрана, а по логам «${before.name}» тогда ещё не сдан`)
  }
  for (const quest of held) {
    for (const requirement of questRequirements(quest)) {
      if (requirement.group || !isCompletionOnly(requirement) || !byId.has(requirement.taskId)) continue
      // A prerequisite the game itself reported otherwise is the game's data, not the chain's: the engine lists it
      // (`prerequisite-open`); «Оружейник» parts are proven by the logs only.
      const prior = input.resolution.states.get(requirement.taskId)?.status
      if ((prior && prior !== 'not-started') || gunsmith.has(requirement.taskId)) continue
      if (availability.get(requirement.taskId)?.status !== 'completed') add('chain', requirement.taskId, `нужен для «${quest.name}», но не засчитан выполненным`)
    }
  }
  const faction = input.player?.faction
  for (const quest of quests) {
    if (availability.get(quest.id)?.status !== 'available') continue
    if ((quest.level ?? 0) > proven) add('level', quest.id, `открыт, но нужен ${quest.level}-й уровень (у игрока ${proven})`)
    const own = questFaction(quest.faction)
    if (faction && faction !== 'unknown' && own && own !== faction) add('faction', quest.id, `открыт, но только для ${quest.faction}`)
  }
}

/** Findings by rule, for the diagnostics line («Проверки цепочки: …»). */
export function questCheckSummary(findings: readonly QuestCheckFinding[]) {
  const byRule = new Map<QuestCheckRule, number>()
  for (const finding of findings) byRule.set(finding.rule, (byRule.get(finding.rule) ?? 0) + 1)
  return [...byRule].map(([rule, count]) => ({ rule, title: QUEST_CHECK_TITLES[rule], count }))
}
