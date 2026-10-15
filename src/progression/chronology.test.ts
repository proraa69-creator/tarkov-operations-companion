import { describe, expect, it } from 'vitest'
import type { AppDataset, ModeProgress, Quest, TaskProgressRecord } from '../domain/types'
import { createModeProgress } from '../domain/progress'
import { withQuestGrid } from '../data/questGrid'
import { unlockFromRequirements } from '../data/questUnlock'
import { calculateAvailability, completedQuestStats, isLiveGameQuest } from './requirementEngine'
import { inferChronology } from './chronology'
import grid from './__fixtures__/quest-grid-tasks-2026-10.json'
import ownerLogs from './__fixtures__/owner-logs-2026-09.json'

const quest = (id: string, extra: Partial<Quest> = {}): Quest => ({
  id, name: id, trader: 'Терапевт', traderId: 'therapist', level: 1, kappa: false, description: '', objectives: [], rewards: [], requirements: [], ...extra,
})
const line = (id: string, level: number, ll?: number) => ({ unlock: { lines: [{ id, level, order: ll ?? 1, ...(ll ? { ll } : {}) }] } })
const logged = (status: TaskProgressRecord['status'], at = '2026-09-26T15:08:00Z') => ({ status, source: 'eft-log' as const, updatedAt: at })
const progressOf = (records: Record<string, ReturnType<typeof logged>>, extra: Partial<ModeProgress> = {}): ModeProgress => ({
  ...createModeProgress(),
  playerLevel: 40,
  taskProgress: Object.fromEntries(Object.entries(records).map(([taskId, record]) => [taskId, { taskId, ...record }])),
  ...extra,
})
// A taken quest that needs one the logs never saw: the player's history began before the oldest log.
const olderThanLogs = { veteran: quest('veteran', { trader: 'Егерь', traderId: 'jaeger', requirements: [{ taskId: 'old', allowedStatuses: ['complete'] }] }), old: quest('old', { trader: 'Егерь', traderId: 'jaeger' }) }

describe('tarkov.dev otherRequirements', () => {
  it('reads a trader line with its level and the dialogue start', () => {
    expect(unlockFromRequirements([
      { type: 'globalVariable', variableId: 'line-a', compareMethod: '>=', value: 4 },
      { type: 'globalVariable', variableId: 'line-b', compareMethod: '>', value: 1 },
      { type: 'globalVariable', variableId: 'line-c', compareMethod: '<', value: 2 },
      { type: 'dialogue', traders: ['x'] },
    ])).toEqual({ lines: [{ id: 'line-a', level: 4 }, { id: 'line-b', level: 2 }], dialogue: true })
    expect(unlockFromRequirements([])).toBeUndefined()
    expect(unlockFromRequirements(undefined)).toBeUndefined()
  })
})

