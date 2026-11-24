import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import { applyCuratedQuestNotes, CURATED_QUEST_IDS_BY_OTHER, curatedQuestsFor, HALLOWEEN_2026, HALLOWEEN_2026_END, HALLOWEEN_QUEST_IDS, withCuratedTasks } from './curatedQuests'
import { canonicalMapId } from './mapIds'
import { mergeObservations } from '../quests/questInputs'
import EVENT_PHOTOS from './eventGuidePhotos.json'

const H = HALLOWEEN_QUEST_IDS
const DURING = Date.UTC(2026, 10, 2, 12)
const SKIER = '58330581ace78e27b8b10cee', THERAPIST = '54cb57776803fa99248b456e'
const traders = { [SKIER]: { id: SKIER }, [THERAPIST]: { id: THERAPIST } }
type Task = { id: string; name: string; taskRequirements: Array<{ task: string; status: string[] }>; availableDelaySecondsMin: number; availableDelaySecondsMax: number; objectives: Array<{ id: string; maps: string[]; zones: Array<{ id: string; map: string; position: { x: number; z: number } }> }> }
const build = (locale: 'ru' | 'en' = 'ru', now = DURING) => {
  const built = withCuratedTasks({ tasks: {} }, { mode: 'pvp', locale, maps: {}, traders, series: [HALLOWEEN_2026], now })
  return { added: built.added, tasks: built.tasks.tasks as Record<string, Task> }
}

