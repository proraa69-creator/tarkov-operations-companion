import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { translateUiText } from '../i18n/uiEnglish'
import { questMapsLabel } from '../progression/questLocation'
import { fetchLiveCatalog } from './catalogSource'
import { maps } from './demo'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'
import {
  adaptMapTransits, feedMapResolver, isTransitObjective, objectiveTransit, questTransitPoints, transitsWithoutPosition,
} from './questTransits'
import {
  BENEATH_THE_STREETS, MAP_IDS, PRICE_OF_INDEPENDENCE, transitMapNames, transitMaps, transitQuestsFetcher,
} from './__fixtures__/transitQuestsFeed'

type JsonRecord = Record<string, unknown>

/** The fixture's maps file translated the way catalogSource does it (every string that is a dictionary key). */
function translated(value: unknown, dictionary: JsonRecord): unknown {
  if (typeof value === 'string') return typeof dictionary[value] === 'string' ? dictionary[value] : value
  if (Array.isArray(value)) return value.map((entry) => translated(entry, dictionary))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, translated(entry, dictionary)]))
}

const index = new Map<string, string>()
for (const map of Object.values(transitMaps.maps)) {
  const canonical = { 'the-lab-dark': 'the-lab', 'ground-zero-21': 'ground-zero' }[map.normalizedName] ?? map.normalizedName
  index.set(map.id, canonical)
  index.set(map.normalizedName, canonical)
}
const resolve = feedMapResolver(index)
const ruMaps = translated(transitMaps, transitMapNames.ru) as JsonRecord
const transits = adaptMapTransits(ruMaps, resolve)

const task = (id: string, objectives: JsonRecord[], extra: JsonRecord = {}) => ({ id, name: id, trader: 'trader', objectives, ...extra })
const quest = (id: string, name: string, mapIds: string[]): Quest => ({
  id, name, trader: 'Прапор', level: 10, kappa: false, description: '', objectives: [], rewards: [], mapId: mapIds[0], mapIds,
})

describe('transit adaptation', () => {
  it('reads the maps file transits on app map ids, with the game\'s label and condition', () => {
    const streets = transits.filter((transit) => transit.mapId === 'streets-of-tarkov')
    expect(streets.map((transit) => [transit.id, transit.toMapId])).toEqual([['3', 'ground-zero'], ['4', 'interchange'], ['5', 'the-lab']])
    expect(streets[2]).toMatchObject({
      label: 'Переход на Лабораторию',
      condition: 'Передать Ключ-карта доступа в TerraGroup Labs (1)',
      position: { x: 209.52, y: -7.38, z: 82.4 },
      top: -6.38,
      bottom: -8.38,
    })
    // The Lab's own transit back to Streets.
    expect(transits.find((transit) => transit.mapId === 'the-lab')).toMatchObject({ id: '8', toMapId: 'streets-of-tarkov', label: 'Переход на Улицы Таркова' })
  })

  it('keeps one transit per map and id (night Factory repeats the day map), and drops untranslated keys and unplaced transits', () => {
    const feed = {
      maps: {
        a: { id: 'a', normalizedName: 'night-factory', transits: [{ id: '13', description: 'Переход на Таможню (ночь)', map: 'customs', position: { x: 18.5, y: -0.4, z: -48.3 } }] },
        b: { id: 'b', normalizedName: 'factory', transits: [
          { id: '13', description: 'Переход на Таможню', map: 'customs', position: { x: 17.34, y: 0.58, z: -49.62 } },
          { id: '12', description: 'FAC_TRANSIT_12_DESC', map: 'woods', position: { x: 24.36, y: 2.24, z: 60.22 } },
          { id: '99', description: 'Переход на Лес', map: 'woods', position: {} },
        ] },
      },
    }
    const result = adaptMapTransits(feed, (raw) => raw)
    expect(result.map((transit) => [transit.mapId, transit.id, transit.label])).toEqual([['factory', '13', 'Переход на Таможню'], ['factory', '12', '']])
    expect(transitsWithoutPosition(feed, (raw) => raw)).toEqual(['factory|99 → woods'])
    expect(transitsWithoutPosition(ruMaps, resolve)).toEqual([])
  })
})

