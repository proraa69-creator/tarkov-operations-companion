import { describe, expect, it } from 'vitest'
import type { RaidMode } from '../domain/types'
import { BALANCE_SHIFT, BALANCE_SHIFT_QUEST_IDS as B, CURATED_QUEST_IDS_BY_OTHER, curatedQuestsFor, LIGHTHOUSE_BTR, LIGHTHOUSE_BTR_QUEST_IDS as T, withCuratedTasks } from './curatedQuests'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'
import EVENT_PHOTOS from './eventGuidePhotos.json'

const PRAPOR = '54cb50c76803fa8b248b4571', SKIER = '58330581ace78e27b8b10cee', JAEGER = '5c0647fdd443bc2504c2d371'
const PEACEKEEPER = '5935c25fb3acc3127c3d8cd9', LIGHTKEEPER = '638f541a29ffd1183d187f57', BTR = '656f0f98d80a697f855d34b1'
const traders = Object.fromEntries([PRAPOR, SKIER, JAEGER, PEACEKEEPER, LIGHTKEEPER, BTR].map((id) => [id, { id }]))
const ARMORED_TRAIN = 'cc16b27f07697867c3afe8731a5323f8b6db7574'
/** As the maps file has them, in all three modes (06.11.2026). */
const maps = { maps: { lighthouse: { normalizedName: 'lighthouse', id: '5704e5fad2720bc05b8b4567', extracts: [{ id: ARMORED_TRAIN, position: { x: 6, y: 13, z: -869 } }], transits: [{ id: '22', position: { x: -293.34, y: 15.3, z: -780.71 } }] } } }
/** The map's own frame (src/data/mapGeometry.ts lighthouse). */
const inMap = (x: number, z: number) => x <= 515 && x >= -545 && z >= -998 && z <= 725

type Zone = { id: string; position: { x: number; z: number } }
type Objective = { id: string; type: string; description: string; count: number; optional: boolean; maps: string[]; zones: Zone[]; items?: string[]; questItem?: string; exitName?: string; targetNames?: string[]; useAny?: string[] }
type Task = { id: string; name: string; trader: string; experience: number; taskRequirements: Array<{ task: string; status: string[] }>; traderRequirements: Array<{ trader: string; value: number }>; objectives: Objective[]; finishRewards: { items: Array<{ item: string; count: number }> } }
const build = (mode: RaidMode = 'pvp', locale: 'ru' | 'en' = 'ru') => {
  const built = withCuratedTasks({ tasks: {} }, { mode, locale, maps, traders, series: [BALANCE_SHIFT, LIGHTHOUSE_BTR] })
  return { added: built.added, tasks: built.tasks.tasks as Record<string, Task> }
}

const ALL = [...Object.values(B), ...Object.values(T)]

