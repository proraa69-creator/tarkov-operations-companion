import { describe, expect, it } from 'vitest'
import type { ObjectiveProgress, Quest, QuestObjective } from '../domain/types'
import { progressWith, quest } from '../raidprep/fixtures'
import { filteredCount, mapWorkCounts, questWorkOnMap } from './mapPriority'

const objective = (id: string, type: string, mapIds?: string[], extra: Partial<QuestObjective> = {}): QuestObjective =>
  ({ id, type, description: id, count: 1, ...(mapIds ? { mapIds } : {}), ...extra })
const ticked = (...ids: string[]) => Object.fromEntries(ids.map((id): [string, ObjectiveProgress] => [id, {
  objectiveId: id, taskId: '', type: 'visit', target: 1, current: 1, source: 'manual', confidence: 1, observedAt: '2026-11-15T02:50:00.000Z',
}]))
const KILL_MAPS = ['streets-of-tarkov', 'factory', 'interchange', 'reserve', 'customs', 'ground-zero', 'icebreaker', 'shoreline', 'lighthouse', 'woods']

/**
 * Report 230 (25.11.2026): the player's current PvE quests on Lighthouse and Woods, as his profile on the server holds them, in
 * their game shapes. The strip showed 13 on Lighthouse and 11 on Woods: every kill quest for «any of these maps» counted on each of
 * them, and on Lighthouse more of them name it. «Задания» (not kills) put Woods first, as the player expected.
 */
const quests: Quest[] = [
  // Lighthouse
  quest('simple-job', 'Простая задача', { mapIds: ['lighthouse'], objectiveDetails: [objective('heli-visit', 'visit', ['lighthouse']), objective('heli-mark', 'mark', ['lighthouse']), objective('heli-kill', 'shoot', ['lighthouse'])] }),
  quest('top-secret', 'Совершенно секретно', { mapIds: ['lighthouse'], objectiveDetails: [objective('ts-visit', 'visit', ['lighthouse']), objective('ts-find', 'findQuestItem', ['lighthouse']), objective('ts-give', 'giveQuestItem')] }),
  quest('invasive', 'Инвазивная терапия', { mapIds: ['lighthouse'], objectiveDetails: [objective('inv-give', 'giveItem'), objective('inv-find', 'findItem', undefined, { optional: true }), objective('inv-plant', 'plantItem', ['lighthouse'])] }),
  quest('cut-down', 'Вырубить под корень', { mapIds: ['lighthouse'], objectiveDetails: [objective('cut-kill', 'shoot', ['lighthouse'])] }),
  quest('easy-money', 'Легкотня', { mapIds: ['reserve', 'lighthouse'], objectiveDetails: [objective('easy-kill', 'shoot', ['reserve', 'lighthouse'])] }),
  quest('ripper', 'Потрошитель', { mapIds: ['factory', 'lighthouse', 'shoreline'], objectiveDetails: [objective('rip-factory', 'shoot', ['factory']), objective('rip-lighthouse', 'shoot', ['lighthouse']), objective('rip-shoreline', 'shoot', ['shoreline'])] }),
  // either map
  quest('shooter-1', 'Тарковский стрелок. Часть 1', { mapIds: KILL_MAPS, objectiveDetails: [objective('shooter-kill', 'shoot', KILL_MAPS)] }),
  quest('stray', 'Залётные', { mapIds: ['customs', 'shoreline', 'lighthouse', 'woods'], objectiveDetails: [objective('stray-kill', 'shoot', ['customs', 'shoreline', 'lighthouse', 'woods'])] }),
  // Woods
  quest('errand', 'Поручение', { mapIds: ['woods'], objectiveDetails: [objective('err-visit', 'visit', ['woods']), objective('err-find', 'findQuestItem', ['woods']), objective('err-give', 'giveQuestItem')] }),
  quest('signal', 'Устойчивый сигнал', { mapIds: ['woods'], objectiveDetails: [objective('sig-mark', 'mark', ['woods'])] }),
  quest('special-comm', 'Спецсвязь', { mapIds: ['woods', 'reserve'], objectiveDetails: [objective('sc-plant-woods', 'plantItem', ['woods']), objective('sc-extract', 'extract', ['woods']), objective('sc-plant-reserve', 'plantItem', ['reserve'])] }),
  quest('delay-2', 'Задержка отправления. Часть 2', { mapIds: ['woods'], objectiveDetails: [objective('d-1', 'visit', ['woods']), objective('d-2', 'visit', ['woods']), objective('d-3', 'visit', ['woods']), objective('d-status', 'taskStatus')] }),
  quest('wings', 'На свет. Подрезать крылья', { mapIds: ['woods', 'customs', 'shoreline'], objectiveDetails: [objective('w-woods', 'plantItem', ['woods']), objective('w-customs', 'plantItem', ['customs']), objective('w-shore', 'plantItem', ['shoreline'])] }),
  quest('hunt', 'На охоту', { mapIds: ['woods'], objectiveDetails: [objective('hunt-kill', 'shoot', ['woods'])] }),
  // nowhere: «Доктор "Айболит"» hands items over at the trader, any map
  quest('aibolit', 'Доктор "Айболит"', { anyMap: true, objectiveDetails: [objective('ai-find', 'findItem'), objective('ai-give', 'giveItem')] }),
]
const progress = progressWith(Object.fromEntries(quests.map((entry) => [entry.id, 'active' as const])), { objectiveProgress: ticked('heli-visit', 'heli-mark') })