describe('transit objectives', () => {
  it('knows a transit objective by its exit status (translated or not) or its text', () => {
    expect(isTransitObjective({ type: 'extract', exitStatus: ['marathon Name'] })).toBe(true)
    expect(isTransitObjective({ type: 'extract', exitStatus: ['Переход'] })).toBe(true)
    expect(isTransitObjective({ type: 'extract', exitStatus: ['Transition'] })).toBe(true)
    // «Survive and extract» accepts a transit too, but is not done at one.
    expect(isTransitObjective({ type: 'extract', exitStatus: ['Выжил', 'Переход'] })).toBe(false)
    // «Новое начало»: no status, the text says it.
    expect(isTransitObjective({ type: 'extract', exitStatus: [], description: 'Use the transit from The Lab to Streets of Tarkov' })).toBe(true)
    expect(isTransitObjective({ type: 'extract', exitStatus: [], description: 'Survive and extract from Streets of Tarkov' })).toBe(false)
    expect(isTransitObjective({ type: 'transit' })).toBe(true)
  })

  it('finds the transit by the text («в Лес» as well as «на Маяк»), by the next objective, or not at all', () => {
    const at = (description: string, mapsList: string[], hints = {}) => objectiveTransit({ type: 'extract', exitStatus: ['Переход'], description, maps: mapsList }, transits, resolve, hints)
    expect(at('Совершить переход с Резерва в Лес', [MAP_IDS.reserve])?.id).toBe('19')
    expect(at('Совершить переход с Леса на Маяк', [MAP_IDS.woods])?.id).toBe('17')
    // «… с Лаборатории на Улицы Таркова» on two maps: the Lab's transit, not Streets' transit to the Lab.
    expect(at('Совершить переход с Лаборатории на Улицы Таркова', [MAP_IDS.lab, MAP_IDS.streets])?.id).toBe('8')
    // No text to go by: where the quest goes on.
    expect(at('', [MAP_IDS.reserve], { nextMaps: ['woods'] })?.id).toBe('19')
    // Three ways out of Reserve and nothing says which: no point.
    expect(at('', [MAP_IDS.reserve], { locations: ['reserve', 'customs', 'woods', 'lighthouse'] })).toBeUndefined()
  })
})

