// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { GameMap, Quest } from '../domain/types'
import { applyCuratedStoryStages } from './storyChapters'
import { STORY_CHAPTER_SEEDS, TOUR_STAGE_POINTS } from './storyChapterSeeds'
import { adaptStoryQuestMarkers } from './storyQuestMarkers'
import { adaptMapRenderingConfigs } from './mapConfigClient'
import { TO_THE_LIGHT_MAP_CONFIGS } from './__fixtures__/toTheLightMapConfigs'

// The Lab's floors as the map has them.
const LAB = {
  id: 'the-lab', name: 'Лаборатория', floors: ['Основной', '2 уровень', 'Технический уровень'],
  layers: [
    { id: 'main', name: 'Основной', heightRange: [-0.9, 3] },
    { id: 'layer-0', name: '2 уровень', heightRange: [3, 10000], extents: [{ height: [3, 10000], bounds: [[[-101, -422], [-271, -270]]] }] },
    { id: 'layer-1', name: 'Технический уровень', heightRange: [-10000, -0.9], extents: [{ height: [-10000, -0.9] }] },
  ],
} as unknown as GameMap
const OTHER = (id: string) => ({ id, name: id }) as unknown as GameMap
const [tour] = applyCuratedStoryStages([{ id: 'story-tour', name: 'Тур', normalizedName: 'tour', kind: 'story', trader: 'История', level: 0, objectives: [], description: '' } as unknown as Quest])

// A player's report №53, 06.11.2026: «все точки гласят одно и то же, но они на правильных местах… описание нужно у каждой своё».
describe('the points of a story stage', () => {
  const markers = adaptStoryQuestMarkers([tour!], [LAB, OTHER('factory'), OTHER('streets-of-tarkov')], []).filter((marker) => marker.stageIndex === 21)

  it('each of the Tour\'s last points says what is at it, on its own floor', () => {
    expect(markers.map((marker) => [marker.mapId, marker.floor, marker.description])).toEqual([
      ['factory', undefined, 'Найти вход в секретный объект на локации Завод'],
      ['streets-of-tarkov', undefined, 'Найти вход в секретный объект на локации Улицы Таркова'],
      ['the-lab', '2 уровень', 'Осмотреть офисы топ-менеджеров (O21, 2-й уровень)'],
      ['the-lab', '2 уровень', 'Осмотреть серверную (2-й уровень, у ангара)'],
      ['the-lab', 'Технический уровень', 'Найти путь отхода через водосток (подвал, у выхода «Накопительный коллектор»)'],
    ])
  })

  it('every point on the Lab knows its floor where the first floor is not meant', () => {
    const lab = [...TOUR_STAGE_POINTS[21]!, ...STORY_CHAPTER_SEEDS.flatMap((chapter) => chapter.stages.flatMap((stage) => stage.points ?? []))].filter((point) => point.mapId === 'the-lab')
    expect(lab.length).toBeGreaterThan(10)
    // Only these two stand on the first floor.
    expect(lab.filter((point) => point.y === undefined).map((point) => [point.x, point.z])).toEqual([[-161.37, -374.86], expect.any(Array)])
  })

  it('a stage whose several points are several goals says so on each', () => {
    const mixed = STORY_CHAPTER_SEEDS.find((chapter) => chapter.id === 'batya')!.stages.find((stage) => stage.ru === 'Найти следы предателей')!
    expect(mixed.points!.map((point) => point.note)).toEqual(['Осмотреть командный бункер на Резерве', 'Осмотреть лагерь BEAR на Маяке', 'Осмотреть лагерь BEAR к востоку от ТЦ «Ультра» на Развязке'])
  })
})

// A player in the support chat, 22.11.2026: «Батя" найти следы придателя» … «база бир теперь на скале, на против смотрителя маяка»,
// «На резерве не отмечается круг сектантов». The points are the game's own quest zones (the live client's scenes).
describe('«Батя»: the BEAR camp on Lighthouse and the cultist circles are where the game checks them', () => {
  const configs = adaptMapRenderingConfigs(TO_THE_LIGHT_MAP_CONFIGS as never)
  const maps = ['lighthouse', 'reserve', 'woods', 'customs', 'shoreline', 'interchange'].map((id) => ({ id, name: id, ...configs.get(id) }) as unknown as GameMap)
  const [batya] = applyCuratedStoryStages([{ id: 'story-batya', name: 'Батя', normalizedName: 'batya', kind: 'story', trader: 'История', level: 0, objectives: [], description: '' } as unknown as Quest])
  const stageOf = (ru: string) => batya!.stages!.findIndex((stage) => stage.title === ru || stage.description === ru)
  const markersOf = (ru: string) => adaptStoryQuestMarkers([batya!], maps, []).filter((marker) => marker.stageIndex === stageOf(ru))

  it('the BEAR camp on Lighthouse is on the cliff across from the Lightkeeper island (zone batya_8_visit), not the old camp', () => {
    const camp = markersOf('Найти следы предателей').find((marker) => marker.mapId === 'lighthouse')!
    expect(camp.position).toEqual([452.41, -64.79])
    expect(camp.floor).toBe(maps[0]!.floors?.[0])
  })

  it('the cultist circle on Reserve has the three rooms of the game, the two under ground on «Бункеры»', () => {
    const reserve = markersOf('Выяснить, как культисты связаны с Генералом').filter((marker) => marker.mapId === 'reserve')
    expect(reserve.map((marker) => [marker.position, marker.floor])).toEqual([
      [[28, -122.53], 'Бункеры'],
      [[72.44, -155.46], 'Бункеры'],
      [[-225.99, 191.7], maps[1]!.floors?.[0]],
    ])
    for (const marker of reserve) expect(marker.description).toMatch(/^Круг культистов \(любое из 3 мест\): /)
  })

  it('the cultist circle on Woods is the one of the game (zone batya_9_visit), not the Halloween circle of «Секта»', () => {
    const woods = markersOf('Выяснить, как культисты связаны с Генералом').find((marker) => marker.mapId === 'woods')!
    expect(woods.position).toEqual([-686.14, -128.64])
  })
})