describe('quest chronology', () => {
  const lineQuests = [
    quest('shortage', line('therapist-1', 1, 1)),
    quest('pharmacist', line('therapist-1', 2, 1)),
    quest('fall-ailment', line('therapist-1', 4, 1)),
    quest('shipment', line('therapist-1', 4, 1)),
    quest('later', line('therapist-1', 5, 1)),
  ]

  it('a quest taken at a line level dates the lower levels as done, opens its own level and keeps the next one closed', () => {
    const quests = [...lineQuests, ...Object.values(olderThanLogs)]
    const availability = calculateAvailability(quests, progressOf({ 'fall-ailment': logged('active'), veteran: logged('active') }))
    expect(availability.get('shortage')).toMatchObject({ status: 'completed', basis: 'line', anchorId: 'fall-ailment' })
    expect(availability.get('pharmacist')).toMatchObject({ status: 'completed', basis: 'line' })
    expect(availability.get('fall-ailment')?.status).toBe('active')
    // the same level is open, not proven done
    expect(availability.get('shipment')?.status).toBe('available')
    expect(availability.get('later')).toMatchObject({ status: 'locked', line: { level: 5, reached: 4 } })
    expect(availability.get('later')?.blockers).toContain('Откроется на 5-м уровне ветки 1 торговца')
  })

  it('takes nothing for granted when the logs hold the whole history (a new account, a wipe)', () => {
    const availability = calculateAvailability(lineQuests, progressOf({ 'fall-ailment': logged('active') }))
    expect(availability.get('shortage')).toEqual({ status: 'available', blockers: [] })
    expect(availability.get('pharmacist')?.status).toBe('available')
    expect(availability.get('later')?.status).toBe('locked')
    // and a line nobody took a quest of is closed
    const fresh = calculateAvailability([quest('drug-trafficking', line('therapist-3', 3, 3))], progressOf({}))
    expect(fresh.get('drug-trafficking')).toMatchObject({ status: 'locked', line: { level: 3, ll: 3 } })
  })

  it("dates a trader's earlier loyalty stages and first quests as done, never another trader's, a branch, the other faction or an unknown stage", () => {
    const quests = [
      ...Object.values(olderThanLogs),
      quest('invasive', line('therapist-3', 3, 3)),
      quest('urban-medicine', line('therapist-2', 1, 2)),
      quest('census', { traderLoyalty: { needed: [{ traderId: 'therapist', level: 2 }], reached: [] } }),
      quest('debut-help', { helpView: { ll: 1 } }),
      quest('first-in-line', { unlock: { dialogue: true } }),
      quest('war-never-changes'),
      quest('curiosity', { helpView: { ll: 1 }, requirements: [{ taskId: 'reagent-4', allowedStatuses: ['active'] }] }),
      quest('usec-only', { helpView: { ll: 1 }, faction: 'USEC' }),
      quest('too-high', { helpView: { ll: 1 }, level: 60 }),
      quest('charity', { traderLoyalty: { needed: [{ traderId: 'therapist', level: 3 }], reached: [] } }),
      quest('decontamination', { traderLoyalty: { needed: [{ traderId: 'therapist', level: 4 }], reached: [] } }),
      quest('prapor-debut', { trader: 'Прапор', traderId: 'prapor', helpView: { ll: 1 }, ...line('prapor-1', 1, 1) }),
    ]
    const availability = calculateAvailability(quests, progressOf({ invasive: logged('active'), veteran: logged('active') }, { faction: 'bear' }))
    expect(availability.get('urban-medicine')).toMatchObject({ status: 'completed', basis: 'stage', anchorId: 'invasive' })
    expect(availability.get('census')).toMatchObject({ status: 'completed', basis: 'stage' })
    expect(availability.get('debut-help')).toMatchObject({ status: 'completed', basis: 'stage' })
    expect(availability.get('first-in-line')).toMatchObject({ status: 'completed', basis: 'start', anchorId: 'invasive' })
    expect(availability.get('war-never-changes')?.status).toBe('available')
    expect(availability.get('curiosity')?.status).toBe('locked')
    expect(availability.get('usec-only')?.status).toBe('locked')
    expect(availability.get('too-high')?.status).not.toBe('completed')
    // the same stage is open; a loyalty the logs do not show yet may be there from before them
    expect(availability.get('charity')?.status).toBe('available')
    expect(availability.get('decontamination')?.status).toBe('unknown')
    // Prapor's quests are not dated by Therapist's
    expect(availability.get('prapor-debut')?.status).toBe('unknown')
  })

  it('never dates the «Оружейник» parts (logs only)', () => {
    const quests = [
      ...Object.values(olderThanLogs),
      quest('gs-aks', { name: 'Оружейник. АКС-74У', trader: 'Механик', traderId: 'mechanic', ...line('mechanic-1', 1, 1) }),
      quest('courier', { trader: 'Механик', traderId: 'mechanic', ...line('mechanic-1', 3, 1) }),
    ]
    const result = inferChronology(quests, { courier: { taskId: 'courier', ...logged('active') }, veteran: { taskId: 'veteran', ...logged('active') } }, { playerLevel: 40, faction: 'bear', exclude: new Set(['gs-aks']) })
    expect(result.historyBeforeLogs).toBe(true)
    expect(result.completed.has('gs-aks')).toBe(false)
  })
})