describe('quest transit points', () => {
  const transitObjective = (id: string, description: string, mapId: string) => ({ id, type: 'extract', exitStatus: ['Переход'], description, maps: [mapId] })

  it('a transit objective is drawn at its transit, in either direction between two maps', () => {
    const there = questTransitPoints(task('there', [transitObjective('t1', 'Совершить переход с Улиц Таркова на Лабораторию', MAP_IDS.streets)]), transits, resolve)
    const back = questTransitPoints(task('back', [transitObjective('t1', 'Совершить переход с Лаборатории на Улицы Таркова', MAP_IDS.lab)]), transits, resolve)
    expect(there.map((point) => `${point.transit.mapId}#${point.transit.id}→${point.transit.toMapId}`)).toEqual(['streets-of-tarkov#5→the-lab'])
    expect(back.map((point) => `${point.transit.mapId}#${point.transit.id}→${point.transit.toMapId}`)).toEqual(['the-lab#8→streets-of-tarkov'])
  })

  it('the marker: the transit\'s position, the game\'s label, the objective and the quest\'s line', () => {
    const context = { maps, quests: [quest('leg', 'Перехват инициативы', ['customs', 'shoreline'])], items: new Map(), mapNameByApiId: index }
    const tasks = { tasks: { leg: task('leg', [transitObjective('t1', 'Совершить переход с Таможни на Резерв', MAP_IDS.customs), { id: 'o2', type: 'extract', exitStatus: ['Выжил', 'Переход'], maps: [MAP_IDS.reserve] }]) } }
    const markers = adaptLiveMapMarkers(ruMaps, tasks, context).filter((marker) => marker.source === 'quest-transit')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      mapId: 'customs',
      type: 'quest',
      layerId: 'quest.zone',
      questId: 'leg',
      objectiveId: 't1',
      title: 'Переход на Резерв → «Перехват инициативы»',
      description: 'Совершить переход с Таможни на Резерв',
      meta: 'Прапор · ур. 10',
    })
    // At the Customs → Reserve transit itself (tarkov.dev x/z → [z, x]).
    expect(markers[0].position).toEqual([124.94, 650.64])
  })

  it('a quest on two maps without a transit objective («Компромат»: Customs and Factory, separate raids) gets no transit point', () => {
    const kompromat = task('kompromat', [
      { id: 'o1', type: 'extract', exitStatus: ['Выжил', 'Сквозная пробежка', 'Переход'], maps: [MAP_IDS.customs] },
      { id: 'o2', type: 'findQuestItem', maps: [MAP_IDS.factory] },
    ])
    expect(questTransitPoints(kompromat, transits, resolve)).toEqual([])
    const context = { maps, quests: [quest('kompromat', 'Компромат', ['customs', 'factory'])], items: new Map(), mapNameByApiId: index }
    expect(adaptLiveMapMarkers(ruMaps, { tasks: { kompromat } }, context).filter((marker) => marker.source === 'quest-transit')).toEqual([])
    // Nor one that only starts on another map, nor a chain of maps without a transit objective.
    expect(questTransitPoints(task('start', [{ id: 'o1', type: 'visit', maps: [MAP_IDS.lab] }], { map: MAP_IDS.streets }), transits, resolve)).toEqual([])
    expect(questTransitPoints(task('chain', [{ id: 'o1', type: 'plantItem', maps: [MAP_IDS.customs] }, { id: 'o2', type: 'mark', maps: [MAP_IDS.woods] }]), transits, resolve)).toEqual([])
  })

  it('no point for a one-map quest or a choice of maps', () => {
    expect(questTransitPoints(task('one', [{ id: 'o1', type: 'visit', maps: [MAP_IDS.customs] }]), transits, resolve)).toEqual([])
    // «Woods or Interchange»: a choice of maps, not a transit.
    expect(questTransitPoints(task('either', [{ id: 'o1', type: 'extract', exitStatus: ['Выжил'], maps: [MAP_IDS.woods, MAP_IDS.interchange] }]), transits, resolve)).toEqual([])
  })

  it('a curated transit objective with its zone at the transit is not drawn twice', () => {
    const curated = task('curated', [{ id: 'c1', type: 'transit', maps: ['woods'], zones: [{ id: 'transit-41', map: 'woods', position: { x: -150.37, y: 1.11, z: 403.41 } }] }])
    expect(questTransitPoints(curated, transits, resolve)).toEqual([])
  })
})