describe('«Хеллоуин 2026»: the event quests (owner, 02.11.2026)', () => {
  it('holds the game\'s 19 quests of Skier and Therapist, in every mode, until the end the app shows', () => {
    expect(HALLOWEEN_2026.quests).toHaveLength(19)
    expect(HALLOWEEN_2026.quests.every((quest) => /^[0-9a-f]{24}$/.test(quest.id) && quest.name.ru.startsWith('Halloween: ') && quest.name.en.startsWith('Halloween: '))).toBe(true)
    expect(new Set(HALLOWEEN_2026.quests.map((quest) => quest.trader))).toEqual(new Set([SKIER, THERAPIST]))
    expect(HALLOWEEN_2026.modes).toEqual(['pvp', 'pve', 'seasonal'])
    expect(curatedQuestsFor('pve', [HALLOWEEN_2026], DURING)).toHaveLength(19)
    expect(curatedQuestsFor('pvp', [HALLOWEEN_2026], Date.parse(HALLOWEEN_2026_END))).toEqual([])
    expect(build().added.size).toBe(19)
  })

  it('the choices: either side opens the next ones, and the second ids of a choice quest count as the quest', () => {
    const { tasks } = build()
    expect(tasks[H.tightening].taskRequirements).toEqual([{ task: H.unexpectedHelp, status: ['complete', 'failed'] }])
    expect(tasks[H.newVaccine].taskRequirements).toEqual([{ task: H.initialExamination, status: ['complete', 'failed'] }])
    expect([tasks[H.tightening].availableDelaySecondsMin, tasks[H.tightening].availableDelaySecondsMax]).toEqual([900, 3600])
    expect(tasks[H.initialExamination].taskRequirements).toEqual([{ task: H.unexpectedHelp, status: ['active', 'complete'] }])
    expect(tasks[H.dangerZone].taskRequirements).toEqual([{ task: H.tightening, status: ['complete'] }])
    expect(tasks[H.highRisk].taskRequirements).toEqual([{ task: H.newVaccine, status: ['complete'] }])
    expect(CURATED_QUEST_IDS_BY_OTHER.get('6abb86cddcebb0efbc0fda8f')).toBe(H.tightening)
    expect(CURATED_QUEST_IDS_BY_OTHER.get('6abd18fed383d797d602d6c9')).toBe(H.newVaccine)
    const layer = mergeObservations({}, [
      { taskId: '6abb86cddcebb0efbc0fda8f', status: 'completed', timestamp: '2026-11-01T10:00:00.000Z' },
      { taskId: H.rumors, status: 'completed', timestamp: '2026-10-30T10:00:00.000Z' },
    ])
    expect(layer).toEqual({ [H.tightening]: { status: 'completed', at: '2026-11-01T10:00:00.000Z' }, [H.rumors]: { status: 'completed', at: '2026-10-30T10:00:00.000Z' } })
  })

  it('the points of the community maps are on the ordinary maps; a door or exit the files lack gives none', () => {
    const { tasks } = build()
    const zones = (id: string, objective: number) => tasks[id].objectives[objective].zones
    expect(zones(H.blindEnemy, 1).map((zone) => zone.map)).toEqual(['woods', 'woods'])
    expect(zones(H.blindEnemy, 2)).toHaveLength(3)
    expect(zones(H.blindEnemy, 2)[0]).toEqual({ id: 'point-th-16026', map: 'customs', position: { x: 233.9, z: 128.5 } })
    // the scientists: Factory's three points; the Lab's are an exit and a door the empty maps file does not have
    expect(zones(H.followUp, 0).map((zone) => zone.id)).toEqual(['point-th-16040', 'point-th-16041', 'point-th-16042'])
    // the infected locations are drawn as the ordinary Factory and Lab
    expect(tasks[H.rumors].objectives[0].maps).toEqual(['infected-factory'])
    expect(['infected-factory', 'infected-lab'].map(canonicalMapId)).toEqual(['factory', 'the-lab'])
  })

  it('№81: «Контрольная проверка» pays 300 000 ₽ as the game shows it, and Therapist pays no quest here in euros', () => {
    const ROUBLES = '5449016a4bdc2d6f028b456f', EUROS = '569668774bdc2da2298b4568'
    const followUp = HALLOWEEN_2026.quests.find((quest) => quest.id === H.followUp)!
    expect(followUp.rewards?.[0]).toEqual([ROUBLES, 300_000])
    const paid = HALLOWEEN_2026.quests.filter((quest) => quest.trader === THERAPIST).flatMap((quest) => quest.rewards ?? [])
    expect(paid.some(([id]) => id === EUROS)).toBe(false)
  })

  it('a choice quest\'s branch rewards and the achievements are reward lines', () => {
    const { tasks } = build()
    const rows = [H.tightening, H.blindEnemy].map((id) => ({ id, name: tasks[id].name, rewards: [] as string[] }))
    const noted = applyCuratedQuestNotes(rows as never, new Set([H.tightening, H.blindEnemy]), 'ru', new Map<string, Item>(), [HALLOWEEN_2026], DURING)
    expect(noted[0].rewards).toEqual(['Если вакцину получил Лыжник: 1 800 €, AK-12, 3 магазина и пачка 7Н40 (120 шт.)', 'Если вакцину получил Терапевт: 2 700 €, кейс для денег'])
    expect(noted[1].rewards).toEqual(['Достижение «Поднять щиты!»'])
    expect(noted[0].description).toMatch(/^Серия «Хеллоуин 2026» \(ивент Лыжника и Терапевта\), задание 6 из 19\. /)
  })

  it('the photos of the places: only the event\'s quests and objectives, tarkov.help\'s pictures, no maps, captions in both languages', () => {
    const data = EVENT_PHOTOS as { quests: Record<string, { photos: Array<{ id: string; caption: string; captionEn: string; objectiveId: string }> }>; files: Record<string, { file: string; url: string }> }
    const photos = Object.entries(data.quests).filter(([quest]) => (Object.values(H) as string[]).includes(quest)).flatMap(([quest, entry]) => entry.photos.map((photo) => ({ quest, ...photo })))
    expect(photos).toHaveLength(30)
    const { tasks } = build()
    for (const photo of photos) {
      expect(tasks[photo.quest].objectives.some((objective) => objective.id === photo.objectiveId), photo.objectiveId).toBe(true)
      expect(data.files[photo.id].url).toMatch(/^https:\/\/minio\.tarkov\.help\/production\/img\/articles\/[0-9a-f-]{36}\.(jpg|webp)$/)
      // the words scripts/quest-guide-photos.mjs drops a picture for («карта», «map»)
      expect(`${photo.caption} ${photo.captionEn} ${data.files[photo.id].file}`).not.toMatch(/(^|[^а-яё])карт(а|е|у|ой|ы|ах|ами)?(?![а-яё])|\bmaps?\b/i)
      expect(photo.caption && photo.captionEn).toBeTruthy()
    }
    // every camera of «Ослепить противника»: 2 on Woods, 3 on each other map
    expect([2, 3, 4, 5, 6].map((n) => photos.filter((photo) => photo.objectiveId === `${H.blindEnemy}-objective-${n}`).length)).toEqual([2, 3, 3, 3, 3])
  })

  it('the notes speak to the player: no sources, no data talk', () => {
    for (const quest of HALLOWEEN_2026.quests) {
      expect(`${quest.note.ru} ${quest.note.en}`, quest.name.en).not.toMatch(/tarkov\.(help|dev)|wiki|вики|fandom|координат|coordinat/i)
    }
  })
})