/** The fixture's PvE tasks as the catalog gives them, with the lines from the snapshot (src/data/questGrid.ts). */
function fixtureQuests(): Quest[] {
  const { traders, tasks } = grid.pve
  const quests = (tasks as unknown as Array<[string, string, number, number, { r?: string[][]; l?: Array<[number, number]>; f?: string; k?: number }?]>).map(([id, name, trader, level, extra]) => quest(id, {
    name,
    trader: traders[trader][1],
    traderId: traders[trader][0],
    level,
    kappa: Boolean(extra?.k),
    faction: extra?.f,
    requirements: (extra?.r ?? []).map(([taskId, ...statuses]) => ({ taskId, allowedStatuses: statuses as Array<'complete' | 'failed' | 'active'> })),
    ...(extra?.l ? { traderLoyalty: { needed: extra.l.map(([index, loyalty]) => ({ traderId: traders[index]?.[0] ?? String(index), level: loyalty })), reached: [] } } : {}),
  }))
  const dataset = { quests, traders: traders.map(([id, name]) => ({ id, name })) } as unknown as AppDataset
  return withQuestGrid(dataset, 'pve').quests
}

/** The latest logged status of each quest in a mode, as the app keeps them (src/import/logApply.ts). */
function recordsOf(mode: 'pve' | 'pvp', after = '') {
  const records: Record<string, ReturnType<typeof logged>> = {}
  for (const [at, status, taskId] of ownerLogs.events[mode] as Array<[string, TaskProgressRecord['status'], string]>) if (at > after) records[taskId] = logged(status, at)
  return records
}