describe('«Приоритет карт»: the quests with work left on a map (report 230)', () => {
  it('reproduces the player: Lighthouse ahead on all quests, Woods ahead on the tasks that are not kills', () => {
    const lighthouse = mapWorkCounts(quests, 'lighthouse', progress)
    const woods = mapWorkCounts(quests, 'woods', progress)
    expect(lighthouse).toEqual({ tasks: 2, kills: 6 })
    expect(woods).toEqual({ tasks: 5, kills: 3 })
    expect(filteredCount(lighthouse, 'tasks')).toBeLessThan(filteredCount(woods, 'tasks'))
    expect(filteredCount(lighthouse, 'kills')).toBeGreaterThan(filteredCount(woods, 'kills'))
    expect(filteredCount(lighthouse, 'all')).toBe(8)
  })

  it('a quest whose open work on the map is kills only is a kill quest there, whatever it did before', () => {
    // «Простая задача»: the helicopter found and marked, the kill around it left
    expect(questWorkOnMap(quests[0], 'lighthouse', progress)).toBe('kills')
    expect(questWorkOnMap(quests[0], 'lighthouse', progressWith({ 'simple-job': 'active' }))).toBe('tasks')
  })

  it('counts each quest once, however many objectives it has there or however often the catalog lists it', () => {
    expect(mapWorkCounts([quests[0], quests[0], quests[11]], 'woods', progress)).toEqual({ tasks: 1, kills: 0 })
    expect(mapWorkCounts([quests[12], quests[12]], 'woods', progress)).toEqual({ tasks: 1, kills: 0 })
  })

  it('leaves out «Любая карта» quests and quests handed over at a trader («Доктор "Айболит"» is on no map)', () => {
    for (const mapId of KILL_MAPS) expect(questWorkOnMap(quests[14], mapId, progress)).toBeNull()
    const handOver = quest('hand-over', 'Только сдать', { mapIds: ['lighthouse'], objectiveDetails: [objective('give-1', 'giveItem'), objective('give-2', 'giveQuestItem')] })
    expect(questWorkOnMap(handOver, 'lighthouse', progressWith({ 'hand-over': 'active' }))).toBeNull()
  })

  it('leaves a map whose objectives are ticked done; the quest stays on its other maps', () => {
    const done = progressWith({ ripper: 'active' }, { objectiveProgress: ticked('rip-lighthouse') })
    expect(questWorkOnMap(quests[5], 'lighthouse', done)).toBeNull()
    expect(questWorkOnMap(quests[5], 'factory', done)).toBe('kills')
  })

  it('leaves out a map the quest lists without an objective on it («Новые маршруты»: the transit leads to Streets)', () => {
    const routes = quest('new-routes', 'Новые маршруты', { mapIds: ['ground-zero', 'streets-of-tarkov'], objectiveDetails: [objective('nr-transit', 'extract', ['ground-zero']), objective('nr-visit', 'visit', ['ground-zero'])] })
    const active = progressWith({ 'new-routes': 'active' })
    expect(questWorkOnMap(routes, 'ground-zero', active)).toBe('tasks')
    expect(questWorkOnMap(routes, 'streets-of-tarkov', active)).toBeNull()
  })

  it('a map whose objectives wait for an item found on another map first is not counted yet (report 165)', () => {
    const parcel = quest('parcel', 'Посылка из прошлого', { mapIds: ['customs', 'factory'], objectiveDetails: [objective('p-find', 'findQuestItem', ['customs'], { itemIds: ['folder'] }), objective('p-plant', 'plantQuestItem', ['factory'], { itemIds: ['folder'] })] })
    expect(questWorkOnMap(parcel, 'factory', progressWith({ parcel: 'active' }))).toBeNull()
    expect(questWorkOnMap(parcel, 'factory', progressWith({ parcel: 'active' }, { objectiveProgress: ticked('p-find') }))).toBe('tasks')
  })

  it('a quest without objectives in the catalog goes by its maps; a story chapter by its current stage', () => {
    const bare = quest('bare', 'Без целей', { mapIds: ['customs'] })
    expect(questWorkOnMap(bare, 'customs', progressWith({ bare: 'active' }))).toBe('tasks')
    expect(questWorkOnMap(bare, 'woods', progressWith({ bare: 'active' }))).toBeNull()
    const chapter = quest('story-x', 'Глава', { kind: 'story', stages: [{ title: 'one', mapIds: ['woods'], objectives: [] }, { title: 'two', mapIds: ['customs'], objectives: [] }] } as unknown as Partial<Quest>)
    expect(questWorkOnMap(chapter, 'woods', progressWith({}))).toBe('tasks')
    expect(questWorkOnMap(chapter, 'customs', progressWith({}))).toBeNull()
  })
})