describe('«Непарадный Тарков» (Beneath The Streets) from the tarkov.dev feed', () => {
  const noWiki = { wiki: async () => ({ titles: [], pages: [], storyQuests: [] }) }

  it('puts the transit objective on the Streets → The Lab transit, lists both maps, and labels it in both languages', async () => {
    const ru = await fetchLiveCatalog('pvp', 'ru', transitQuestsFetcher(), noWiki)
    const en = await fetchLiveCatalog('pvp', 'en', transitQuestsFetcher(), noWiki)
    const questRu = ru.quests.find((entry) => entry.id === BENEATH_THE_STREETS)!
    expect(questRu.name).toBe('Непарадный Тарков')
    expect(questRu.trader).toBe('Терапевт')
    expect(questRu.mapIds).toEqual(['streets-of-tarkov', 'the-lab'])
    expect(questMapsLabel(questRu, ru.maps)).toBe('Улицы Таркова, Лаборатория')
    const transitObjectives = questRu.objectiveDetails?.filter((objective) => objective.transit) ?? []
    expect(transitObjectives).toHaveLength(1)
    expect(transitObjectives[0]).toMatchObject({
      description: 'Совершить переход с Улиц Таркова на Лабораторию (За один рейд)',
      mapIds: ['streets-of-tarkov'],
      transit: { fromMapId: 'streets-of-tarkov', toMapId: 'the-lab', transitId: '5' },
      zoneBound: true,
    })

    const onStreets = ru.markers.filter((marker) => marker.questId === BENEATH_THE_STREETS && marker.mapId === 'streets-of-tarkov')
    expect(onStreets).toHaveLength(1)
    expect(onStreets[0]).toMatchObject({
      id: `streets-of-tarkov-quest-transit-${BENEATH_THE_STREETS}-5`,
      type: 'quest',
      layerId: 'quest.zone',
      objectiveId: transitObjectives[0].id,
      title: 'Переход на Лабораторию → «Непарадный Тарков»',
      description: 'Совершить переход с Улиц Таркова на Лабораторию (За один рейд) Условие перехода: Передать Ключ-карта доступа в TerraGroup Labs (1).',
      position: [82.4, 209.52],
      height: -7.38,
    })
    // The transit is underground on Streets: the marker keeps the transit's height range for the floor switch.
    expect(onStreets[0].heightRange).toEqual([-8.38, -6.38])

    // On The Lab: the quest's own zones (one of them the passage back to Streets), no extra transit point.
    const onLab = ru.markers.filter((marker) => marker.questId === BENEATH_THE_STREETS && marker.mapId === 'the-lab')
    expect(onLab.length).toBe(4)
    expect(onLab.some((marker) => marker.source === 'quest-transit')).toBe(false)

    const enMarker = en.markers.find((marker) => marker.id === onStreets[0].id)!
    expect(translateUiText(enMarker.title)).toBe('Transit to The Lab → «Beneath The Streets»')
    expect(translateUiText(enMarker.description)).toBe('Use the transit from Streets of Tarkov to The Lab (In one raid) Transit condition: TerraGroup Labs access keycard required (1).')
    expect(questMapsLabel(en.quests.find((entry) => entry.id === BENEATH_THE_STREETS)!, en.maps)).toBe('Streets of Tarkov, The Lab')
  })

  it('«Цена независимости»: every leg of Customs → Reserve → Woods → Lighthouse at its transit, the same in both languages', async () => {
    for (const locale of ['ru', 'en'] as const) {
      const catalog = await fetchLiveCatalog('pvp', locale, transitQuestsFetcher(), noWiki)
      const points = catalog.markers.filter((marker) => marker.questId === PRICE_OF_INDEPENDENCE && marker.source === 'quest-transit')
      expect(points.map((marker) => marker.id)).toEqual([
        `customs-quest-transit-${PRICE_OF_INDEPENDENCE}-9`,
        `reserve-quest-transit-${PRICE_OF_INDEPENDENCE}-19`,
        `woods-quest-transit-${PRICE_OF_INDEPENDENCE}-17`,
      ])
    }
  })
})

describe('quest map labels', () => {
  it('lists every map the quest needs, the start map first, and shortens a long list', () => {
    const named = [{ id: 'customs', name: 'Таможня' }, { id: 'woods', name: 'Лес' }, { id: 'reserve', name: 'Резерв' }, { id: 'lighthouse', name: 'Маяк' }, { id: 'shoreline', name: 'Берег' }]
    expect(questMapsLabel({ mapId: 'customs', mapIds: ['customs', 'woods'] }, named)).toBe('Таможня, Лес')
    expect(questMapsLabel({ mapId: 'customs', mapIds: ['customs', 'woods', 'reserve', 'lighthouse', 'shoreline'] }, named)).toBe('Таможня, Лес, Резерв и ещё 2')
    expect(translateUiText('Customs, Woods, Reserve и ещё 2')).toBe('Customs, Woods, Reserve and 2 more')
    expect(questMapsLabel({}, named)).toBe('')
  })
})