describe('The Lighthouse quests of reports №77 and №78 and their chain', () => {
  for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
    it(`${mode}: all twelve are there, each with its trader, in both languages`, () => {
      const { added, tasks } = build(mode)
      const english = build(mode, 'en').tasks
      expect([...added].sort()).toEqual([...ALL].sort())
      expect(tasks[T.honestReview].name).toBe('Честный отзыв')
      expect(tasks[T.honestReview].trader).toBe(BTR)
      expect(english[T.honestReview].name).toBe('Honest Review')
      expect(tasks[B.familiarFace].name).toBe('Знакомое лицо...')
      expect(tasks[B.familiarFace].trader).toBe(SKIER)
      expect(english[B.familiarFace].name).toBe('A Familiar Face...')
      expect(tasks[B.cutDownToTheRoot].trader).toBe(JAEGER)
      expect(tasks[B.easeTheMove].trader).toBe(PEACEKEEPER)
      expect(tasks[B.preserveValuablePiece].trader).toBe(LIGHTKEEPER)
      for (const id of ALL) {
        const objectives = tasks[id].objectives
        expect(objectives.length).toBeGreaterThan(0)
        for (const [index, objective] of objectives.entries()) {
          expect(objective.description, `${id} ${index}`).toBeTruthy()
          expect(english[id].objectives[index].description).not.toBe(objective.description)
          expect(english[id].objectives[index].description).not.toMatch(/[а-яё]/i)
        }
      }
    })
  }

  it('the order: the two lines and what they open', () => {
    const { tasks } = build()
    const after = (id: string) => tasks[id].taskRequirements.map((requirement) => [requirement.task, requirement.status])
    const done = (id: string) => [id, ['complete']]
    expect(after(B.fogOfWar)).toEqual([])
    expect(after(B.numberUnavailable)).toEqual([done(B.fogOfWar)])
    expect(after(B.allInclusive)).toEqual([done(B.numberUnavailable)])
    expect(after(B.loseTheTail)).toEqual([done(B.allInclusive)])
    expect(after(B.callsignMalachite)).toEqual([done(B.loseTheTail)])
    // a Season character took «Знакомое лицо...» minutes after handing in Prapor's first quest (the game's log, 31.10.2026)
    expect(after(B.familiarFace)).toEqual([])
    expect(tasks[B.familiarFace].traderRequirements).toMatchObject([{ trader: SKIER, value: 2 }])
    expect(after(B.scopeTheClearing)).toEqual([done(B.familiarFace)])
    expect(after(B.cutDownToTheRoot)).toEqual([done(B.scopeTheClearing)])
    expect(after(B.easeTheMove)).toEqual([done(B.scopeTheClearing)])
    expect(after(B.preserveValuablePiece)).toEqual([[B.cutDownToTheRoot, ['active', 'complete']]])
    // «Рука помощи» taken opens the driver's quests; a player has «Честный отзыв» open at once with «Сечь поляну»
    expect(after(T.honestReview)).toEqual([['6752f6d83038f7df520c83e8', ['active', 'complete']]])
    expect(after(T.btrMyself)).toEqual([done(T.honestReview)])
    expect(after(B.scopeTheClearing).flat()).not.toContain(T.btrMyself)
  })

  it('the rewards: «Знакомое лицо...» as report №78 shows it, without the bonus; Season has its own helmets', () => {
    const rewards = (mode: RaidMode, id: string) => build(mode).tasks[id].finishRewards.items.map(({ item, count }) => [item, count])
    expect(build().tasks[B.familiarFace].experience).toBe(15_000)
    expect(rewards('pvp', B.familiarFace)).toEqual([['569668774bdc2da2298b4568', 1_800], ['69413241b1ce1e5fbb09ed0a', 2]])
    expect(rewards('pvp', T.honestReview)).toEqual([])
    expect(rewards('pvp', B.callsignMalachite)).toContainEqual(['5c091a4e0db834001d5addc8', 2])
    expect(rewards('pve', B.callsignMalachite)).toContainEqual(['5c091a4e0db834001d5addc8', 2])
    expect(rewards('seasonal', B.callsignMalachite)).toContainEqual(['5d6d3716a4b9361bc8618872', 2])
    expect(rewards('seasonal', B.callsignMalachite)).not.toContainEqual(['5c091a4e0db834001d5addc8', 2])
    // «Туман войны»: 2 packs, it said 42
    expect(rewards('pvp', B.fogOfWar)).toContainEqual(['6570257cc5d7d4cb4d078579', 2])
  })

  it('the points: where an objective has a place it lies on the map; only kills and talks have none', () => {
    const { tasks } = build()
    const zones = (id: string) => tasks[id].objectives.map((objective) => objective.zones.length)
    expect(zones(B.fogOfWar)).toEqual([1, 1, 3])
    expect(zones(B.numberUnavailable)).toEqual([1, 1, 1])
    expect(zones(B.allInclusive)).toEqual([0, 1, 1])
    expect(zones(B.loseTheTail)).toEqual([0, 0])
    expect(zones(B.callsignMalachite)).toEqual([1, 0, 0])
    expect(zones(B.familiarFace)).toEqual([1])
    expect(zones(B.scopeTheClearing)).toEqual([1, 1, 1])
    expect(zones(B.cutDownToTheRoot)).toEqual([0])
    expect(zones(B.easeTheMove)).toEqual([3, 2, 1])
    expect(zones(B.preserveValuablePiece)).toEqual([0])
    expect(zones(T.honestReview)).toEqual([1, 1, 1, 0, 0])
    expect(zones(T.btrMyself)).toEqual([0, 0])
    for (const id of ALL) {
      for (const objective of tasks[id].objectives) {
        for (const zone of objective.zones) expect(inMap(zone.position.x, zone.position.z), `${id} ${zone.id}`).toBe(true)
      }
    }
    expect(tasks[B.familiarFace].objectives[0]).toMatchObject({ type: 'extract', exitName: 'EXFIL_Train', zones: [{ id: `extract-${ARMORED_TRAIN}` }] })
    expect(tasks[B.allInclusive].objectives[1]).toMatchObject({ type: 'transit', zones: [{ id: 'transit-22' }] })
    expect(tasks[B.allInclusive].objectives[2].useAny).toEqual(['62178c4d4ecf221597654e3d', '62389ba9a63f32501b1b4451'])
    expect(tasks[B.easeTheMove].objectives.every((objective) => objective.type === 'mark' && objective.items?.[0] === '5991b51486f77447b112d44f')).toBe(true)
  })

  it('«Честный отзыв» points at the same places as the map\'s BTR stops', () => {
    const context = { items: new Map(), quests: [], maps: [{ id: 'lighthouse', name: 'Маяк' }] } as unknown as Parameters<typeof adaptLiveMapMarkers>[2]
    const stops = adaptLiveMapMarkers({ maps: { lighthouse: { normalizedName: 'lighthouse', btrStops: [] } } }, {}, context).filter((marker) => marker.layerId === 'btr')
    const at = (title: string) => stops.find((marker) => marker.title === title)!.id
    const { tasks } = build()
    const zone = (index: number) => tasks[T.honestReview].objectives[index].zones[0].position
    expect(at('Перекрёсток у деревни')).toBe(`lighthouse-btr-stop-${zone(0).x}-${zone(0).z}`)
    expect(at('КПП ООН')).toBe(`lighthouse-btr-stop-${zone(1).x}-${zone(1).z}`)
    expect(at('Парковка корпуса 2 водоочистки')).toBe(`lighthouse-btr-stop-${zone(2).x}-${zone(2).z}`)
  })

  it('the log lines of «Туман войны» under the game\'s id count for it', () => {
    expect(CURATED_QUEST_IDS_BY_OTHER.get('6a7637fed31fb1191903fc07')).toBe(B.fogOfWar)
  })

  it('the photos: tied to real objectives, the host our server takes them from, no maps, both languages', () => {
    const data = EVENT_PHOTOS as unknown as { quests: Record<string, { photos: Array<{ id: string; caption: string; captionEn: string; objectiveId?: string; alsoFor?: string[] }> }>; files: Record<string, { file: string; url: string }> }
    const { tasks } = build()
    const photos = ALL.flatMap((quest) => (data.quests[quest]?.photos ?? []).map((photo) => ({ quest, ...photo })))
    expect(photos).toHaveLength(16)
    for (const photo of photos) {
      for (const objectiveId of [photo.objectiveId, ...(photo.alsoFor ?? [])]) {
        if (objectiveId) expect(tasks[photo.quest].objectives.some((objective) => objective.id === objectiveId), objectiveId).toBe(true)
      }
      expect(data.files[photo.id].url).toMatch(/^https:\/\/minio\.tarkov\.help\/production\/img\/articles\/[0-9a-f-]{36}\.(jpg|webp|png)$/)
      expect(`${photo.caption} ${photo.captionEn}`).not.toMatch(/(^|[^а-яё])карт(а|е|у|ой|ы|ах|ами)?(?![а-яё])|\bmaps?\b/i)
      expect(photo.caption && photo.captionEn).toBeTruthy()
    }
  })

  it('the texts name no source', () => {
    const research = /tarkov\.(help|dev)|tarkov-?dev|wiki|вики|fandom|координат|coordinat|источник/i
    for (const { quest } of curatedQuestsFor('pvp', [BALANCE_SHIFT, LIGHTHOUSE_BTR])) {
      for (const line of [quest.note.ru, quest.note.en, ...quest.objectives.flatMap((objective) => [objective.text.ru, objective.text.en])]) expect(line).not.toMatch(research)
    }
  })
})