describe("the owner's logs against the quest grid", () => {
  const quests = fixtureQuests()
  const byName = (trader: string, name: string) => quests.find((entry) => entry.trader === trader && entry.name === name)!
  const statusOf = (availability: ReturnType<typeof calculateAvailability>, trader: string, name: string) => availability.get(byName(trader, name).id)

  it('PvE, 26.09: Therapist is almost all done, not «1 completed»', () => {
    const availability = calculateAvailability(quests, progressOf(recordsOf('pve'), { faction: 'bear', playerLevel: 1 }))
    const therapist = quests.filter((entry) => entry.trader === 'Терапевт')
    const count = (status: string) => therapist.filter((entry) => availability.get(entry.id)?.status === status).length
    // what the logs show
    for (const name of ['Всё тайное становится явным', 'Инвазивная терапия', 'Осеннее недомогание']) expect(statusOf(availability, 'Терапевт', name)?.status).toBe('active')
    // levels 1–2 of the first line and level 1 of the third come before the quests taken at levels 4 and 3
    for (const name of ['Дефицит', 'Кровавая вода', 'Брошенный груз', 'Провизор', 'Авторем', 'Дипломатия по-тарковски', 'Отдых у моря']) {
      expect(statusOf(availability, 'Терапевт', name)).toMatchObject({ status: 'completed', basis: 'line' })
    }
    // the first quests and the whole LL2 line are behind an LL3 quest
    for (const name of ['Операция "Водолей"', 'Первый в очереди', 'Планы снабжения']) expect(statusOf(availability, 'Терапевт', name)).toMatchObject({ status: 'completed', basis: 'start' })
    for (const name of ['Городская медицина', 'Сельпо', 'Санэпидемнадзор', 'Фельдшер', 'Инвентаризация', 'Тарковский мясник']) {
      expect(statusOf(availability, 'Терапевт', name)).toMatchObject({ status: 'completed', basis: 'stage' })
    }
    // a chain takes the stage of the trader's quests it needs: part 3 says nothing itself but follows part 2 (LL2)
    expect(statusOf(availability, 'Терапевт', 'Врачебная тайна. Часть 3')).toMatchObject({ status: 'completed', basis: 'stage' })
    expect(statusOf(availability, 'Терапевт', 'Врачебная тайна. Часть 1')).toMatchObject({ status: 'completed', basis: 'chain' })
    // the other quests of the level taken now are open, not assumed done; so is the trader's current stage (LL3)
    for (const name of ['Медицинский журнал', 'Наркотрафик', 'Коллеги', 'Врачебная тайна. Часть 4']) expect(statusOf(availability, 'Терапевт', name)?.status).toBe('available')
    // the logs prove the character's level (Prapor's «Уникальный опыт» needs 35): no «Нужен уровень 18» for LL3 quests
    expect(statusOf(availability, 'Терапевт', 'Коллеги')?.blockers).toEqual([])
    // LL4: the logs show no quest of it yet
    expect(statusOf(availability, 'Терапевт', 'Служба дезинфекции')?.status).toBe('unknown')
    expect(count('active')).toBe(3)
    expect(count('completed')).toBeGreaterThanOrEqual(25)
  })

  it('«Выполнено» counts what the game reported, never what the app infers (owner, 15.10.2026: 154 in the game, 226 in the app)', () => {
    const availability = calculateAvailability(quests, progressOf(recordsOf('pve'), { faction: 'bear', playerLevel: 40 }))
    const inferred = [...availability.values()].filter((entry) => entry.status === 'completed' && entry.basis).length
    // The lists still show the inferred ones as done (chain, line, stage, start): over two hundred of them.
    expect(inferred).toBeGreaterThan(200)
    // The count: the one PvE quest these logs show handed in.
    const handedIn = (ownerLogs.events.pve as Array<[string, string, string]>).filter(([, status]) => status === 'completed').length
    expect(completedQuestStats(quests, availability).completed).toBe(handedIn)
    expect(handedIn).toBe(1)
    // PvP after its prestige: the 36 handed in since the reset, nothing more.
    const pvp = calculateAvailability(quests, progressOf(recordsOf('pvp', ownerLogs.resets.pvp), { faction: 'bear', playerLevel: 5 }))
    const live = new Set(quests.filter((entry) => isLiveGameQuest(entry)).map((entry) => entry.id))
    const pvpHandedIn = Object.entries(recordsOf('pvp', ownerLogs.resets.pvp)).filter(([taskId, record]) => record.status === 'completed' && live.has(taskId)).length
    expect(pvpHandedIn).toBeGreaterThan(0)
    expect(completedQuestStats(quests, pvp).completed).toBe(pvpHandedIn)
  })

  it('PvE, 26.09: Prapor — the quest handed in and the ones taken date the first line', () => {
    const availability = calculateAvailability(quests, progressOf(recordsOf('pve'), { faction: 'bear', playerLevel: 1 }))
    expect(statusOf(availability, 'Прапор', 'Сила переубеждения')?.status).toBe('completed')
    for (const name of ['Компромат', 'Пикник со стрельбой', 'Белка и Стрелка', 'Проверка на вшивость', 'Роскошная жизнь']) {
      expect(statusOf(availability, 'Прапор', name)).toMatchObject({ status: 'completed', basis: 'line' })
    }
    expect(statusOf(availability, 'Прапор', 'Легкотня')?.status).toBe('active')
    expect(statusOf(availability, 'Прапор', 'Документы')).toMatchObject({ status: 'completed', basis: 'line' })
  })

  it('PvP after the prestige of 26.09: the logs hold everything, nothing is assumed', () => {
    const availability = calculateAvailability(quests, progressOf(recordsOf('pvp', ownerLogs.resets.pvp), { faction: 'bear', playerLevel: 5 }))
    expect([...availability.values()].some((entry) => entry.basis && entry.basis !== 'chain')).toBe(false)
    expect(statusOf(availability, 'Барахольщик', 'Вернем Ультре былое величие')?.status).toBe('completed')
    expect(statusOf(availability, 'Барахольщик', 'Мелочь, а приятно')?.status).toBe('active')
    // Ragman's first line reached level 2: its level-1 quest not taken yet is open; the second line is not
    expect(statusOf(availability, 'Барахольщик', 'Картотека')?.status).toBe('available')
    expect(statusOf(availability, 'Барахольщик', 'Горячая доставка')).toMatchObject({ status: 'locked', line: { level: 2 } })
    // Therapist: the dialogue quests are taken, the first line has not started
    expect(statusOf(availability, 'Терапевт', 'Первый в очереди')?.status).toBe('active')
    expect(statusOf(availability, 'Терапевт', 'Дефицит')).toMatchObject({ status: 'locked', line: { level: 1 } })
  })
})
